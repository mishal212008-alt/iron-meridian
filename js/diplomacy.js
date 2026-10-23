// Дипломатия: отношения, договоры, границы, торговые сделки, предложения ботов.
// Без DOM. Состояние лежит в g.dip и сохраняется вместе с игрой.
import { BASE_PRICE, DIP, DIP_BASE, RES_ICON, RES_LABEL, STATES_DEF, TRADE_RES } from './data.js';

const N = STATES_DEF.length;
const pairKey = (a, b) => `${Math.min(a, b)}-${Math.max(a, b)}`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mat = (v) => Array.from({ length: N }, () => Array(N).fill(v));
const money = (v) => Math.round(v * 10) / 10;

// какому месторождению соответствует ресурс (чтобы понять, добывает ли страна его сама)
const RES_DEPOSIT = { steel: 'steel', fuel: 'oil', gold: 'gold', rare: 'rare' };

export const STATUS_LABEL = { neutral: 'Нейтралитет', friend: 'Дружба', ally: 'Союз', war: 'Война' };

export function initDiplomacy(g) {
  const rel = mat(0), status = mat('neutral'), since = mat(0);
  for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
    if (a === b) continue;
    rel[a][b] = DIP_BASE[pairKey(a, b)] ?? 0;
  }
  g.dip = { rev: 1, rel, status, since, closed: mat(false), deals: [], offers: [], nextId: 1, log: [], cool: {}, wars: {} };
}

// ---------- простые запросы ----------
export const relOf = (g, a, b) => g.dip.rel[a][b];
export const statusOf = (g, a, b) => g.dip.status[a][b];
export const isClosed = (g, a, b) => g.dip.closed[a][b] || g.dip.closed[b][a];
export function relWord(r) {
  return r <= -60 ? 'Вражда' : r <= -25 ? 'Холодные' : r < 15 ? 'Нейтральные' : r < 45 ? 'Тёплые' : r < 75 ? 'Дружеские' : 'Братские';
}
export const dealsBetween = (g, a, b) => g.dip.deals.filter((d) => (d.seller === a && d.buyer === b) || (d.seller === b && d.buyer === a));

// почему нельзя торговать (null — можно)
export function tradeBlock(g, a, b) {
  if (statusOf(g, a, b) === 'war') return 'Идёт война';
  if (g.dip.closed[a][b]) return `${g.states[a].name} закрыла границу`;
  if (g.dip.closed[b][a]) return `${g.states[b].name} закрыла границу`;
  return null;
}

export function logDip(g, text, important = false, a = -1, b = -1) {
  g.dip.log.unshift({ day: g.day, text, a, b });
  if (g.dip.log.length > 60) g.dip.log.length = 60;
  const me = g.playerState;
  if (important || a === me || b === me) g.events.push(`🤝 ${text}`);
}

function addRel(g, a, b, v) {
  const r = clamp(g.dip.rel[a][b] + v, -100, 100);
  g.dip.rel[a][b] = r; g.dip.rel[b][a] = r;
}
function setStatus(g, a, b, st) {
  g.dip.status[a][b] = st; g.dip.status[b][a] = st; g.dip.since[a][b] = g.day; g.dip.since[b][a] = g.day;
  g.dip.rev++;
}

// ---------- цены ----------
// сколько ресурс стоит для конкретного государства прямо сейчас
export function valueFor(g, s, res) {
  let v = BASE_PRICE[res];
  const stock = s[res];
  const rate = s.rate ? s.rate[res] : 0;
  if (stock < 60) v *= 1.45; else if (stock < 150) v *= 1.25; else if (stock > 2000) v *= 0.65; else if (stock > 900) v *= 0.82;
  if (rate < -1 && stock < 400) v *= 1.15;
  const dk = RES_DEPOSIT[res];
  if (dk && !g.provs.some((p) => p.owner === s.id && p.deposits[dk] > 0)) v *= 1.15; // своей добычи нет
  return v;
}
export const fairPrice = (res) => BASE_PRICE[res];

