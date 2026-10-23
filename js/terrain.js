// Рисование земли в текстуру: вода, берег, трава, леса, горы, снег, поля, реки, дороги,
// границы государств. Работает без DOM: результат — массив RGBA, из него делается текстура.
import { CELL, WORLD, gridSample, mulberry32, smoothstep, territoryAt } from './world.js';

const { N, HALF, SZ } = WORLD;
export const TEX = 1024;

const hexRgb = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const C = {
  deep: [14, 52, 92], mid: [24, 94, 138], shallow: [64, 156, 170], foam: [226, 240, 236],
  sand: [217, 201, 153],
  low: [118, 163, 86], mid2: [94, 144, 72], hill: [128, 140, 84], rock: [138, 130, 118], snow: [238, 241, 245],
  forest: [56, 100, 58], river: [66, 140, 190], urban: [156, 146, 128],
  road: [182, 150, 100], roadEdge: [120, 96, 64],
};
const FIELDS = [[205, 190, 98], [160, 178, 84], [128, 156, 74], [184, 146, 92], [212, 200, 120]];

function hash2(a, b, s) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(s | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// освещение рельефа заранее (свет с северо-запада)
function hillshade(h) {
  const out = new Float32Array(N * N);
  const get = (i, j) => h[Math.max(0, Math.min(N - 1, j)) * N + Math.max(0, Math.min(N - 1, i))];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const dx = (get(i + 1, j) - get(i - 1, j)) / (2 * CELL);
      const dz = (get(i, j + 1) - get(i, j - 1)) / (2 * CELL);
      // нормаль (-dx*S, 1, -dz*S); свет из (-1, 1.3, -1)
      const S = 9;
      const nx = -dx * S, nz = -dz * S;
      const len = Math.hypot(nx, 1, nz);
      const l = (-nx * 0.5 + 0.72 - nz * 0.5) / len / Math.hypot(0.5, 0.72, 0.5);
      out[j * N + i] = h[j * N + i] > 0 ? 0.62 + 0.55 * Math.max(0, l) : 1;
    }
  }
  return out;
}

