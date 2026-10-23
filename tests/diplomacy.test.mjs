// Тесты дипломатии: модель отношений, договоры, кризисы, война, боты, сохранения.
// Запуск: node tests/diplomacy.test.mjs
import { newGame, tick, serialize, deserialize } from '../js/sim.js';
import * as D from '../js/diplomacy.js';
import { DIP, TREATIES } from '../js/data.js';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('ПРОВАЛ:', m); } };
const mk = (seed = 5, me = 0) => { const g = newGame({ seed, playerState: me }); g.dip.inf = g.dip.inf.map(() => 100); return g; };

// ---- 1. отношения: разбор = итог ----
{
  const g = mk();
  for (let i = 0; i < 20; i++) tick(g);
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
    if (a === b) continue;
    const sum = D.relItems(g, a, b).reduce((s, x) => s + x.v, 0);
    ok(Math.abs(Math.max(-100, Math.min(100, sum)) - D.relOf(g, a, b)) < 0.6, `разбор отношения ${a}->${b} не сходится с итогом`);
  }
  // обида затухает со временем
  D.feel(g, 1, 2, -30, 0, 'png', 'тест');
  const val = () => (D.grudgeItems(g, 1, 2).find((x) => x.k === 'grv-png') || { v: 0 }).v;
  ok(val() < -25, 'обида записана');
  for (let i = 0; i < 140; i++) tick(g);
  ok(Math.abs(val()) < 9 && Math.abs(val()) > 3, 'обида затухает вдвое за каждые ' + DIP.halfLife + ' дней: ' + val());
}

// ---- 2. репутация ----
{
  const g = mk(6);
  g.dip.ties[0][1] = true; g.dip.ties[1][0] = true;
  D.signTreaty(g, 'nap', 0, 1, {}, true);
  const rep0 = g.dip.rep[0].reliab;
  D.breakTreaty(g, 0, 1, 'nap');
  ok(g.dip.rep[0].reliab <= rep0 - DIP.repViolation + 0.01, 'нарушение договора должно снижать надёжность на ' + DIP.repViolation);
  ok(D.relOf(g, 2, 0) < 40 && g.dip.trust[2][0] < g.dip.trust[2][1] + 30, 'третья сторона тоже должна пострадать в отношении');
  ok(D.cbFor(g, 1, 0).length > 0, 'пострадавший получает повод к войне');
  // выполнение договоров медленно повышает
  const g2 = mk(7);
  D.signTreaty(g2, 'friend', 0, 1, {}, true);
  g2.dip.rep[0].reliab = 50;
  for (let i = 0; i < 60; i++) tick(g2);
  ok(g2.dip.rep[0].reliab > 50, 'выполнение договоров повышает репутацию');
}

// ---- 3. мощь и угроза ----
{
  const g = mk(8);
  const t0 = D.threatTo(g, 0, 1);
  g.dip.power[1] *= 3;
  ok(D.threatTo(g, 0, 1) > t0, 'угроза растёт с мощью соседа');
  let called = 0;
  D.setMilitaryHook(() => { called++; return 50; });
  D.updatePower(g, true);
  ok(called > 0 && g.dip.power[0] > 49, 'заглушка military_power подключается');
  D.setMilitaryHook(() => 0);
}

// ---- 4. личность и разведка ----
{
  const g = mk(9);
  ok(!D.traitKnown(g, 0, 1, 'honor') || g.dip.know[0][1] >= 60, 'личность скрыта до разведки');
  g.dip.know[0][1] = 100;
  ok(D.traitKnown(g, 0, 1, 'honor') && D.traitKnown(g, 0, 1, 'ideo'), 'после разведки черты открыты');
  const lo = D.perceive(g, 0, 1), noisy = (() => { g.dip.know[0][1] = 0; let m = 0; for (let d = 0; d < 120; d += 12) { g.day = d + 1; m = Math.max(m, Math.abs(D.perceive(g, 0, 1).power / g.dip.power[1] - 1)); } return m; })();
  ok(noisy > 0.1, 'без разведки оценка силы шумит');
  g.dip.know[0][1] = 100; g.day = 3;
  ok(Math.abs(lo.power / g.dip.power[1] - 1) < 0.05, 'с разведкой оценка точна');
}