// ---------- оценка предложений ИИ ----------
export function evaluate(g, from, to, kind, params = {}) {
  const reasons = [];
  const rel = relOf(g, from, to), st = statusOf(g, from, to);
  const T = STATES_DEF[to].trait;
  const fail = (t) => { reasons.push(t); return { accept: false, reasons }; };
  const win = (t) => { reasons.push(t); return { accept: true, reasons }; };

  if (kind === 'friend') {
    if (st === 'war') return fail('Мы воюем');
    if (st !== 'neutral') return fail('Договор уже есть');
    const need = DIP.friendMin + T.hostile * 10;
    if (rel < need) return fail(`Отношения недостаточно тёплые (нужно ${Math.round(need)}, сейчас ${Math.round(rel)})`);
    return win('Дружба выгодна обеим сторонам');
  }
  if (kind === 'ally') {
    if (st !== 'friend') return fail('Сначала нужен договор о дружбе');
    const need = DIP.allyMin + T.hostile * 10;
    if (rel < need) return fail(`Мало доверия для союза (нужно ${Math.round(need)}, сейчас ${Math.round(rel)})`);
    if (isClosed(g, from, to)) return fail('Закройте вопрос границы: союзники держат её открытой');
    return win('Союз заключён');
  }
  if (kind === 'peace') {
    if (st !== 'war') return fail('Войны нет');
    const days = g.day - g.dip.since[from][to];
    if (days < DIP.warPeaceDays * (0.5 + T.hostile * 0.5)) return fail(`Рано для мира (война идёт ${days} дн.)`);
    return win('Они согласны на мир');
  }
  if (kind === 'deal') {
    const { seller, buyer, res, amt, price } = params;
    const block = tradeBlock(g, seller, buyer);
    if (block) return fail(block);
    if (rel < -30) return fail('Отношения слишком плохи для торговли');
    const relMod = clamp(rel / 250, -0.15, 0.35) + (st === 'ally' ? 0.08 : st === 'friend' ? 0.04 : 0);
    const me = g.states[to];
    if (to === buyer) {
      const val = valueFor(g, me, res);
      const limit = val * (1 + relMod) * (1.08 / Math.max(0.8, T.greed));
      if (me[res] > 2200) return fail('Склады забиты, им это не нужно');
      if (me.money < price * amt * 10) return fail('Не хватит денег платить за поставки');
      if (price > limit) return fail(`Дорого: для них ресурс стоит около ${money(limit)}💰`);
      reasons.push(me[res] < 150 ? 'Им остро нужен этот ресурс' : 'Цена приемлема');
      return { accept: true, reasons };
    }
    const val = valueFor(g, me, res);
    const floor = val * (1 - relMod) * Math.max(0.8, T.greed) * 0.97;
    const reserve = res === 'steel' || res === 'fuel' ? 120 : 40;
    if (me[res] - amt * 12 < reserve) return fail('Нет запаса для таких поставок');
    if (price < floor) return fail(`Дёшево: меньше ${money(floor)}💰 они не продадут`);
    reasons.push('Сделка выгодна');
    return { accept: true, reasons };
  }
  return fail('Неизвестное предложение');
}

// ---------- применение ----------
export function createDeal(g, { seller, buyer, res, amt, price, days }) {
  const d = { id: g.dip.nextId++, seller, buyer, res, amt, price, start: g.day, until: days ? g.day + days : null, fails: 0, state: 'active' };
  g.dip.deals.push(d);
  addRel(g, seller, buyer, 3);
  logDip(g, `Сделка: ${g.states[seller].name} продаёт ${g.states[buyer].name} ${RES_ICON[res]} ${amt}/дн. по ${money(price)}💰`, false, seller, buyer);
  g.dip.rev++;
  return d;
}

