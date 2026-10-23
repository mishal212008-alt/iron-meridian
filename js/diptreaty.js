// Договоры, дипломатические отношения, послы, сделки, помощь, займы, эмбарго. Без DOM.
import { DIP, DIP_COST, RES_ICON, RES_LABEL, TREATIES } from './data.js';
import {
  N, addTrust, ambSlots, ambUsed, dealsBetween, feel, hasTreaty, inWar, logDip, money, repGood, repHit, spend, statusOf, tradeBlock, treatiesBetween,
} from './dipcore.js';

// ---------- статус пары выводится из договоров и войны ----------
export function recomputeStatus(g) {
  const d = g.dip;
  for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) {
    let st = 'neutral';
    if (inWar(g, a, b)) st = 'war';
    else if (d.wars.some((w) => w.state === 'ceasefire' && ((w.sideA.includes(a) && w.sideB.includes(b)) || (w.sideA.includes(b) && w.sideB.includes(a))))) st = 'ceasefire';
    else if (hasTreaty(g, a, b, 'ally') || hasTreaty(g, a, b, 'protect')) st = 'ally';
    else if (hasTreaty(g, a, b, 'friend') || hasTreaty(g, a, b, 'defense')) st = 'friend';
    if (d.status[a][b] !== st) { d.status[a][b] = st; d.status[b][a] = st; d.since[a][b] = g.day; d.since[b][a] = g.day; d.rev++; }
  }
}

// ---------- договоры ----------
export function signTreaty(g, kind, a, b, terms = {}, quiet = false) {
  const def = TREATIES[kind];
  const d = g.dip;
  const clauses = { ...(def.clauses ? Object.fromEntries(def.clauses.map((c) => [c, true])) : {}), ...(terms.clauses || {}) };
  const t = { id: d.nextId++, kind, a, b, terms: { ...terms, clauses: undefined }, clauses, start: g.day, until: terms.days ?? (def.days ? g.day + def.days : null), state: 'active', kept: 0 };
  if (terms.days !== undefined) t.until = terms.days ? g.day + terms.days : null;
  d.treaties.push(t);
  d.closed[a][b] = false; d.closed[b][a] = false;
  if (kind !== 'truce' && kind !== 'peacetreaty') { feel(g, a, b, 6, 6, 'service'); }
  recomputeStatus(g);
  d.rev++;
  if (!quiet) logDip(g, `${TREATIES[kind].icon} ${g.states[a].name} и ${g.states[b].name}: ${TREATIES[kind].name.toLowerCase()}${terms.target !== undefined ? ' против ' + g.states[terms.target].name : ''}`, true, a, b, 'treaty');
  return t;
}

// by — кто разорвал (−1: срок истёк / обоюдно). Нарушение до срока бьёт по репутации у всех.
export function endTreaty(g, id, by = -1, reason = '') {
  const d = g.dip;
  const t = d.treaties.find((x) => x.id === id && x.state === 'active');
  if (!t) return false;
  t.state = 'ended'; t.endDay = g.day;
  const other = by === t.a ? t.b : t.a;
  const early = t.until === null || g.day < t.until;
  let violation = false;
  if (by >= 0 && early && !['truce', 'whitepeace', 'trade'].includes(t.kind) && !reason.startsWith('война')) violation = true;
  if (by >= 0 && t.kind === 'trade' && early && g.day - t.start < 30) violation = true;
  if (violation) {
    repHit(g, by, 'violation', other, `${TREATIES[t.kind].name}`);
    d.cb[other][by].push({ kind: 'violation', until: g.day + DIP.cbDays });
    logDip(g, `${g.states[by].name} нарушила ${TREATIES[t.kind].name.toLowerCase()} с ${g.states[other].name}!`, true, by, other, 'treaty');
  } else {
    if (by < 0) { repGood(g, t.a, 1.2); repGood(g, t.b, 1.2); feel(g, t.a, t.b, 3, 3, 'service'); }
    logDip(g, `${TREATIES[t.kind].icon} ${TREATIES[t.kind].name} ${g.states[t.a].name} и ${g.states[t.b].name} завершён${reason ? ' (' + reason + ')' : ''}`, false, t.a, t.b, 'treaty');
  }
  d.treaties = d.treaties.filter((x) => x.state === 'active' || g.day - (x.endDay || 0) < 90);
  recomputeStatus(g);
  d.rev++;
  return violation;
}

