// Ядро дипломатии: состояние, отношения из компонентов, репутация, мощь, личности,
// посольства, очки влияния. Без DOM. Состояние лежит в g.dip и сохраняется вместе с игрой.
import { BASE_PRICE, BUILDINGS, DIP, DIP_BASE, DIP_DIFF, STATES_DEF, STOCK_TARGET, TRADE_RES } from './data.js';
import { mulberry32 } from './world.js';

export const N = STATES_DEF.length;
export const DIP_VERSION = 5;
export const pairKey = (a, b) => `${Math.min(a, b)}-${Math.max(a, b)}`;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const mat = (v) => Array.from({ length: N }, () => Array(N).fill(v));
const matArr = () => Array.from({ length: N }, () => Array.from({ length: N }, () => []));
export const money = (v) => Math.round(v * 10) / 10;

export const STATUS_LABEL = { neutral: 'Нейтралитет', friend: 'Дружба', ally: 'Союз', war: 'Война', ceasefire: 'Перемирие' };
export const GRV_LABEL = {
  incident: 'пограничный инцидент', violation: 'нарушение договора', aggression: 'агрессия', war: 'война', gift: 'подарок', service: 'услуга',
  png: 'изгнание посла', embargo: 'эмбарго', help: 'помощь в беде', protest: 'протест', ultimatum: 'ультиматум', spy: 'шпионский скандал',
  trade: 'выполненные поставки', mediation: 'посредничество', betray: 'предательство', refuse: 'отказ в помощи', insult: 'оскорбление', loan: 'заём',
};

// Заглушка силы армии: после этапов 3–4 дорожной карты сюда подставляется реальная армия.
export const hooks = { military: (g, s) => 0 };
export const militaryPower = (g, s) => hooks.military(g, s);
export function setMilitaryHook(fn) { hooks.military = fn; }

// ---------- создание и миграция ----------
export function initDiplomacy(g) {
  const dip = {
    v: DIP_VERSION, rev: 1, nextId: 1,
    status: mat('neutral'), since: mat(0), closed: mat(false), ties: mat(false), amb: mat(false), embargo: mat(false),
    trust: mat(0), grv: matArr(), rel: mat(0), comp: Array.from({ length: N }, () => Array(N).fill(null)), know: mat(0),
    rep: [], pers: [], inf: [], face: [], power: [], adj: mat(0), pos: [],
    deals: [], offers: [], treaties: [], loans: [], crises: [], calls: [], wars: [], sanc: Array.from({ length: N }, () => []),
    log: [], cool: {}, cb: Array.from({ length: N }, () => Array.from({ length: N }, () => [])), lastWar: mat(-999),
  };
  g.dip = dip;
  const rnd = g.rand || (g.rand = mulberry32((g.seed || 1) ^ 0xb07));
  for (let i = 0; i < N; i++) {
    const def = STATES_DEF[i];
    const p = def.pers || { aggr: def.trait.hostile, honor: 0.6, greed: def.trait.greed / 2, caution: 0.5, ideo: 'order' };
    const jit = () => (rnd() - 0.5) * 0.3;
    dip.pers.push({ aggr: clamp(p.aggr + jit(), 0.05, 0.95), honor: clamp(p.honor + jit(), 0.05, 0.95), greed: clamp(p.greed + jit(), 0.05, 0.95), caution: clamp(p.caution + jit(), 0.05, 0.95), ideo: p.ideo });
    dip.rep.push({ reliab: DIP.repStart, aggr: Math.round(def.trait.hostile * 30) });
    dip.inf.push(DIP.infStart); dip.face.push(50); dip.power.push(0);
  }
  computeAdjacency(g);
  for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
    if (a === b) continue;
    const base = DIP_BASE[pairKey(a, b)] ?? 0;
    dip.trust[a][b] = base * 0.8;
    dip.ties[a][b] = base > -20;           // враждующие пары стартуют без дипотношений
    dip.amb[a][b] = dip.ties[a][b] && a !== g.playerState ? true : false;
  }
  // у игрока послы сразу в первых двух дружественных странах (остальных назначит сам)
  const me = g.playerState;
  if (me >= 0) {
    const order = [...Array(N).keys()].filter((b) => b !== me && dip.ties[me][b]).sort((x, y) => (DIP_BASE[pairKey(me, y)] ?? 0) - (DIP_BASE[pairKey(me, x)] ?? 0));
    order.slice(0, DIP.ambBase).forEach((b) => { dip.amb[me][b] = true; });
    dip.know[me] = Array(N).fill(0);
  }
  for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) if (a !== b) dip.know[a][b] = a === b ? 100 : dip.ties[a][b] ? 25 : 5;
  for (let a = 0; a < N; a++) dip.know[a][a] = 100;
  updatePower(g, true);
  for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) if (a !== b) refreshRel(g, a, b);
  return dip;
}

