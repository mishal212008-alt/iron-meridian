// Генерация мира: один цельный материк с рельефом, морем, реками, лесами, городами,
// территориями государств и дорогами. Без DOM, работает в node.
import { NAMES, STATES_DEF } from './data.js';

export const WORLD = { SZ: 80, HALF: 40, N: 256 };
const { SZ, HALF, N } = WORLD;
export const CELL = SZ / N;
export const HEIGHT_SCALE = 9; // высота рельефа в единицах сцены на 1.0 «высоты»

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sm01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
export const smoothstep = (a, b, x) => sm01((x - a) / (b - a));

function makeNoise(rng) {
  const S = 128;
  const g = new Float32Array(S * S);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  const at = (x, y) => g[((y & (S - 1)) * S) + (x & (S - 1))];
  const n = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = sm01(x - xi), yf = sm01(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return (a + (b - a) * xf) * (1 - yf) + (c + (d - c) * xf) * yf;
  };
  n.fbm = (x, y, oct = 4) => {
    let s = 0, a = 0.5, f = 1, tot = 0;
    for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f); tot += a; a *= 0.5; f *= 2.03; }
    return s / tot;
  };
  return n;
}

// ---- доступ к сетке ----
export const toGrid = (v) => (v + HALF) / CELL - 0.5;
export const fromGrid = (i) => -HALF + (i + 0.5) * CELL;

export function gridSample(arr, x, z) {
  let gx = toGrid(x), gz = toGrid(z);
  gx = gx < 0 ? 0 : gx > N - 1.001 ? N - 1.001 : gx;
  gz = gz < 0 ? 0 : gz > N - 1.001 ? N - 1.001 : gz;
  const ix = gx | 0, iz = gz | 0, fx = gx - ix, fz = gz - iz;
  const k = iz * N + ix;
  return (arr[k] * (1 - fx) + arr[k + 1] * fx) * (1 - fz) + (arr[k + N] * (1 - fx) + arr[k + N + 1] * fx) * fz;
}
export const heightAt = (w, x, z) => gridSample(w.h, x, z);

// высота поверхности в сцене (и для меша, и для расстановки объектов)
export function surfaceFromH(h) {
  if (h >= 0) return h * HEIGHT_SCALE;
  return -0.04 - Math.min(1, -h / 0.18) * 0.34;
}
export const surfaceY = (w, x, z) => surfaceFromH(gridSample(w.h, x, z));

export function provAt(w, x, z) {
  let ix = Math.round(toGrid(x)), iz = Math.round(toGrid(z));
  ix = Math.max(0, Math.min(N - 1, ix)); iz = Math.max(0, Math.min(N - 1, iz));
  return w.pid[iz * N + ix];
}
// точное положение относительно границ: [провинция, расстояние до границы провинции,
// расстояние до границы государства, государство] (в единицах сцены)
export function territoryAt(w, x, z) {
  const wx = x + (w.noise.fbm(x * 0.17 + 3, z * 0.17, 2) - 0.5) * 3.2;
  const wz = z + (w.noise.fbm(x * 0.17, z * 0.17 + 5, 2) - 0.5) * 3.2;
  let b1 = 1e9, b2 = 1e9, id = 0;
  const ps = w.provs;
  for (let c = 0; c < ps.length; c++) {
    const d = Math.hypot(ps[c].x - wx, ps[c].z - wz);
    if (d < b1) { b2 = b1; b1 = d; id = c; } else if (d < b2) b2 = d;
  }
  const own = w.owner[id];
  let d2 = 1e9;
  for (let c = 0; c < ps.length; c++) {
    if (w.owner[c] === own) continue;
    const d = Math.hypot(ps[c].x - wx, ps[c].z - wz);
    if (d < d2) d2 = d;
  }
  return [id, (b2 - b1) / 2, (d2 - b1) / 2, own];
}
export const isLand = (w, x, z) => gridSample(w.h, x, z) > 0.004;