export function cancelDeal(g, id, by = -1, why = '') {
  const i = g.dip.deals.findIndex((d) => d.id === id);
  if (i < 0) return;
  const d = g.dip.deals[i];
  g.dip.deals.splice(i, 1);
  if (by >= 0 && g.day - d.start < 20) addRel(g, d.seller, d.buyer, -4);
  logDip(g, `Сделка расторгнута: ${g.states[d.seller].name} → ${g.states[d.buyer].name}, ${RES_ICON[d.res]}${why ? ' (' + why + ')' : ''}`, false, d.seller, d.buyer);
}

function applyKind(g, from, to, kind, params) {
  if (kind === 'friend') { setStatus(g, from, to, 'friend'); addRel(g, from, to, 6); logDip(g, `${g.states[from].name} и ${g.states[to].name} заключили договор о дружбе`, true, from, to); }
  else if (kind === 'ally') { setStatus(g, from, to, 'ally'); g.dip.closed[from][to] = false; g.dip.closed[to][from] = false; addRel(g, from, to, 10); logDip(g, `${g.states[from].name} и ${g.states[to].name} стали союзниками`, true, from, to); }
  else if (kind === 'peace') { setStatus(g, from, to, 'neutral'); addRel(g, from, to, 25); logDip(g, `${g.states[from].name} и ${g.states[to].name} заключили мир`, true, from, to); }
  else if (kind === 'deal') createDeal(g, params);
}

// Предложение. Если адресат — игрок, оно ложится во входящие; иначе решает ИИ.
export function propose(g, from, to, kind, params = {}) {
  if (g.states[to].isPlayer && !g.states[from].isPlayer) {
    if (g.dip.offers.some((o) => o.from === from && o.to === to)) return { ok: false, msg: 'Уже есть предложение', reasons: [] };
    g.dip.offers.push({ id: g.dip.nextId++, from, to, kind, params, expires: g.day + DIP.offerLife });
    g.dip.rev++;
    g.events.push(`📨 Предложение от ${g.states[from].name}: ${offerText(g, g.dip.offers[g.dip.offers.length - 1])}`);
    return { ok: true, msg: 'Предложение отправлено', reasons: [] };
  }
  const ev = evaluate(g, from, to, kind, params);
  if (ev.accept) { applyKind(g, from, to, kind, params); return { ok: true, msg: `${g.states[to].name} согласна`, reasons: ev.reasons }; }
  // отказ немного портит отношения только при явной наглости с ценой
  return { ok: false, msg: `${g.states[to].name} отказывает`, reasons: ev.reasons };
}

export function offerText(g, o) {
  const A = g.states[o.from].name;
  if (o.kind === 'friend') return `${A} предлагает договор о дружбе`;
  if (o.kind === 'ally') return `${A} предлагает союз`;
  if (o.kind === 'peace') return `${A} предлагает мир`;
  const p = o.params;
  const sell = p.seller === o.from;
  return sell
    ? `${A} продаёт вам ${RES_ICON[p.res]} ${RES_LABEL[p.res]}: ${p.amt}/дн. по ${money(p.price)}💰${p.days ? ', ' + p.days + ' дн.' : ''}`
    : `${A} хочет купить у вас ${RES_ICON[p.res]} ${RES_LABEL[p.res]}: ${p.amt}/дн. по ${money(p.price)}💰${p.days ? ', ' + p.days + ' дн.' : ''}`;
}

export function offerError(g, o) {
  if (o.kind === 'deal') {
    const p = o.params, me = g.playerState;
    const block = tradeBlock(g, p.seller, p.buyer);
    if (block) return block;
    if (p.seller === me && g.states[me][p.res] < p.amt) return 'У вас нет столько на складе';
    if (p.buyer === me && g.states[me].money < p.price * p.amt) return 'Не хватает денег';
  }
  if (o.kind === 'friend' && statusOf(g, o.from, o.to) !== 'neutral') return 'Уже неактуально';
  if (o.kind === 'ally' && statusOf(g, o.from, o.to) !== 'friend') return 'Уже неактуально';
  if (o.kind === 'peace' && statusOf(g, o.from, o.to) !== 'war') return 'Уже неактуально';
  return null;
}