export function computeAdjacency(g) {
  const adj = mat(0);
  for (const p of g.provs) for (const q of g.nbrs[p.id] || []) {
    const o = g.provs[q].owner;
    if (o !== p.owner) adj[p.owner][o]++;
  }
  g.dip.adj = adj;
}

// Перенос старого формата (v3/v4) в новый: статусы превращаются в договоры
export function upgradeDiplomacy(g) {
  const old = g.dip;
  if (old && old.v === DIP_VERSION) return;
  const keep = old || {};
  initDiplomacy(g);
  const d = g.dip;
  if (keep.closed) d.closed = keep.closed;
  if (keep.deals) d.deals = keep.deals;
  if (keep.offers) d.offers = keep.offers.filter((o) => ['friend', 'ally', 'peace', 'deal'].includes(o.kind));
  if (keep.nextId) d.nextId = keep.nextId;
  if (keep.log) d.log = keep.log.map((e) => ({ kind: 'old', ...e }));
  if (keep.cool) d.cool = keep.cool;
  if (keep.rel) for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) if (a !== b) d.trust[a][b] = clamp((keep.rel[a][b] ?? 0) * 0.8, -100, 100);
  g.dip.migrated = keep.status || null;   // статусы применит diptreaty.finishMigration
}

// ---------- запросы ----------
export const relOf = (g, a, b) => g.dip.rel[a][b];
export const statusOf = (g, a, b) => g.dip.status[a][b];
export const hasTies = (g, a, b) => g.dip.ties[a][b];
export const isClosed = (g, a, b) => g.dip.closed[a][b] || g.dip.closed[b][a];
export const dealsBetween = (g, a, b) => g.dip.deals.filter((d) => (d.seller === a && d.buyer === b) || (d.seller === b && d.buyer === a));
export const treatiesBetween = (g, a, b) => g.dip.treaties.filter((t) => t.state === 'active' && ((t.a === a && t.b === b) || (t.a === b && t.b === a)));
export const treatyOf = (g, a, b, kind) => treatiesBetween(g, a, b).find((t) => t.kind === kind) || null;
export const hasTreaty = (g, a, b, kind) => !!treatyOf(g, a, b, kind);
export const wasWar = (g, a, b) => g.dip.wars.some((w) => w.state !== 'ended' && ((w.sideA.includes(a) && w.sideB.includes(b)) || (w.sideA.includes(b) && w.sideB.includes(a))));
export const inWar = (g, a, b) => g.dip.wars.some((w) => w.state === 'active' && ((w.sideA.includes(a) && w.sideB.includes(b)) || (w.sideA.includes(b) && w.sideB.includes(a))));
export const warsOf = (g, s) => g.dip.wars.filter((w) => w.state !== 'ended' && (w.sideA.includes(s) || w.sideB.includes(s)));
export const activeEnemies = (g, s) => [...new Set(g.dip.wars.filter((w) => w.state === 'active' && (w.sideA.includes(s) || w.sideB.includes(s))).flatMap((w) => (w.sideA.includes(s) ? w.sideB : w.sideA)))];
export const overlordOf = (g, s) => { const t = g.dip.treaties.find((x) => x.state === 'active' && x.kind === 'protect' && x.b === s); return t ? t.a : -1; };
export const vassalsOf = (g, s) => g.dip.treaties.filter((x) => x.state === 'active' && x.kind === 'protect' && x.a === s).map((x) => x.b);