// ---- вспомогательные структуры ----
class Heap {
  constructor() { this.a = []; }
  push(k, v) {
    const a = this.a; a.push([k, v]);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export function generateWorld(seed) {
  const rng = mulberry32(seed);
  const nz = makeNoise(rng);
  const nz2 = makeNoise(rng);
  const nz3 = makeNoise(rng);
  const ox = rng() * 50, oz = rng() * 50;

  // 1. высоты: шум + остров, уровень моря = квантиль
  const raw = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = fromGrid(i), z = fromGrid(j);
      const wx = x + (nz2.fbm(x * 0.05 + 7, z * 0.05, 3) - 0.5) * 16;
      const wz = z + (nz2.fbm(x * 0.05, z * 0.05 + 9, 3) - 0.5) * 16;
      const d = Math.hypot(wx, wz) / (HALF * 0.9);
      const mask = 1 - Math.pow(d, 1.7);
      const base = nz.fbm(x * 0.05 + ox, z * 0.05 + oz, 5);
      raw[j * N + i] = base * 0.62 + mask * 0.62;
    }
  }
  const sorted = Float32Array.from(raw).sort();
  const sea = sorted[Math.floor(N * N * 0.5)];
  const h = new Float32Array(N * N);
  let hmax = 0;
  for (let k = 0; k < h.length; k++) { h[k] = raw[k] - sea; if (h[k] > hmax) hmax = h[k]; }
  // сжимаем сушу: больше низин и холмов, редкие горы
  for (let k = 0; k < h.length; k++) if (h[k] > 0) h[k] = Math.pow(h[k] / hmax, 1.5) * 0.2;
  // горные хребты на суше
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (h[k] <= 0) continue;
      const x = fromGrid(i), z = fromGrid(j);
      const r = 1 - Math.abs(2 * nz3.fbm(x * 0.07 + 20, z * 0.07 + 5, 3) - 1);
      h[k] += Math.pow(r, 4) * 0.3 * smoothstep(0.06, 0.15, h[k]);
    }
  }

  // 2. оставляем самый большой материк, мелкие крошки убираем
  const label = new Int32Array(N * N).fill(-1);
  const comps = [];
  for (let s = 0; s < N * N; s++) {
    if (h[s] <= 0 || label[s] >= 0) continue;
    const id = comps.length, cells = [], st = [s];
    label[s] = id;
    while (st.length) {
      const c = st.pop(); cells.push(c);
      const cx = c % N, cy = (c / N) | 0;
      for (let q = 0; q < 4; q++) {
        const nx = cx + DIRS8[q][0], ny = cy + DIRS8[q][1];
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const nk = ny * N + nx;
        if (h[nk] > 0 && label[nk] < 0) { label[nk] = id; st.push(nk); }
      }
    }
    comps.push(cells);
  }
  let main = 0;
  comps.forEach((c, i) => { if (c.length > comps[main].length) main = i; });
  comps.forEach((c, i) => { if (c.length < 40) for (const k of c) { h[k] = -0.01; label[k] = -1; } });
  const onMain = (k) => label[k] === main;

  // 3. реки: от высоких мест строго вниз к морю
  const river = new Float32Array(N * N);
  const riverPaths = [];
  {
    const cand = [];
    for (let k = 0; k < N * N; k++) if (onMain(k) && h[k] > 0.13 && h[k] < 0.3) cand.push(k);
    for (let t = 0; t < 400 && riverPaths.length < 7 && cand.length; t++) {
      let cur = cand[Math.floor(rng() * cand.length)];
      const seen = new Set([cur]); const path = [cur];
      let reached = false;
      for (let step = 0; step < 600; step++) {
        const cx = cur % N, cy = (cur / N) | 0;
        let best = -1, bestH = 1e9;
        for (const [dx, dy] of DIRS8) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          const nk = ny * N + nx;
          if (seen.has(nk) || h[nk] > h[cur] + 0.0005) continue;
          const hv = h[nk] + rng() * 0.006;
          if (hv < bestH) { bestH = hv; best = nk; }
        }
        if (best < 0) break;
        cur = best; seen.add(cur); path.push(cur);
        if (h[cur] <= 0) { reached = true; break; }
      }
      const far = path.length > 1 && Math.hypot(path[0] % N - cur % N, ((path[0] / N) | 0) - ((cur / N) | 0)) > 35;
      if (reached && far && path.length < 420) riverPaths.push(path);
    }
    for (const path of riverPaths) {
      path.forEach((k, idx) => {
        if (h[k] <= 0) return;
        river[k] = 1;
        const cx = k % N, cy = (k / N) | 0;
        for (let q = 0; q < 4; q++) {
          const nx = cx + DIRS8[q][0], ny = cy + DIRS8[q][1];
          if (nx >= 0 && ny >= 0 && nx < N && ny < N && h[ny * N + nx] > 0) river[ny * N + nx] = Math.max(river[ny * N + nx], 0.5);
        }
        if (h[k] > 0.01 && idx > 3) h[k] -= 0.01;
      });
    }
  }

  const world = { seed, N, SZ, HALF, h, river, label, main };
  world.noise = nz2;

  // 4. города
  const cands = [];
  for (let k = 0; k < N * N; k++) {
    if (!onMain(k) || river[k] > 0 || h[k] < 0.03 || h[k] > 0.2) continue;
    cands.push(k);
  }
  const cities = [];
  const target = 36;
  for (let minD = 8.2; minD >= 5.4 && cities.length < target; minD -= 0.6) {
    for (let tries = 0; tries < 5000 && cities.length < target; tries++) {
      const k = cands[Math.floor(rng() * cands.length)];
      const x = fromGrid(k % N), z = fromGrid((k / N) | 0);
      if (Math.hypot(x, z) > HALF * 0.86) continue;
      if (cities.every((c) => Math.hypot(c.x - x, c.z - z) >= minD)) cities.push({ x, z });
    }
  }
  cities.sort((a, b) => a.z - b.z || a.x - b.x);

  // 5. территории (диаграмма Вороного с искажением границ)
  const pid = new Uint8Array(N * N);
  const pm = new Float32Array(N * N); // расстояние до границы провинции * 2
  const wxg = new Float32Array(N * N), wzg = new Float32Array(N * N);
  const d1g = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const x = fromGrid(i), z = fromGrid(j);
      const wx = x + (nz2.fbm(x * 0.17 + 3, z * 0.17, 2) - 0.5) * 3.2;
      const wz = z + (nz2.fbm(x * 0.17, z * 0.17 + 5, 2) - 0.5) * 3.2;
      wxg[k] = wx; wzg[k] = wz;
      let b1 = 1e9, b2 = 1e9, id = 0;
      for (let c = 0; c < cities.length; c++) {
        const d = Math.hypot(cities[c].x - wx, cities[c].z - wz);
        if (d < b1) { b2 = b1; b1 = d; id = c; } else if (d < b2) b2 = d;
      }
      pid[k] = id; pm[k] = b2 - b1; d1g[k] = b1;
    }
  }
  // соседи по контакту территорий на суше
  const adj = cities.map(() => new Set());
  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < N - 1; i++) {
      const k = j * N + i;
      if (h[k] <= 0) continue;
      for (const nk of [k + 1, k + N]) {
        if (h[nk] > 0 && pid[nk] !== pid[k]) { adj[pid[k]].add(pid[nk]); adj[pid[nk]].add(pid[k]); }
      }
    }
  }

  // 6. государства: столицы дальше друг от друга, города — по ближайшей цепочке связей
  const n = cities.length, S = STATES_DEF.length;
  const dist = (a, b) => Math.hypot(cities[a].x - cities[b].x, cities[a].z - cities[b].z);
  let bestAssign = null, bestScore = 1e9;
  for (let t = 0; t < 14; t++) {
    const caps = [Math.floor(rng() * n)];
    while (caps.length < S) {
      let bi = -1, bd = -1;
      for (let c = 0; c < n; c++) {
        if (caps.includes(c)) continue;
        const d = Math.min(...caps.map((q) => dist(c, q))) + rng() * 2;
        if (d > bd) { bd = d; bi = c; }
      }
      caps.push(bi);
    }
    const best = new Array(n).fill(1e9), owner = new Array(n).fill(-1);
    const done = new Array(n).fill(false);
    caps.forEach((c, s) => { best[c] = 0; owner[c] = s; });
    for (let it = 0; it < n; it++) {
      let u = -1;
      for (let c = 0; c < n; c++) if (!done[c] && best[c] < 1e9 && (u < 0 || best[c] < best[u])) u = c;
      if (u < 0) break;
      done[u] = true;
      for (const v of adj[u]) {
        const w = best[u] + dist(u, v) * (1 + rng() * 0.3);
        if (w < best[v]) { best[v] = w; owner[v] = owner[u]; }
      }
    }
    // города без связи с остальными (очень редко) отдаём ближайшей столице
    for (let c = 0; c < n; c++) if (owner[c] < 0) {
      let bs = 0, bd = 1e9;
      caps.forEach((q, s) => { const d = dist(c, q); if (d < bd) { bd = d; bs = s; } });
      owner[c] = bs;
    }
    const cnt = new Array(S).fill(0);
    owner.forEach((o) => cnt[o]++);
    const score = Math.max(...cnt) - Math.min(...cnt);
    if (score < bestScore) { bestScore = score; bestAssign = { caps, owner }; }
  }
  const { caps, owner } = bestAssign;

  // 7. граница государств (расстояние до чужой территории)
  const sm = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) {
    const own = owner[pid[k]];
    let d2 = 1e9;
    for (let c = 0; c < n; c++) {
      if (owner[c] === own) continue;
      const d = Math.hypot(cities[c].x - wxg[k], cities[c].z - wzg[k]);
      if (d < d2) d2 = d;
    }
    sm[k] = d2 - d1g[k];
  }

  // 8. города как провинции
  const names = [...NAMES];
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  const provs = cities.map((c, id) => ({
    id, x: c.x, z: c.z, name: names[id % names.length],
    terrain: 'plains', coastal: false,
    deposits: { steel: 0, oil: 0 }, depositPos: {},
    owner: owner[id], capital: caps.includes(id), pop: 0, cityLevel: 0, buildings: [],
  }));
  world.provs = provs; world.pid = pid; world.pm = pm; world.sm = sm;
  world.owner = owner;
  world.nbrs = provs.map((p) => [...adj[p.id]].sort((a, b) => a - b));
  world.capitals = STATES_DEF.map((_, s) => caps[s]);

  // 9. рельеф вокруг городов, месторождения
  const cellsOf = provs.map(() => []);
  for (let k = 0; k < N * N; k++) if (h[k] > 0.02 && river[k] === 0) cellsOf[pid[k]].push(k);
  for (const p of provs) {
    const hc = heightAt(world, p.x, p.z);
    for (let a = 0; a < 12 && !p.coastal; a++) {
      const ang = (a / 12) * Math.PI * 2;
      if (heightAt(world, p.x + Math.cos(ang) * 3.2, p.z + Math.sin(ang) * 3.2) <= 0) p.coastal = true;
    }
    p.terrain = p.coastal && hc < 0.09 ? 'coast' : hc > 0.125 ? 'hills' : 'plains';
    const cells = cellsOf[p.id];
    let hi = 0;
    for (const k of cells) if (h[k] > 0.22) hi++;
    const mountShare = cells.length ? hi / cells.length : 0;
    const far = cells.filter((k) => Math.hypot(fromGrid(k % N) - p.x, fromGrid((k / N) | 0) - p.z) > 3.4);
    p._far = far;
    const r1 = rng(), r2 = rng(), r3 = rng();
    if (r1 < 0.12 + mountShare * 1.6 + (p.terrain === 'hills' ? 0.2 : 0)) p.deposits.steel = r3 < 0.3 ? 2 : 1;
    if (r2 < (p.terrain === 'hills' ? 0.1 : 0.27)) p.deposits.oil = r3 > 0.7 ? 2 : 1;
  }
  // гарантия: у каждого государства есть сталь и нефть
  STATES_DEF.forEach((s, i) => {
    const mine = provs.filter((p) => p.owner === i).sort((a, b) =>
      Math.hypot(a.x - provs[caps[i]].x, a.z - provs[caps[i]].z) - Math.hypot(b.x - provs[caps[i]].x, b.z - provs[caps[i]].z));
    for (const kind of ['steel', 'oil']) {
      if (!mine.some((p) => p.deposits[kind] > 0)) mine[Math.min(1, mine.length - 1)].deposits[kind] = 1;
    }
  });
  // точки месторождений: руда — выше, нефть — на равнинах
  for (const p of provs) {
    const far = p._far.length ? p._far : cellsOf[p.id];
    delete p._far;
    if (!far.length) continue;
    const pick = (score) => {
      let bestK = far[0], bestS = -1e9;
      for (let t = 0; t < 40; t++) {
        const k = far[Math.floor(rng() * far.length)];
        const s = score(h[k]) + rng() * 0.05;
        if (s > bestS) { bestS = s; bestK = k; }
      }
      return [Math.round(fromGrid(bestK % N) * 100) / 100, Math.round(fromGrid((bestK / N) | 0) * 100) / 100];
    };
    if (p.deposits.steel) p.depositPos.steel = pick((v) => v);
    if (p.deposits.oil) p.depositPos.oil = pick((v) => -Math.abs(v - 0.07));
  }
  provs.forEach((p) => { p.pop = p.capital ? 3000 : 500 + Math.floor(rng() * 500); });

  // 10. леса: плотность 0..1, вырубка вокруг городов
  const forest = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (h[k] <= 0.012 || river[k] > 0) continue;
      const x = fromGrid(i), z = fromGrid(j);
      let f = smoothstep(0.46, 0.62, nz3.fbm(x * 0.09 + 40, z * 0.09 + 11, 3));
      f *= 1 - smoothstep(0.26, 0.4, h[k]);
      f *= smoothstep(0.012, 0.05, h[k]);
      const pr = provs[pid[k]];
      const dc = Math.hypot(pr.x - x, pr.z - z);
      f *= smoothstep(2.6, 5.2, dc);
      forest[k] = f;
    }
  }
  world.forest = forest;

  // 11. дороги: остов (чтобы всё было связано) + короткие связи, путь по рельефу (A*)
  world.roads = [];
  const edges = [];
  for (const p of provs) for (const q of world.nbrs[p.id]) if (q > p.id) edges.push([p.id, q, Math.hypot(provs[q].x - p.x, provs[q].z - p.z)]);
  edges.sort((a, b) => a[2] - b[2]);
  const uf = provs.map((_, i) => i);
  const find = (a) => (uf[a] === a ? a : (uf[a] = find(uf[a])));
  for (const [a, b, d] of edges) {
    const ra = find(a), rb = find(b);
    const inTree = ra !== rb;
    if (inTree) uf[ra] = rb;
    if (!inTree && d > 12.5) continue;
    if (d > 20) continue;
    const path = findRoad(world, provs[a], provs[b]);
    if (path) world.roads.push({ a, b, pts: path });
  }
  return world;
}

