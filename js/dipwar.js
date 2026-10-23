// Война, повод к войне, призыв союзников, мир и перемирие, кризисы с лестницей эскалации. Без DOM.
import { DIP, DIP_COST, ESCALATION, RES_ICON, TREATIES } from './data.js';
import {
  N, addTrust, clamp, dealsBetween, effPower, feel, hasTreaty, inWar, logDip, money, overlordOf, perceive, repGood, repHit, spend, treatiesBetween, vassalsOf,
} from './dipcore.js';
import { cancelDeal, endTreaty, recomputeStatus, setEmbargo, signTreaty } from './diptreaty.js';

// ---------- повод к войне ----------
export const cbFor = (g, a, b) => g.dip.cb[a][b].filter((c) => c.until >= g.day);
export const hasCb = (g, a, b) => cbFor(g, a, b).length > 0;
export function grantCb(g, a, b, kind, days = DIP.cbDays) {
  g.dip.cb[a][b].push({ kind, until: g.day + days });
  if (g.dip.cb[a][b].length > 6) g.dip.cb[a][b].shift();
}
export const CB_LABEL = { violation: 'нарушение договора', incident: 'пограничный инцидент', ultimatum_refused: 'отказ выполнить ультиматум', defend: 'защита союзника', embargo: 'эмбарго против нас' };

// ---------- объявление войны ----------
export function warError(g, a, b) {
  const d = g.dip;
  if (a === b) return 'Нельзя воевать с собой';
  if (inWar(g, a, b)) return 'Уже воюем';
  if (d.wars.some((w) => w.state === 'ceasefire' && ((w.sideA.includes(a) && w.sideB.includes(b)) || (w.sideA.includes(b) && w.sideB.includes(a))))) return 'Действует перемирие';
  if (g.day - d.lastWar[a][b] < DIP.warCooldown && d.lastWar[a][b] > -900) return `После прошлой войны не прошло ${DIP.warCooldown} дней`;
  if (overlordOf(g, a) >= 0) return 'Вассал не вправе объявлять войну';
  if (overlordOf(g, b) === a) return 'Нельзя воевать с вассалом';
  return null;
}
// последствия для окна подтверждения
export function warPreview(g, a, b) {
  const out = [];
  const cb = hasCb(g, a, b);
  out.push(cb ? `Есть повод к войне: ${cbFor(g, a, b).map((c) => CB_LABEL[c.kind] || c.kind).join(', ')}. Репутационный штраф небольшой.` : 'Повода нет: репутация надёжности −' + DIP.repSuddenWar + ', агрессивность +' + DIP.aggrSuddenWar + ' у ВСЕХ, против вас может сложиться коалиция.');
  const tr = treatiesBetween(g, a, b);
  if (tr.length) out.push('Договоры будут нарушены: ' + tr.map((t) => TREATIES[t.kind].name).join(', ') + '.');
  out.push('Границы закроются, сделки и займы с ними расторгнутся, торговля встанет.');
  const allies = new Set();
  for (const t of g.dip.treaties) if (t.state === 'active' && ['ally', 'defense'].includes(t.kind) && (t.a === b || t.b === b)) allies.add(t.a === b ? t.b : t.a);
  allies.delete(a);
  if (allies.size) out.push('Союзники цели получат призыв: ' + [...allies].map((i) => g.states[i].name).join(', ') + '.');
  return out;
}

