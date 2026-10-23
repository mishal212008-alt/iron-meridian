// Симуляция без DOM: её можно гонять в node и использовать ботам.
import {
  BASE_PRICE, BUILDINGS, BUILD_ORDER, CITY_LEVELS, DEPOSITS, ECON, LEVEL_COST_MULT, MAX_LEVEL, RES, START, STATES_DEF, STOCK_TARGET, TRADE_RES,
} from './data.js';
import { botDiplomacy, initDiplomacy, stepDiplomacy } from './diplomacy.js';
import { generateWorld, gridSample, mulberry32, territoryAt } from './world.js';

export const SAVE_KEY = 'iron-meridian-save-v3';
export const SAVE_VERSION = 4;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const emptyFlow = () => Object.fromEntries(RES.map((k) => [k, { prod: 0, cons: 0 }]));
const zeroRes = () => Object.fromEntries(RES.map((k) => [k, 0]));
const emptyBudget = () => ({ tax: 0, sales: 0, deals: 0, upkeep: 0, buy: 0, build: 0 });
const bonusOf = (s, key) => (STATES_DEF[s.id].bonus && STATES_DEF[s.id].bonus[key]) || 1;

export function newGame({ seed = Date.now() % 1000000, playerState = 0, difficulty = 'normal' } = {}) {
  const world = generateWorld(seed);
  const g = {
    v: SAVE_VERSION, seed, day: 1, difficulty, playerState,
    states: STATES_DEF.map((s, i) => newState(s, i, i === playerState, world)),
    provs: world.provs,
    events: [], feed: [],
    quests: { done: [] },
  };
  g.world = world; g.nbrs = world.nbrs;
  g.rand = mulberry32(seed ^ 0xb07);
  initDiplomacy(g);
  // стартовые здания в столицах
  for (const s of g.states) {
    const cap = g.provs[s.capital];
    addDone(cap, 'housing', 1);
    addDone(cap, 'power', 1);
    addDone(cap, 'farm', 1);
    addDone(cap, 'farm', 1);
    cap.cityLevel = levelOf(cap.pop);
    for (const kind of ['steel', 'oil']) {
      const spot = g.provs.filter((p) => p.owner === s.id && p.deposits[kind] > 0 && p.buildings.length < slots(p))[0];
      if (spot) addDone(spot, DEPOSITS[kind].building, 1);
    }
  }
  assignSpots(g);
  for (const p of g.provs) p.cityLevel = levelOf(p.pop);
  for (const s of g.states) updateCaps(g, s);
  return g;
}

