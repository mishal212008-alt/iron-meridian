// Симуляция без DOM: её можно гонять в node и использовать ботам.
import {
  BUILDINGS, BUILD_ORDER, CITY_LEVELS, ECON, LEVEL_COST_MULT, MAX_LEVEL, RES, START, STATES_DEF,
} from './data.js';
import { generateWorld } from './world.js';

export const SAVE_KEY = 'iron-meridian-save-v2';

const emptyFlow = () => ({ money: { prod: 0, cons: 0 }, steel: { prod: 0, cons: 0 }, fuel: { prod: 0, cons: 0 }, electronics: { prod: 0, cons: 0 } });

export function newGame({ seed = Date.now() % 1000000, playerState = 0, difficulty = 'normal' } = {}) {
  const world = generateWorld(seed);
  const g = {
    v: 2, seed, day: 1, difficulty, playerState,
    states: STATES_DEF.map((s, i) => ({
      id: i, name: s.name, color: s.color, isPlayer: i === playerState,
      capital: world.capitals[i],
      ...START,
      energy: { supply: 0, demand: 0, ratio: 1 },
      rate: { money: 0, steel: 0, fuel: 0, electronics: 0 },
      flow: emptyFlow(),
    })),
    provs: world.provs,
    events: [],
  };
  g.world = world; g.nbrs = world.nbrs;
  // стартовые здания в столицах
  for (const s of g.states) {
    const cap = g.provs[s.capital];
    addDone(cap, 'housing', 1);
    addDone(cap, 'power', 1);
    cap.cityLevel = levelOf(cap.pop);
    // рудник/НПЗ — в ближайшей своей провинции с месторождением
    for (const kind of [['mine', 'steel'], ['refinery', 'oil']]) {
      const spot = g.provs.filter((p) => p.owner === s.id && p.deposits[kind[1]] > 0 && p.buildings.length < slots(p))[0];
      if (spot) addDone(spot, kind[0], 1);
    }
  }
  for (const p of g.provs) p.cityLevel = levelOf(p.pop);
  return g;
}

function addDone(p, type, level) {
  p.buildings.push({ type, level, buildLeft: 0, target: level });
}

export function levelOf(pop) {
  let lvl = 0;
  CITY_LEVELS.forEach((c, i) => { if (pop >= c.min) lvl = i; });
  return lvl;
}
export const slots = (p) => CITY_LEVELS[levelOf(p.pop)].slots;
export const cityName = (p) => CITY_LEVELS[levelOf(p.pop)].name;

export function housingCap(p) {
  let cap = p.capital ? ECON.baseCapCapital : ECON.baseCapOther;
  for (const b of p.buildings) if (b.level > 0 && BUILDINGS[b.type].housing) cap += BUILDINGS[b.type].housing * b.level;
  return cap;
}
export function jobsOf(p) {
  let j = 0;
  for (const b of p.buildings) if (b.level > 0) j += BUILDINGS[b.type].jobs * b.level;
  return j;
}
export function staffing(p) {
  const jobs = jobsOf(p);
  return jobs > 0 ? Math.min(1, (p.pop * ECON.workerShare) / jobs) : 1;
}
export const stateProvs = (g, sid) => g.provs.filter((p) => p.owner === sid);

export function costOf(type, level) {
  const m = Math.pow(LEVEL_COST_MULT, level - 1);
  const out = {};
  for (const [k, v] of Object.entries(BUILDINGS[type].cost)) out[k] = Math.round(v * m);
  return out;
}
export function canAfford(s, cost) {
  return Object.entries(cost).every(([k, v]) => s[k] >= v);
}
function pay(s, cost) { for (const [k, v] of Object.entries(cost)) s[k] -= v; }

// ---- действия игрока и ботов ----