// ---- 5. лестница договоров и оценка ----
{
  const g = mk(10);
  const ev = D.evaluateOffer(g, 0, 1, 'ally', {});
  ok(ev.hard && /дружб/.test(ev.hard), 'союз без дружбы невозможен: ' + ev.hard);
  g.dip.trust[1][0] = 70; g.dip.trust[0][1] = 70;
  const f = D.evaluateOffer(g, 0, 1, 'friend', {});
  ok(f.factors.length >= 4 && typeof f.p === 'number' && f.p > 0 && f.p < 1, 'оценка даёт вероятность и факторы');
  ok(f.factors.reduce((s, x) => s + x.v, 0) === f.score || Math.abs(f.factors.reduce((s, x) => s + x.v, 0) - f.score) < 0.6, 'сумма факторов = баланс');
  // приплата повышает шанс
  const base = D.evaluateOffer(g, 0, 1, 'nap', {}), sweet = D.evaluateOffer(g, 0, 1, 'nap', { sweet: { money: 200 } });
  ok(sweet.score > base.score, 'приплата повышает шанс');
  // нехватка влияния
  g.dip.inf[0] = 0;
  ok(!D.propose(g, 0, 1, 'friend', {}).ok, 'без очков влияния предложение не отправить');
  g.dip.inf[0] = 100;
  // отказ объясним, встречное
  g.dip.trust[1][0] = -40; g.dip.trust[0][1] = -40;
  const bad = D.evaluateOffer(g, 0, 1, 'defense', {});
  ok(bad.hard || (!bad.accept && bad.reasons.length > 0), 'отказ без причины');
  // повтор после отказа запрещён (защита от спама)
  const r1 = D.propose(g, 0, 1, 'nap', {});
  if (!r1.ok) { const r2 = D.propose(g, 0, 1, 'nap', {}); ok(!r2.ok && /через/.test(r2.msg), 'повтор сразу после отказа должен быть закрыт: ' + r2.msg); }
  // оборонный пакт: оговорки
  const g2 = mk(11);
  g2.dip.trust[1][0] = 80; g2.dip.trust[0][1] = 80;
  D.signTreaty(g2, 'friend', 0, 1, {}, true);
  const t = D.signTreaty(g2, 'defense', 0, 1, { clauses: { binding: false, noChain: true } }, true);
  ok(t.clauses.noChain === true && !t.clauses.binding, 'оговорки оборонного пакта');
}

// ---- 6. посольство, послы, ПНГ ----
{
  const g = mk(12);
  D.establishTies(g, 0, 2);
  ok(g.dip.ties[0][2], 'дипотношения установлены');
  g.dip.amb[2][0] = true;
  const rel0 = D.relOf(g, 2, 0);
  ok(D.expelAmbassador(g, 0, 2).ok && D.relOf(g, 2, 0) < rel0 && !g.dip.amb[2][0], 'персона нон грата ухудшает отношения и отзывает посла');
  ok(D.breakTies(g, 0, 2).ok && !g.dip.ties[0][2], 'разрыв отношений');
  ok(D.infIncome(g, 0) > 0, 'доход влияния');
}

// ---- 7. кризис: лестница, уступка, отказ, потеря лица ----
{
  const g = mk(13);
  const A = 1, B = 2;
  const r = D.startCrisis(g, A, B, D.DEMANDS.tribute(g, A, B, 100));
  ok(r.ok, 'кризис начат: ' + r.msg);
  const c = r.crisis;
  g.states[B].money = 1000; const a0 = g.states[A].money;
  ok(D.escalate(g, c.id).ok && c.step === 1, 'ступень 2: демонстрация силы');
  ok(D.respond(g, c.id, 'bargain', B).ok, 'торг');
  ok(D.answerBargain(g, c.id, true).ok && g.states[A].money > a0 - 100, 'компромисс принят, получена половина дани');
  // ультиматум + отказ = повод к войне
  const r2 = D.startCrisis(g, B, 3, D.DEMANDS.tribute(g, B, 3, 100));
  const c2 = r2.crisis;
  g.dip.inf[B] = 100;
  D.escalate(g, c2.id); D.escalate(g, c2.id);
  ok(c2.step === 2 && c2.deadline - g.day === DIP.ultDays, 'ультиматум со сроком');
  D.respond(g, c2.id, 'refuse', 3);
  ok(D.hasCb(g, B, 3), 'отказ от ультиматума даёт повод');
  const face0 = g.dip.face[3];
  const c3 = D.startCrisis(g, 0, 3, D.DEMANDS.open_border()).crisis;
  D.escalate(g, c3.id); D.escalate(g, c3.id);
  D.respond(g, c3.id, 'yield', 3);
  ok(g.dip.face[3] < face0, 'уступка на ультиматуме стоит лица');
  // молчание цели = отказ по сроку
  const g2 = mk(14);
  const c4 = D.startCrisis(g2, 1, 0, D.DEMANDS.open_border()).crisis;
  for (let i = 0; i < DIP.crisisStepDays + 1; i++) tick(g2);
  ok(c4.refused || c4.step > 0 || c4.state !== 'open', 'без ответа кризис не зависает');
}

