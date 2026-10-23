// Запуск: node tests/balance.mjs  — 4 бота играют 2000 дней на нескольких сидах.
import { newGame, tick, forecast, stateProvs } from '../js/sim.js';
import { BUILDINGS, BUILD_ORDER, RES, TRADE_RES } from '../js/data.js';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('ПРОВАЛ:', m); } };
const DAYS = Number(process.argv[2] || 2000);

// --- окупаемость зданий ---
console.log('\nОкупаемость зданий (1 ур., полная загрузка, справочные цены):');
console.log('здание'.padEnd(26), 'цена'.padStart(6), 'доход/д'.padStart(8), 'содерж'.padStart(7), 'чистыми'.padStart(8), 'окупается');
const core = ['housing', 'farm', 'power', 'hydro', 'mine', 'refinery', 'steelworks', 'electronics', 'goldmine', 'raremine'];
for (const t of BUILD_ORDER) {
  const f = forecast(t, 1, { deposits: { steel: 1, oil: 1, gold: 1, rare: 1 } });
  const cost = BUILDINGS[t].cost.money;
  const pb = f.payback === Infinity ? '— (косвенная польза)' : Math.round(f.payback) + ' дн.';
  console.log(BUILDINGS[t].name.padEnd(26), String(cost).padStart(6), f.income.toFixed(1).padStart(8), f.upkeep.toFixed(1).padStart(7), f.net.toFixed(1).padStart(8), pb);
  if (core.includes(t) && !['farm', 'housing'].includes(t)) ok(f.payback >= 25 && f.payback <= 70, `окупаемость «${BUILDINGS[t].name}» ${Math.round(f.payback)} дн. вне диапазона 25–70`);
}

// --- симуляция ботов ---
const rows = [];
for (const seed of [3, 42, 777]) {
  const g = newGame({ seed, playerState: -1, difficulty: 'normal' });
  const full = g.states.map(() => 0), debtDays = g.states.map(() => 0);
  for (let d = 0; d < DAYS; d++) {
    tick(g);
    g.events.length = 0;
    if (d > DAYS - 600) g.states.forEach((s, i) => { if (TRADE_RES.some((k) => s[k] >= s.cap * 0.98)) full[i]++; });
    g.states.forEach((s, i) => { if (s.debt) debtDays[i]++; });
  }
  g.states.forEach((s, i) => {
    const ps = stateProvs(g, s.id);
    const pop = ps.reduce((a, p) => a + p.pop, 0), bld = ps.reduce((a, p) => a + p.buildings.length, 0);
    rows.push({ seed, name: s.name, money: s.money, pop, bld, rate: s.rate.money, full: full[i] / 6, debt: debtDays[i] / DAYS, food: s.foodRatio });
    ok(RES.every((k) => Number.isFinite(s[k]) && s[k] >= 0), `seed ${seed}: ${s.name} NaN или минус`);
    ok(debtDays[i] / DAYS < 0.35, `seed ${seed}: ${s.name} слишком часто в долгах (${Math.round((100 * debtDays[i]) / DAYS)}%)`);
    ok(full[i] / 600 < 0.4, `seed ${seed}: ${s.name} упирается в потолок склада ${Math.round(full[i] / 6)}% времени`);
    ok(s.foodRatio > 0.8, `seed ${seed}: ${s.name} голодает`);
  });
  const pops = g.states.map((s) => stateProvs(g, s.id).reduce((a, p) => a + p.pop, 0));
  ok(Math.max(...pops) / Math.min(...pops) < 4, `seed ${seed}: доминирование (население ${pops.map(Math.round)})`);
}
console.log(`\nИтог через ${DAYS} дней:`);
for (const r of rows) console.log(`seed ${r.seed} ${r.name.padEnd(8)} 💰${Math.round(r.money)} 👥${Math.round(r.pop)} зданий ${r.bld} доход ${r.rate.toFixed(0)}/д, склад полон ${Math.round(r.full)}%, долги ${Math.round(r.debt * 100)}%`);
console.log(fails === 0 ? '\nБАЛАНС: ОК' : `\nПРОВАЛОВ: ${fails}`);
process.exit(fails ? 1 : 0);
