// Внешняя политика ботов: личность, баланс угрозы, кризисы, мир, события. Без DOM.
import { DIP, DIP_COST, DIP_DIFF, STOCK_TARGET, TRADE_RES } from './data.js';
import {
  N, clamp, commonEnemy, dealsBetween, effPower, hasTreaty, inWar, interdependence, logDip, money, overlordOf, perceive, relOf, spend, statusOf, summarizeNeeds, tradeBlock, treatiesBetween, valueFor,
  activeEnemies, feel, repGood, addTrust,
} from './dipcore.js';
import { appointAmbassador, breakTreaty, joinSanctions, setBorder } from './diptreaty.js';
import {
  answerBargain, answerCall, backdown, crisisError, crisisOf, DEMANDS, declareFromCrisis, escalate, grantCb, mediateCrisis, respond, scoreFor, sideOf, startCrisis, warBetween, warError, hasCb,
} from './dipwar.js';
import { evaluateOffer, propose } from './dipoffer.js';

const diffOf = (g) => DIP_DIFF[g.difficulty] || DIP_DIFF.normal;
const isBot = (g, s) => s !== g.playerState;
const partnersOf = (g, s, kinds = ['ally', 'defense', 'protect']) => {
  const out = [];
  for (const t of g.dip.treaties) if (t.state === 'active' && kinds.includes(t.kind)) { if (t.a === s) out.push(t.b); else if (t.b === s) out.push(t.a); }
  return [...new Set(out)];
};
// сила стороны с её друзьями: глазами наблюдателя (с шумом разведки)
function blocPower(g, viewer, target, exclude = []) {
  let p = perceive(g, viewer, target).power;
  for (const a of partnersOf(g, target)) if (a !== viewer && !exclude.includes(a)) p += perceive(g, viewer, a).power * 0.7;
  return p;
}
const myBloc = (g, me, exclude = []) => {
  let p = effPower(g, me);
  for (const a of partnersOf(g, me)) if (!exclude.includes(a)) p += effPower(g, a) * 0.7;
  return p;
};

// ---------- желание воевать ----------
export function warDesire(g, me, o) {
  const d = g.dip, P = d.pers[me], diff = diffOf(g);
  const ratio = blocPower(g, me, o, [me]) / Math.max(0.01, myBloc(g, me, [o]));
  let v = P.aggr * diff.aggr * 42;
  v += Math.max(0, -relOf(g, me, o)) * 0.35;
  if (hasCb(g, me, o)) v += 12;
  v += (1 - ratio) * 26;
  const nb = summarizeNeeds(g, g.states[me]).needs, os = summarizeNeeds(g, g.states[o]).surplus;
  v += P.greed * 3 * nb.filter((r) => os.includes(r)).length;
  v -= interdependence(g, me, o) * 40;
  v -= P.caution * 16;
  if (hasTreaty(g, me, o, 'nap')) v -= 32 * (0.4 + P.honor);
  if (hasTreaty(g, me, o, 'friend') || hasTreaty(g, me, o, 'trade')) v -= 14 * (0.4 + P.honor);
  v -= d.adj[me][o] > 0 ? 0 : 10;                                 // дальний сосед — меньше поводов
  v -= d.rep[me].aggr > 65 ? 6 : 0;                               // уже известный агрессор осторожнее
  return { v, ratio };
}