function findRoad(w, A, B) {
  const { h, river } = w;
  const sx = Math.round(toGrid(A.x)), sy = Math.round(toGrid(A.z));
  const ex = Math.round(toGrid(B.x)), ey = Math.round(toGrid(B.z));
  const start = sy * N + sx, goal = ey * N + ex;
  const g = new Map([[start, 0]]);
  const from = new Map();
  const heap = new Heap();
  const octile = (x, y) => { const dx = Math.abs(x - ex), dy = Math.abs(y - ey); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
  heap.push(octile(sx, sy), start);
  let found = false, iter = 0;
  while (heap.size && iter++ < 60000) {
    const [, cur] = heap.pop();
    if (cur === goal) { found = true; break; }
    const cx = cur % N, cy = (cur / N) | 0;
    const gc = g.get(cur);
    for (const [dx, dy] of DIRS8) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const nk = ny * N + nx;
      if (h[nk] <= 0.004) continue;
      const slope = Math.abs(h[nk] - h[cur]) / CELL;
      const step = (dx && dy ? 1.414 : 1) * (1 + slope * 22 + (river[nk] > 0.4 ? 7 : 0) + (h[nk] > 0.24 ? 3 : 0));
      const ng = gc + step;
      if (ng < (g.get(nk) ?? 1e9)) { g.set(nk, ng); from.set(nk, cur); heap.push(ng + octile(nx, ny), nk); }
    }
  }
  if (!found) return null;
  let pts = [];
  for (let c = goal; c !== undefined; c = from.get(c)) pts.push([fromGrid(c % N), fromGrid((c / N) | 0)]);
  pts.reverse();
  pts = pts.filter((_, i) => i % 3 === 0 || i === pts.length - 1);
  for (let it = 0; it < 2; it++) { // сглаживание Чайкина
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts.map(([x, z]) => [Math.round(x * 100) / 100, Math.round(z * 100) / 100]);
}