export function declareWar(g, a, b, opts = {}) {
  const d = g.dip;
  const err = warError(g, a, b);
  if (err) return { ok: false, msg: err };
  const cb = hasCb(g, a, b);
  const war = { id: d.nextId++, a, b, sideA: [a], sideB: [b], start: g.day, score: 0, exh: { A: 0, B: 0 }, dmg: {}, cb: cb ? cbFor(g, a, b)[0].kind : null, state: 'active', origin: opts.origin || 'declared', ceaseUntil: 0 };
  // договоры между сторонами нарушаются нападающим
  for (const t of treatiesBetween(g, a, b)) endTreaty(g, t.id, a, 'нападение');
  if (cb) { repHit(g, a, 'war_cb', b); d.cb[a][b] = []; } else { repHit(g, a, 'sudden_war', b, 'нападение без повода'); d.hot = d.hot || {}; d.hot[a] = g.day; grantCb(g, b, a, 'defend', 60); }
  d.wars.push(war);
  // вассалы нападающего идут за покровителем
  for (const v of vassalsOf(g, a)) war.sideA.push(v);
  for (const v of vassalsOf(g, b)) war.sideB.push(v);
  applyWarState(g, war);
  logDip(g, `💥 ${g.states[a].name} объявила войну государству ${g.states[b].name}!`, true, a, b, 'war');
  callAllies(g, war, b, false);
  callAllies(g, war, a, false, true);
  recomputeStatus(g);
  d.rev++;
  return { ok: true, msg: 'Война объявлена', war };
}
// граница, сделки, займы между воюющими сторонами
function applyWarState(g, war) {
  const d = g.dip;
  for (const x of war.sideA) for (const y of war.sideB) {
    d.closed[x][y] = true; d.closed[y][x] = true;
    for (const dl of [...dealsBetween(g, x, y)]) cancelDeal(g, dl.id, -1, 'война');
    d.loans = d.loans.filter((l) => !((l.lender === x && l.borrower === y) || (l.lender === y && l.borrower === x)));
    for (const t of treatiesBetween(g, x, y)) endTreaty(g, t.id, -1, 'война');
    d.offers = d.offers.filter((o) => !((o.from === x && o.to === y) || (o.from === y && o.to === x)));
    d.lastWar[x][y] = g.day; d.lastWar[y][x] = g.day;
    d.amb[x][y] = false; d.amb[y][x] = false;
    d.embargo[x][y] = false; d.embargo[y][x] = false;
    feel(g, x, y, -18, -18, 'war', 'война');
  }
}