function newState(def, i, isPlayer, world) {
  return {
    id: i, name: def.name, color: def.color, isPlayer, capital: world.capitals[i],
    ...START,
    energy: { supply: 0, demand: 0, ratio: 1 },
    rate: zeroRes(), trade: zeroRes(), flow: emptyFlow(),
    budget: emptyBudget(), pend: emptyBudget(),
    auto: {}, marketLeft: ECON.marketBase, cap: ECON.storageBase, mcap: ECON.marketBase,
    foodRatio: 1, foodNeed: 0, famine: 0, overflow: {}, stats: { sold: 0, bought: 0, built: 0, deals: 0 },
  };
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
// доля занятых мест (с учётом нанятых из соседних городов)
export function staffing(p) {
  const jobs = jobsOf(p);
  return jobs > 0 ? Math.min(1, (p.pop * ECON.workerShare + (p.hired || 0)) / jobs) : 1;
}
export const stateProvs = (g, sid) => g.provs.filter((p) => p.owner === sid);
const isGen = (type) => BUILDINGS[type].energy < 0;

export function costOf(type, level) {
  const m = Math.pow(LEVEL_COST_MULT, level - 1);
  const out = {};
  for (const [k, v] of Object.entries(BUILDINGS[type].cost)) out[k] = Math.round(v * m);
  if (level >= 3) out.electronics = Math.ceil(out.money / ECON.upgElecDiv); // третий уровень требует электронику
  return out;
}
export function canAfford(s, cost) {
  return Object.entries(cost).every(([k, v]) => s[k] >= v);
}
function pay(s, cost) {
  for (const [k, v] of Object.entries(cost)) s[k] -= v;
  s.pend.build += cost.money || 0;
}

// ---- склады и рынок ----
const levelSum = (g, sid, key) => {
  let n = 0;
  for (const p of g.provs) if (p.owner === sid) for (const b of p.buildings) if (b.level > 0 && BUILDINGS[b.type][key]) n += BUILDINGS[b.type][key] * b.level;
  return n;
};
export function updateCaps(g, s) {
  s.cap = ECON.storageBase + levelSum(g, s.id, 'storage');
  s.mcap = ECON.marketBase + levelSum(g, s.id, 'market');
}
export const marketSellPrice = (res, stock) => BASE_PRICE[res] * clamp(STOCK_TARGET[res] / Math.max(stock, 1), ECON.sellFloor, 1);
export const marketBuyPrice = (res, stock) => ECON.buyMarkup * BASE_PRICE[res] * (1 + Math.max(0, 1 - stock / STOCK_TARGET[res]) * 0.8);

// Продажа/покупка на мировом рынке. mode: 'sell' | 'buy'
export function marketTrade(g, s, res, amt, mode) {
  if (!TRADE_RES.includes(res)) return { ok: false, msg: 'Этим ресурсом не торгуют' };
  amt = Math.floor(amt);
  if (amt <= 0) return { ok: false, msg: 'Нечего торговать' };
  if (s.marketLeft < 1) return { ok: false, msg: 'Дневной лимит торговли исчерпан (порт увеличит его)' };
  amt = Math.min(amt, Math.floor(s.marketLeft));
  if (mode === 'sell') {
    amt = Math.min(amt, Math.floor(s[res]));
    if (amt <= 0) return { ok: false, msg: 'Нет на складе' };
    const price = marketSellPrice(res, s[res]) * bonusOf(s, 'sell');
    const gain = amt * price;
    s[res] -= amt; s.money += gain; s.marketLeft -= amt; s.pend.sales += gain; s.stats.sold += amt;
    return { ok: true, msg: `Продано ${amt} по ${price.toFixed(2)}`, amt, money: gain };
  }
  const price = marketBuyPrice(res, s[res]);
  amt = Math.min(amt, Math.floor(s.money / price), Math.max(0, Math.floor(s.cap - s[res])));
  if (amt <= 0) return { ok: false, msg: s.money < price ? 'Не хватает денег' : 'Склад полон' };
  const cost = amt * price;
  s[res] += amt; s.money -= cost; s.marketLeft -= amt; s.pend.buy += cost; s.stats.bought += amt;
  return { ok: true, msg: `Куплено ${amt} по ${price.toFixed(2)}`, amt, money: -cost };
}
// «Продать излишки»: всё выше целевого запаса
export function sellSurplus(g, s, res) {
  return marketTrade(g, s, res, s[res] - STOCK_TARGET[res], 'sell');
}
// «Докупить»: до целевого запаса
export function buyShortage(g, s, res) {
  return marketTrade(g, s, res, STOCK_TARGET[res] - s[res], 'buy');
}

// ---- действия игрока и ботов ----

export function buildError(g, p, type) {
  const s = g.states[p.owner];
  const b = BUILDINGS[type];
  if (p.buildings.length >= slots(p)) return 'Нет свободных мест';
  if (b.needs && !p.deposits[b.needs]) return `Нужно месторождение: ${DEPOSITS[b.needs].name.toLowerCase()}`;
  if (b.needsRiver && !p.hasRiver) return 'Нужна река в этом городе';
  if (!canAfford(s, costOf(type, 1))) return 'Не хватает ресурсов';
  return null;
}

// ---- размещение на карте ----
export const PLOT = { minFromCity: 3.1, spacing: 1.75, depositReach: 2.5, depositKeep: 1.1 };

function riverNear(w, x, z, r = 1.3) {
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    if (gridSample(w.river, x + Math.cos(a) * r, z + Math.sin(a) * r) > 0.3) return true;
  }
  return false;
}

