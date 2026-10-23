// Симуляция без DOM: её можно гонять в node и использовать ботам.
import {
  BUILDINGS, BUILD_ORDER, CITY_LEVELS, DEPOSITS, ECON, LEVEL_COST_MULT, MAX_LEVEL, RES, START, STATES_DEF,
} from './data.js';
import { botDiplomacy, initDiplomacy, stepDiplomacy } from './diplomacy.js';
import { generateWorld, gridSample, territoryAt } from './world.js';

export const SAVE_KEY = 'iron-meridian-save-v3';

const emptyFlow = () => Object.fromEntries(RES.map((k) => [k, { prod: 0, cons: 0 }]));
const zeroRes = () => Object.fromEntries(RES.map((k) => [k, 0]));

export function newGame({ seed = Date.now() % 1000000, playerState = 0, difficulty = 'normal' } = {}) {
  const world = generateWorld(seed);
  const g = {
    v: 3, seed, day: 1, difficulty, playerState,
    states: STATES_DEF.map((s, i) => ({
      id: i, name: s.name, color: s.color, isPlayer: i === playerState,
      capital: world.capitals[i],
      ...START,
      energy: { supply: 0, demand: 0, ratio: 1 },
      rate: zeroRes(),
      trade: zeroRes(),
      flow: emptyFlow(),
    })),
    provs: world.provs,
    events: [],
  };
  g.world = world; g.nbrs = world.nbrs;
  initDiplomacy(g);
  // стартовые здания в столицах
  for (const s of g.states) {
    const cap = g.provs[s.capital];
    addDone(cap, 'housing', 1);
    addDone(cap, 'power', 1);
    cap.cityLevel = levelOf(cap.pop);
    // рудник/НПЗ — в ближайшей своей провинции с месторождением
    for (const kind of ['steel', 'oil']) {
      const spot = g.provs.filter((p) => p.owner === s.id && p.deposits[kind] > 0 && p.buildings.length < slots(p))[0];
      if (spot) addDone(spot, DEPOSITS[kind].building, 1);
    }
  }
  assignSpots(g);
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
  if (b.needs && !p.deposits[b.needs]) return `Нужно месторождение: ${DEPOSITS[b.needs].name.toLowerCase()}`;
  if (!canAfford(s, costOf(type, 1))) return 'Не хватает ресурсов';
  return null;
}

// ---- размещение на карте ----
export const PLOT = { minFromCity: 3.1, spacing: 1.75, depositReach: 2.5, depositKeep: 1.1 };

export function plotError(g, p, type, x, z, ignore = null) {
  const w = g.world, def = BUILDINGS[type];
  const hv = gridSample(w.h, x, z);
  if (hv < 0.02) return 'Здесь вода или пляж';
  if (hv > 0.3) return 'Слишком крутой склон';
  if (gridSample(w.river, x, z) > 0.25) return 'Здесь река';
  if (territoryAt(w, x, z)[0] !== p.id) return 'Это территория другого города';
  if (Math.hypot(x - p.x, z - p.z) < PLOT.minFromCity) return 'Слишком близко к центру города';
  if (p.buildings.some((o) => o !== ignore && o.x !== undefined && Math.hypot(o.x - x, o.z - z) < PLOT.spacing)) return 'Место занято';
  const dep = p.depositPos || {};
  if (def.needs) {
    const d = dep[def.needs];
    if (!p.deposits[def.needs] || !d) return 'Нет месторождения';
    if (Math.hypot(d[0] - x, d[1] - z) > PLOT.depositReach) return `${def.name} — рядом с месторождением (${DEPOSITS[def.needs].name.toLowerCase()})`;
  } else {
    for (const d of Object.values(dep)) if (Math.hypot(d[0] - x, d[1] - z) < PLOT.depositKeep) return 'Оставьте месторождение для добычи';
  }
  return null;
}

export function findSpot(g, p, type, ignore = null) {
  const def = BUILDINGS[type];
  const ang0 = (p.id * 1.7 + p.buildings.length * 1.1) % (Math.PI * 2);
  const centers = def.needs ? [p.depositPos && p.depositPos[def.needs]].filter(Boolean).map((d) => [d[0], d[1], 1.5, 2.2]) : [[p.x, p.z, 3.3, 7.5]];
  for (const [cx, cz, r0, r1] of centers) {
    for (let r = r0; r <= r1; r += 0.6) {
      for (let k = 0; k < 14; k++) {
        const a = ang0 + (k * Math.PI * 2) / 14;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        if (!plotError(g, p, type, x, z, ignore)) return { x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 };
      }
    }
  }
  return null;
}

export function assignSpots(g) {
  for (const p of g.provs) {
    for (const b of p.buildings) {
      if (b.x !== undefined) continue;
      const s = findSpot(g, p, b.type, b) || { x: p.x + 3.4, z: p.z };
      b.x = s.x; b.z = s.z;
    }
  }
}