export function paintTerrain(world, stateColors, tex = TEX) {
  const { h, river, forest, pid, pm, sm, provs, roads, owner } = world;
  const shade = hillshade(h);
  const px = new Uint8ClampedArray(tex * tex * 4);
  const col = stateColors.map(hexRgb);
  const nz = world.noise;
  const fieldAngle = provs.map((p) => hash2(p.id, 7, 3) * Math.PI);
  const fieldReach = provs.map((p) => 5.5 + hash2(p.id, 11, 5) * 2.5);

  for (let r = 0; r < tex; r++) {
    const z = -HALF + ((r + 0.5) * SZ) / tex;
    for (let c = 0; c < tex; c++) {
      const x = -HALF + ((c + 0.5) * SZ) / tex;
      const hv = gridSample(h, x, z);
      const o = (r * tex + c) * 4;
      let rgb;
      const n1 = nz(x * 1.1, z * 1.1), n2 = nz(x * 0.23 + 9, z * 0.23);
      const vari = 0.93 + 0.1 * n1 + 0.08 * n2;

      if (hv <= 0) {
        const d = -hv;
        rgb = d < 0.05 ? mix(C.shallow, C.mid, d / 0.05) : mix(C.mid, C.deep, Math.min(1, (d - 0.05) / 0.25));
        const sparkle = 0.97 + 0.06 * n1;
        rgb = [rgb[0] * sparkle, rgb[1] * sparkle, rgb[2] * sparkle];
        if (d < 0.012) rgb = mix(rgb, C.foam, 0.55 * (1 - d / 0.012));
      } else {
        const k = Math.round((z + HALF) / CELL - 0.5) * N + Math.round((x + HALF) / CELL - 0.5);
        const kk = Math.max(0, Math.min(N * N - 1, k));
        const pi = pid[kk];
        const p = provs[pi];
        const rv = gridSample(river, x, z);

        // базовый цвет по высоте
        rgb = mix(C.low, C.mid2, smoothstep(0.03, 0.12, hv));
        rgb = mix(rgb, C.hill, smoothstep(0.12, 0.2, hv));
        rgb = mix(rgb, C.rock, smoothstep(0.2, 0.3, hv + (n2 - 0.5) * 0.06));
        rgb = mix(rgb, C.snow, smoothstep(0.38, 0.47, hv + (n1 - 0.5) * 0.04));
        rgb = [rgb[0] * vari, rgb[1] * vari, rgb[2] * vari];
        // пляж
        const beach = 1 - smoothstep(0.004, 0.026, hv);
        if (beach > 0) rgb = mix(rgb, C.sand, beach);

        // города и поля
        const dc = Math.hypot(x - p.x, z - p.z);
        const fz = gridSample(forest, x, z);
        if (hv < 0.17 && fz < 0.25 && rv < 0.3 && dc > 2.0 && dc < fieldReach[pi]) {
          const a = fieldAngle[pi], ca = Math.cos(a), sa = Math.sin(a);
          const u = ((x - p.x) * ca + (z - p.z) * sa) / 1.1, v = ((z - p.z) * ca - (x - p.x) * sa) / 0.75;
          const iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
          const prob = 1 - smoothstep(3.4, fieldReach[pi], dc);
          if (hash2(iu, iv, pi + 1) < prob * 0.6) {
            if (fu < 0.07 || fu > 0.93 || fv < 0.09 || fv > 0.91) rgb = mix(rgb, [78, 118, 62], 0.85);
            else {
              const f = FIELDS[Math.floor(hash2(iu, iv, pi + 40) * FIELDS.length)];
              const stripe = Math.floor(fv * 4) % 2 ? 0.93 : 1.04;
              rgb = [f[0] * stripe * vari, f[1] * stripe * vari, f[2] * stripe * vari];
            }
          }
        }
        if (dc < 2.4) rgb = mix(rgb, C.urban, 0.6 * (1 - smoothstep(0.8, 2.4, dc)));

        // лес
        if (fz > 0.02) rgb = mix(rgb, [C.forest[0] * vari, C.forest[1] * vari, C.forest[2] * vari], Math.min(1, fz * 1.4) * 0.85);

        // освещение рельефа
        const sh = gridSample(shade, x, z);
        rgb = [rgb[0] * sh, rgb[1] * sh, rgb[2] * sh];

        // река
        if (rv > 0.35) rgb = mix(rgb, C.river, Math.min(1, (rv - 0.35) * 3.2));

        // оттенок и граница государства (рядом с границей считаем точно)
        let st = owner[pi], sd = gridSample(sm, x, z), pd = gridSample(pm, x, z);
        if (sd < 1.2 || pd < 1.2) { const t = territoryAt(world, x, z); st = t[3]; pd = t[1]; sd = t[2]; }
        else { sd /= 2; pd /= 2; }
        rgb = mix(rgb, col[st], 0.2);
        if (sd < 0.6) rgb = mix(rgb, col[st], (1 - sd / 0.6) * 0.5);
        if (sd < 0.075) rgb = mix(rgb, [14, 18, 24], 0.85 * (1 - sd / 0.075));
        else if (sd < 0.13) rgb = mix(rgb, col[st], 0.5);
        if (pd < 0.04 && sd > 0.13) rgb = mix(rgb, [255, 255, 255], 0.25 * (1 - pd / 0.04));
      }
      px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = 255;
    }
  }

  // дороги
  const stamp = (x, z, rad, color, a) => {
    const c0 = Math.floor(((x + HALF) / SZ) * tex - rad - 1), c1 = Math.ceil(((x + HALF) / SZ) * tex + rad + 1);
    const r0 = Math.floor(((z + HALF) / SZ) * tex - rad - 1), r1 = Math.ceil(((z + HALF) / SZ) * tex + rad + 1);
    for (let r = Math.max(0, r0); r <= Math.min(tex - 1, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.min(tex - 1, c1); c++) {
        const cx = -HALF + ((c + 0.5) * SZ) / tex, cz = -HALF + ((r + 0.5) * SZ) / tex;
        const d = Math.hypot(cx - x, cz - z) * (tex / SZ);
        if (d > rad) continue;
        const al = a * Math.min(1, (rad - d) / 0.8);
        const o = (r * tex + c) * 4;
        px[o] += (color[0] - px[o]) * al; px[o + 1] += (color[1] - px[o + 1]) * al; px[o + 2] += (color[2] - px[o + 2]) * al;
      }
    }
  };
  // месторождения: пятна руды и нефти прямо на земле
  const rng = mulberry32(world.seed ^ 0x5eed);
  for (const p of provs) {
    const d = p.depositPos || {};
    if (p.deposits.steel && d.steel) {
      const R = p.deposits.steel > 1 ? 1.3 : 0.95;
      for (let k = 0; k < 9; k++) {
        const a = rng() * 6.28, r = rng() * R * 0.8;
        stamp(d.steel[0] + Math.cos(a) * r, d.steel[1] + Math.sin(a) * r, (0.3 + rng() * 0.35) * (tex / SZ), k % 3 === 0 ? [186, 120, 62] : [96, 88, 82], 0.8);
      }
    }
    if (p.deposits.oil && d.oil) {
      const R = p.deposits.oil > 1 ? 1.3 : 0.95;
      for (let k = 0; k < 7; k++) {
        const a = rng() * 6.28, r = rng() * R * 0.8;
        stamp(d.oil[0] + Math.cos(a) * r, d.oil[1] + Math.sin(a) * r, (0.25 + rng() * 0.4) * (tex / SZ), [26, 26, 32], 0.88);
      }
    }
  }
  return px;
}