export function plotError(g, p, type, x, z, ignore = null) {
  const w = g.world, def = BUILDINGS[type];
  const hv = gridSample(w.h, x, z);
  if (hv < 0.02) return 'Здесь вода или пляж';
  if (hv > 0.3) return 'Слишком крутой склон';
  if (gridSample(w.river, x, z) > 0.25) return 'Здесь река';
  if (territoryAt(w, x, z)[0] !== p.id) return 'Это территория другого города';
  if (Math.hypot(x - p.x, z - p.z) < PLOT.minFromCity) return 'Слишком близко к центру города';
  if (p.buildings.some((o) => o !== ignore && o.x !== undefined && Math.hypot(o.x - x, o.z - z) < PLOT.spacing)) return 'Место занято';
  if (def.needsFlat && (hv > 0.14 || gridSample(w.forest, x, z) > 0.25)) return 'Ферме нужна ровная земля без леса';
  if (def.needsRiver && !riverNear(w, x, z)) return 'Гидростанция — рядом с рекой';
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
  const reach = def.needsRiver ? 11 : 7.5;
  const centers = def.needs ? [p.depositPos && p.depositPos[def.needs]].filter(Boolean).map((d) => [d[0], d[1], 1.5, 2.2]) : [[p.x, p.z, 3.3, reach]];
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
export function cityProduction(p, s = null) {
  const out = {};
  for (const k of RES) out[k] = { prod: 0, cons: 0 };
  for (const b of p.buildings) {
    if (b.level <= 0) continue;
    const def = BUILDINGS[b.type], e = b.eff ?? 0;
    const rich = def.needs ? p.deposits[def.needs] || 0 : 1;
    if (def.produces) for (const [k, v] of Object.entries(def.produces)) out[k].prod += v * b.level * e * rich * (s ? outputBonus(s, b.type) : 1);
    if (def.consumes) for (const [k, v] of Object.entries(def.consumes)) out[k].cons += v * b.level * e;
  }
  return out;
}

// бонусы государств к выпуску
function outputBonus(s, type) {
  if (type === 'mine') return bonusOf(s, 'ore');
  if (type === 'refinery') return bonusOf(s, 'fuel');
  return 1;
}

export function upgradeError(g, p, i) {
  const b = p.buildings[i];
  if (!b) return 'Нет здания';
  if (b.buildLeft > 0) return 'Идёт строительство';
  if (b.level >= MAX_LEVEL) return 'Максимальный уровень';
  const c = costOf(b.type, b.level + 1);
  const s = g.states[p.owner];
  if (c.electronics && s.electronics < c.electronics) return `Нужна электроника: ${c.electronics}`;
  if (!canAfford(s, c)) return 'Не хватает ресурсов';
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
// отмена стройки или улучшения с возвратом денег
export function cancelBuild(g, p, i) {
  const b = p.buildings[i];
  if (!b || b.buildLeft <= 0) return 'Нечего отменять';
  const s = g.states[p.owner];
  for (const [k, v] of Object.entries(costOf(b.type, b.target))) s[k] += Math.floor(v * ECON.cancelRefund);
  if (b.level === 0) p.buildings.splice(i, 1); else { b.buildLeft = 0; b.target = b.level; }
  return null;
}

// Прогноз: сколько здание даёт в день и за сколько окупится
export function forecast(type, level = 1, p = null) {
  const d = BUILDINGS[type];
  const parts = [];
  let income = 0;
  const rich = d.needs && p ? p.deposits[d.needs] || 1 : 1;
  if (d.produces) for (const [k, v] of Object.entries(d.produces)) income += v * level * rich * BASE_PRICE[k];
  if (d.consumes) for (const [k, v] of Object.entries(d.consumes)) income -= v * level * BASE_PRICE[k];
  const tax = d.jobs * level * ECON.taxPerJob;
  income += tax;
  if (d.energy < 0) income += -d.energy * level * ECON.energyValue;
  if (d.housing) income += d.housing * level * (ECON.taxPerPop + ECON.workerShare * ECON.taxPerJob * 0.5);
  if (d.storage || d.market) income += 0; // косвенная польза
  const upkeep = costOf(type, level).money * ECON.upkeepRate;
  const net = income - upkeep;
  const cost = costOf(type, level).money;
  parts.push(`налоги с работы ~${tax.toFixed(1)}`);
  return { income, upkeep, net, payback: net > 0.05 ? cost / net : Infinity, indirect: !!(d.storage || d.market), parts };
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
          g.states[p.owner].stats.built++;
          if (g.states[p.owner].isPlayer) {
            note(g, `${BUILDINGS[b.type].icon} ${BUILDINGS[b.type].name}: ${wasNew ? 'построено' : 'улучшено до ' + b.level + ' ур.'} (${p.name})`, p.id, 'good');
          }
        }
      }
    }
  }

  for (const s of g.states) { updateCaps(g, s); s.marketLeft = s.mcap; simulateState(g, s); }
  stepDiplomacy(g);
  for (const s of g.states) {
    for (const k of RES) if (s.trade && s.trade[k]) s.rate[k] += s.trade[k];
    s.budget.deals = s.trade ? s.trade.money : 0;
    if (s.trade) for (const k of TRADE_RES) if (s.trade[k] && s[k] > s.cap) s.overflow[k] = true;
    settleStorage(g, s);
    if (s.isPlayer) autoSell(g, s); else botMarket(g, s);
  }

  const every = ECON.botEvery[g.difficulty] || 4;
  if (g.day % every === 0) for (const s of g.states) if (!s.isPlayer) botStep(g, s);
  if (g.day % 3 === 0) for (const s of g.states) if (!s.isPlayer) botDiplomacy(g, s);
  checkQuests(g);
}