// «Расторгнуть» из интерфейса: ищет договор данного вида
export function breakTreaty(g, a, b, kind) {
  const t = treatiesBetween(g, a, b).find((x) => x.kind === kind);
  if (!t) return { ok: false, msg: 'Договора нет' };
  const early = t.until === null || g.day < t.until;
  const viol = endTreaty(g, t.id, a, 'расторгнут');
  return { ok: true, msg: viol ? 'Договор нарушен: репутация пострадала у всех' : 'Договор расторгнут', violation: viol, early };
}
// старое имя: расторгает «высший» договор пары
export function breakPact(g, a, b) {
  const order = ['ally', 'protect', 'defense', 'friend', 'offense', 'nap', 'trade'];
  for (const k of order) if (hasTreaty(g, a, b, k)) return breakTreaty(g, a, b, k);
  return { ok: false, msg: 'Нет договора' };
}

// Что будет, если расторгнуть/нарушить (для окна подтверждения)
export function breakConsequences(g, a, b, kind) {
  const t = treatiesBetween(g, a, b).find((x) => x.kind === kind);
  if (!t) return [];
  const early = t.until === null || g.day < t.until;
  if (!early || ['trade'].includes(kind)) return ['Договор завершится без последствий для репутации.'];
  return [`Репутация надёжности −${DIP.repViolation} у ВСЕХ государств`, `${g.states[b].name} получит повод для войны на ${DIP.cbDays} дн.`, 'Доверие у всех снизится'];
}

export function stepTreaties(g) {
  const d = g.dip;
  for (const t of [...d.treaties]) {
    if (t.state !== 'active') continue;
    if (t.until !== null && g.day >= t.until) { endTreaty(g, t.id, -1, 'срок истёк'); continue; }
    t.kept++;
    if (t.kept % 30 === 0) { repGood(g, t.a, DIP.repGain * 4); repGood(g, t.b, DIP.repGain * 4); }
  }
  // протекторат: налоги идут покровителю
  for (const t of d.treaties) {
    if (t.state !== 'active' || t.kind !== 'protect') continue;
    const v = g.states[t.b], o = g.states[t.a];
    const tax = (v.budget ? v.budget.tax : 0) * DIP.tributeShare;
    const pay = Math.min(v.money, tax);
    v.money -= pay; o.money += pay;
    v.trib = -pay; o.trib = (o.trib || 0) + pay;
  }
  // перемирие и ненападение: ничего не требуется, действуют через проверки
}