// ---------- ответы бота ----------
export function botRespond(g, c) {
  if (g.day - (c.stepDay ?? c.start) < 1) return;
  const d = g.dip, P = d.pers[c.b], diff = diffOf(g);
  const ratio = blocPower(g, c.b, c.a, [c.b]) / Math.max(0.01, myBloc(g, c.b, [c.a]));
  const cheap = c.demand.kind === 'tribute' ? c.demand.amount < g.states[c.b].money * 0.15 : c.demand.kind === 'resource' ? true : c.demand.kind === 'open_border';
  const ys = (ratio - 1) * 2.2 + P.caution * 0.9 - P.aggr * 0.9 - P.honor * 0.3 + (cheap ? 0.5 : 0) + (c.step >= 3 ? 0.25 : 0) + (diff === DIP_DIFF.easy ? 0.3 : 0) - (d.face[c.b] < 35 ? 0.3 : 0);
  if (c.step >= 2 && !c.backersTried) {
    c.backersTried = true;
    if (partnersOf(g, c.b).length && ys < 0.9) respond(g, c.id, 'appeal', c.b);
  }
  if (ys > 0.85) respond(g, c.id, 'yield', c.b);
  else if (ys > 0.25 && !c.flags.bargained) { c.flags.bargained = true; respond(g, c.id, 'bargain', c.b); }
  else respond(g, c.id, 'refuse', c.b);
}
export function botInstigate(g, c) {
  const d = g.dip, P = d.pers[c.a], diff = diffOf(g);
  if (c.flags.bargain) {
    if (g.rand() < 0.6 - P.aggr * 0.4) answerBargain(g, c.id, true); else answerBargain(g, c.id, false);
    return;
  }
  if (g.day - (c.stepDay ?? c.start) < 1) return;
  const ratio = blocPower(g, c.a, c.b, [c.a]) / Math.max(0.01, myBloc(g, c.a, [c.b]));     // >1: цель сильнее
  const eager = P.aggr * diff.aggr;
  const go = ratio < 0.95 + eager * 0.5 || g.rand() < eager * 0.12;                         // блеф бывает
  const bots = partnersOf(g, c.b).filter((x) => !d.ties[c.a][x] || relOf(g, x, c.a) < 20);
  const guarded = bots.length >= 2 && ratio > 0.7;
  if (c.refused && go && !guarded) {
    if (c.step >= 2) { declareFromCrisis(g, c); return; }
    const r = escalate(g, c.id);
    if (!r.ok && /влияния|денег|30/.test(r.msg)) return;                                    // подкопить и подождать
    return;
  }
  if (c.refused) backdown(g, c.id);
}
export function botAnswerCall(g, call) {
  if (g.day <= call.start) return null;
  const d = g.dip, P = d.pers[call.ally];
  const war = d.wars.find((w) => w.id === call.war);
  if (!war) return false;
  const enemies = call.side === 'A' ? war.sideB : war.sideA;
  const friends = call.side === 'A' ? war.sideA : war.sideB;
  const ePow = enemies.reduce((s, e) => s + perceive(g, call.ally, e).power, 0);
  const fPow = friends.reduce((s, e) => s + effPower(g, e), 0);
  const my = effPower(g, call.ally);
  const afraid = ePow > (my + fPow) * 1.6 && P.caution > 0.55;
  if (call.binding) return !(afraid && g.rand() < 0.5);
  const likes = relOf(g, call.ally, call.to) > 20;
  const hates = enemies.some((e) => relOf(g, call.ally, e) < 0);
  if (call.kind === 'offense') return hates && P.aggr > 0.4 && !afraid;
  return (likes || hates) && !afraid && g.rand() < 0.4 + P.aggr * 0.4;
}

// ---------- мир ----------
function botPeace(g, me) {
  const d = g.dip, diff = diffOf(g);
  for (const war of d.wars) {
    if (war.state !== 'active' || (war.a !== me && war.b !== me)) continue;
    const enemy = war.a === me ? war.b : war.a;
    const days = g.day - war.start;
    if (days < 10) continue;
    const side = sideOf(war, me), sc = scoreFor(war, me);
    const wants = war.exh[side] > 35 || sc < -8 || days > 70 || g.rand() < 0.05;
    if (!wants) continue;
    const cands = [];
    if (sc > 25 && !g.states[enemy].isPlayer) cands.push(['peacetreaty', { payer: enemy, contrib: Math.round(Math.min(g.states[enemy].money * 0.4, sc * 5) / 10) * 10, dmz: true }]);
    if (sc > 25 && g.states[enemy].isPlayer) cands.push(['peacetreaty', { payer: enemy, contrib: Math.round(Math.min(g.states[enemy].money * 0.3, sc * 4) / 10) * 10 }]);
    cands.push(['whitepeace', {}], ['truce', {}]);
    if (sc < -35) cands.unshift(['peacetreaty', { payer: me, contrib: Math.round(Math.min(g.states[me].money * 0.3, -sc * 3) / 10) * 10 }]);
    for (const [kind, params] of cands) {
      if (g.states[enemy].isPlayer) { if (propose(g, me, enemy, kind, params).ok) break; continue; }
      const ev = evaluateOffer(g, me, enemy, kind, params);
      if (ev.accept || diff === DIP_DIFF.easy && ev.score > -4) { propose(g, me, enemy, kind, params); break; }
    }
  }
}