// ---- 8. война, повод, репутация, призыв союзников ----
{
  const g = mk(15);
  D.signTreaty(g, 'ally', 1, 2, {}, true);
  const repA = g.dip.rep[0].reliab, aggA = g.dip.rep[0].aggr;
  const w = D.declareWar(g, 0, 1);
  ok(w.ok && D.inWar(g, 0, 1), 'война объявлена');
  ok(g.dip.rep[0].reliab < repA - 5 && g.dip.rep[0].aggr > aggA + 15, 'война без повода бьёт по репутации у всех');
  ok(g.dip.rep[0].reliab < repA, 'репутация общая');
  const call = g.dip.calls.find((c) => c.ally === 2 && c.state === 'open');
  ok(call && call.deadline - g.day >= DIP.callDays[0] && call.deadline - g.day <= DIP.callDays[1], 'призыв союзника с таймером 3–7 дней');
  ok(g.dip.closed[0][1] && !D.setBorder(g, 0, 1, false).ok, 'граница заперта на войне');
  // война с поводом дешевле
  const g2 = mk(16);
  D.grantCb(g2, 0, 1, 'incident');
  const rep2 = g2.dip.rep[0].reliab, ag2 = g2.dip.rep[0].aggr;
  D.declareWar(g2, 0, 1);
  ok(g2.dip.rep[0].reliab === rep2 && g2.dip.rep[0].aggr - ag2 <= DIP.aggrWarWithCb + 0.01, 'повод снижает штраф');
  // оговорка «без цепной реакции»
  const g3 = mk(17);
  D.signTreaty(g3, 'defense', 1, 2, { clauses: { binding: true, noChain: true } }, true);
  D.signTreaty(g3, 'defense', 2, 3, { clauses: { binding: true, noChain: true } }, true);
  D.declareWar(g3, 0, 1);
  const w3 = g3.dip.wars.find((x) => x.state === 'active');
  D.answerCall(g3, g3.dip.calls.find((c) => c.ally === 2).id, true);
  ok(!g3.dip.calls.some((c) => c.ally === 3 && c.state === 'open'), 'без цепной реакции: третий пакт не срабатывает');
  void w3;
  // отказ по обязательному пакту = нарушение
  const g4 = mk(18);
  D.signTreaty(g4, 'ally', 1, 2, {}, true);
  D.declareWar(g4, 0, 1);
  const rr = g4.dip.rep[2].reliab;
  D.answerCall(g4, g4.dip.calls.find((c) => c.ally === 2).id, false);
  ok(g4.dip.rep[2].reliab < rr && !D.hasTreaty(g4, 1, 2, 'ally'), 'отказ помочь по союзу нарушает договор');
  // мир
  const g5 = mk(19);
  D.declareWar(g5, 0, 1);
  for (let i = 0; i < 25; i++) tick(g5);
  const war = D.warBetween(g5, 0, 1);
  ok(war && war.score !== 0, 'счёт войны меняется');
  D.applyPeace(g5, 'truce', 0, 1);
  ok(D.statusOf(g5, 0, 1) === 'ceasefire', 'перемирие');
  for (let i = 0; i < DIP.truceDays + 2; i++) tick(g5);
  ok(!D.warBetween(g5, 0, 1) && D.statusOf(g5, 0, 1) !== 'war', 'после перемирия война окончена');
  ok(!D.declareWar(g5, 0, 1).ok, 'сразу после войны новая запрещена (кулдаун)');
}

// ---- 9. экономика ----
{
  const g = mk(20);
  tick(g);
  const base = g.states[0].mods;
  ok(base && base.mcap === 1, 'без дипломатии множители нейтральны');
  D.signTreaty(g, 'trade', 0, 1, {}, true);
  tick(g);
  ok(g.states[0].mods.mcap > 1 && g.states[0].mods.sell > 1, 'торговое соглашение расширяет лимит и улучшает цену');
  D.setEmbargo(g, 1, 0, true);
  tick(g);
  ok(g.states[0].mods.mcap < 1 + DIP.tradeAgreeCap, 'эмбарго режет торговлю');
  const m0 = g.states[0].money, r0 = g.states[1].money;
  D.gift(g, 0, 1, 100);
  ok(g.states[0].money === m0 - 100 && g.states[1].money === r0 + 100, 'подарок переводит деньги');
  g.states[0].food = 500;
  D.sendAid(g, 0, 1, 'food', 100);
  ok(g.states[0].food === 400, 'помощь передаёт ресурс');
  const loan = D.grantLoan(g, 0, 1, 200, 60);
  ok(loan.ok && loan.loan.total > 200, 'заём с процентами');
  for (let i = 0; i < 70; i++) tick(g);
  ok(g.dip.loans.length === 0 || g.dip.loans[0].left < loan.loan.total, 'заём погашается');
  // блокада в кризисе
  const g2 = mk(21);
  const c = D.startCrisis(g2, 1, 0, D.DEMANDS.open_border()).crisis;
  g2.dip.inf[1] = 100; g2.states[1].money = 5000;
  for (let i = 0; i < 4; i++) { D.escalate(g2, c.id); if (c.step >= 2) D.respond(g2, c.id, 'refuse', 0); }
  D.computeMods(g2, g2.states[0]);
  ok(c.flags.blockade && g2.states[0].mods.mcap < 1, 'блокада бьёт по портам');
}