// ---------- дипотношения и послы ----------
export function establishTies(g, a, b) {
  const d = g.dip;
  d.ties[a][b] = true; d.ties[b][a] = true;
  d.rev++;
  logDip(g, `${g.states[a].name} и ${g.states[b].name} установили дипломатические отношения`, false, a, b, 'rel');
}
export function breakTies(g, a, b, by = a) {
  const d = g.dip;
  if (inWar(g, a, b)) return { ok: false, msg: 'Во время войны отношения не рвут: заключите мир' };
  if (!d.ties[a][b]) return { ok: false, msg: 'Отношений и так нет' };
  for (const t of treatiesBetween(g, a, b)) endTreaty(g, t.id, by, 'разрыв отношений');
  for (const dl of dealsBetween(g, a, b)) cancelDeal(g, dl.id, -1, 'разрыв отношений');
  d.ties[a][b] = false; d.ties[b][a] = false; d.amb[a][b] = false; d.amb[b][a] = false;
  const other = by === a ? b : a;
  feel(g, other, by, -12, 0, 'insult', 'разрыв отношений');
  d.rev++;
  logDip(g, `${g.states[by].name} разорвала дипломатические отношения с ${g.states[other].name}`, true, a, b, 'rel');
  return { ok: true, msg: 'Отношения разорваны' };
}
export function appointAmbassador(g, a, b) {
  const d = g.dip;
  if (!d.ties[a][b]) return { ok: false, msg: 'Нет дипломатических отношений' };
  if (d.amb[a][b]) return { ok: false, msg: 'Посол уже назначен' };
  if (inWar(g, a, b)) return { ok: false, msg: 'Во время войны послов нет' };
  if (ambUsed(g, a) >= ambSlots(g, a)) return { ok: false, msg: `Нет свободных мест для послов (${ambSlots(g, a)}). Постройте посольский квартал` };
  if (!spend(g, a, DIP_COST.amb)) return { ok: false, msg: `Не хватает очков влияния (нужно ${DIP_COST.amb})` };
  d.amb[a][b] = true; d.rev++;
  addTrust(g, b, a, 2);
  logDip(g, `${g.states[a].name} назначила посла в ${g.states[b].name}`, false, a, b, 'rel');
  return { ok: true, msg: 'Посол назначен' };
}
export function recallAmbassador(g, a, b, quiet = false) {
  const d = g.dip;
  if (!d.amb[a][b]) return { ok: false, msg: 'Посла там нет' };
  d.amb[a][b] = false; d.rev++;
  if (!quiet) addTrust(g, b, a, -2);
  return { ok: true, msg: 'Посол отозван' };
}
// «персона нон грата»: без объяснений, посол отзывается, отношения падают
export function expelAmbassador(g, a, b) {
  const d = g.dip;
  if (!d.amb[b][a]) return { ok: false, msg: 'Их посла у вас нет' };
  d.amb[b][a] = false; d.rev++;
  feel(g, b, a, -14, 0, 'png', 'персона нон грата');
  addTrust(g, b, a, -6);
  logDip(g, `${g.states[a].name} объявила посла государства ${g.states[b].name} персоной нон грата`, true, a, b, 'rel');
  return { ok: true, msg: 'Посол выслан, отношения ухудшились' };
}

// ---------- границы, эмбарго, санкции ----------
export function setBorder(g, a, b, closed) {
  const d = g.dip;
  if (d.closed[a][b] === closed) return { ok: true, msg: '' };
  if (!closed && inWar(g, a, b)) return { ok: false, msg: 'Во время войны граница заперта' };
  if (closed && (hasTreaty(g, a, b, 'ally') || hasTreaty(g, a, b, 'protect'))) return { ok: false, msg: 'Союзникам границу не закрывают: сначала расторгните союз' };
  d.closed[a][b] = closed;
  d.rev++;
  if (closed) feel(g, b, a, statusOf(g, a, b) === 'friend' ? -12 : -6, 0, 'insult', 'закрыта граница'); else feel(g, b, a, 2, 0, 'service');
  logDip(g, `${g.states[a].name} ${closed ? 'закрыла' : 'открыла'} границу для ${g.states[b].name}`, closed, a, b, 'rel');
  if (closed) for (const dl of [...dealsBetween(g, a, b)]) cancelDeal(g, dl.id, -1, 'граница закрыта');
  return { ok: true, msg: closed ? 'Граница закрыта' : 'Граница открыта' };
}
export function setEmbargo(g, a, b, on) {
  const d = g.dip;
  if (d.embargo[a][b] === on) return { ok: true, msg: '' };
  if (on && !spend(g, a, DIP_COST.sanction)) return { ok: false, msg: `Не хватает очков влияния (нужно ${DIP_COST.sanction})` };
  d.embargo[a][b] = on; d.rev++;
  if (on) {
    feel(g, b, a, -14, 0, 'embargo', 'эмбарго');
    for (const dl of [...dealsBetween(g, a, b)]) cancelDeal(g, dl.id, -1, 'эмбарго');
    logDip(g, `${g.states[a].name} ввела эмбарго против ${g.states[b].name}`, true, a, b, 'trade');
  } else { feel(g, b, a, 3, 0, 'service'); logDip(g, `${g.states[a].name} сняла эмбарго с ${g.states[b].name}`, false, a, b, 'trade'); }
  return { ok: true, msg: on ? 'Эмбарго введено' : 'Эмбарго снято' };
}
// Санкции: несколько стран давят на цель. Каждая снижает её торговый лимит.
export function joinSanctions(g, imposer, target) {
  const d = g.dip;
  if (d.sanc[target].includes(imposer)) return { ok: false, msg: 'Вы уже в санкционном списке против них' };
  if (!spend(g, imposer, DIP_COST.sanction)) return { ok: false, msg: `Не хватает очков влияния (нужно ${DIP_COST.sanction})` };
  d.sanc[target].push(imposer); d.rev++;
  feel(g, target, imposer, -10, 0, 'embargo', 'санкции');
  logDip(g, `${g.states[imposer].name} присоединилась к санкциям против ${g.states[target].name}`, true, imposer, target, 'trade');
  return { ok: true, msg: 'Санкции введены' };
}
export function liftSanctions(g, imposer, target) {
  const d = g.dip;
  d.sanc[target] = d.sanc[target].filter((x) => x !== imposer); d.rev++;
  logDip(g, `${g.states[imposer].name} сняла санкции с ${g.states[target].name}`, false, imposer, target, 'trade');
  return { ok: true, msg: 'Санкции сняты' };
}