// событие для игрока: всплывающее сообщение + запись в ленту
export function note(g, text, pid = -1, kind = 'info') {
  g.events.push(text);
  g.feed.unshift({ day: g.day, text, pid, kind });
  if (g.feed.length > 40) g.feed.length = 40;
}

// излишек сверх склада продаётся по минимальной цене
function settleStorage(g, s) {
  for (const k of TRADE_RES) {
    if (s[k] > s.cap) {
      const over = s[k] - s.cap;
      const gain = over * BASE_PRICE[k] * ECON.overflowPrice;
      s[k] = s.cap; s.money += gain; s.budget.sales += gain; s.overflow[k] = true;
    } else if (s[k] < s.cap * 0.9) s.overflow[k] = false;
  }
}
function autoSell(g, s) {
  for (const [k, t] of Object.entries(s.auto)) {
    if (t == null || !(s[k] > t)) continue;
    if (s.marketLeft < 1) break;
    marketTrade(g, s, k, s[k] - t, 'sell');
  }
  flushPending(s);
}
function flushPending(s) {
  s.budget.sales += s.pend.sales; s.budget.buy += s.pend.buy; s.budget.build += s.pend.build;
  s.pend = emptyBudget();
}

function simulateState(g, s) {
  const provs = stateProvs(g, s.id);
  const before = Object.fromEntries(RES.map((k) => [k, s[k]]));
  const flow = emptyFlow();
  const botMult = s.isPlayer ? 1 : ECON.botIncome[g.difficulty] || 1;
  const budget = emptyBudget();

  // занятость: не хватает людей — нанимаем до 30% свободных из соседних городов
  const spare = new Map();
  for (const p of provs) spare.set(p.id, Math.max(0, p.pop * ECON.workerShare - jobsOf(p)));
  const staff = new Map();
  for (const p of provs) {
    const jobs = jobsOf(p), workers = p.pop * ECON.workerShare;
    let hired = 0;
    if (jobs > workers) {
      let gap = jobs - workers;
      for (const q of g.nbrs[p.id] || []) {
        if (g.provs[q].owner !== s.id || gap <= 0) continue;
        const take = Math.min(gap, spare.get(q) * ECON.hireShare);
        if (take > 0) { spare.set(q, spare.get(q) - take); hired += take; gap -= take; }
      }
    }
    p.hired = Math.round(hired);
    staff.set(p.id, jobs > 0 ? Math.min(1, (workers + hired) / jobs) : 1);
  }

  // 1) генераторы: ТЭС жжёт топливо, ГЭС — нет
  let fuelNeed = 0;
  for (const p of provs) for (const b of p.buildings) {
    if (b.level > 0 && isGen(b.type) && BUILDINGS[b.type].consumes) fuelNeed += BUILDINGS[b.type].consumes.fuel * b.level;
  }
  const fuelRatio = fuelNeed > 0 ? Math.min(1, s.fuel / fuelNeed) : 1;
  let supply = 0;
  for (const p of provs) for (const b of p.buildings) {
    if (b.level <= 0 || !isGen(b.type)) continue;
    const def = BUILDINGS[b.type];
    const fr = def.consumes ? fuelRatio : 1;
    const e = staff.get(p.id) * fr;
    b.eff = e;
    b.limit = e < 0.97 ? (staff.get(p.id) <= fr ? { k: 'staff', text: 'нет рабочих' } : { k: 'raw', text: 'нет топлива' }) : null;
    supply += -def.energy * b.level * e;
  }
  s.fuel = Math.max(0, s.fuel - fuelNeed * fuelRatio);
  flow.fuel.cons += fuelNeed * fuelRatio;

  // 2) спрос на энергию
  let demand = 0;
  for (const p of provs) for (const b of p.buildings) {
    if (b.level > 0 && !isGen(b.type)) demand += BUILDINGS[b.type].energy * b.level;
  }
  const eRatio = demand > 0 ? Math.min(1, supply / demand) : 1;
  s.energy = { supply, demand, ratio: eRatio };

  // 3) сырьё для производств: хватает ли склада на всё, что хотят потребить
  const need = {};
  for (const p of provs) for (const b of p.buildings) {
    if (b.level <= 0 || isGen(b.type)) continue;
    const cons = BUILDINGS[b.type].consumes;
    if (cons) for (const [k, v] of Object.entries(cons)) need[k] = (need[k] || 0) + v * b.level;
  }
  const ratioOf = (k) => (need[k] > 0 ? Math.min(1, s[k] / need[k]) : 1);

  // 4) производство
  for (const p of provs) for (const b of p.buildings) {
    if (b.level <= 0 || isGen(b.type)) continue;
    const def = BUILDINGS[b.type];
    const grid = def.needs ? Math.max(eRatio, ECON.extractorFloor) : eRatio;
    const st = staff.get(p.id);
    let raw = 1, rawName = '';
    if (def.consumes) for (const k of Object.keys(def.consumes)) { const r = ratioOf(k); if (r < raw) { raw = r; rawName = k; } }
    const eff = st * grid * raw;
    b.eff = eff;
    // причина простоя: самый слабый фактор
    const worst = Math.min(grid, st, raw);
    if (eff >= 0.97) b.limit = null;
    else if (worst === raw && raw < 1) b.limit = { k: 'raw', text: `нет сырья: ${rawName}` };
    else if (worst === grid) b.limit = { k: 'energy', text: 'нет энергии' };
    else b.limit = { k: 'staff', text: 'нет рабочих' };
    const rich = def.needs ? p.deposits[def.needs] || 0 : 1;
    const mult = outputBonus(s, b.type);
    if (def.consumes) for (const [k, v] of Object.entries(def.consumes)) { s[k] = Math.max(0, s[k] - v * b.level * eff); flow[k].cons += v * b.level * eff; }
    if (def.produces) for (const [k, v] of Object.entries(def.produces)) {
      const out = v * b.level * eff * rich * mult;
      s[k] += out; flow[k].prod += out;
      if (s.overflow[k] && !b.limit) b.limit = { k: 'full', text: 'склад полон: излишек продаётся дёшево' };
    }
  }

  // 5) еда: город ест 1 ед. в день на 100 жителей
  const totalPop = provs.reduce((a, p) => a + p.pop, 0);
  const foodNeed = (totalPop / 100) * ECON.foodPer100;
  const eaten = Math.min(s.food, foodNeed);
  s.food -= eaten; flow.food.cons += eaten;
  s.foodNeed = foodNeed;
  s.foodRatio = foodNeed > 0 ? eaten / foodNeed : 1;
  if (s.foodRatio < 0.9) s.famine++; else s.famine = Math.max(0, s.famine - 2);

  // 6) налоги, содержание, рост населения
  const taxMult = (s.foodRatio < 0.9 ? 0.7 : 1) * bonusOf(s, 'tax') * botMult;
  for (const p of provs) {
    let effJobs = 0;
    for (const b of p.buildings) if (b.level > 0) {
      if (b.eff === undefined) b.eff = 1;
      if (!BUILDINGS[b.type].produces && !isGen(b.type)) { b.eff = staff.get(p.id) * (BUILDINGS[b.type].energy > 0 ? eRatio : 1); b.limit = b.eff < 0.97 ? (staff.get(p.id) < eRatio ? { k: 'staff', text: 'нет рабочих' } : { k: 'energy', text: 'нет энергии' }) : null; }
      effJobs += BUILDINGS[b.type].jobs * b.level * clamp(b.eff, 0, 1);
    }
    const tax = (p.pop * ECON.taxPerPop * (0.5 + 0.5 * eRatio) + effJobs * ECON.taxPerJob) * taxMult;
    s.money += tax; budget.tax += tax;

    const cap = housingCap(p);
    if (p.pop < cap) {
      const gate = s.foodRatio >= 0.95 ? 1 : 0;
      p.pop += gate * Math.max(1, p.pop * ECON.growth * bonusOf(s, 'growth') * (0.5 + 0.5 * eRatio) * (1 - p.pop / cap));
    } else p.pop -= (p.pop - cap) * 0.03;
    if (s.famine > ECON.famineDays && p.pop > housingCap(p) * 0.35) p.pop *= 0.99;
    p.pop = Math.max(50, p.pop);
    p.cityLevel = levelOf(p.pop);
    for (const b of p.buildings) if (b.level > 0) { const up = costOf(b.type, 1).money * b.level * ECON.upkeepRate; s.money -= up; budget.upkeep += up; }
  }
  flow.money.prod += budget.tax; flow.money.cons += budget.upkeep;
  if (s.money < 0) { s.money = 0; s.debt = true; } else s.debt = false;

  s.budget = { ...budget, sales: 0, buy: 0, build: 0, deals: 0 };
  s.flow = flow;
  s.rate = {};
  for (const k of RES) s.rate[k] = s[k] - before[k];
}