export function relWord(r) {
  return r <= -60 ? 'Вражда' : r <= -25 ? 'Холодные' : r < 15 ? 'Нейтральные' : r < 45 ? 'Тёплые' : r < 75 ? 'Дружеские' : 'Братские';
}
export const repWord = (v) => (v >= 80 ? 'безупречная' : v >= 62 ? 'надёжная' : v >= 45 ? 'сомнительная' : v >= 28 ? 'плохая' : 'ненадёжный');
export const aggrWord = (v) => (v >= 70 ? 'агрессор' : v >= 45 ? 'воинственная' : v >= 22 ? 'сдержанная' : 'миролюбивая');

export function logDip(g, text, important = false, a = -1, b = -1, kind = 'rel') {
  g.dip.log.unshift({ day: g.day, text, a, b, kind });
  if (g.dip.log.length > 120) g.dip.log.length = 120;
  const me = g.playerState;
  if (important || a === me || b === me) {
    g.events.push(`🤝 ${text}`);
    if (g.feed) { g.feed.unshift({ day: g.day, text: `🤝 ${text}`, pid: -1, kind: 'dip' }); if (g.feed.length > 40) g.feed.length = 40; }
  }
}

// почему нельзя торговать (null — можно)
export function tradeBlock(g, a, b) {
  const d = g.dip;
  if (inWar(g, a, b)) return 'Идёт война';
  if (!d.ties[a][b]) return 'Нет дипломатических отношений';
  if (d.closed[a][b]) return `${g.states[a].name} закрыла границу`;
  if (d.closed[b][a]) return `${g.states[b].name} закрыла границу`;
  if (d.embargo[a][b]) return `${g.states[a].name} ввела эмбарго`;
  if (d.embargo[b][a]) return `${g.states[b].name} ввела эмбарго`;
  return null;
}

// ---------- мощь ----------
export const totalPopOf = (g, s) => g.provs.reduce((a, p) => a + (p.owner === s ? p.pop : 0), 0);
export function econPower(g, s) {
  const st = g.states[s];
  const f = st.flow || {};
  const pr = (k) => (f[k] ? f[k].prod : 0);
  return totalPopOf(g, s) / 1000 * 1.6 + pr('steel') * 2.2 + pr('electronics') * 14 + pr('fuel') * 1.2 + pr('gold') * 2 + pr('rare') * 3 + Math.min(40, st.steel * 0.004 + st.fuel * 0.003);
}
export const powerNow = (g, s) => econPower(g, s) + militaryPower(g, s);
export function updatePower(g, init = false) {
  const d = g.dip;
  for (let i = 0; i < N; i++) {
    const t = powerNow(g, i);
    d.power[i] = init ? t : d.power[i] + (t - d.power[i]) * DIP.powerSmooth;
  }
}
// эффективная мощь с учётом «лица» (престижа)
export const effPower = (g, s) => g.dip.power[s] * (0.85 + 0.3 * g.dip.face[s] / 100);

// Угроза для a со стороны b: растёт с мощью b и с близостью границ
export function threatTo(g, a, b) {
  const d = g.dip;
  const pa = effPower(g, a), pb = effPower(g, b);
  const share = pb / Math.max(0.01, pa + pb);
  const adj = d.adj[a][b];
  const near = adj > 0 ? Math.min(1, 0.35 + 0.1 * adj) : 0.12;
  return clamp(100 * share * near * (0.4 + d.rep[b].aggr / 100), 0, 100);
}
export function fearOf(g, a, b) {
  return clamp((effPower(g, b) / Math.max(0.01, effPower(g, a)) - 1) * 45, 0, 100);
}

// ---------- личность и разведка ----------
const TRAIT_KNOW = { aggr: 18, caution: 32, greed: 46, honor: 60, ideo: 74 };
export const traitKnown = (g, viewer, target, key) => viewer === target || g.dip.know[viewer][target] >= TRAIT_KNOW[key];
const hash01 = (a, b, c) => { const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return x - Math.floor(x); };
// Оценка наблюдателем: шум тем меньше, чем лучше разведка
export function perceive(g, viewer, target) {
  const d = g.dip;
  if (viewer === target) return { power: d.power[target], resolve: d.pers[target].aggr };
  const diff = DIP_DIFF[g.difficulty] || DIP_DIFF.normal;
  const bot = viewer !== g.playerState;
  const k = (1 - d.know[viewer][target] / 100) * 0.7 * (bot ? diff.noise : 1);
  const slot = Math.floor(g.day / 12);
  const n1 = hash01(viewer, target, slot) * 2 - 1, n2 = hash01(viewer + 7, target + 3, slot) * 2 - 1;
  return { power: d.power[target] * (1 + n1 * k), resolve: clamp(d.pers[target].aggr + n2 * k * 0.6, 0, 1), noise: k };
}