// ---------- подарки, помощь, займы ----------
export function gift(g, a, b, amount = 100) {
  const s = g.states[a];
  if (s.money < amount) return { ok: false, msg: 'Не хватает денег' };
  const key = `gift-${a}-${b}`;
  if ((g.dip.cool[key] ?? -99) > g.day - 5) return { ok: false, msg: 'Подарки не чаще раза в 5 дней' };
  if (!spend(g, a, DIP_COST.gift)) return { ok: false, msg: `Не хватает очков влияния (нужно ${DIP_COST.gift})` };
  g.dip.cool[key] = g.day;
  s.money -= amount; g.states[b].money += amount;
  feel(g, b, a, Math.min(14, 2 + amount / 25), 0, 'gift', 'подарок');
  logDip(g, `${g.states[a].name} передала ${g.states[b].name} ${amount}💰 в подарок`, false, a, b, 'rel');
  return { ok: true, msg: 'Подарок вручён' };
}
// помощь ресурсами (в беде ценится выше)
export function sendAid(g, a, b, res, amt) {
  const A = g.states[a], B = g.states[b];
  amt = Math.floor(amt);
  if (amt <= 0 || A[res] < amt) return { ok: false, msg: 'У вас нет столько на складе' };
  if (!g.dip.ties[a][b] || inWar(g, a, b)) return { ok: false, msg: 'Помощь невозможна' };
  if (!spend(g, a, DIP_COST.aid)) return { ok: false, msg: `Не хватает очков влияния (нужно ${DIP_COST.aid})` };
  const need = B[res] < 100;
  A[res] -= amt; B[res] = Math.min(B.cap || 1e9, B[res] + amt);
  feel(g, b, a, Math.min(20, (need ? 8 : 3) + amt / 30), 0, 'help', 'помощь');
  repGood(g, a, 0.6);
  logDip(g, `${g.states[a].name} направила ${g.states[b].name} помощь: ${RES_ICON[res]} ${amt}`, false, a, b, 'trade');
  return { ok: true, msg: 'Помощь отправлена' };
}
export function grantLoan(g, lender, borrower, amount, days = 90) {
  const L = g.states[lender];
  if (L.money < amount) return { ok: false, msg: 'Не хватает денег для займа' };
  if (!spend(g, lender, DIP_COST.loan)) return { ok: false, msg: `Не хватает очков влияния (нужно ${DIP_COST.loan})` };
  const total = amount * (1 + DIP.loanRate * days);
  const loan = { id: g.dip.nextId++, lender, borrower, principal: amount, total, perDay: total / days, left: total, until: g.day + days, miss: 0 };
  g.dip.loans.push(loan);
  L.money -= amount; g.states[borrower].money += amount;
  feel(g, borrower, lender, 6, 0, 'loan', 'заём');
  logDip(g, `${g.states[lender].name} выдала ${g.states[borrower].name} заём ${amount}💰 на ${days} дн.`, true, lender, borrower, 'trade');
  g.dip.rev++;
  return { ok: true, msg: 'Заём выдан', loan };
}
export function stepLoans(g) {
  const d = g.dip;
  for (const l of [...d.loans]) {
    const B = g.states[l.borrower], L = g.states[l.lender];
    if (inWar(g, l.lender, l.borrower)) { d.loans.splice(d.loans.indexOf(l), 1); continue; }
    const pay = Math.min(l.perDay, l.left);
    if (B.money >= pay) { B.money -= pay; L.money += pay; l.left -= pay; l.miss = 0; }
    else { l.miss++; if (l.miss >= 6) { // дефолт
      d.loans.splice(d.loans.indexOf(l), 1);
      repHit(g, l.borrower, 'violation', l.lender, 'дефолт по займу');
      feel(g, l.lender, l.borrower, -15, 0, 'violation', 'дефолт');
      logDip(g, `${g.states[l.borrower].name} не платит по займу ${g.states[l.lender].name}: дефолт`, true, l.lender, l.borrower, 'trade');
      continue; } }
    if (l.left <= 0.5) { d.loans.splice(d.loans.indexOf(l), 1); repGood(g, l.borrower, 2); feel(g, l.lender, l.borrower, 6, 0, 'service', 'заём возвращён'); logDip(g, `${g.states[l.borrower].name} вернула заём ${g.states[l.lender].name}`, false, l.lender, l.borrower, 'trade'); }
  }
}

