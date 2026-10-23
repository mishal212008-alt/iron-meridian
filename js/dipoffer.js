// Предложения: прозрачная оценка ботом (факторы, вероятность, причины отказа, встречные условия). Без DOM.
import { BASE_PRICE, DIP, DIP_COST, DIP_DIFF, ECON, RES_ICON, RES_LABEL, STOCK_TARGET, TREATIES } from './data.js';
import {
  clamp, commonEnemy, dealsBetween, effPower, fearOf, hasTies, hasTreaty, inWar, interdependence, interestOf, isClosed, logDip, money, overlordOf, perceive,
  repGood, spend, statusOf, threatTo, tradeBlock, treatiesBetween, valueFor, feel, addTrust, relOf,
} from './dipcore.js';
import { applyPeace, scoreFor, sideOf, warBetween } from './dipwar.js';
import { appointAmbassador, createDeal, establishTies, grantLoan, signTreaty } from './diptreaty.js';

export const OFFER_KINDS = ['ties', 'trade', 'friend', 'nap', 'defense', 'offense', 'ally', 'protect', 'truce', 'whitepeace', 'peacetreaty', 'deal', 'loan'];
export const KIND_NAME = { ties: 'Дипотношения', deal: 'Торговая сделка', loan: 'Заём', ...Object.fromEntries(Object.entries(TREATIES).map(([k, v]) => [k, v.name])) };
const costOf = (kind) => ({ ties: DIP_COST.relations, deal: DIP_COST.deal, loan: DIP_COST.loan }[kind] ?? DIP_COST[kind] ?? 3);
export const offerCost = costOf;
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const marketSell = (res, stock) => BASE_PRICE[res] * Math.max(ECON.sellFloor, Math.min(1, STOCK_TARGET[res] / Math.max(stock, 1)));
const marketBuy = (res, stock) => ECON.buyMarkup * BASE_PRICE[res] * (1 + Math.max(0, 1 - stock / STOCK_TARGET[res]) * 0.8);
const valueBase = (res) => BASE_PRICE[res];

const IDEO_OF = (g, s) => g.dip.pers[s].ideo;

// Жёсткие условия (без них вероятность 0)
export function prerequisite(g, from, to, kind, p = {}) {
  const d = g.dip, st = statusOf(g, from, to);
  const war = st === 'war' || st === 'ceasefire';
  if (from === to) return 'Нельзя';
  if (['truce', 'whitepeace', 'peacetreaty'].includes(kind)) {
    if (st === 'ceasefire' && kind === 'truce') return 'Перемирие уже действует';
    if (!warBetween(g, from, to)) return 'Войны нет';
    if (kind === 'truce' && st !== 'war') return 'Уже действует перемирие';
    return null;
  }
  if (st === 'war') return 'Мы воюем';
  if (st === 'ceasefire' && kind !== 'ties') return 'Действует перемирие: сначала мир';
  if (overlordOf(g, from) >= 0 && !['deal'].includes(kind)) return 'Вассал не вправе заключать договоры сам';
  if (overlordOf(g, to) >= 0 && !['deal'].includes(kind)) return 'Адресат — вассал';
  if (kind === 'ties') return d.ties[from][to] ? 'Отношения уже есть' : null;
  if (!d.ties[from][to]) return 'Нужны дипломатические отношения';
  if (kind === 'deal') {
    const b = tradeBlock(g, p.seller, p.buyer);
    return b || null;
  }
  if (kind === 'loan') return war ? 'Война' : null;
  if (hasTreaty(g, from, to, kind)) return 'Такой договор уже есть';
  if (kind === 'defense' && !(hasTreaty(g, from, to, 'friend') || hasTreaty(g, from, to, 'nap') || hasTreaty(g, from, to, 'trade'))) return 'Для оборонного пакта нужен договор о дружбе, ненападении или торговле';
  if (kind === 'offense') {
    if (p.target === undefined) return 'Укажите цель';
    if (p.target === from || p.target === to) return 'Неверная цель';
    if (!hasTreaty(g, from, to, 'friend') && !hasTreaty(g, from, to, 'defense')) return 'Для наступательного пакта нужна дружба или оборонный пакт';
  }
  if (kind === 'ally' && !hasTreaty(g, from, to, 'friend')) return 'Для союза нужен договор о дружбе';
  if (kind === 'ally' && isClosed(g, from, to)) return 'Закройте вопрос границы: союзники держат её открытой';
  if (kind === 'protect') {
    if (p.over === undefined) return 'Укажите покровителя';
    if (g.dip.treaties.some((t) => t.state === 'active' && t.kind === 'protect' && t.b === (p.over === from ? to : from))) return 'Уже под протекторатом';
  }
  return null;
}