// ---------- обиды и услуги ----------
export function addGrudge(g, a, b, v, kind, text = '') {
  g.dip.grv[a][b].push({ day: g.day, v, kind, text });
  if (g.dip.grv[a][b].length > 40) g.dip.grv[a][b].shift();
}
const decay = (g, e) => Math.pow(0.5, (g.day - e.day) / DIP.halfLife);
export function grudgeItems(g, a, b) {
  const by = {};
  for (const e of g.dip.grv[a][b]) { const v = e.v * decay(g, e); by[e.kind] = (by[e.kind] || 0) + v; }
  return Object.entries(by).filter(([, v]) => Math.abs(v) >= 0.5).map(([k, v]) => ({ k: 'grv-' + k, label: (v < 0 ? 'Обида: ' : 'Услуга: ') + (GRV_LABEL[k] || k), v }));
}
export const addTrust = (g, a, b, v) => { g.dip.trust[a][b] = clamp(g.dip.trust[a][b] + v, -100, 100); };
// событие с двух сторон: ax — как это видит a про b, bx — наоборот
export function feel(g, a, b, va, vb, kind, text = '') {
  if (va) { addGrudge(g, a, b, va, kind, text); addTrust(g, a, b, va * 0.35); }
  if (vb) { addGrudge(g, b, a, vb, kind, text); addTrust(g, b, a, vb * 0.35); }
  refreshRel(g, a, b); refreshRel(g, b, a);
}

// ---------- отношение = взвешенная сумма (с разбором) ----------
const TREATY_REL = { trade: 3, friend: 8, nap: 2, defense: 5, offense: 4, ally: 15, protect: 6, truce: 0, peacetreaty: 3 };
export function interestOf(g, a, b) {
  const d = g.dip;
  let v = 0;
  v += dealsBetween(g, a, b).length * 5;
  if (hasTreaty(g, a, b, 'trade')) v += 8;
  const na = summarizeNeeds(g, g.states[a]), nb = summarizeNeeds(g, g.states[b]);
  for (const r of na.needs) if (nb.surplus.includes(r)) v += 3;
  for (const r of na.surplus) if (nb.needs.includes(r)) v += 2;
  if (d.closed[a][b] || d.closed[b][a] || d.embargo[a][b] || d.embargo[b][a]) v *= 0.3;
  return clamp(v, 0, 30);
}
export function commonEnemy(g, a, b) {
  let v = 0;
  for (let c = 0; c < N; c++) {
    if (c === a || c === b) continue;
    if (inWar(g, a, c) && inWar(g, b, c)) v += 10;
    else if (g.dip.rel[a][c] < -30 && g.dip.rel[b][c] < -30) v += 5;
  }
  return Math.min(16, v);
}
export function relItems(g, a, b) {
  const d = g.dip, P = d.pers[a];
  const items = [];
  const push = (k, label, v) => { if (Math.abs(v) >= 0.5) items.push({ k, label, v: Math.round(v * 10) / 10 }); };
  push('trust', 'Доверие', d.trust[a][b] * DIP.wTrust);
  push('base', 'Историческая симпатия', (DIP_BASE[pairKey(a, b)] ?? 0) * DIP.wBase);
  push('interest', 'Выгода от торговли', interestOf(g, a, b) * DIP.wInterest);
  for (const it of grudgeItems(g, a, b)) items.push({ ...it, v: Math.round(it.v * 10) / 10 });
  push('common', 'Общий враг', commonEnemy(g, a, b));
  let tr = 0;
  for (const t of treatiesBetween(g, a, b)) tr += TREATY_REL[t.kind] || 0;
  if (inWar(g, a, b)) tr -= 40;
  push('treaty', 'Договоры', tr);
  push('respect', 'Уважение к силе', fearOf(g, a, b) * DIP.wRespect * P.caution);
  push('threat', 'Угроза границе', -threatTo(g, a, b) * DIP.wThreat * (0.6 + 0.8 * P.caution));
  if (d.closed[b][a]) push('border', 'Граница закрыта для нас', -5);
  if (d.embargo[b][a]) push('embargo', 'Эмбарго против нас', -8);
  return items;
}
export function refreshRel(g, a, b) {
  if (a === b) return 0;
  const items = relItems(g, a, b);
  const r = clamp(items.reduce((s, x) => s + x.v, 0), -100, 100);
  g.dip.rel[a][b] = r;
  g.dip.comp[a][b] = { items, day: g.day };
  return r;
}
export const relBreakdown = (g, a, b) => relItems(g, a, b);