export function buildError(g, p, type) {
  const s = g.states[p.owner];
  const b = BUILDINGS[type];
  if (p.buildings.length >= slots(p)) return 'Нет свободных мест';
  if (b.needs === 'steel' && !p.deposits.steel) return 'Нужно месторождение руды';
  if (b.needs === 'oil' && !p.deposits.oil) return 'Нужно месторождение нефти';
  if (!canAfford(s, costOf(type, 1))) return 'Не хватает ресурсов';
  return null;
}
export function startBuild(g, p, type) {
  const err = buildError(g, p, type);
  if (err) return err;
  pay(g.states[p.owner], costOf(type, 1));
  p.buildings.push({ type, level: 0, buildLeft: BUILDINGS[type].days, target: 1 });
  return null;
}
export function upgradeError(g, p, i) {
  const b = p.buildings[i];
  if (!b) return 'Нет здания';
  if (b.buildLeft > 0) return 'Идёт строительство';
  if (b.level >= MAX_LEVEL) return 'Максимальный уровень';
  if (!canAfford(g.states[p.owner], costOf(b.type, b.level + 1))) return 'Не хватает ресурсов';
  return null;
}
export function startUpgrade(g, p, i) {
  const err = upgradeError(g, p, i);
  if (err) return err;
  const b = p.buildings[i];
  pay(g.states[p.owner], costOf(b.type, b.level + 1));
  b.target = b.level + 1;
  b.buildLeft = Math.round(BUILDINGS[b.type].days * (1 + 0.5 * b.level));
  return null;
}
export function demolish(g, p, i) {
  const b = p.buildings[i];
  if (!b) return 'Нет здания';
  const s = g.states[p.owner];
  const lvl = Math.max(b.level, 1);
  for (const [k, v] of Object.entries(costOf(b.type, lvl))) s[k] += Math.floor(v * ECON.demolishRefund);
  p.buildings.splice(i, 1);
  return null;
}

// ---- один игровой день ----

export function tick(g) {
  g.day++;

  // строительство
  for (const p of g.provs) {
    for (const b of p.buildings) {
      if (b.buildLeft > 0) {
        b.buildLeft--;
        if (b.buildLeft === 0) {
          const wasNew = b.level === 0;
          b.level = b.target;
          if (g.states[p.owner].isPlayer) {
            g.events.push(`${BUILDINGS[b.type].icon} ${BUILDINGS[b.type].name}: ${wasNew ? 'построено' : 'улучшено до ' + b.level + ' ур.'} (${p.name})`);
          }
        }
      }
    }
  }

  for (const s of g.states) simulateState(g, s);

  if (g.day % 4 === 0) {
    for (const s of g.states) if (!s.isPlayer) botStep(g, s);
  }
}

function simulateState(g, s) {
  const provs = stateProvs(g, s.id);
  const before = { money: s.money, steel: s.steel, fuel: s.fuel, electronics: s.electronics };
  const flow = emptyFlow();

  // занятость
  const staff = new Map();
  for (const p of provs) {
    const jobs = jobsOf(p);
    const workers = p.pop * ECON.workerShare;
    staff.set(p.id, jobs > 0 ? Math.min(1, workers / jobs) : 1);
  }

  // 1) электростанции
  let fuelNeed = 0;
  for (const p of provs) for (const b of p.buildings) {
    if (b.level > 0 && b.type === 'power') fuelNeed += BUILDINGS.power.consumes.fuel * b.level;
  }
  const fuelRatio = fuelNeed > 0 ? Math.min(1, s.fuel / fuelNeed) : 1;
  let supply = 0;
  for (const p of provs) for (const b of p.buildings) {
    if (b.level > 0 && b.type === 'power') {
      supply += -BUILDINGS.power.energy * b.level * staff.get(p.id) * fuelRatio;
    }
  }
  s.fuel = Math.max(0, s.fuel - fuelNeed * fuelRatio);
  flow.fuel.cons += fuelNeed * fuelRatio;
  for (const p of provs) for (const b of p.buildings) if (b.type === 'power' && b.level > 0) b.eff = staff.get(p.id) * fuelRatio;

  // 2) спрос на энергию
  let demand = 0;
  for (const p of provs) for (const b of p.buildings) {
    if (b.level > 0 && b.type !== 'power') demand += BUILDINGS[b.type].energy * b.level;
  }
  const eRatio = demand > 0 ? Math.min(1, supply / demand) : 1;
  s.energy = { supply, demand, ratio: eRatio };

  // 3) сырьё для производств
  const need = { steel: 0 };
  for (const p of provs) for (const b of p.buildings) {
    if (b.level > 0 && b.type === 'electronics') need.steel += BUILDINGS.electronics.consumes.steel * b.level;
  }
  const steelRatio = need.steel > 0 ? Math.min(1, s.steel / need.steel) : 1;

  // 4) производство
  for (const p of provs) for (const b of p.buildings) {
    if (b.level <= 0 || b.type === 'power' || b.type === 'housing') continue;
    const def = BUILDINGS[b.type];
    const grid = def.needs ? Math.max(eRatio, ECON.extractorFloor) : eRatio;
    let eff = staff.get(p.id) * grid;
    if (def.consumes && def.consumes.steel) eff *= steelRatio;
    let rich = 1;
    if (def.needs === 'steel') rich = p.deposits.steel;
    if (def.needs === 'oil') rich = p.deposits.oil;
    b.eff = eff;
    if (def.consumes) for (const [k, v] of Object.entries(def.consumes)) { s[k] = Math.max(0, s[k] - v * b.level * eff); flow[k].cons += v * b.level * eff; }
    if (def.produces) for (const [k, v] of Object.entries(def.produces)) { s[k] += v * b.level * eff * rich; flow[k].prod += v * b.level * eff * rich; }
  }

  // 5) налоги и рост населения
  for (const p of provs) {
    const jobs = jobsOf(p);
    const employed = Math.min(p.pop * ECON.workerShare, jobs);
    const tax = p.pop * ECON.taxPerPop * (0.5 + 0.5 * eRatio) + employed * ECON.taxPerJob * eRatio;
    s.money += tax; flow.money.prod += tax;

    const cap = housingCap(p);
    if (p.pop < cap) p.pop += Math.max(1, p.pop * ECON.growth * (0.5 + 0.5 * eRatio) * (1 - p.pop / cap));
    else p.pop -= (p.pop - cap) * 0.03;
    p.pop = Math.max(50, p.pop);
    p.cityLevel = levelOf(p.pop);
  }

  s.flow = flow;
  s.rate = {};
  for (const k of RES) s.rate[k] = s[k] - before[k];
}