export function answerOffer(g, id, accept) {
  const i = g.dip.offers.findIndex((o) => o.id === id);
  if (i < 0) return { ok: false, msg: 'Предложение устарело' };
  const o = g.dip.offers[i];
  if (accept) {
    const err = offerError(g, o);
    if (err) return { ok: false, msg: err };
    g.dip.offers.splice(i, 1);
    applyKind(g, o.from, o.to, o.kind, o.params);
    g.dip.rev++;
    return { ok: true, msg: 'Принято' };
  }
  g.dip.offers.splice(i, 1);
  addRel(g, o.from, o.to, -1);
  g.dip.rev++;
  return { ok: true, msg: 'Отклонено' };
}

// ---------- действия (игрок и боты) ----------
export function setBorder(g, a, b, closed) {
  if (g.dip.closed[a][b] === closed) return { ok: true, msg: '' };
  if (!closed && statusOf(g, a, b) === 'war') return { ok: false, msg: 'Во время войны граница заперта' };
  if (closed && statusOf(g, a, b) === 'ally') return { ok: false, msg: 'Союзникам границу не закрывают: сначала расторгните союз' };
  g.dip.closed[a][b] = closed;
  g.dip.rev++;
  addRel(g, a, b, closed ? (statusOf(g, a, b) === 'friend' ? -12 : -6) : 2);
  logDip(g, `${g.states[a].name} ${closed ? 'закрыла' : 'открыла'} границу для ${g.states[b].name}`, closed, a, b);
  if (closed) for (const d of [...dealsBetween(g, a, b)]) cancelDeal(g, d.id, -1, 'граница закрыта');
  return { ok: true, msg: closed ? 'Граница закрыта' : 'Граница открыта' };
}

export function breakPact(g, a, b) {
  const st = statusOf(g, a, b);
  if (st !== 'friend' && st !== 'ally') return { ok: false, msg: 'Нет договора' };
  addRel(g, a, b, st === 'ally' ? -25 : -15);
  setStatus(g, a, b, 'neutral');
  logDip(g, `${g.states[a].name} расторгла ${st === 'ally' ? 'союз' : 'договор о дружбе'} с ${g.states[b].name}`, true, a, b);
  return { ok: true, msg: 'Договор расторгнут' };
}

export function declareWar(g, a, b) {
  const st = statusOf(g, a, b);
  if (st === 'war') return { ok: false, msg: 'Уже воюем' };
  if (st !== 'neutral') return { ok: false, msg: 'Сначала расторгните договор' };
  setStatus(g, a, b, 'war');
  g.dip.rel[a][b] = Math.min(g.dip.rel[a][b], -60); g.dip.rel[b][a] = g.dip.rel[a][b];
  g.dip.closed[a][b] = true; g.dip.closed[b][a] = true;
  for (const d of [...dealsBetween(g, a, b)]) cancelDeal(g, d.id, -1, 'война');
  for (const o of [...g.dip.offers]) if ((o.from === a && o.to === b) || (o.from === b && o.to === a)) g.dip.offers.splice(g.dip.offers.indexOf(o), 1);
  // союзники обеих сторон портят отношения с агрессором
  for (let c = 0; c < N; c++) if (c !== a && c !== b) {
    if (statusOf(g, c, b) === 'ally') addRel(g, c, a, -25);
    if (statusOf(g, c, a) === 'ally') addRel(g, c, b, -10);
  }
  logDip(g, `${g.states[a].name} объявила войну государству ${g.states[b].name}!`, true, a, b);
  return { ok: true, msg: 'Война объявлена' };
}