// ---------- торговые сделки (поставки ресурсов) ----------
export function createDeal(g, { seller, buyer, res, amt, price, days }) {
  const dl = { id: g.dip.nextId++, seller, buyer, res, amt, price, start: g.day, until: days ? g.day + days : null, fails: 0, state: 'active' };
  g.dip.deals.push(dl);
  feel(g, seller, buyer, 2, 2, 'trade');
  logDip(g, `Сделка: ${g.states[seller].name} продаёт ${g.states[buyer].name} ${RES_ICON[res]} ${amt}/дн. по ${money(price)}💰`, false, seller, buyer, 'trade');
  g.dip.rev++;
  return dl;
}
export function cancelDeal(g, id, by = -1, why = '') {
  const i = g.dip.deals.findIndex((x) => x.id === id);
  if (i < 0) return;
  const dl = g.dip.deals[i];
  g.dip.deals.splice(i, 1);
  if (by >= 0 && g.day - dl.start < 20) { feel(g, dl.seller === by ? dl.buyer : dl.seller, by, -4, 0, 'insult', 'сделка расторгнута'); }
  logDip(g, `Сделка расторгнута: ${g.states[dl.seller].name} → ${g.states[dl.buyer].name}, ${RES_ICON[dl.res]}${why ? ' (' + why + ')' : ''}`, false, dl.seller, dl.buyer, 'trade');
  g.dip.rev++;
}
export function runDeals(g) {
  for (const s of g.states) { s.trade = { money: 0 }; for (const k of ['ore', 'steel', 'fuel', 'food', 'electronics', 'gold', 'rare']) s.trade[k] = 0; }
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
      if (deal.fails >= 12) {
        const sellerFault = S[deal.res] < deal.amt;
        repHit(g, sellerFault ? deal.seller : deal.buyer, 'default', sellerFault ? deal.buyer : deal.seller, 'срыв поставок');
        cancelDeal(g, deal.id, -1, 'срыв поставок');
      }
      continue;
    }
    deal.state = why ? 'short' : 'active'; deal.why = why;
    deal.fails = why ? deal.fails + 1 : 0;
    const cost = amt * deal.price;
    S[deal.res] -= amt; B[deal.res] += amt;
    B.money -= cost; S.money += cost;
    S.trade[deal.res] -= amt; B.trade[deal.res] += amt;
    S.trade.money += cost; B.trade.money -= cost;
    addTrust(g, deal.seller, deal.buyer, 0.05); addTrust(g, deal.buyer, deal.seller, 0.05);
  }
}