// ---------- торговые сделки (как раньше, но через новые предложения) ----------
const myDeals = (g, id) => g.dip.deals.filter((d) => d.seller === id || d.buyer === id);
function botTrade(g, s) {
  const me = s.id, d = g.dip;
  if (myDeals(g, me).length >= 6) return;
  const others = g.states.filter((o) => o.id !== me);
  const { needs, surplus } = summarizeNeeds(g, s);
  const tryDeal = (res, partner, asBuyer) => {
    if (tradeBlock(g, me, partner.id) || relOf(g, me, partner.id) < -20) return false;
    const key = `d${me}-${partner.id}-${res}`;
    if ((d.cool[key] ?? -99) > g.day) return false;
    if (d.deals.some((x) => x.res === res && ((x.seller === me && x.buyer === partner.id) || (x.seller === partner.id && x.buyer === me)))) return false;
    d.cool[key] = g.day + 14;
    const base = valueFor(g, s, res);
    const price = money(asBuyer ? base * (0.95 + g.rand() * 0.12) : base * (1.0 + g.rand() * 0.15));
    const amt = Math.max(2, Math.round((4 + g.rand() * 8) / 2) * 2) * (res === 'electronics' || res === 'gold' || res === 'rare' ? 1 : 2);
    const params = { seller: asBuyer ? partner.id : me, buyer: asBuyer ? me : partner.id, res, amt, price, days: 45 };
    if (partner.isPlayer) {
      if (asBuyer && partner[res] < amt * 10) return false;
      if (!asBuyer && partner[res] > STOCK_TARGET[res] * 0.7) return false;
      if (d.offers.filter((o) => o.to === partner.id).length >= 2) return false;
    }
    return propose(g, me, partner.id, 'deal', params).ok;
  };
  for (const res of needs) {
    const ps = others.filter((o) => o[res] > STOCK_TARGET[res] * (o.isPlayer ? 0.6 : 0.5)).sort((a, b) => relOf(g, me, b.id) - relOf(g, me, a.id));
    for (const p of ps) if (tryDeal(res, p, true)) break;
  }
  for (const res of surplus) {
    const ps = others.filter((o) => o[res] < STOCK_TARGET[res] * 0.3).sort((a, b) => relOf(g, me, b.id) - relOf(g, me, a.id));
    for (const p of ps) if (tryDeal(res, p, false)) break;
  }
}

// ---------- главная политика бота ----------
export function botDiplomacy(g, s) {
  const me = s.id, d = g.dip, P = d.pers[me], diff = diffOf(g);
  if (overlordOf(g, me) >= 0) { botTrade(g, s); return; }          // вассал сам не решает
  const others = [...Array(N).keys()].filter((o) => o !== me);
  const total = g.states.reduce((a, _, i) => a + effPower(g, i), 0);
  let budget = 2;                                                   // не больше пары дипходов за раз

  botPeace(g, me);
  // границы и послы
  for (const o of others) {
    const st = statusOf(g, me, o), rel = relOf(g, me, o);
    if (st === 'war' || st === 'ceasefire') continue;
    if (!d.ties[me][o] && rel > -25 && budget > 0 && propose(g, me, o, 'ties').ok) budget--;
    if (d.ties[me][o] && !d.amb[me][o]) appointAmbassador(g, me, o);
    if (!d.closed[me][o] && rel < -38 && st !== 'ally') setBorder(g, me, o, true);
    else if (d.closed[me][o] && rel > -8) setBorder(g, me, o, false);
  }
  // кого бояться: сильнейший сосед
  const order = [...others].sort((a, b) => effPower(g, b) - effPower(g, a));
  const top = order[0];
  const topShare = effPower(g, top) / Math.max(0.01, total);
  const mine = effPower(g, me) / Math.max(0.01, total);
  const threatening = topShare > 0.36 + (diff.coalition > 1 ? -0.04 : diff.coalition < 1 ? 0.06 : 0);

  // лестница договоров по отношению
  for (const o of others) {
    if (budget <= 0) break;
    const st = statusOf(g, me, o), rel = relOf(g, me, o);
    if (st === 'war' || st === 'ceasefire' || !d.ties[me][o]) continue;
    const ok = (kind, params) => { const r = propose(g, me, o, kind, params); if (r.ok) budget--; return r.ok; };
    const has = (k) => hasTreaty(g, me, o, k);
    if (!has('trade') && rel > 8 && interdependence(g, me, o) < 0.5 && g.rand() < 0.4 && ok('trade', {})) continue;
    if (!has('friend') && rel > 26 && g.rand() < 0.35 && ok('friend', {})) continue;
    if (!has('nap') && !has('friend') && rel > 0 && (P.caution > 0.5 || effPower(g, o) > effPower(g, me) * 1.2) && g.rand() < 0.25 && ok('nap', {})) continue;
    // коалиция против сильнейшего: оборонный пакт с теми, кого он тоже пугает
    if (threatening && o !== top && me !== top && !has('defense') && !has('ally') && (has('friend') || has('nap') || has('trade')) && relOf(g, me, top) < 25 + diff.coalition * 5 && relOf(g, o, top) < 30 && g.rand() < 0.35 * diff.coalition) {
      if (ok('defense', { binding: P.honor > 0.5, noChain: P.caution > 0.55 })) continue;
    }
    if (has('friend') && !has('ally') && rel > 55 && (commonEnemy(g, me, o) > 4 || (threatening && o !== top)) && g.rand() < 0.2 && ok('ally', {})) continue;
    // слабый ищет покровителя
    if (mine < 0.12 && o === top && !has('protect') && P.caution > 0.55 && rel > 10 && g.rand() < 0.1 && ok('protect', { over: o })) continue;
  }
  // санкции против явного агрессора
  const agg = order.find((o) => d.rep[o].aggr > 62 && relOf(g, me, o) < -10 && !d.sanc[o].includes(me));
  if (agg !== undefined && d.inf[me] > 14 && g.rand() < 0.08 * diff.coalition) joinSanctions(g, me, agg);

  // предательство: мало чести, высокая агрессия, слабый сосед по договору
  if (P.honor < 0.4 && P.aggr > 0.55 && g.rand() < 0.01) {
    const victim = others.find((o) => (hasTreaty(g, me, o, 'nap') || hasTreaty(g, me, o, 'friend')) && effPower(g, o) < effPower(g, me) * 0.7);
    if (victim !== undefined && !warError(g, me, victim)) {
      for (const t of treatiesBetween(g, me, victim)) if (['nap', 'friend'].includes(t.kind)) breakTreaty(g, me, victim, t.kind);
      logDip(g, `🗡️ ${g.states[me].name} предала партнёра — ${g.states[victim].name}`, true, me, victim, 'treaty');
    }
  }

  // кризисы и войны
  const mineCrisis = d.crises.some((c) => c.state === 'open' && c.a === me);
  const atWar = activeEnemies(g, me).length;
  if (!mineCrisis && atWar === 0 && d.inf[me] >= DIP_COST.protest && g.rand() < 0.5) {
    let best = null;
    for (const o of others) {
      if (crisisError(g, me, o) || warError(g, me, o)) continue;
      const { v, ratio } = warDesire(g, me, o);
      if (v > 36 && ratio < 1.4 && (!best || v > best.v)) best = { o, v };
    }
    if (best) {
      const demand = g.rand() < 0.5 ? DEMANDS.tribute(g, me, best.o, Math.round(g.states[best.o].money * 0.15 / 10) * 10 + 50) : g.rand() < 0.5 ? DEMANDS.resource(g, me, best.o, 80, 'steel') : DEMANDS.open_border();
      startCrisis(g, me, best.o, demand);
    }
  }
  botTrade(g, s);
}