// ---------- призыв союзников ----------
export function callAllies(g, war, subject, chain, offense = false) {
  const d = g.dip;
  const inSide = (s) => war.sideA.includes(s) || war.sideB.includes(s);
  for (const t of d.treaties) {
    if (t.state !== 'active') continue;
    let partner = -1, kind = 'defend', binding = false;
    if (!offense && ['ally', 'defense'].includes(t.kind) && (t.a === subject || t.b === subject)) { partner = t.a === subject ? t.b : t.a; binding = t.kind === 'ally' || !!t.clauses.binding; }
    else if (!offense && t.kind === 'protect' && t.b === subject) { partner = t.a; binding = true; }
    else if (offense && t.kind === 'offense' && (t.a === subject || t.b === subject) && t.terms.target !== undefined && inSide(t.terms.target)) { partner = t.a === subject ? t.b : t.a; kind = 'offense'; binding = false; }
    if (partner < 0 || inSide(partner)) continue;
    if (chain && t.clauses.noChain) continue;                         // оговорка от цепной реакции
    if (d.calls.some((c) => c.war === war.id && c.ally === partner && c.state === 'open')) continue;
    const side = war.sideA.includes(subject) ? 'A' : 'B';
    const enemies = side === 'A' ? war.sideB : war.sideA;
    if (enemies.some((e) => treatiesBetween(g, partner, e).some((x) => ['ally', 'defense', 'protect'].includes(x.kind)))) continue;
    const [lo, hi] = DIP.callDays;
    d.calls.push({ id: d.nextId++, war: war.id, ally: partner, to: subject, side, kind, binding, treaty: t.id, chain, start: g.day, deadline: g.day + lo + Math.floor(g.rand() * (hi - lo + 1)), state: 'open' });
    logDip(g, `${g.states[subject].name} призывает ${g.states[partner].name} на помощь (${binding ? 'обязательно' : 'по желанию'})`, partner === g.playerState, subject, partner, 'war');
  }
  d.rev++;
}
export function joinWar(g, war, sid, side) {
  const d = g.dip;
  const mine = side === 'A' ? war.sideA : war.sideB, theirs = side === 'A' ? war.sideB : war.sideA;
  if (mine.includes(sid)) return;
  mine.push(sid);
  for (const e of theirs) {
    d.closed[sid][e] = true; d.closed[e][sid] = true;
    for (const dl of [...dealsBetween(g, sid, e)]) cancelDeal(g, dl.id, -1, 'война');
    for (const t of treatiesBetween(g, sid, e)) endTreaty(g, t.id, -1, 'война');
    d.lastWar[sid][e] = g.day; d.lastWar[e][sid] = g.day;
    d.amb[sid][e] = false; d.amb[e][sid] = false;
    feel(g, sid, e, -14, -14, 'war', 'война');
  }
  recomputeStatus(g);
  logDip(g, `${g.states[sid].name} вступила в войну на стороне ${g.states[side === 'A' ? war.a : war.b].name}`, true, sid, side === 'A' ? war.a : war.b, 'war');
  for (const v of vassalsOf(g, sid)) joinWar(g, war, v, side);
  // цепная реакция: союзники вступившего тоже получают призыв, если нет оговорки
  const tgt = side === 'A' ? war.a : war.b;
  callAllies(g, war, sid, true);
  d.rev++;
  void tgt;
}
export function callError(g, call) {
  const war = g.dip.wars.find((w) => w.id === call.war);
  if (!war || war.state === 'ended') return 'Война уже окончена';
  const enemies = call.side === 'A' ? war.sideB : war.sideA;
  if (enemies.some((e) => treatiesBetween(g, call.ally, e).some((x) => ['ally', 'defense', 'protect'].includes(x.kind)))) return 'Вы в союзе с противником';
  return null;
}
export function answerCall(g, id, join, auto = false) {
  const d = g.dip;
  const call = d.calls.find((c) => c.id === id && c.state === 'open');
  if (!call) return { ok: false, msg: 'Призыв устарел' };
  const war = d.wars.find((w) => w.id === call.war);
  if (join) {
    const err = callError(g, call);
    if (err) return { ok: false, msg: err };
    call.state = 'joined';
    joinWar(g, war, call.ally, call.side);
    feel(g, call.to, call.ally, 10, 0, 'help', 'пришли на помощь');
    repGood(g, call.ally, 2);
    return { ok: true, msg: 'Вы вступили в войну' };
  }
  call.state = auto ? 'ignored' : 'declined';
  if (call.binding) {
    endTreaty(g, call.treaty, call.ally, 'отказ помочь');
    feel(g, call.to, call.ally, -16, 0, 'refuse', 'не пришли на помощь');
    logDip(g, `${g.states[call.ally].name} не пришла на помощь ${g.states[call.to].name}: договор нарушен`, true, call.ally, call.to, 'war');
  } else {
    feel(g, call.to, call.ally, call.kind === 'defend' ? -5 : -3, 0, 'refuse', 'отказали в помощи');
  }
  d.rev++;
  return { ok: true, msg: 'Вы отказались' };
}
export function stepCalls(g, botAnswer) {
  const d = g.dip;
  for (const c of d.calls) {
    if (c.state !== 'open') continue;
    const war = d.wars.find((w) => w.id === c.war);
    if (!war || war.state === 'ended') { c.state = 'void'; continue; }
    if (c.ally !== g.playerState && botAnswer) { const j = botAnswer(g, c); if (j !== null) { answerCall(g, c.id, j); continue; } }
    if (g.day >= c.deadline) answerCall(g, c.id, false, true);
  }
  d.calls = d.calls.filter((c) => c.state === 'open' || g.day - c.deadline < 30);
}