export function gift(g, a, b, amount = 100) {
  const s = g.states[a];
  if (s.money < amount) return { ok: false, msg: 'Не хватает денег' };
  const key = `gift-${a}-${b}`;
  if ((g.dip.cool[key] ?? -99) > g.day - 5) return { ok: false, msg: 'Подарки не чаще раза в 5 дней' };
  g.dip.cool[key] = g.day;
  s.money -= amount; g.states[b].money += amount;
  addRel(g, a, b, DIP.giftRel);
  logDip(g, `${g.states[a].name} передала ${g.states[b].name} ${amount}💰 в подарок`, false, a, b);
  return { ok: true, msg: 'Подарок вручён' };
}

// ---------- ежедневный шаг ----------
export function stepDiplomacy(g) {
  const d = g.dip;
  // отношения тянутся к «естественному» уровню пары
  for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) {
    const st = d.status[a][b];
    let target = DIP_BASE[pairKey(a, b)] ?? 0;
    if (st === 'friend') target += 18; else if (st === 'ally') target += 35; else if (st === 'war') target = -70;
    target += dealsBetween(g, a, b).length * 6;
    if (d.closed[a][b]) target -= 12; if (d.closed[b][a]) target -= 12;
    const r = d.rel[a][b];
    const next = clamp(r + clamp((target - r) * 0.04, -0.5, 0.5), -100, 100);
    d.rel[a][b] = next; d.rel[b][a] = next;
  }
  d.offers = d.offers.filter((o) => o.expires > g.day);
  runDeals(g);
}

export function runDeals(g) {
  for (const s of g.states) { s.trade = { money: 0 }; for (const k of TRADE_RES) s.trade[k] = 0; }
  for (const deal of [...g.dip.deals]) {
    if (deal.until && g.day >= deal.until) { cancelDeal(g, deal.id, -1, 'срок истёк'); continue; }
    const S = g.states[deal.seller], B = g.states[deal.buyer];
    const block = tradeBlock(g, deal.seller, deal.buyer);
    if (block) { deal.state = 'blocked'; deal.why = block; continue; }
    let amt = Math.min(deal.amt, Math.floor(S[deal.res]));
    const maxByMoney = Math.floor(B.money / deal.price);
    let why = '';
    if (amt < deal.amt) why = `${S.name}: не хватает товара`;
    if (maxByMoney < amt) { amt = maxByMoney; why = `${B.name}: не хватает денег`; }
    if (amt <= 0) {
      deal.fails++; deal.state = 'short'; deal.why = why;
      if (deal.fails >= 12) { addRel(g, deal.seller, deal.buyer, -8); cancelDeal(g, deal.id, -1, 'срыв поставок'); }
      continue;
    }
    deal.state = why ? 'short' : 'active'; deal.why = why;
    deal.fails = why ? deal.fails + 1 : 0;
    const cost = amt * deal.price;
    S[deal.res] -= amt; B[deal.res] += amt;
    B.money -= cost; S.money += cost;
    S.trade[deal.res] -= amt; B.trade[deal.res] += amt;
    S.trade.money += cost; B.trade.money -= cost;
    addRel(g, deal.seller, deal.buyer, 0.04);
  }
}

// ---------- ИИ ----------
export function summarizeNeeds(g, s) {
  const needs = [], surplus = [];
  const hasFactory = g.provs.some((p) => p.owner === s.id && p.buildings.some((b) => b.type === 'electronics' && b.level > 0));
  for (const res of TRADE_RES) {
    const stock = s[res];
    const lowAt = res === 'fuel' || res === 'steel' ? 160 : res === 'electronics' ? 0 : hasFactory ? 60 : 0;
    if (lowAt && stock < lowAt) needs.push(res);
    const hiAt = res === 'fuel' ? 400 : res === 'steel' ? 450 : res === 'electronics' ? 120 : 140;
    if (stock > hiAt) surplus.push(res);
  }
  return { needs, surplus };
}

function myDeals(g, id) { return g.dip.deals.filter((d) => d.seller === id || d.buyer === id); }