// ---------- репутация ----------
// Нарушение договора и внезапная война бьют по репутации в глазах ВСЕХ
export function repHit(g, culprit, kind, victim = -1, text = '') {
  const d = g.dip, R = d.rep[culprit];
  const bigV = kind === 'sudden_war' ? 35 : 25;
  (g.dip.repLog ||= []).push({ day: g.day, who: culprit, kind, victim, text });
  if (g.dip.repLog.length > 80) g.dip.repLog.shift();
  if (kind === 'violation') R.reliab = Math.max(0, R.reliab - DIP.repViolation);
  else if (kind === 'sudden_war') { R.reliab = Math.max(0, R.reliab - DIP.repSuddenWar); R.aggr = Math.min(100, R.aggr + DIP.aggrSuddenWar); }
  else if (kind === 'war_cb') R.aggr = Math.min(100, R.aggr + DIP.aggrWarWithCb);
  else if (kind === 'default') { R.reliab = Math.max(0, R.reliab - 3); if (victim >= 0) feel(g, victim, culprit, -8, 0, 'violation', text); return; }
  else if (kind === 'betray') { R.reliab = Math.max(0, R.reliab - 20); R.aggr = Math.min(100, R.aggr + 8); }
  for (let o = 0; o < N; o++) {
    if (o === culprit) continue;
    const isVictim = o === victim;
    const gk = kind === 'violation' ? 'violation' : kind === 'betray' ? 'betray' : 'aggression';
    if (kind === 'war_cb') { if (isVictim) feel(g, o, culprit, -12, 0, 'war'); continue; }
    feel(g, o, culprit, isVictim ? -(bigV - 7) : -6, 0, gk, text);
    addTrust(g, o, culprit, isVictim ? -bigV * 0.5 : -7);
  }
}
export function repGood(g, s, v = DIP.repGain) { g.dip.rep[s].reliab = Math.min(100, g.dip.rep[s].reliab + v); }

// ---------- влияние и послы ----------
const levelSum = (g, sid, key) => {
  let n = 0;
  for (const p of g.provs) if (p.owner === sid) for (const b of p.buildings) if (b.level > 0 && BUILDINGS[b.type][key]) n += BUILDINGS[b.type][key] * b.level;
  return n;
};
export const embassyLevels = (g, s) => g.provs.reduce((a, p) => a + (p.owner === s ? p.buildings.reduce((x, b) => x + (b.type === 'embassy' && b.level > 0 ? b.level : 0), 0) : 0), 0);
export const mfaLevels = (g, s) => g.provs.reduce((a, p) => a + (p.owner === s ? p.buildings.reduce((x, b) => x + (b.type === 'mfa' && b.level > 0 ? b.level : 0), 0) : 0), 0);
export const ambSlots = (g, s) => DIP.ambBase + embassyLevels(g, s) * DIP.ambPerEmbassy;
export const ambUsed = (g, s) => g.dip.amb[s].filter(Boolean).length;
export function infIncome(g, s) {
  return DIP.infBase + embassyLevels(g, s) * DIP.infPerEmbassy + mfaLevels(g, s) * DIP.infPerMfa + ambUsed(g, s) * DIP.infPerAmb;
}
export const infOf = (g, s) => g.dip.inf[s];
export function spend(g, s, n) {
  if (g.dip.inf[s] < n) return false;
  g.dip.inf[s] -= n;
  return true;
}

