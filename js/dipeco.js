// Связь дипломатии с экономикой: множители s.mods (читает sim.js), поддержка союзников. Без DOM.
import { DIP, STOCK_TARGET, TRADE_RES } from './data.js';
import { N, clamp, hasTreaty } from './dipcore.js';

export const defaultMods = () => ({ prod: 1, tax: 1, mcap: 1, sell: 1, buy: 1, mood: 0, notes: [] });

// Считаем множители для государства s (дёшево, раз в день)
export function computeMods(g, s) {
  const d = g.dip, m = defaultMods(), me = s.id;
  const note = (t) => m.notes.push(t);
  // потери войны
  let dmg = 0;
  for (const w of d.wars) { if (w.dmg[me]) dmg = Math.max(dmg, w.dmg[me]); }
  if (dmg > 0.005) { m.prod -= dmg; m.tax -= dmg * 0.8; m.mood -= dmg * 45; note(`Война: производство −${Math.round(dmg * 100)}%`); }
  // мобилизация
  for (const c of d.crises) if (c.state === 'open' && c.flags.mobilize && (c.a === me || c.b === me)) { m.prod -= 0.04; m.tax -= 0.03; note('Мобилизация: −4% производства'); break; }
  // блокада порта
  for (const c of d.crises) if (c.state === 'open' && c.flags.blockade && c.b === me) { m.mcap *= 1 - DIP.blockadePort; m.sell *= 0.9; note(`Блокада: торговый лимит −${Math.round(DIP.blockadePort * 100)}%`); break; }
  for (const w of d.wars) {
    if (w.state !== 'active') continue;
    const side = w.sideA.includes(me) ? 'A' : w.sideB.includes(me) ? 'B' : null;
    if (!side) continue;
    const lose = (side === 'A' ? -w.score : w.score) / 100;
    if (lose > 0.2) { m.mcap *= 1 - DIP.blockadePort * 0.5 * lose; note('Враг блокирует порты'); }
  }
  // эмбарго и санкции против нас
  let emb = 0;
  for (let x = 0; x < N; x++) if (x !== me && d.embargo[x][me]) emb++;
  emb += d.sanc[me].length;
  if (emb) { const cut = Math.min(0.6, DIP.sanctionCut * emb); m.mcap *= 1 - cut; m.sell *= 1 - cut * 0.4; note(`Эмбарго/санкции (${emb}): торговый лимит −${Math.round(cut * 100)}%`); }
  // торговые соглашения
  let tr = 0;
  for (const t of d.treaties) if (t.state === 'active' && t.kind === 'trade' && (t.a === me || t.b === me)) tr++;
  if (tr) { tr = Math.min(3, tr); m.mcap *= 1 + DIP.tradeAgreeCap * tr; m.sell += DIP.tradeAgreeSell * tr; m.buy -= DIP.tradeAgreeSell * tr * 0.6; note(`Торговые соглашения (${tr}): лимит +${Math.round(DIP.tradeAgreeCap * tr * 100)}%, лучше цены`); }
  // союзники делятся технологиями
  let al = 0;
  for (const t of d.treaties) if (t.state === 'active' && t.kind === 'ally' && (t.a === me || t.b === me)) al++;
  if (al) { m.prod += Math.min(0.04, 0.02 * al); note('Союзники делятся технологиями: +2% производства'); }
  m.prod = clamp(m.prod, 0.4, 1.2); m.tax = clamp(m.tax, 0.4, 1.2); m.mcap = clamp(m.mcap, 0.2, 2); m.sell = clamp(m.sell, 0.5, 1.2); m.buy = clamp(m.buy, 0.85, 1.2);
  s.mods = m;
  return m;
}

// союзники делятся ресурсами: излишек → дефицит
export function allyShare(g) {
  const d = g.dip;
  for (const t of d.treaties) {
    if (t.state !== 'active' || (t.kind !== 'ally' && t.kind !== 'protect')) continue;
    const A = g.states[t.a], B = g.states[t.b];
    for (const k of TRADE_RES) {
      if (k === 'gold' || k === 'rare') continue;
      const tg = STOCK_TARGET[k];
      for (const [x, y] of [[A, B], [B, A]]) {
        if (x[k] > tg * 1.3 && y[k] < tg * 0.25 && !d.closed[x.id][y.id]) {
          const n = Math.min(DIP.allyShareRate, x[k] - tg, Math.max(0, y.cap - y[k]));
          if (n >= 1) { x[k] -= n; y[k] += n; }
        }
      }
    }
  }
}
void hasTreaty;