// Главная оценка: score >= 0 — согласие. Вероятность = сигмоида. Все слагаемые показываем игроку.
export function evaluateOffer(g, from, to, kind, p = {}) {
  const d = g.dip;
  const out = { kind, accept: false, p: 0, score: 0, factors: [], reasons: [], counter: null, hard: null };
  const hard = prerequisite(g, from, to, kind, p);
  if (hard) { out.hard = hard; out.reasons = [hard]; return out; }
  const P = d.pers[to];
  const diff = DIP_DIFF[g.difficulty] || DIP_DIFF.normal;
  const F = out.factors;
  const add = (label, v, hint = '') => { if (Math.abs(v) >= 0.4) F.push({ label, v: Math.round(v * 10) / 10, hint }); };
  const rel = relOf(g, to, from), trust = d.trust[to][from];
  const peace = ['truce', 'whitepeace', 'peacetreaty'].includes(kind);
  const mil = ['defense', 'offense', 'ally', 'protect'].includes(kind);
  const tier = TREATIES[kind] ? TREATIES[kind].tier : 1;
  const per = perceive(g, to, from);                                 // бот видит силу партнёра с шумом
  const myP = effPower(g, to);
  const ratio = per.power / Math.max(0.01, myP);                     // >1: партнёр сильнее

  if (kind === 'deal') return evaluateDeal(g, from, to, p, out, add);
  if (kind === 'loan') return evaluateLoan(g, from, to, p, out, add);

  add('Отношение к вам', rel * 0.35);
  add('Доверие', trust * 0.12);
  if (!peace) {
    add('Репутация надёжности', (d.rep[from].reliab - 60) * 0.3);
    if (mil || kind === 'friend') add('Репутация агрессора', -(d.rep[from].aggr - 30) * 0.12);
  }

  if (kind === 'ties') {
    add('Желание держать связь', 6);
    add('Выгода от торговли', interestOf(g, to, from) * 0.3);
    if (isClosed(g, from, to)) add('Граница закрыта', -6);
  } else if (kind === 'trade') {
    add('Выгода от торговли', interestOf(g, to, from) * 0.8 + 5, 'торговые соглашения сильнее на стыке потребностей');
    add('Жадность: выгода важнее', (P.greed - 0.5) * 8);
    if (d.embargo[from][to] || d.embargo[to][from]) add('Эмбарго между нами', -14);
  } else if (kind === 'friend') {
    add('Выгода от торговли', interestOf(g, to, from) * 0.4);
    add('Идеологическая близость', IDEO_OF(g, from) === IDEO_OF(g, to) ? 5 : -3);
    add('Общий враг', commonEnemy(g, to, from) * 0.5);
    add(`Уровень договора (${tier})`, -3);
  } else if (kind === 'nap') {
    add('Страх перед вашей силой', (ratio > 1 ? Math.min(14, (ratio - 1) * 8) : 0) * (0.5 + P.caution));
    add('Осторожность', (P.caution - 0.5) * 10);
    add('Угроза с вашей стороны', threatTo(g, to, from) * 0.1);
    add('Желание вольной руки', -(P.aggr - 0.4) * 10);
  } else if (mil) {
    add('Общий враг', commonEnemy(g, to, from) * (kind === 'offense' ? 0.4 : 0.9));
    add('Честь: верность слову', (P.honor - 0.5) * (kind === 'ally' ? 12 : 6));
    add(`Серьёзность обязательств (${tier})`, -tier * 3.4);
    add('Идеологическая близость', IDEO_OF(g, from) === IDEO_OF(g, to) ? 5 : -4);
    if (kind === 'defense') {
      add('Осторожность ищет защиты', P.caution * 6 + Math.max(0, ratio - 1) * 3);
      if (p.binding) add('Обязательный вариант пакта', -5 + (P.honor - 0.5) * 6);
      if (p.noChain) add('Оговорка от цепной реакции', 4);
    }
    if (kind === 'offense') {
      add('Агрессивность', (P.aggr - 0.4) * 22);
      const tgt = p.target;
      add(`Отношение к цели (${g.states[tgt].name})`, -relOf(g, to, tgt) * 0.25);
      add('Сила цели', -Math.max(0, perceive(g, to, tgt).power / Math.max(0.01, myP) - 0.7) * 10);
      if (d.rep[tgt].aggr > 55) add('Цель опасна для всех', 3);
    }
    if (kind === 'ally') {
      add('Баланс сил: союз с сильным', Math.min(8, Math.max(-6, (ratio - 1) * 6)));
      add('Осторожность', P.caution * 3);
    }
    if (kind === 'protect') {
      const overIsFrom = p.over === from;
      if (overIsFrom) {           // бот-вассал
        add('Страх сильного соседа', clamp((ratio - 1) * 14, -12, 22) * (0.4 + P.caution));
        add('Гордость', -(P.aggr + P.honor) * 7);
        add('Потеря самостоятельности', -10);
      } else {                    // бот-покровитель
        add('Выгода от дани', 6 + P.greed * 6);
        add('Слабость вассала', clamp((1 - 1 / Math.max(0.2, ratio)) * 0, -4, 0));
        add('Ответственность за защиту', -6 + (P.aggr - 0.4) * 4);
      }
    }
  } else if (peace) {
    const war = warBetween(g, from, to);
    const side = sideOf(war, to);
    const sc = scoreFor(war, to);
    const days = g.day - war.start;
    add('Счёт войны для нас', sc * 0.28, sc >= 0 ? 'мы выигрываем: зачем мир?' : 'мы проигрываем');
    add('Усталость от войны', (war.exh[side] || 0) * 0.28);
    add('Воинственность', -(P.aggr - 0.4) * 14);
    add('Рано для мира', days < 12 ? -(12 - days) * 1.1 : 0);
    add('Гордость (честь)', -(P.honor - 0.5) * (sc > 0 ? 5 : 1));
    add('Потеря лица', -Math.max(0, 50 - d.face[to]) * 0.1);
    if (war.cb && hasCbFor(g, to, from)) add('У нас есть повод к войне', -5);
    if (kind === 'peacetreaty') {
      const contrib = p.contrib || 0;
      if (p.payer === to) add(`Мы платим контрибуцию ${contrib}💰`, -contrib / 12 - (P.aggr * 4));
      else if (contrib) add(`Нам платят контрибуцию ${contrib}💰`, Math.min(14, contrib / 18 + P.greed * 3));
      if (p.dmz) add('Демилитаризованная зона', p.payer === to ? -6 : 3);
    }
    if (kind === 'whitepeace') add('Белый мир без условий', sc < 0 ? 5 : -2);
    if (kind === 'truce') add('Передышка выгодна', 3 + (war.exh[side] || 0) * 0.05);
  }

  // Общие факторы
  if (!peace && kind !== 'ties') {
    add('Страх перед сильным (умиротворение)', ratio > 1.3 && !mil ? Math.min(6, (ratio - 1.3) * 5) * P.caution : 0);
    const bal = balanceOfThreat(g, to, from);
    add('Баланс угрозы: вы опасны для всех', bal.v, bal.hint);
  }
  if (p.sweet && p.sweet.money) add(`Приплата ${p.sweet.money}💰`, Math.min(18, p.sweet.money / 22));
  if (p.sweet && p.sweet.res) add(`Уступка ресурса ${RES_LABEL[p.sweet.res.res]}`, Math.min(14, (p.sweet.res.amt * valueBase(p.sweet.res.res)) / 22));
  if (from === g.playerState) add(`Сложность (${{ easy: 'лёгкая', normal: 'обычная', hard: 'тяжёлая' }[g.difficulty] || 'обычная'})`, diff.lenient);
  if (p.days && p.days > (TREATIES[kind].days || 0) * 1.5 && TREATIES[kind].days) add('Слишком долгий срок', -3);
  return finish(g, from, to, kind, p, out);
}
const hasCbFor = (g, a, b) => g.dip.cb[a][b].some((c) => c.until >= g.day);