// ---------- ход войны и мир ----------
export const sidePower = (g, ids) => ids.reduce((a, s) => a + effPower(g, s), 0);
export function warAdvantage(g, war) {
  const pa = sidePower(g, war.sideA), pb = sidePower(g, war.sideB);
  return (pa - pb) / Math.max(0.01, pa + pb);
}
export const sideOf = (war, s) => (war.sideA.includes(s) ? 'A' : war.sideB.includes(s) ? 'B' : null);
// счёт войны глазами стороны: >0 выигрываем
export const scoreFor = (war, s) => (sideOf(war, s) === 'A' ? war.score : -war.score);

export function stepWars(g) {
  const d = g.dip;
  for (const war of d.wars) {
    if (war.state === 'ended') continue;
    if (war.state === 'ceasefire') { if (g.day >= war.ceaseUntil) endWar(g, war, 'истекло перемирие'); continue; }
    const adv = warAdvantage(g, war);
    war.score = clamp(war.score + adv * 2.2 + (g.rand() - 0.5) * 1.2, -100, 100);
    // экономический ущерб: слабая сторона страдает сильнее
    for (const [side, ids] of [['A', war.sideA], ['B', war.sideB]]) {
      const lose = side === 'A' ? -adv : adv;                 // >0: сторона проигрывает
      for (const s of ids) war.dmg[s] = clamp((war.dmg[s] || 0) + DIP.warDmg * (0.3 + Math.max(0, lose + 0.4)) * 0.2, 0, 0.4);
      war.exh[side] = clamp(war.exh[side] + DIP.exhRate * (0.7 + Math.max(0, lose)), 0, 100);
    }
  }
  // сгладить ущерб завершившихся войн
  for (const war of d.wars) if (war.state === 'ended') for (const s of Object.keys(war.dmg)) war.dmg[s] = Math.max(0, war.dmg[s] - 0.01);
  d.wars = d.wars.filter((w) => w.state !== 'ended' || Object.values(w.dmg).some((v) => v > 0.005) || g.day - (w.endDay || 0) < 60);
}
export function endWar(g, war, how = '') {
  war.state = 'ended'; war.endDay = g.day;
  for (const x of war.sideA) for (const y of war.sideB) { g.dip.lastWar[x][y] = g.day; g.dip.lastWar[y][x] = g.day; }
  g.dip.calls = g.dip.calls.filter((c) => c.war !== war.id);
  recomputeStatus(g);
  logDip(g, `Война ${g.states[war.a].name} — ${g.states[war.b].name} окончена${how ? ': ' + how : ''}`, true, war.a, war.b, 'war');
  g.dip.rev++;
}
// Мир между главными противниками war. kind: truce | whitepeace | peacetreaty
export function warBetween(g, a, b) {
  return g.dip.wars.find((w) => w.state !== 'ended' && ((w.sideA.includes(a) && w.sideB.includes(b)) || (w.sideA.includes(b) && w.sideB.includes(a)))) || null;
}
export function applyPeace(g, kind, a, b, terms = {}) {
  const war = warBetween(g, a, b);
  if (!war) return null;
  if (kind === 'truce') {
    war.state = 'ceasefire'; war.ceaseUntil = g.day + DIP.truceDays;
    signTreaty(g, 'truce', a, b, { days: DIP.truceDays }, true);
    logDip(g, `🏳️ ${g.states[a].name} и ${g.states[b].name} заключили перемирие на ${DIP.truceDays} дн.`, true, a, b, 'war');
    recomputeStatus(g);
  } else {
    endWar(g, war, kind === 'whitepeace' ? 'белый мир' : 'мирный договор');
    if (kind === 'peacetreaty') {
      const payer = terms.payer, recv = payer === a ? b : a;
      if (payer !== undefined && terms.contrib > 0) { const pay = Math.min(g.states[payer].money, terms.contrib); g.states[payer].money -= pay; g.states[recv].money += pay; terms.paid = pay; }
      signTreaty(g, 'peacetreaty', a, b, { ...terms, days: DIP.warCooldown * 2 }, true);
      logDip(g, `📜 Мирный договор ${g.states[a].name} и ${g.states[b].name}${terms.contrib ? ', контрибуция ' + Math.round(terms.paid || 0) + '💰' : ''}${terms.dmz ? ', демилитаризованная зона' : ''}`, true, a, b, 'war');
    }
    feel(g, a, b, 14, 14, 'service', 'мир');
    repGood(g, a, 1.5); repGood(g, b, 1.5);
  }
  return war;
}
// предложение условий мира: сколько готов отдать проигрывающий
export function suggestedContribution(g, war, payer) {
  const sc = scoreFor(war, payer);
  return sc < 0 ? Math.round(clamp(-sc * 6, 0, 600) / 10) * 10 : 0;
}