export function startBuild(g, p, type, pos = null) {
  const err = buildError(g, p, type);
  if (err) return err;
  const spot = pos || findSpot(g, p, type);
  if (!spot) return 'Нет подходящего места';
  const perr = pos ? plotError(g, p, type, pos.x, pos.z) : null;
  if (perr) return perr;
  pay(g.states[p.owner], costOf(type, 1));
  p.buildings.push({ type, level: 0, buildLeft: BUILDINGS[type].days, target: 1, x: spot.x, z: spot.z });
  return null;
}

// производство города за день (по загрузке зданий)
export function cityProduction(p) {
  const out = {};
  for (const k of RES) out[k] = { prod: 0, cons: 0 };
  for (const b of p.buildings) {
    if (b.level <= 0) continue;
    const def = BUILDINGS[b.type], e = b.eff ?? 0;
    let rich = 1;
    if (def.needs) rich = p.deposits[def.needs] || 0;
    if (def.produces) for (const [k, v] of Object.entries(def.produces)) out[k].prod += v * b.level * e * rich;
    if (def.consumes) for (const [k, v] of Object.entries(def.consumes)) out[k].cons += v * b.level * e;
  }
  return out;
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
  stepDiplomacy(g);
  for (const s of g.states) for (const k of RES) if (s.trade && s.trade[k]) s.rate[k] += s.trade[k];

  if (g.day % 4 === 0) {
    for (const s of g.states) if (!s.isPlayer) botStep(g, s);
  }
  if (g.day % 3 === 0) {
    for (const s of g.states) if (!s.isPlayer) botDiplomacy(g, s);
  }
}

function simulateState(g, s) {
  const provs = stateProvs(g, s.id);
  const before = Object.fromEntries(RES.map((k) => [k, s[k]]));
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

  // 3) сырьё для производств: хватает ли склада на всё, что хотят потребить
  const need = {};
  for (const p of provs) for (const b of p.buildings) {
    if (b.level <= 0 || b.type === 'power') continue;
    const cons = BUILDINGS[b.type].consumes;
    if (cons) for (const [k, v] of Object.entries(cons)) need[k] = (need[k] || 0) + v * b.level;
  }
  const ratioOf = (k) => (need[k] > 0 ? Math.min(1, s[k] / need[k]) : 1);

  // 4) производство
  for (const p of provs) for (const b of p.buildings) {
    if (b.level <= 0 || b.type === 'power' || b.type === 'housing') continue;
    const def = BUILDINGS[b.type];
    const grid = def.needs ? Math.max(eRatio, ECON.extractorFloor) : eRatio;
    let eff = staff.get(p.id) * grid;
    if (def.consumes) for (const k of Object.keys(def.consumes)) eff *= ratioOf(k);
    const rich = def.needs ? p.deposits[def.needs] || 0 : 1;
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
  if (s.energy.ratio < 0.8 && type !== 'power') return 0.03; // сначала энергия
  switch (type) {
    case 'power': return lowE && s.fuel > 60 ? 9 : lowE ? 0.5 : 0.2;
    case 'housing': return s.energy.ratio < 0.7 ? 0.1 : p.pop > housingCap(p) * 0.85 ? 4 : 0.5;
    case 'mine': return s.energy.ratio < 0.7 ? 0.3 : s.steel < 400 ? 4 : s.steel > 3000 ? 0 : 0.5;
    case 'steelworks': return s.fuel > 500 && s.steel < 1500 && s.energy.ratio > 0.8 ? 2 : 0.05;
    case 'refinery': return s.fuel < 300 ? (lowE ? 8 : 4) : s.fuel > 3000 ? 0 : 0.3;
    case 'goldmine': return s.energy.ratio < 0.7 ? 0.1 : s.gold > 1200 ? 0 : s.gold < 200 ? 2 : 0.4;
    case 'raremine': return s.energy.ratio < 0.7 ? 0.1 : s.rare > 900 ? 0 : s.rare < 150 ? 2.2 : 0.4;
    case 'electronics':
      if (s.electronics > 400) return 0;
      if (s.gold < 20 || s.rare < 20) return 0.08;
      return s.steel > 250 && s.energy.ratio > 0.9 ? 1.5 : 0.1;
    default: return 1;
  }
}

function botStep(g, s) {
  if (s.energy.ratio < 0.8 && !canAfford(s, costOf('power', 1))) return; // копим на электростанцию
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
    states: g.states, provs: g.provs, dip: g.dip,
  });
}
export function deserialize(text) {
  const d = JSON.parse(text);
  if (d.v !== 3) throw new Error('Неизвестная версия сохранения');
  const world = generateWorld(d.seed);
  const g = { ...d, world, nbrs: world.nbrs, events: [] };
  for (const st of g.states) { st.flow ||= emptyFlow(); st.trade ||= zeroRes(); }
  assignSpots(g);
  return g;
}