// «Баланс угрозы»: слишком сильный сосед вызывает недоверие; слабый проситель безопасен
function balanceOfThreat(g, to, from) {
  const share = effPower(g, from) / Math.max(0.01, g.states.reduce((s, _, i) => s + effPower(g, i), 0));
  if (share > 0.42) return { v: -(share - 0.42) * 60 * (DIP_DIFF[g.difficulty]?.coalition || 1), hint: 'все боятся самого сильного' };
  return { v: 0, hint: '' };
}

function finish(g, from, to, kind, p, out) {
  const score = out.factors.reduce((s, f) => s + f.v, 0) - baseBar(kind);
  out.factors.push({ label: 'Порог согласия', v: -baseBar(kind), hint: '' });
  out.score = Math.round(score * 10) / 10;
  out.p = Math.round(sigmoid(score / 9) * 100) / 100;
  out.accept = score >= 0;
  const neg = out.factors.filter((f) => f.v < -1.2).sort((a, b) => a.v - b.v);
  out.reasons = out.accept ? ['Предложение выгодно'] : neg.slice(0, 3).map((f) => `${f.label} (${f.v})`);
  if (!out.accept && !out.reasons.length) out.reasons = ['Недостаточно выгод'];
  // встречное предложение: «согласен, если добавишь деньги»
  if (!out.accept && score > -22 && !(p.sweet && p.sweet.money) && from !== undefined) {
    const need = Math.ceil((-score) * 22 / 10) * 10;
    if (need > 0 && need <= 400) out.counter = { money: need, text: `согласен, если добавите ${need}💰` };
  }
  return out;
}
const BAR = { ties: -2, trade: 3, friend: 6, nap: 4, defense: 8, offense: 10, ally: 12, protect: 8, truce: 0, whitepeace: 2, peacetreaty: 0 };
const baseBar = (kind) => BAR[kind] ?? 4;