// ---------- кризисы и лестница эскалации ----------
export const DEMANDS = {
  tribute: (g, a, b, n) => ({ kind: 'tribute', amount: n || 200, text: `выплатить ${n || 200}💰` }),
  open_border: () => ({ kind: 'open_border', text: 'открыть границу' }),
  end_deal: () => ({ kind: 'end_deal', text: 'расторгнуть сделки с врагами' }),
  resource: (g, a, b, n, res = 'steel') => ({ kind: 'resource', res, amount: n || 80, text: `передать ${RES_ICON[res]} ${n || 80}` }),
  lift_embargo: () => ({ kind: 'lift_embargo', text: 'снять эмбарго' }),
};
export const crisisOf = (g, a, b) => g.dip.crises.find((c) => c.state === 'open' && ((c.a === a && c.b === b) || (c.a === b && c.b === a)));
export const crisesAgainst = (g, s) => g.dip.crises.filter((c) => c.state === 'open' && c.b === s);

export function crisisError(g, a, b) {
  if (a === b) return 'Нельзя';
  if (inWar(g, a, b)) return 'Уже идёт война';
  if (crisisOf(g, a, b)) return 'Кризис уже идёт';
  if (overlordOf(g, a) >= 0) return 'Вассал не вправе начинать кризисы';
  if ((g.dip.cool[`cr${a}-${b}`] ?? -99) > g.day) return 'Недавно уже был кризис: подождите';
  return null;
}
export function startCrisis(g, a, b, demand) {
  const err = crisisError(g, a, b);
  if (err) return { ok: false, msg: err };
  if (!spend(g, a, DIP_COST.protest)) return { ok: false, msg: `Не хватает очков влияния (нужно ${DIP_COST.protest})` };
  const d = g.dip;
  const c = { id: d.nextId++, a, b, step: 0, demand, start: g.day, deadline: g.day + DIP.crisisStepDays, state: 'open', stepDay: g.day, awaiting: 'target', backers: { a: [], b: [] }, flags: {}, log: [{ day: g.day, text: `Протест: ${demand.text}` }], faceSaved: false, refused: false };
  d.crises.push(c);
  feel(g, b, a, -4, 0, 'protest', demand.text);
  logDip(g, `📣 ${g.states[a].name} направила ноту протеста ${g.states[b].name}: требует ${demand.text}`, true, a, b, 'crisis');
  d.cool[`cr${a}-${b}`] = g.day + 25;
  d.rev++;
  return { ok: true, msg: 'Протест вручён', crisis: c };
}
export function escalate(g, id) {
  const d = g.dip, c = d.crises.find((x) => x.id === id && x.state === 'open');
  if (!c) return { ok: false, msg: 'Кризис завершён' };
  if (c.awaiting === 'target' && c.step >= 2 && !c.refused) return { ok: false, msg: 'Сначала дождитесь ответа цели' };
  const next = c.step + 1;
  if (next >= 5) return declareFromCrisis(g, c);
  const stepDef = ESCALATION[next];
  const costKey = { 1: 'show', 2: 'ultimatum', 3: 'mobilize', 4: 'blockade' }[next];
  if (next === 1 && g.states[c.a].money < 30) return { ok: false, msg: 'Демонстрация силы стоит 30💰' };
  if (!spend(g, c.a, DIP_COST[costKey])) return { ok: false, msg: `Не хватает очков влияния (нужно ${DIP_COST[costKey]})` };
  c.step = next; c.awaiting = 'target'; c.refused = false; c.stepDay = g.day;
  c.deadline = g.day + (next === 2 ? DIP.ultDays : DIP.crisisStepDays);
  c.log.push({ day: g.day, text: stepDef.name });
  if (next === 1) { g.states[c.a].money -= 30; feel(g, c.b, c.a, -8, 0, 'insult', 'демонстрация силы'); }
  if (next === 2) { feel(g, c.b, c.a, -12, 0, 'ultimatum', c.demand.text); }
  if (next === 3) { c.flags.mobilize = true; feel(g, c.b, c.a, -10, 0, 'ultimatum', 'мобилизация'); }
  if (next === 4) {
    c.flags.blockade = true;
    if (!d.embargo[c.a][c.b]) { d.embargo[c.a][c.b] = true; c.flags.embargoSet = true; }
    for (const dl of [...dealsBetween(g, c.a, c.b)]) cancelDeal(g, dl.id, -1, 'блокада');
    feel(g, c.b, c.a, -16, 0, 'embargo', 'блокада');
  }
  logDip(g, `${stepDef.icon} ${g.states[c.a].name} → ${g.states[c.b].name}: ${stepDef.name.toLowerCase()}${next === 2 ? ' (требует ' + c.demand.text + ', срок ' + DIP.ultDays + ' дн.)' : ''}`, true, c.a, c.b, 'crisis');
  d.rev++;
  return { ok: true, msg: stepDef.name };
}
export function declareFromCrisis(g, c) {
  if (c.step < 2 || !c.refused && c.step < 4) { /* без отказа повод слабее, но разрешено */ }
  if (c.refused || c.step >= 2) grantCb(g, c.a, c.b, 'ultimatum_refused');
  const r = declareWar(g, c.a, c.b);
  closeCrisis(g, c, r.ok ? 'war' : 'open', 'началась война');
  return r;
}
function unwind(g, c) {
  if (c.flags.embargoSet) g.dip.embargo[c.a][c.b] = false;
  c.flags.mobilize = false; c.flags.blockade = false;
}
export function closeCrisis(g, c, state, why) {
  unwind(g, c);
  c.state = state === 'open' ? 'open' : state;
  c.endDay = g.day;
  c.log.push({ day: g.day, text: why });
  g.dip.rev++;
}
function applyDemand(g, c, scale = 1) {
  const A = g.states[c.a], B = g.states[c.b], dm = c.demand, d = g.dip;
  if (dm.kind === 'tribute') { const pay = Math.min(B.money, Math.round(dm.amount * scale)); B.money -= pay; A.money += pay; return `${pay}💰`; }
  if (dm.kind === 'open_border') { d.closed[c.b][c.a] = false; return 'граница открыта'; }
  if (dm.kind === 'lift_embargo') { d.embargo[c.b][c.a] = false; return 'эмбарго снято'; }
  if (dm.kind === 'end_deal') { for (const dl of [...dealsBetween(g, c.a, c.b)]) cancelDeal(g, dl.id, -1, 'уступка'); return 'сделки расторгнуты'; }
  if (dm.kind === 'resource') { const n = Math.min(Math.floor(B[dm.res]), Math.round(dm.amount * scale)); B[dm.res] -= n; A[dm.res] += n; return `${RES_ICON[dm.res]} ${n}`; }
  return '';
}
// ответ цели
export function respond(g, id, choice, by = -1) {
  const d = g.dip, c = d.crises.find((x) => x.id === id && x.state === 'open');
  if (!c) return { ok: false, msg: 'Кризис завершён' };
  if (choice === 'mediate') return mediateCrisis(g, id, by);
  if (c.awaiting !== 'target') return { ok: false, msg: 'Ждём решения инициатора' };
  const A = c.a, B = c.b;
  if (choice === 'yield') {
    const what = applyDemand(g, c);
    const big = c.step >= 2 && !c.faceSaved;
    if (big) { d.face[B] = clamp(d.face[B] - 10, 0, 100); d.face[A] = clamp(d.face[A] + 8, 0, 100); }
    feel(g, B, A, -5, 0, 'insult', 'пришлось уступить'); feel(g, A, B, 3, 0, 'service', 'уступка');
    closeCrisis(g, c, 'resolved', `цель уступила (${what})`);
    logDip(g, `${g.states[B].name} уступила требованиям ${g.states[A].name}: ${what}`, true, A, B, 'crisis');
    return { ok: true, msg: 'Вы уступили: ' + what };
  }
  if (choice === 'bargain') {
    c.flags.bargain = true; c.awaiting = 'instigator';
    logDip(g, `${g.states[B].name} предлагает ${g.states[A].name} компромисс: половина требований`, A === g.playerState || B === g.playerState, B, A, 'crisis');
    d.rev++;
    return { ok: true, msg: 'Предложен компромисс (половина требований)' };
  }
  if (choice === 'refuse') {
    c.refused = true; c.awaiting = 'instigator'; c.deadline = g.day + 10;
    if (c.step >= 2) { grantCb(g, A, B, 'ultimatum_refused'); feel(g, A, B, -8, 0, 'ultimatum', 'отказ'); }
    c.log.push({ day: g.day, text: 'Отказ' });
    logDip(g, `${g.states[B].name} отвергла требования ${g.states[A].name}`, true, A, B, 'crisis');
    d.rev++;
    return { ok: true, msg: 'Вы отказали' };
  }
  if (choice === 'appeal') {
    let helped = 0;
    for (const t of d.treaties) {
      if (t.state !== 'active' || !['ally', 'defense', 'protect'].includes(t.kind)) continue;
      const p = t.a === B ? t.b : t.b === B ? t.a : -1;
      if (p < 0 || p === A || c.backers.b.includes(p)) continue;
      // союзник решает сам: поддержит ли, зависит от отношения к инициатору и от личности
      const stance = d.rel[p][A] < -10 || d.pers[p].aggr > 0.5 || d.rel[p][B] > 40;
      if (stance || t.clauses.binding) { c.backers.b.push(p); feel(g, A, p, -6, 0, 'ultimatum', 'предупреждение'); helped++; logDip(g, `${g.states[p].name} выступила в поддержку ${g.states[B].name} против ${g.states[A].name}`, true, p, A, 'crisis'); }
    }
    d.rev++;
    return { ok: true, msg: helped ? `Поддержали: ${helped}` : 'Никто не откликнулся' };
  }
  return { ok: false, msg: 'Неизвестный ответ' };
}
// инициатор отвечает на компромисс цели
export function answerBargain(g, id, accept) {
  const d = g.dip, c = d.crises.find((x) => x.id === id && x.state === 'open' && x.flags.bargain);
  if (!c) return { ok: false, msg: 'Нет предложения' };
  c.flags.bargain = false;
  if (accept) {
    const what = applyDemand(g, c, 0.5);
    feel(g, c.a, c.b, 3, 3, 'service', 'компромисс');
    closeCrisis(g, c, 'resolved', `компромисс (${what})`);
    logDip(g, `Компромисс ${g.states[c.a].name} и ${g.states[c.b].name}: ${what}`, true, c.a, c.b, 'crisis');
    return { ok: true, msg: 'Компромисс принят' };
  }
  c.awaiting = 'target'; c.refused = true;
  return { ok: true, msg: 'Компромисс отклонён' };
}
// инициатор отступает; потеря лица, если не было «запасного выхода»
export function backdown(g, id) {
  const d = g.dip, c = d.crises.find((x) => x.id === id && x.state === 'open');
  if (!c) return { ok: false, msg: 'Кризис завершён' };
  const cost = c.step >= 2 && !c.faceSaved ? 15 : 0;
  if (cost) { d.face[c.a] = clamp(d.face[c.a] - cost, 0, 100); feel(g, c.b, c.a, 2, 0, 'service'); }
  closeCrisis(g, c, 'backed', cost ? 'инициатор отступил (потеря лица)' : 'стороны сняли напряжение');
  logDip(g, `${g.states[c.a].name} отступила в споре с ${g.states[c.b].name}${cost ? ': потеря лица' : ''}`, true, c.a, c.b, 'crisis');
  return { ok: true, msg: cost ? `Вы отступили: престиж −${cost}` : 'Напряжение снято' };
}
// посредничество третьей стороны: компромисс без потери лица
export function mediateCrisis(g, id, mediator) {
  const d = g.dip, c = d.crises.find((x) => x.id === id && x.state === 'open');
  if (!c) return { ok: false, msg: 'Кризис завершён' };
  if (mediator === c.a || mediator === c.b || mediator < 0) return { ok: false, msg: 'Посредник — третья страна' };
  if (!d.ties[mediator][c.a] || !d.ties[mediator][c.b]) return { ok: false, msg: 'Нужны отношения с обеими сторонами' };
  if (!spend(g, mediator, DIP_COST.mediate)) return { ok: false, msg: `Не хватает очков влияния (нужно ${DIP_COST.mediate})` };
  const t = (d.trust[c.a][mediator] + d.trust[c.b][mediator]) / 2 + (d.rep[mediator].reliab - 60) * 0.4;
  if (t < -5) { addTrust(g, c.a, mediator, -2); return { ok: false, msg: 'Стороны не доверяют посреднику' }; }
  c.faceSaved = true;
  const what = applyDemand(g, c, 0.5);
  feel(g, c.a, mediator, 6, 0, 'mediation'); feel(g, c.b, mediator, 6, 0, 'mediation');
  repGood(g, mediator, 1.5);
  closeCrisis(g, c, 'resolved', `посредничество ${g.states[mediator].name} (${what})`);
  logDip(g, `${g.states[mediator].name} уладила спор ${g.states[c.a].name} и ${g.states[c.b].name}`, true, c.a, c.b, 'crisis');
  return { ok: true, msg: 'Спор улажен посредником' };
}

