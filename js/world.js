// Генерация мира: гексагональная карта, суша, государства, месторождения.
import { MAP, NAMES, STATES_DEF } from './data.js';

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// «odd-r» смещённые координаты, остроконечные гексы
export function neighbors(col, row) {
  const odd = row & 1;
  const d = odd
    ? [[1, 0], [-1, 0], [1, -1], [0, -1], [1, 1], [0, 1]]
    : [[1, 0], [-1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1]];
  const out = [];
  for (const [dc, dr] of d) {
    const c = col + dc, r = row + dr;
    if (c >= 0 && c < MAP.cols && r >= 0 && r < MAP.rows) out.push([c, r]);
  }
  return out;
}

function toCube(col, row) {
  const x = col - (row - (row & 1)) / 2;
  const z = row;
  return [x, -x - z, z];
}

export function hexDist(a, b) {
  const [ax, ay, az] = toCube(a.col, a.row);
  const [bx, by, bz] = toCube(b.col, b.row);
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by), Math.abs(az - bz));
}

function makeNoise(rng) {
  const g = [];
  for (let i = 0; i < 64 * 64; i++) g.push(rng());
  const at = (x, y) => g[((y & 63) * 64) + (x & 63)];
  const sm = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = sm(x - xi), yf = sm(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return (a + (b - a) * xf) * (1 - yf) + (c + (d - c) * xf) * yf;
  };
}

export function generateWorld(seed) {
  const rng = mulberry32(seed);
  const n1 = makeNoise(rng);
  const n2 = makeNoise(rng);
  const { cols, rows } = MAP;

  // 1. суша: шум + спад к краям, берём верхние 68% клеток
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dx = (c - cols / 2) / (cols / 2);
      const dy = (r - rows / 2) / (rows / 2);
      const edge = Math.sqrt(dx * dx + dy * dy);
      const v = n1(c * 0.45, r * 0.45) * 0.7 + n1(c * 0.9, r * 0.9) * 0.3 - edge * 0.35;
      cells.push({ col: c, row: r, v });
    }
  }
  const sorted = [...cells].sort((a, b) => b.v - a.v);
  const landCount = Math.floor(cells.length * 0.68);
  const land = new Set(sorted.slice(0, landCount).map((c) => c.row * cols + c.col));

  // 2. оставляем самую большую связную сушу
  const seen = new Set();
  let best = [];
  for (const id of land) {
    if (seen.has(id)) continue;
    const comp = [];
    const stack = [id];
    seen.add(id);
    while (stack.length) {
      const cur = stack.pop();
      comp.push(cur);
      const cc = cur % cols, rr = Math.floor(cur / cols);
      for (const [nc, nr] of neighbors(cc, rr)) {
        const nid = nr * cols + nc;
        if (land.has(nid) && !seen.has(nid)) { seen.add(nid); stack.push(nid); }
      }
    }
    if (comp.length > best.length) best = comp;
  }
  const landSet = new Set(best);

  // 3. провинции
  const provs = [];
  const byCell = new Map();
  for (const id of best.sort((a, b) => a - b)) {
    const col = id % cols, row = Math.floor(id / cols);
    const elev = n2(col * 0.5 + 10, row * 0.5 + 10);
    let terrain = elev > 0.66 ? 'mountains' : elev > 0.5 ? 'hills' : 'plains';
    const coastal = neighbors(col, row).length < 6 ||
      neighbors(col, row).some(([nc, nr]) => !landSet.has(nr * cols + nc));
    if (coastal && terrain === 'plains') terrain = 'coast';
    const p = {
      id: provs.length, col, row, terrain, coastal,
      deposits: { steel: 0, oil: 0 },
      owner: -1, capital: false, pop: 0, cityLevel: 0, buildings: [],
    };
    provs.push(p);
    byCell.set(id, p);
  }
  const nbrs = (p) => neighbors(p.col, p.row)
    .map(([c, r]) => byCell.get(r * cols + c)).filter(Boolean);

  // 4. столицы: дальние друг от друга
  const capitals = [];
  capitals.push(provs[Math.floor(rng() * provs.length)]);
  while (capitals.length < STATES_DEF.length) {
    let bestP = null, bestD = -1;
    for (const p of provs) {
      if (capitals.includes(p)) continue;
      const d = Math.min(...capitals.map((cp) => hexDist(p, cp)));
      if (d > bestD || (d === bestD && rng() < 0.5)) { bestD = d; bestP = p; }
    }
    capitals.push(bestP);
  }

  // 5. раздаём провинции ближайшей столице
  for (const p of provs) {
    let bestS = 0, bestD = 1e9;
    capitals.forEach((cp, i) => {
      const d = hexDist(p, cp) + rng() * 0.6;
      if (d < bestD) { bestD = d; bestS = i; }
    });
    p.owner = bestS;
  }
  capitals.forEach((cp, i) => { cp.owner = i; cp.capital = true; cp.terrain = cp.terrain === 'mountains' ? 'hills' : cp.terrain; });

  // 6. месторождения
  for (const p of provs) {
    const r = rng();
    if (p.terrain === 'mountains') { p.deposits.steel = r < 0.7 ? 1 + (rng() < 0.4 ? 1 : 0) : 0; if (rng() < 0.12) p.deposits.oil = 1; }
    else if (p.terrain === 'hills') { p.deposits.steel = r < 0.45 ? 1 : 0; if (rng() < 0.15) p.deposits.oil = 1; }
    else { if (r < 0.28) p.deposits.oil = 1 + (rng() < 0.3 ? 1 : 0); if (rng() < 0.08) p.deposits.steel = 1; }
  }
  // гарантия: у каждого государства есть сталь и нефть, ближе к столице
  STATES_DEF.forEach((s, i) => {
    const mine = provs.filter((p) => p.owner === i).sort((a, b) => hexDist(a, capitals[i]) - hexDist(b, capitals[i]));
    for (const kind of ['steel', 'oil']) {
      if (!mine.some((p) => p.deposits[kind] > 0)) {
        const pick = mine[Math.min(1, mine.length - 1)];
        pick.deposits[kind] = 1;
      }
    }
  });

  // 7. население
  for (const p of provs) {
    p.pop = p.capital ? 3000 : 500 + Math.floor(rng() * 500);
  }

  // 8. названия (перемешанный список)
  const names = [...NAMES];
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  provs.forEach((p, i) => { p.name = names[i % names.length]; });

  return { seed, cols, rows, provs, capitals: capitals.map((c) => c.id), nbrs: provs.map((p) => nbrs(p).map((q) => q.id)) };
}