// мелкая повторяющаяся текстура-«шум»: накладывается на землю, чтобы вблизи не было мыла
export function makeDetail(size = 128) {
  const rng = mulberry32(777);
  const lat = (k) => { const a = new Float32Array(k * k); for (let i = 0; i < a.length; i++) a[i] = rng(); return a; };
  const L1 = lat(32), L2 = lat(8), L3 = lat(64);
  const at = (a, k, x, y) => a[((y % k) + k) % k * k + (((x % k) + k) % k)];
  const val = (a, k, u, v) => {
    const x = u * k, y = v * k, xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return (at(a, k, xi, yi) * (1 - sx) + at(a, k, xi + 1, yi) * sx) * (1 - sy) + (at(a, k, xi, yi + 1) * (1 - sx) + at(a, k, xi + 1, yi + 1) * sx) * sy;
  };
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, o = (y * size + x) * 4;
    px[o] = Math.round(255 * (0.6 * val(L1, 32, u, v) + 0.4 * val(L3, 64, u, v)));
    px[o + 1] = Math.round(255 * val(L2, 8, u, v));
    px[o + 2] = 128; px[o + 3] = 255;
  }
  return px;
}

// маска выбранной провинции (маленькая текстура поверх карты)
export const SEL_TEX = 256;
export function paintSelection(world, id, size = SEL_TEX) {
  const px = new Uint8ClampedArray(size * size * 4);
  if (id < 0) return px;
  const p = world.provs[id];
  for (let r = 0; r < size; r++) {
    const z = -HALF + ((r + 0.5) * SZ) / size;
    for (let c = 0; c < size; c++) {
      const x = -HALF + ((c + 0.5) * SZ) / size;
      if (Math.abs(x - p.x) > 14 || Math.abs(z - p.z) > 14) continue;
      if (gridSample(world.h, x, z) <= 0) continue;
      const t = territoryAt(world, x, z);
      if (t[0] !== id) continue;
      const edge = t[1] < 0.5 ? 1 - t[1] / 0.5 : 0;
      const o = (r * size + c) * 4;
      px[o] = 255; px[o + 1] = 255; px[o + 2] = 255;
      px[o + 3] = Math.round(255 * (0.14 + 0.5 * edge));
    }
  }
  return px;
}