function evaluateDeal(g, from, to, p, out, add) {
  const d = g.dip, P = d.pers[to];
  const { seller, buyer, res, amt, price } = p;
  const rel = relOf(g, to, from), st = statusOf(g, from, to);
  const me = g.states[to];
  const relMod = clamp(rel / 250, -0.15, 0.35) + (st === 'ally' ? 0.08 : st === 'friend' ? 0.04 : 0) + (hasTreaty(g, from, to, 'trade') ? 0.04 : 0);
  if (rel < -30) { out.hard = 'Отношения слишком плохи для торговли'; out.reasons = [out.hard]; return out; }
  let margin;
  if (to === buyer) {
    const val = valueFor(g, me, res);
    const limit = Math.min(val * (1 + relMod) * (1.08 / Math.max(0.8, P.greed + 0.5)), marketBuy(res, me[res]));
    if (me[res] > STOCK_TARGET[res] * 3.5) { out.hard = 'Склады забиты, им это не нужно'; out.reasons = [out.hard]; return out; }
    if (me.money < price * amt * 8) { out.hard = 'Не хватит денег платить за поставки'; out.reasons = [out.hard]; return out; }
    margin = (limit - price) / Math.max(0.1, limit);
    add(`Цена ${money(price)}💰 при их оценке ${money(limit)}💰`, margin * 40);
    add(me[res] < 150 ? 'Им остро нужен ресурс' : 'Ресурс обычный', me[res] < 150 ? 6 : 0);
  } else {
    const val = valueFor(g, me, res);
    const floor = Math.max(val * (1 - relMod) * Math.max(0.8, P.greed + 0.5) * 0.97, marketSell(res, me[res]));
    const reserve = res === 'steel' || res === 'fuel' || res === 'food' || res === 'ore' ? 120 : 40;
    if (me[res] - amt * 12 < reserve) { out.hard = 'Нет запаса для таких поставок'; out.reasons = [out.hard]; return out; }
    margin = (price - floor) / Math.max(0.1, floor);
    add(`Цена ${money(price)}💰 при их минимуме ${money(floor)}💰`, margin * 40);
  }
  add('Отношение', rel * 0.06);
  add('Торговое соглашение', hasTreaty(g, from, to, 'trade') ? 3 : 0);
  if (from === g.playerState) add('Сложность', (DIP_DIFF[g.difficulty] || DIP_DIFF.normal).lenient * 0.4);
  out.score = Math.round(out.factors.reduce((s, f) => s + f.v, 0) * 10) / 10;
  out.p = Math.round(sigmoid(out.score / 6) * 100) / 100;
  out.accept = out.score >= 0;
  out.reasons = out.accept ? ['Сделка выгодна'] : [margin < 0 ? (to === buyer ? 'Для них это дорого' : 'Для них это дёшево') : 'Мало выгод'];
  return out;
}
function evaluateLoan(g, from, to, p, out, add) {
  const d = g.dip, P = d.pers[to];
  const rel = relOf(g, to, from);
  const lender = p.lender, borrower = p.borrower;
  if (to === borrower) {
    const need = g.states[to].money < 250 ? 8 : 0;
    add('Нужны деньги', need - 4);
    add('Отношение к кредитору', rel * 0.1);
    add('Осторожность (долг — ярмо)', -P.caution * 4);
  } else {
    add('Доверие заёмщику', d.trust[to][from] * 0.15 + (d.rep[from].reliab - 60) * 0.25);
    add('Проценты', 4);
    add('Жадность', P.greed * 5 - 2);
    if (g.states[to].money < p.amount * 3) add('Мало свободных денег', -8);
    add('Отношение', rel * 0.12);
  }
  out.score = Math.round(out.factors.reduce((s, f) => s + f.v, 0) * 10) / 10;
  out.p = Math.round(sigmoid(out.score / 7) * 100) / 100;
  out.accept = out.score >= 0;
  out.reasons = out.accept ? ['Условия займа приемлемы'] : ['Мало выгод'];
  return out;
}