// ---------- потребности и цены (для сделок) ----------
const RES_DEPOSIT = { ore: 'steel', steel: 'steel', fuel: 'oil', gold: 'gold', rare: 'rare' };
export function valueFor(g, s, res) {
  let v = BASE_PRICE[res];
  const stock = s[res];
  const rate = s.rate ? s.rate[res] : 0;
  const t = STOCK_TARGET[res];
  if (stock < t * 0.1) v *= 1.45; else if (stock < t * 0.3) v *= 1.25; else if (stock > t * 3.3) v *= 0.65; else if (stock > t * 1.5) v *= 0.82;
  if (rate < -0.5 && stock < t * 0.7) v *= 1.15;
  const dk = RES_DEPOSIT[res];
  if (dk && !g.provs.some((p) => p.owner === s.id && p.deposits[dk] > 0)) v *= 1.15;
  return v;
}
export const fairPrice = (res) => BASE_PRICE[res];
export function summarizeNeeds(g, s) {
  const needs = [], surplus = [];
  const hasSw = g.provs.some((p) => p.owner === s.id && p.buildings.some((b) => b.type === 'steelworks' && b.level > 0));
  const hasFactory = g.provs.some((p) => p.owner === s.id && p.buildings.some((b) => b.type === 'electronics' && b.level > 0));
  for (const res of TRADE_RES) {
    const stock = s[res], t = STOCK_TARGET[res];
    const lowAt = res === 'fuel' || res === 'steel' ? t * 0.3 : res === 'food' ? s.foodNeed * 10 + 20 : res === 'ore' ? (hasSw ? t * 0.15 : 0) : res === 'electronics' ? 0 : hasFactory ? t * 0.4 : 0;
    if (lowAt && stock < lowAt) needs.push(res);
    if (stock > t * 0.9) surplus.push(res);
  }
  return { needs, surplus };
}
// взаимозависимость: доля торговли с b в обороте a (0..1)
export function interdependence(g, a, b) {
  let v = 0;
  for (const dl of dealsBetween(g, a, b)) v += dl.amt * dl.price;
  if (hasTreaty(g, a, b, 'trade')) v += 20;
  const income = Math.max(50, (g.states[a].budget ? g.states[a].budget.tax : 0) + 80);
  return clamp(v / income, 0, 1);
}

// ---------- ежедневное обновление ядра ----------
export function stepCore(g) {
  const d = g.dip;
  if (g.day % 6 === 0 || !d.rel1) { d.rel1 = d.rel0 || d.rel.map((r) => r.slice()); d.rel0 = d.rel.map((r) => r.slice()); }
  updatePower(g);
  for (let a = 0; a < N; a++) {
    d.inf[a] = Math.min(DIP.infCap, d.inf[a] + infIncome(g, a));
    d.rep[a].aggr = Math.max(0, d.rep[a].aggr - 0.04);
    d.face[a] += (50 - d.face[a]) * 0.01;
    d.grv[a].forEach((arr, b) => { d.grv[a][b] = arr.filter((e) => Math.abs(e.v * decay(g, e)) >= 0.3); });
    for (let b = 0; b < N; b++) {
      if (a === b) continue;
      // доверие тянется к ожидаемому уровню
      let target = (DIP_BASE[pairKey(a, b)] ?? 0) * 0.8 + (d.rep[b].reliab - 60) * 0.5 - (d.rep[b].aggr - 35) * 0.1;
      for (const t of treatiesBetween(g, a, b)) target += { ally: 25, friend: 15, trade: 8, nap: 6, defense: 10, protect: 8, offense: 8 }[t.kind] || 0;
      target += dealsBetween(g, a, b).length * 3;
      if (inWar(g, a, b)) target = -70;
      if (!d.ties[a][b]) target -= 10;
      if (!d.amb[a][b] && d.ties[a][b]) target -= 4;      // без посла отношения остывают
      d.trust[a][b] = clamp(d.trust[a][b] + clamp((target - d.trust[a][b]) * 0.03, -0.6, 0.6), -100, 100);
      // разведка
      if (d.ties[a][b]) d.know[a][b] = Math.min(100, d.know[a][b] + DIP.knowGain * 0.3 + (d.amb[a][b] ? DIP.knowEmbassy : 0) * 0.5);
      refreshRel(g, a, b);
    }
  }
}

export const relTrend = (g, a, b) => (g.dip.rel1 ? g.dip.rel[a][b] - g.dip.rel1[a][b] : 0);