// ---------- случайные события ----------
export function worldEvents(g) {
  const d = g.dip, diff = diffOf(g);
  if (g.day % Math.max(4, Math.round(DIP.eventEvery / diff.event)) !== 0) return;
  const r = g.rand();
  const pairs = [];
  for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) if (a !== b && d.ties[a][b] && !inWar(g, a, b)) pairs.push([a, b]);
  if (!pairs.length) return;
  const [a, b] = pairs[Math.floor(g.rand() * pairs.length)];
  const A = g.states[a].name, B = g.states[b].name;
  const you = (a === g.playerState || b === g.playerState);
  if (r < 0.4 && d.adj[a][b] > 0) {
    feel(g, b, a, -9, 0, 'incident', 'пограничный инцидент');
    addTrust(g, a, b, -2);
    if (g.rand() < 0.5) grantCb(g, b, a, 'incident', 35);
    logDip(g, `⚠️ Пограничный инцидент: ${A} ↔ ${B}`, you, a, b, 'event');
  } else if (r < 0.75) {
    d.rep[a].reliab = Math.max(0, d.rep[a].reliab - 2);
    feel(g, b, a, -10, 0, 'spy', 'шпионаж');
    d.know[b][a] = Math.min(100, d.know[b][a] + 6);
    logDip(g, `🕵️ Шпионский скандал: агенты ${A} пойманы в ${B}`, you, a, b, 'event');
  } else if (r < 0.9 && a !== g.playerState && !crisisOf(g, a, b) && d.pers[a].aggr > 0.45) {
    d.inf[a] += DIP_COST.protest;
    const res = startCrisis(g, a, b, DEMANDS.open_border());
    if (res.ok) logDip(g, `🔥 Дипломатический кризис: ${A} против ${B}`, you, a, b, 'event');
  } else {
    feel(g, a, b, 6, 6, 'service', 'совместная инициатива');
    logDip(g, `🤝 ${A} и ${B} провели культурный обмен`, false, a, b, 'event');
  }
}

// посредничество третьих сторон и давление мирового сообщества
export function worldPressure(g) {
  const d = g.dip, diff = diffOf(g);
  for (const c of d.crises) {
    if (c.state !== 'open' || c.step < 2 || g.rand() > 0.12) continue;
    const meds = [...Array(N).keys()].filter((m) => m !== c.a && m !== c.b && m !== g.playerState && d.ties[m][c.a] && d.ties[m][c.b] && d.inf[m] >= DIP_COST.mediate && d.pers[m].caution > 0.4);
    if (meds.length && g.rand() < 0.4 * diff.coalition) mediateCrisis(g, c.id, meds[Math.floor(g.rand() * meds.length)]);
  }
}
void clamp; void dealsBetween; void spend; void repGood; void TRADE_RES; void answerCall; void answerBargain; void warBetween; void logDip;