// ---------- применение ----------
export function applyOffer(g, from, to, kind, p = {}) {
  const d = g.dip;
  if (p.sweet && p.sweet.money) { const m = Math.min(g.states[from].money, p.sweet.money); g.states[from].money -= m; g.states[to].money += m; }
  if (p.sweet && p.sweet.res) { const { res, amt } = p.sweet.res; const n = Math.min(g.states[from][res], amt); g.states[from][res] -= n; g.states[to][res] += n; }
  switch (kind) {
    case 'ties': establishTies(g, from, to); break;
    case 'deal': createDeal(g, p); logDip(g, `Сделка ${g.states[p.seller].name} → ${g.states[p.buyer].name}: ${RES_ICON[p.res]} ${p.amt}/дн. по ${money(p.price)}💰`, p.seller === g.playerState || p.buyer === g.playerState, p.seller, p.buyer, 'deal'); break;
    case 'loan': grantLoan(g, p.lender, p.borrower, p.amount, p.days || 90); break;
    case 'truce': case 'whitepeace': case 'peacetreaty': applyPeace(g, kind, from, to, { payer: p.payer, contrib: p.contrib, dmz: p.dmz }); break;
    case 'protect': signTreaty(g, 'protect', p.over, p.over === from ? to : from, {}); break;
    case 'offense': signTreaty(g, 'offense', from, to, { target: p.target, days: p.days }); break;
    case 'defense': signTreaty(g, 'defense', from, to, { days: p.days, clauses: { binding: !!p.binding, noChain: !!p.noChain } }); break;
    default: signTreaty(g, kind, from, to, { days: p.days });
  }
  addTrust(g, to, from, 3); addTrust(g, from, to, 3);
  d.rev++;
}
export function offerError(g, o) {
  const hard = prerequisite(g, o.from, o.to, o.kind, o.params || {});
  if (hard) return hard;
  const me = g.playerState, p = o.params || {};
  if (o.kind === 'deal') {
    if (p.seller === me && g.states[me][p.res] < p.amt) return 'У вас нет столько на складе';
    if (p.buyer === me && g.states[me].money < p.price * p.amt) return 'Не хватает денег';
  }
  if (o.kind === 'peacetreaty' && p.payer === me && g.states[me].money < p.contrib) return 'Не хватает денег на контрибуцию';
  if (p.sweet && p.sweet.money && g.states[o.from].money < p.sweet.money) return 'У предлагающего нет таких денег';
  return null;
}

export function offerText(g, o) {
  const A = g.states[o.from].name, p = o.params || {};
  const sweet = p.sweet && p.sweet.money ? ` (+${p.sweet.money}💰 вам)` : '';
  if (o.kind === 'deal') {
    const sell = p.seller === o.from;
    return sell
      ? `${A} продаёт вам ${RES_ICON[p.res]} ${RES_LABEL[p.res]}: ${p.amt}/дн. по ${money(p.price)}💰${p.days ? ', ' + p.days + ' дн.' : ''}`
      : `${A} хочет купить у вас ${RES_ICON[p.res]} ${RES_LABEL[p.res]}: ${p.amt}/дн. по ${money(p.price)}💰${p.days ? ', ' + p.days + ' дн.' : ''}`;
  }
  if (o.kind === 'loan') return p.lender === o.from ? `${A} даёт вам заём ${p.amount}💰 на ${p.days || 90} дн.` : `${A} просит заём ${p.amount}💰 на ${p.days || 90} дн.`;
  if (o.kind === 'ties') return `${A} предлагает установить дипотношения`;
  let t = `${A} предлагает: ${KIND_NAME[o.kind].toLowerCase()}`;
  if (o.kind === 'offense') t += ` против ${g.states[p.target].name}`;
  if (o.kind === 'defense') t += p.binding ? ' (обязательный)' : ' (необязательный)';
  if (o.kind === 'protect') t += p.over === o.from ? ' — вы под её защитой (вассал)' : ' — она под вашей защитой';
  if (o.kind === 'peacetreaty') t += `${p.contrib ? ', контрибуция ' + p.contrib + '💰 (' + (p.payer === o.from ? 'вам' : 'с вас') + ')' : ''}${p.dmz ? ', демилитаризованная зона' : ''}`;
  return t + sweet;
}

