// Запуск: node tests/sim.test.mjs
import { gridSample, territoryAt, provAt } from '../js/world.js';
import { plotError, findSpot, cityProduction } from '../js/sim.js';
import { newGame, tick, serialize, deserialize, stateProvs, startBuild, buildError } from '../js/sim.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('ПРОВАЛ:', msg); } };

for (const seed of [1, 7, 42, 123, 999, 31337]) {
  const g = newGame({ seed, playerState: 0 });
  const counts = g.states.map((s) => stateProvs(g, s.id).length);
  ok(g.provs.length >= 28, `seed ${seed}: мало провинций (${g.provs.length})`);
  ok(counts.every((c) => c >= 6), `seed ${seed}: у кого-то слишком мало провинций ${counts}`);
  for (const s of g.states) {
    const ps = stateProvs(g, s.id);
    ok(ps.some((p) => p.deposits.steel > 0), `seed ${seed}: у ${s.name} нет руды`);
    ok(ps.some((p) => p.deposits.oil > 0), `seed ${seed}: у ${s.name} нет нефти`);
  }
  const w = g.world;
  ok(g.provs.every((p) => gridSample(w.h, p.x, p.z) > 0.02), `seed ${seed}: город в воде`);
  ok(g.provs.every((p) => provAt(w, p.x, p.z) === p.id && territoryAt(w, p.x, p.z)[0] === p.id), `seed ${seed}: город не в своей территории`);
  ok(g.provs.every((p) => Object.values(p.depositPos).every((d) => gridSample(w.h, d[0], d[1]) > 0)), `seed ${seed}: месторождение в воде`);
  ok(g.provs.every((p) => (p.deposits.steel ? p.depositPos.steel : true) && (p.deposits.oil ? p.depositPos.oil : true)), `seed ${seed}: нет точки месторождения`);
  { // дорожная сеть связывает все города
    const seen = new Set([0]), st = [0];
    while (st.length) { const c = st.pop(); for (const r of w.roads) { const o = r.a === c ? r.b : r.b === c ? r.a : -1; if (o >= 0 && !seen.has(o)) { seen.add(o); st.push(o); } } }
    ok(seen.size === g.provs.length, `seed ${seed}: дороги не связывают все города (${seen.size}/${g.provs.length})`);
  }
  // игрок ничего не строит, боты играют 400 дней
  for (let i = 0; i < 400; i++) tick(g);
  for (const s of g.states) {
    for (const k of ['money', 'steel', 'fuel', 'electronics']) {
      ok(Number.isFinite(s[k]) && s[k] >= 0, `seed ${seed}: ${s.name}.${k} = ${s[k]}`);
    }
    ok(Number.isFinite(s.energy.ratio), `seed ${seed}: энергия NaN`);
  }
  for (const p of g.provs) ok(Number.isFinite(p.pop) && p.pop > 0, `seed ${seed}: население ${p.pop}`);
  if (true) {
    console.log('seed', seed, 'день', g.day, g.states.map((s) => `${s.name}: 💰${Math.round(s.money)} 🔩${Math.round(s.steel)} ⛽${Math.round(s.fuel)} 🔌${Math.round(s.electronics)} ⚡${s.energy.ratio.toFixed(2)}`).join(' | '));
    console.log('зданий у ботов:', g.states.map((s) => stateProvs(g, s.id).reduce((a, p) => a + p.buildings.length, 0)));
  }
}

// ручная стройка и сохранение
{
  const g = newGame({ seed: 5, playerState: 1 });
  const cap = g.provs[g.states[1].capital];
  const before = g.states[1].money;
  const err = buildError(g, cap, 'housing');
  if (!err) { ok(startBuild(g, cap, 'housing') === null, 'startBuild вернул ошибку'); ok(g.states[1].money < before, 'деньги не списались'); }
  const copy = deserialize(serialize(g));
  ok(copy.day === g.day && copy.provs.length === g.provs.length, 'сохранение не совпало');
  for (let i = 0; i < 20; i++) tick(copy);
}

// размещение зданий на карте
{
  const g = newGame({ seed: 11, playerState: 0 });
  const p = g.provs.find((q) => q.owner === 0 && q.deposits.steel && !q.capital) || g.provs[g.states[0].capital];
  g.states[0].money = 1e5; g.states[0].steel = 1e4;
  ok(plotError(g, p, 'housing', p.x, p.z) === 'Слишком близко к центру города', 'центр города должен быть занят');
  ok(plotError(g, p, 'housing', -39, -39) !== null, 'вода должна блокировать стройку');
  const spot = findSpot(g, p, 'power');
  ok(!!spot && !plotError(g, p, 'power', spot.x, spot.z), 'findSpot вернул плохое место');
  if (p.deposits.steel) {
    const d = p.depositPos.steel;
    const mineSpot = findSpot(g, p, 'mine');
    ok(!!mineSpot && Math.hypot(mineSpot.x - d[0], mineSpot.z - d[1]) <= 2.5, 'рудник не у месторождения');
    ok(plotError(g, p, 'mine', spot ? spot.x : p.x + 4, spot ? spot.z : p.z) !== null, 'рудник вдали от руды должен быть запрещён');
  }
  ok(startBuild(g, p, 'power', spot) === null, 'startBuild в выбранное место не прошёл');
  ok(plotError(g, p, 'power', spot.x + 0.5, spot.z) !== null, 'должна быть проверка занятости места');
  for (let i = 0; i < 40; i++) tick(g);
  const pr = cityProduction(p);
  ok(Object.values(pr).every((v) => Number.isFinite(v.prod) && Number.isFinite(v.cons)), 'cityProduction NaN');
}

console.log(fails === 0 ? 'ВСЕ ПРОВЕРКИ ПРОШЛИ' : `ПРОВАЛОВ: ${fails}`);
process.exit(fails ? 1 : 0);