// ---- рыночные действия ботов ----
function botMarket(g, s) {
  const buy = (k, upTo, keep = 250) => { if (s[k] < upTo * 0.5 && s.money > keep) marketTrade(g, s, k, upTo - s[k], 'buy'); };
  const hasSw = g.provs.some((p) => p.owner === s.id && p.buildings.some((b) => b.type === 'steelworks'));
  buy('fuel', 260); buy('steel', 160);
  if (s.food < s.foodNeed * 3 && s.money > 500) marketTrade(g, s, 'food', s.foodNeed * 5 - s.food, 'buy'); // на ферму деньги важнее
  if (hasSw) buy('ore', 120);
  for (const k of TRADE_RES) {
    const poor = s.money < 150;
    const t = STOCK_TARGET[k] * (poor ? 0.8 : 1.6);
    if (s[k] > t && s.marketLeft >= 1) marketTrade(g, s, k, s[k] - STOCK_TARGET[k] * (poor ? 0.6 : 1.2), 'sell');
  }
  flushPending(s);
}

// ---- обучение: короткие цели с наградой ----
export const QUESTS = [
  { id: 'power', text: 'Построй электростанцию (ТЭС или ГЭС)', reward: 150, done: (g, s) => hasBuilt(g, s, ['power', 'hydro']) },
  { id: 'mine', text: 'Построй рудник у месторождения руды', reward: 150, done: (g, s) => hasBuilt(g, s, ['mine']) },
  { id: 'steel', text: 'Построй сталелитейный завод: руда → сталь', reward: 200, done: (g, s) => hasBuilt(g, s, ['steelworks']) },
  { id: 'farm', text: 'Построй вторую ферму, чтобы город не голодал', reward: 150, done: (g, s) => provsOf(g, s).reduce((a, p) => a + p.buildings.filter((b) => b.type === 'farm' && b.level > 0).length, 0) >= 2 },
  { id: 'sell', text: 'Продай излишки на рынке (вкладка «Бюджет»)', reward: 100, done: (g, s) => s.stats.sold > 0 },
  { id: 'trade', text: 'Заключи торговую сделку или построй порт', reward: 250, done: (g, s) => hasBuilt(g, s, ['port']) || g.dip.deals.some((d) => d.seller === s.id || d.buyer === s.id) },
];
const provsOf = (g, s) => g.provs.filter((p) => p.owner === s.id);
const hasBuilt = (g, s, types) => provsOf(g, s).some((p) => p.buildings.some((b) => b.level > 0 && types.includes(b.type)));
export function currentQuest(g) {
  return QUESTS.find((q) => !g.quests.done.includes(q.id)) || null;
}
function checkQuests(g) {
  const s = g.states[g.playerState];
  if (!s) return;
  for (const q of QUESTS) {
    if (g.quests.done.includes(q.id)) continue;
    if (q.done(g, s)) {
      g.quests.done.push(q.id);
      s.money += q.reward;
      note(g, `🎯 Цель выполнена: ${q.text}. Награда ${q.reward}💰`, -1, 'good');
    }
    break; // по одной цели за раз, по порядку
  }
}