// ---- 10. мир ботов (короткий): баланс, блоки, нет вечной войны, нет победителя, нет циклов ----
{
  const SEEDS = +process.env.DIP_SEEDS || 6, DAYS = +process.env.DIP_DAYS || 1500;
  let blocs = 0, maxTop = 0, maxWar = 0, allWar = 0, maxRef = 0, wars = 0, ended = 0;
  const kinds = {};
  for (let s = 1; s <= SEEDS; s++) {
    const g = newGame({ seed: s * 97, playerState: -1, difficulty: 'normal' });
    let bloc = false;
    for (let i = 0; i < DAYS; i++) {
      tick(g);
      const d = g.dip;
      if (!bloc && d.treaties.some((t) => ['ally', 'defense', 'protect'].includes(t.kind))) bloc = true;
      for (const w of d.wars) if (w.state === 'active') maxWar = Math.max(maxWar, g.day - w.start);
      let all = true;
      for (let a = 0; a < 4; a++) { let n = 0; for (let b = 0; b < 4; b++) if (a !== b && d.status[a][b] === 'war') n++; if (n < 2) all = false; }
      if (all) allWar++;
    }
    for (const t of g.dip.treaties) kinds[t.kind] = (kinds[t.kind] || 0) + 1;
    for (const w of g.dip.wars) { wars++; if (w.state === 'ended') ended++; }
    if (bloc) blocs++;
    const pw = g.dip.power, tot = pw.reduce((a, b) => a + b, 0);
    maxTop = Math.max(maxTop, Math.max(...pw) / tot);
    // циклы «предложение — отказ»: сколько отказов одного и того же в 40-дневном окне
    const st = g.dip.stats;
    if (st) for (const arr of Object.values(st.byKey)) for (let i = 0; i + 3 < arr.length; i++) maxRef = Math.max(maxRef, arr.slice(i, i + 4).length && arr[i + 3] - arr[i] < 40 ? 4 : 0);
    // сохранение в конце
    const cp = deserialize(serialize(g));
    for (let i = 0; i < 30; i++) tick(cp);
    ok(cp.dip.v === 5 && Number.isFinite(cp.dip.rel[0][1]), 'сохранение/загрузка дипломатии');
  }
  ok(allWar === 0, `война всех со всеми не должна возникать (дней: ${allWar})`);
  ok(maxWar < 400, `вечная война: ${maxWar} дн.`);
  ok(blocs >= Math.ceil(SEEDS / 2), `блоки должны образовываться (в ${blocs} из ${SEEDS})`);
  ok(maxTop < 0.7, `нет автоматического победителя (макс. доля мощи ${maxTop.toFixed(2)})`);
  ok(maxRef < 4, 'бесконечный цикл предложение—отказ');
  console.log(`мир ботов: сидов ${SEEDS}, дней ${DAYS}; блоки в ${blocs}; макс. длительность войны ${maxWar}; макс. доля мощи ${(maxTop * 100).toFixed(0)}%; войн ${wars}/${ended} закончено`);
  console.log('договоров на конец (активных/завершённых):', Object.entries(kinds).map(([k, v]) => `${TREATIES[k].name} ${v}`).join(', '));
}

// ---- 11. сохранения посреди кризиса и войны ----
{
  const g = mk(30);
  D.declareWar(g, 0, 1);
  D.startCrisis(g, 2, 3, D.DEMANDS.open_border());
  for (let i = 0; i < 40; i++) tick(g);
  const cp = deserialize(serialize(g));
  ok(cp.dip.wars.length === g.dip.wars.length && cp.dip.crises.length === g.dip.crises.length, 'войны и кризисы сохраняются');
  for (let i = 0; i < 60; i++) tick(cp);
  ok(cp.states.every((s) => Number.isFinite(s.money)), 'после загрузки экономика цела');
}

console.log(fails ? `ПРОВАЛОВ: ${fails}` : 'ВСЕ ПРОВЕРКИ ДИПЛОМАТИИ ПРОШЛИ');
process.exit(fails ? 1 : 0);
