// Дипломатия: фасад над модулями dipcore / diptreaty / dipwar / dipoffer / dipeco / dipai. Без DOM.
// Состояние лежит в g.dip и сохраняется вместе с игрой.
import { BASE_PRICE, RES_LABEL, STOCK_TARGET, TRADE_RES } from './data.js';
import { DIP_VERSION, stepCore, upgradeDiplomacy, valueFor, money, N } from './dipcore.js';
import { recomputeStatus, runDeals, signTreaty, stepLoans, stepTreaties } from './diptreaty.js';
import { applyPeace, declareWar, endWar, stepCalls, stepCrises, stepWars } from './dipwar.js';
import { expireOffers } from './dipoffer.js';
import { allyShare, computeMods } from './dipeco.js';
import { botAnswerCall, botDiplomacy, botInstigate, botRespond, worldEvents, worldPressure } from './dipai.js';

export * from './dipcore.js';
export * from './diptreaty.js';
export * from './dipwar.js';
export * from './dipoffer.js';
export { computeMods, defaultMods, allyShare } from './dipeco.js';
export { botDiplomacy, warDesire, botRespond, botInstigate, botAnswerCall } from './dipai.js';
export { evaluateOffer as evaluate } from './dipoffer.js';

// международное давление: затянувшиеся и изнурительные войны останавливаются перемирием
function pressure(g) {
  for (const w of g.dip.wars) {
    if (w.state !== 'active') continue;
    const days = g.day - w.start;
    if ((days > 200 || (w.exh.A > 88 && w.exh.B > 88)) && w.a !== undefined) {
      applyPeace(g, 'truce', w.a, w.b);
      g.dip.rev++;
    }
  }
  for (const w of g.dip.wars) if (w.state === 'ceasefire' && g.day >= w.ceaseUntil) endWar(g, w, 'истекло перемирие');
}

export function stepDiplomacy(g) {
  stepCore(g);
  stepTreaties(g);
  runDeals(g);
  stepLoans(g);
  stepWars(g);
  stepCalls(g, botAnswerCall);
  stepCrises(g, botRespond, botInstigate);
  expireOffers(g);
  worldEvents(g);
  worldPressure(g);
  pressure(g);
  allyShare(g);
  for (const s of g.states) computeMods(g, s);
}

// подсказки для игрока: что можно выгодно предложить конкретному государству
export function hintsFor(g, me, other) {
  const A = g.states[me], B = g.states[other];
  const out = [];
  for (const res of TRADE_RES) {
    const vb = valueFor(g, B, res), va = valueFor(g, A, res);
    if (A[res] > STOCK_TARGET[res] * 0.3 && B[res] < STOCK_TARGET[res] * 0.5 && vb > va) out.push({ res, dir: 'sell', price: money(Math.max(va * 1.05, vb * 0.97)), why: `${B.name} нуждается в ${RES_LABEL[res].toLowerCase()}` });
    if (B[res] > STOCK_TARGET[res] * 0.5 && A[res] < STOCK_TARGET[res] * 0.5 && va >= vb) out.push({ res, dir: 'buy', price: money(Math.min(va * 0.97, vb * 1.08)), why: `${B.name} располагает запасом` });
  }
  return out;
}
void BASE_PRICE;

// Миграция сохранений v3/v4 → v5: старые статусы превращаются в договоры и войны
export function migrateDiplomacy(g) {
  if (g.dip && g.dip.v === DIP_VERSION) return false;
  upgradeDiplomacy(g);
  const old = g.dip.migrated;
  delete g.dip.migrated;
  if (old) {
    for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) {
      const st = old[a] && old[a][b];
      if (st === 'ally') signTreaty(g, 'ally', a, b, {}, true);
      else if (st === 'friend') signTreaty(g, 'friend', a, b, {}, true);
      else if (st === 'war') { g.dip.lastWar[a][b] = -999; g.dip.lastWar[b][a] = -999; declareWar(g, a, b, { origin: 'migrated' }); }
    }
  }
  recomputeStatus(g);
  return true;
}