// ---- простой бот ----

function botWeight(g, s, p, type) {
  const lowE = s.energy.ratio < 0.95;
  const foodShort = s.foodRatio < 1 || s.food < s.foodNeed * 8;
  if (s.energy.ratio < 0.8 && !isGen(type) && type !== 'farm') return 0.03; // сначала энергия
  const fuelNeg = s.flow.fuel.cons > s.flow.fuel.prod * 1.05 && s.fuel < 350;
  const oreNeg = s.flow.ore.cons > s.flow.ore.prod * 1.05 && s.ore < 300;
  switch (type) {
    case 'power': return lowE && s.fuel > 60 ? (fuelNeg ? 1.5 : 9) : lowE ? 0.5 : 0.2;
    case 'hydro': return p.hasRiver ? (lowE ? 10 : fuelNeg ? 4 : 0.5) : 0;
    case 'farm': return foodShort ? 9 : s.food < s.foodNeed * 20 ? 1.2 : 0.2;
    case 'housing': return s.energy.ratio < 0.7 ? 0.1 : p.pop > housingCap(p) * 0.85 ? 4 : 0.5;
    case 'mine': return s.energy.ratio < 0.7 ? 0.3 : oreNeg ? 7 : s.ore < 400 ? 4 : s.ore > 3000 ? 0 : 0.5;
    case 'steelworks': return oreNeg || fuelNeg ? 0.02 : s.steel < 300 && (s.ore > 100 || s.ore > 30 && s.steel < 150) && s.fuel > 60 ? 4 : s.steel > 1500 ? 0 : 0.3;
    case 'refinery': return fuelNeg ? 9 : s.fuel < 300 ? (lowE ? 8 : 4) : s.fuel > 3000 ? 0 : 0.3;
    case 'goldmine': return s.energy.ratio < 0.7 ? 0.1 : s.gold > 1200 ? 0 : s.gold < 200 ? 1.6 : 0.4;
    case 'raremine': return s.energy.ratio < 0.7 ? 0.1 : s.rare > 900 ? 0 : s.rare < 150 ? 1.8 : 0.4;
    case 'warehouse': return TRADE_RES.some((k) => s[k] > s.cap * 0.8) ? 4 : 0;
    case 'port': return Object.values(s.overflow).some(Boolean) ? 1.2 : s.money > 3000 ? 0.4 : 0.05;
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
      let w = botWeight(g, s, p, type);
      // не строим второй однотипный завод в одной провинции без нужды
      if (p.buildings.some((b) => b.type === type) && type !== 'housing' && type !== 'farm') w *= 0.2;
      if (w > 0) cands.push({ kind: 'build', p, type, w });
    }
    p.buildings.forEach((b, i) => {
      if (upgradeError(g, p, i)) return;
      const w = botWeight(g, s, p, b.type) * 0.8;
      if (w > 0) cands.push({ kind: 'up', p, i, w });
    });
  }
  if (!cands.length) return;
  const total = cands.reduce((a, c) => a + c.w, 0);
  let r = g.rand() * total;
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
    v: SAVE_VERSION, seed: g.seed, day: g.day, difficulty: g.difficulty, playerState: g.playerState,
    states: g.states, provs: g.provs, dip: g.dip, quests: g.quests,
  });
}
export function deserialize(text) {
  const d = JSON.parse(text);
  if (d.v !== 3 && d.v !== 4) throw new Error('Неизвестная версия сохранения');
  const world = generateWorld(d.seed);
  const g = { ...d, v: SAVE_VERSION, world, nbrs: world.nbrs, events: [], feed: [] };
  g.rand = mulberry32((d.seed ^ 0xb07) + d.day * 7919);
  // миграция v3 → v4: новые поля, ресурсы и свойства городов
  g.quests ||= { done: [] };
  for (const st of g.states) {
    const fresh = newState(STATES_DEF[st.id], st.id, st.isPlayer, world);
    for (const k of Object.keys(fresh)) if (st[k] === undefined) st[k] = fresh[k];
    for (const k of RES) if (typeof st[k] !== 'number' || Number.isNaN(st[k])) st[k] = START[k] ?? 0;
    st.flow ||= emptyFlow(); st.trade ||= zeroRes();
    for (const k of RES) { st.flow[k] ||= { prod: 0, cons: 0 }; st.rate[k] ??= 0; st.trade[k] ??= 0; }
  }
  g.provs.forEach((p, i) => {
    p.hasRiver = world.provs[i].hasRiver;
    for (const k of Object.keys(world.provs[i].deposits)) if (p.deposits[k] === undefined) p.deposits[k] = 0;
  });
  assignSpots(g);
  for (const s of g.states) updateCaps(g, s);
  return g;
}