// ---- простой бот (на этапе 5 станет умным) ----

function botWeight(s, p, type) {
  const lowE = s.energy.ratio < 0.95;
  switch (type) {
    case 'power': return lowE && s.fuel > 60 ? 9 : lowE ? 0.5 : 0.2;
    case 'housing': return s.energy.ratio < 0.7 ? 0.1 : p.pop > housingCap(p) * 0.85 ? 4 : 0.5;
    case 'mine': return s.energy.ratio < 0.7 ? 0.3 : s.steel < 400 ? 4 : s.steel > 3000 ? 0 : 0.5;
    case 'refinery': return s.fuel < 300 ? (lowE ? 8 : 4) : s.fuel > 3000 ? 0 : 0.3;
    case 'electronics':
      if (s.electronics > 400) return 0;
      return s.steel > 250 && s.energy.ratio > 0.9 ? 1.5 : 0.1;
    default: return 1;
  }
}

function botStep(g, s) {
  const provs = stateProvs(g, s.id);
  const cands = [];
  for (const p of provs) {
    for (const type of BUILD_ORDER) {
      if (buildError(g, p, type)) continue;
      let w = botWeight(s, p, type);
      // не строим второй однотипный завод в одной провинции без нужды
      if (p.buildings.some((b) => b.type === type) && type !== 'housing') w *= 0.2;
      if (w > 0) cands.push({ kind: 'build', p, type, w });
    }
    p.buildings.forEach((b, i) => {
      if (upgradeError(g, p, i)) return;
      const w = botWeight(s, p, b.type) * 0.8;
      if (w > 0) cands.push({ kind: 'up', p, i, w });
    });
  }
  if (!cands.length) return;
  const total = cands.reduce((a, c) => a + c.w, 0);
  let r = Math.random() * total;
  for (const c of cands) {
    r -= c.w;
    if (r <= 0) {
      if (c.kind === 'build') startBuild(g, c.p, c.type); else startUpgrade(g, c.p, c.i);
      return;
    }
  }
}

// ---- сохранение ----

export function serialize(g) {
  return JSON.stringify({
    v: g.v, seed: g.seed, day: g.day, difficulty: g.difficulty, playerState: g.playerState,
    states: g.states, provs: g.provs,
  });
}
export function deserialize(text) {
  const d = JSON.parse(text);
  if (d.v !== 2) throw new Error('Неизвестная версия сохранения');
  const world = generateWorld(d.seed);
  const g = { ...d, world, nbrs: world.nbrs, events: [] };
  for (const st of g.states) st.flow ||= emptyFlow();
  return g;
}
