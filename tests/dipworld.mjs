// Симуляция мира: 4 бота, N дней, много сидов. Печатает статистику внешней политики.
// Запуск: node tests/dipworld.mjs [дней=3000] [сидов=20] [сложность=normal]
import { newGame, tick } from '../js/sim.js';
import { TREATIES } from '../js/data.js';

const DAYS = +process.argv[2] || 3000, SEEDS = +process.argv[3] || 20, DIFF = process.argv[4] || 'normal';
const agg = { wars: 0, warDays: 0, warsEnded: 0, treaties: {}, crises: 0, crisesWar: 0, crisesYield: 0, crisesBack: 0, allWar: 0, minRep: 100, blocDays: 0, winners: 0, loops: 0, maxOffers: 0, eternal: 0, coalitions: 0, betrayals: 0 };
const rows = [];
for (let seed = 1; seed <= SEEDS; seed++) {
  const g = newGame({ seed: seed * 101, playerState: -1, difficulty: DIFF });
  const seenW = new Map(), seenT = new Map(), seenC = new Map();
  let allWarDays = 0, blocDays = 0, maxActive = 0, pairWarDays = {};
  const refusals = {};
  for (let i = 0; i < DAYS; i++) {
    tick(g);
    const d = g.dip;
    for (const w of d.wars) {
      if (!seenW.has(w.id)) { seenW.set(w.id, { start: w.start }); agg.wars++; }
      if (w.state === 'ended' && !seenW.get(w.id).end) { seenW.get(w.id).end = w.endDay; agg.warsEnded++; }
    }
    for (const t of d.treaties) if (!seenT.has(t.id)) { seenT.set(t.id, t); agg.treaties[t.kind] = (agg.treaties[t.kind] || 0) + 1; }
    for (const c of d.crises) if (!seenC.has(c.id)) { seenC.set(c.id, c); agg.crises++; }
    const active = d.wars.filter((w) => w.state === 'active').length;
    maxActive = Math.max(maxActive, active);
    // война «всех со всеми»: каждое государство воюет хотя бы с двумя
    let all = true;
    for (let a = 0; a < 4; a++) { let n = 0; for (let b = 0; b < 4; b++) if (a !== b && d.status[a][b] === 'war') n++; if (n < 2) all = false; }
    if (all) allWarDays++;
    // блоки: есть союз/оборонный пакт
    if (d.treaties.some((t) => t.state === 'active' && ['ally', 'defense', 'protect'].includes(t.kind))) blocDays++;
    agg.maxOffers = Math.max(agg.maxOffers, d.offers.length);
    for (let a = 0; a < 4; a++) agg.minRep = Math.min(agg.minRep, d.rep[a].reliab);
    // вечная война: любая война дольше 400 дней
    for (const w of d.wars) if (w.state === 'active' && g.day - w.start > 400) { agg.eternal++; w.start = g.day; }
  }
  for (const c of seenC.values()) { if (c.state === 'war') agg.crisesWar++; else if (c.state === 'resolved') agg.crisesYield++; else if (c.state === 'backed') agg.crisesBack++; }
  const durations = [...seenW.values()].filter((w) => w.end).map((w) => w.end - w.start);
  agg.warDays += durations.reduce((a, b) => a + b, 0);
  agg.blocDays += blocDays; agg.allWar += allWarDays;
  const pw = g.dip.power.map((p) => p / g.dip.power.reduce((a, b) => a + b, 0));
  const top = Math.max(...pw);
  if (top > 0.7) agg.winners++;
  const viol = [...seenT.values()].filter((t) => t.state === 'broken').length;
  rows.push({ seed, wars: seenW.size, maxActive, allWarDays, blocDays: Math.round(blocDays / DAYS * 100), top: Math.round(top * 100), viol, reps: g.dip.rep.map((r) => Math.round(r.reliab)).join('/') });
  void refusals;
}
console.table(rows);
const n = SEEDS;
console.log(`Сложность ${DIFF}, дней ${DAYS}, сидов ${n}`);
console.log(`войн всего ${agg.wars} (на сид ${(agg.wars / n).toFixed(1)}), закончено ${agg.warsEnded}, средняя длительность ${(agg.warDays / Math.max(1, agg.warsEnded)).toFixed(0)} дн.`);
console.log(`кризисов ${agg.crises}: война ${agg.crisesWar}, уступка/компромисс ${agg.crisesYield}, отступление ${agg.crisesBack}`);
console.log('договоры:', Object.entries(agg.treaties).map(([k, v]) => `${TREATIES[k].name} ${v}`).join(', '));
console.log(`дней войны всех со всеми: ${agg.allWar}; затяжных (>400) войн: ${agg.eternal}; дней с блоками: ${(agg.blocDays / (n * DAYS) * 100).toFixed(0)}%`);
console.log(`доминирующих (мощь >70%): ${agg.winners}; минимум надёжности: ${agg.minRep.toFixed(0)}; макс. очередь предложений: ${agg.maxOffers}`);
