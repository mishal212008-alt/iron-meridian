// Запуск: node tests/sim.test.mjs
import { gridSample, territoryAt, provAt } from '../js/world.js';
import { plotError, findSpot, cityProduction } from '../js/sim.js';
import { newGame, tick, serialize, deserialize, stateProvs, startBuild, buildError } from '../js/sim.js';
import { STATES_DEF, DEPOSIT_KINDS } from '../js/data.js';
import {
  answerOffer, breakPact, cancelDeal, createDeal, declareWar, evaluate, gift, isClosed, propose, setBorder, statusOf, tradeBlock,
} from '../js/diplomacy.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('ПРОВАЛ:', msg); } };

for (const seed of [1, 7, 42, 123, 999, 31337]) {
  const g = newGame({ seed, playerState: 0 });
  const counts = g.states.map((s) => stateProvs(g, s.id).length);
  ok(g.provs.length >= 28, `seed ${seed}: мало провинций (${g.provs.length})`);
  ok(counts.every((c) => c >= 6), `seed ${seed}: у кого-то слишком мало провинций ${counts}`);
  for (const s of g.states) {
    const ps = stateProvs(g, s.id);
    for (const k of DEPOSIT_KINDS) {
      const prof = STATES_DEF[s.id].deposits[k], n = ps.filter((p) => p.deposits[k] > 0).length;
      if (prof === 0) ok(n === 0, `seed ${seed}: у ${s.name} не должно быть «${k}» (${n})`);
      if (prof === 'S') ok(n === 1, `seed ${seed}: у ${s.name} должно быть ровно одно «${k}» (${n})`);
      if (prof === 'A') ok(n >= 3, `seed ${seed}: у ${s.name} мало «${k}» (${n})`);
    }
    ok(ps.some((p) => p.deposits.oil > 0), `seed ${seed}: у ${s.name} нет нефти`);
  }
  ok(g.world.borders.length >= 5, `seed ${seed}: нет границ`);
  {
    const pairs = new Set(g.world.checkpoints.map((c) => c.a + '-' + c.b));
    const need = new Set();
    for (const p of g.provs) for (const q of g.world.nbrs[p.id]) if (g.provs[q].owner !== p.owner) need.add(Math.min(p.owner, g.provs[q].owner) + '-' + Math.max(p.owner, g.provs[q].owner));
    ok([...pairs].length >= 4, `seed ${seed}: мало КПП (${pairs.size})`);
  }
  const w = g.world;
  ok(g.provs.every((p) => gridSample(w.h, p.x, p.z) > 0.02), `seed ${seed}: город в воде`);
  ok(g.provs.every((p) => provAt(w, p.x, p.z) === p.id && territoryAt(w, p.x, p.z)[0] === p.id), `seed ${seed}: город не в своей территории`);
  ok(g.provs.every((p) => Object.values(p.depositPos).every((d) => gridSample(w.h, d[0], d[1]) > 0)), `seed ${seed}: месторождение в воде`);
  ok(g.provs.every((p) => DEPOSIT_KINDS.every((k) => (p.deposits[k] ? p.depositPos[k] : true))), `seed ${seed}: нет точки месторождения`);
  { // дорожная сеть связывает все города
    const seen = new Set([0]), st = [0];
    while (st.length) { const c = st.pop(); for (const r of w.roads) { const o = r.a === c ? r.b : r.b === c ? r.a : -1; if (o >= 0 && !seen.has(o)) { seen.add(o); st.push(o); } } }
    ok(seen.size === g.provs.length, `seed ${seed}: дороги не связывают все города (${seen.size}/${g.provs.length})`);
  }
  // игрок ничего не строит, боты играют 400 дней
  for (let i = 0; i < 400; i++) tick(g);
  for (const s of g.states) {
    for (const k of ['money', 'steel', 'fuel', 'electronics', 'gold', 'rare']) {
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
    ok(plotError(g, p, 'mine', d[0] + 8, d[1]) !== null, 'рудник вдали от руды должен быть запрещён');
  }
  ok(startBuild(g, p, 'power', spot) === null, 'startBuild в выбранное место не прошёл');
  ok(plotError(g, p, 'power', spot.x + 0.5, spot.z) !== null, 'должна быть проверка занятости места');
  for (let i = 0; i < 40; i++) tick(g);
  const pr = cityProduction(p);
  ok(Object.values(pr).every((v) => Number.isFinite(v.prod) && Number.isFinite(v.cons)), 'cityProduction NaN');
}

// дипломатия
{
  const g = newGame({ seed: 21, playerState: 0 });
  const A = g.states[0], B = g.states[1];
  A.gold = 500; B.money = 5000; B.gold = 0;
  // сделка: игрок продаёт золото
  let r = propose(g, 0, 1, 'deal', { seller: 0, buyer: 1, res: 'gold', amt: 5, price: 18, days: 30 });
  ok(r.ok, 'Аурелия должна купить ' + JSON.stringify(r));
  const m0 = A.money, g0 = A.gold;
  tick(g);
  ok(A.gold < g0 && A.money > m0 - 1000, 'сделка не исполнилась');
  ok(A.trade.gold === -5 && B.trade.gold === 5, 'учёт торговли неверен');
  // слишком дорого
  r = propose(g, 0, 1, 'deal', { seller: 0, buyer: 1, res: 'steel', amt: 5, price: 400, days: 30 });
  ok(!r.ok && r.reasons.length, 'абсурдная цена должна быть отвергнута');
  // граница закрывает торговлю
  ok(setBorder(g, 0, 1, true).ok && isClosed(g, 0, 1), 'граница не закрылась');
  ok(g.dip.deals.length === 0, 'сделки должны сниматься при закрытии границы');
  ok(!!tradeBlock(g, 0, 1), 'торговля должна быть заблокирована');
  r = propose(g, 0, 1, 'deal', { seller: 0, buyer: 1, res: 'gold', amt: 5, price: 18, days: 30 });
  ok(!r.ok, 'сделка через закрытую границу');
  setBorder(g, 0, 1, false);
  // договоры
  g.dip.rel[0][1] = g.dip.rel[1][0] = 50;
  ok(propose(g, 0, 1, 'friend').ok && statusOf(g, 0, 1) === 'friend', 'дружба не заключилась');
  g.dip.rel[0][1] = g.dip.rel[1][0] = 80;
  ok(propose(g, 0, 1, 'ally').ok && statusOf(g, 0, 1) === 'ally', 'союз не заключился');
  ok(!setBorder(g, 0, 1, true).ok, 'союзнику нельзя закрыть границу');
  ok(breakPact(g, 0, 1).ok && statusOf(g, 0, 1) === 'neutral', 'расторжение не сработало');
  // война
  createDeal(g, { seller: 0, buyer: 1, res: 'gold', amt: 2, price: 18, days: 0 });
  ok(declareWar(g, 0, 1).ok && statusOf(g, 0, 1) === 'war', 'война не объявлена');
  ok(g.dip.deals.length === 0 && isClosed(g, 0, 1), 'война должна рвать сделки и закрывать границу');
  ok(!setBorder(g, 0, 1, false).ok, 'во время войны границу открыть нельзя');
  // предложение игроку от бота
  const g2 = newGame({ seed: 22, playerState: 0 });
  const rr = propose(g2, 2, 0, 'friend');
  ok(rr.ok && g2.dip.offers.length === 1, 'бот должен оставить предложение игроку');
  ok(answerOffer(g2, g2.dip.offers[0].id, false).ok && g2.dip.offers.length === 0, 'отклонение предложения');
  g2.states[0].money = 1000;
  ok(gift(g2, 0, 1, 100).ok, 'подарок');
  // сохранение с дипломатией
  g2.dip.closed[1][2] = true;
  const cp = deserialize(serialize(g2));
  ok(cp.dip.closed[1][2] === true && cp.dip.rel.length === 4, 'дипломатия не сохранилась');
  for (let i = 0; i < 30; i++) tick(cp);
}

console.log(fails === 0 ? 'ВСЕ ПРОВЕРКИ ПРОШЛИ' : `ПРОВАЛОВ: ${fails}`);
process.exit(fails ? 1 : 0);