// ежедневно: сроки, расходы мобилизации, зависшие кризисы
export function stepCrises(g, botRespond, botInstigate) {
  const d = g.dip;
  for (const c of d.crises) {
    if (c.state !== 'open') continue;
    if (inWar(g, c.a, c.b)) { closeCrisis(g, c, 'war', 'началась война'); continue; }
    if (c.flags.mobilize) for (const s of [c.a, c.b]) { const S = g.states[s]; S.money = Math.max(0, S.money - Math.min(40, S.money * DIP.mobilizeCost * 0.1)); }
    if (c.awaiting === 'target') {
      if (c.b !== g.playerState && botRespond) botRespond(g, c);
      if (c.state === 'open' && c.awaiting === 'target' && g.day >= c.deadline) respond(g, c.id, 'refuse');    // молчание = отказ
    } else if (c.awaiting === 'instigator') {
      if (c.a !== g.playerState && botInstigate) botInstigate(g, c);
      if (c.state === 'open' && c.awaiting === 'instigator' && g.day >= c.deadline) {
        d.face[c.a] = clamp(d.face[c.a] - 8, 0, 100);                  // блеф раскрыт
        closeCrisis(g, c, 'backed', 'инициатор не решился идти дальше');
      }
    }
  }
  d.crises = d.crises.filter((c) => c.state === 'open' || g.day - (c.endDay || 0) < 40);
}
void money; void perceive;