// ---------- предложение ----------
export function offerCooldownKey(from, to, kind) { return `o${from}-${to}-${kind}`; }
export function preview(g, from, to, kind, params = {}) {
  const ev = evaluateOffer(g, from, to, kind, params);
  ev.cost = costOf(kind);
  ev.have = Math.floor(g.dip.inf[from]);
  ev.cool = Math.max(0, (g.dip.cool[offerCooldownKey(from, to, kind)] || 0) - g.day);
  return ev;
}
export function propose(g, from, to, kind, params = {}) {
  const d = g.dip;
  if (to === g.playerState && from !== g.playerState) {
    if (d.offers.some((o) => o.from === from && o.to === to && o.kind === kind)) return { ok: false, msg: 'Уже есть такое предложение', reasons: [] };
    if (d.offers.filter((o) => o.to === to).length >= 4) return { ok: false, msg: 'Очередь предложений полна', reasons: [] };
    const pre = prerequisite(g, from, to, kind, params);
    if (pre) return { ok: false, msg: pre, reasons: [pre] };
    const cost = costOf(kind);
    if (from !== g.playerState && !spend(g, from, cost)) return { ok: false, msg: 'У них нет очков влияния', reasons: [] };
    const o = { id: d.nextId++, from, to, kind, params, expires: g.day + DIP.offerLife, born: g.day };
    d.offers.push(o);
    d.cool[offerCooldownKey(from, to, kind)] = g.day + 25;
    d.rev++;
    g.events.push(`📨 Предложение от ${g.states[from].name}: ${offerText(g, o)}`);
    return { ok: true, msg: 'Предложение отправлено', reasons: [], offer: o };
  }
  const ck = offerCooldownKey(from, to, kind);
  const left = (d.cool[ck] || 0) - g.day;
  if (left > 0 && from === g.playerState) return { ok: false, msg: `Повторить можно через ${left} дн.`, reasons: [] };
  const cost = costOf(kind);
  if (d.inf[from] < cost) return { ok: false, msg: `Не хватает очков влияния (нужно ${cost}, есть ${Math.floor(d.inf[from])})`, reasons: [] };
  const ev = evaluateOffer(g, from, to, kind, params);
  if (ev.hard) return { ok: false, msg: ev.hard, reasons: ev.reasons, eval: ev };
  spend(g, from, cost);
  if (ev.accept) { applyOffer(g, from, to, kind, params); return { ok: true, msg: `${g.states[to].name} согласна`, reasons: ev.reasons, eval: ev }; }
  d.cool[ck] = g.day + (from === g.playerState ? 8 : 24);
  addTrust(g, to, from, -0.6);                     // настойчивые отказы слегка охлаждают
  return { ok: false, msg: `${g.states[to].name} отказывает`, reasons: ev.reasons, counter: ev.counter, eval: ev };
}
export function answerOffer(g, id, accept) {
  const d = g.dip, i = d.offers.findIndex((o) => o.id === id);
  if (i < 0) return { ok: false, msg: 'Предложение устарело' };
  const o = d.offers[i];
  if (accept) {
    const err = offerError(g, o);
    if (err) return { ok: false, msg: err };
    d.offers.splice(i, 1);
    applyOffer(g, o.from, o.to, o.kind, o.params || {});
    d.rev++;
    return { ok: true, msg: 'Принято' };
  }
  d.offers.splice(i, 1);
  feel(g, o.from, o.to, -1, 0, 'refuse', 'отклонили предложение');
  d.rev++;
  return { ok: true, msg: 'Отклонено' };
}
export function expireOffers(g) {
  const d = g.dip, n = d.offers.length;
  d.offers = d.offers.filter((o) => o.expires > g.day);
  if (d.offers.length !== n) d.rev++;
}
void hasTies; void inWar; void interdependence; void fearOf; void repGood; void appointAmbassador; void dealsBetween; void treatiesBetween;