export function botDiplomacy(g, s) {
  const me = s.id, d = g.dip;
  const T = STATES_DEF[me].trait;
  const { needs, surplus } = summarizeNeeds(g, s);
  const others = g.states.filter((o) => o.id !== me);

  // границы и войны
  for (const o of others) {
    const rel = relOf(g, me, o.id), st = statusOf(g, me, o.id);
    if (st === 'war') {
      const days = g.day - d.since[me][o.id];
      if (days > DIP.warPeaceDays && rel > -62 && Math.random() < 0.25) propose(g, me, o.id, 'peace');
      continue;
    }
    if (!d.closed[me][o.id] && rel < -38 && st !== 'ally') setBorder(g, me, o.id, true);
    else if (d.closed[me][o.id] && rel > -8) setBorder(g, me, o.id, false);
    if (st === 'neutral' && rel < -78 && Math.random() < 0.04 * T.hostile) declareWar(g, me, o.id);
    if (st === 'neutral' && rel > 26 && Math.random() < 0.3 && !(d.cool[`f${me}-${o.id}`] > g.day)) { d.cool[`f${me}-${o.id}`] = g.day + 20; propose(g, me, o.id, 'friend'); }
    if (st === 'friend' && rel > 58 && Math.random() < 0.1 && !(d.cool[`a${me}-${o.id}`] > g.day)) { d.cool[`a${me}-${o.id}`] = g.day + 30; propose(g, me, o.id, 'ally'); }
  }

  // торговля
  if (myDeals(g, me).length >= 6) return;
  const tryDeal = (res, partner, asBuyer) => {
    if (partner.id === me) return false;
    if (tradeBlock(g, me, partner.id) || relOf(g, me, partner.id) < -20) return false;
    const key = `d${me}-${partner.id}-${res}`;
    if ((d.cool[key] ?? -99) > g.day) return false;
    if (g.dip.deals.some((x) => x.res === res && ((x.seller === me && x.buyer === partner.id) || (x.seller === partner.id && x.buyer === me)))) return false;
    d.cool[key] = g.day + 14;
    const base = valueFor(g, s, res);
    const price = money(asBuyer ? base * (0.95 + Math.random() * 0.12) : base * (1.0 + Math.random() * 0.15));
    const amt = Math.max(2, Math.round((4 + Math.random() * 8) / 2) * 2);
    const params = { seller: asBuyer ? partner.id : me, buyer: asBuyer ? me : partner.id, res, amt, price, days: 45 };
    if (partner.isPlayer) {
      if (asBuyer && partner[res] < amt * 10) return false;            // у игрока нечего продавать
      if (!asBuyer && partner[res] > 400) return false;               // игроку это не нужно
      if (d.offers.filter((o) => o.to === partner.id).length >= 2) return false;
    }
    return propose(g, me, partner.id, 'deal', params).ok;
  };
  for (const res of needs) {
    const partners = others.filter((o) => o[res] > (o.isPlayer ? 300 : 260)).sort((a, b) => relOf(g, me, b.id) - relOf(g, me, a.id));
    for (const p of partners) if (tryDeal(res, p, true)) break;
  }
  for (const res of surplus) {
    const partners = others.filter((o) => o[res] < 150).sort((a, b) => relOf(g, me, b.id) - relOf(g, me, a.id));
    for (const p of partners) if (tryDeal(res, p, false)) break;
  }
}

// подсказки для игрока: что можно выгодно предложить конкретному государству
export function hintsFor(g, me, other) {
  const A = g.states[me], B = g.states[other];
  const out = [];
  for (const res of TRADE_RES) {
    const vb = valueFor(g, B, res), va = valueFor(g, A, res);
    if (A[res] > 120 && B[res] < 220 && vb > va) out.push({ res, dir: 'sell', price: money(Math.max(va * 1.05, vb * 0.97)), why: `${B.name} нуждается в ${RES_LABEL[res].toLowerCase()}` });
    if (B[res] > 220 && A[res] < 220 && va >= vb) out.push({ res, dir: 'buy', price: money(Math.min(va * 0.97, vb * 1.08)), why: `${B.name} располагает запасом` });
  }
  return out;
}
