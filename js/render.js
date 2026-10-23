// 3D-карта на Three.js: цельный рельеф с текстурой, леса, дома, здания, подписи городов,
// камера с жестами. Сцена строится без WebGL, поэтому её можно проверять в node (режим headless).
import * as THREE from './vendor/three.min.js';
import {
  CELL, HEIGHT_SCALE, WORLD, fromGrid, gridSample, provAt, surfaceFromH, surfaceY, territoryAt,
} from './world.js';
import { SEL_TEX, TEX, makeDetail, paintSelection, paintTerrain } from './terrain.js';
import { isClosed } from './diplomacy.js';
import { BUILDINGS, DEPOSITS, DEPOSIT_KINDS } from './data.js';

const { SZ, HALF } = WORLD;
const DEG = Math.PI / 180;
const SLOT_ANGLES = [-60, 0, 60, 120, 180, 240].map((a) => a * DEG);
const RING_R = 3.5;
const BSCALE = 2.4; // масштаб моделей зданий

const hash = (n) => { const x = Math.sin(n * 12.9898 + 4.1) * 43758.5453; return x - Math.floor(x); };
const HEX = (s) => parseInt(s.slice(1), 16);

// ---------- простые «кирпичики» моделей (общие геометрии и материалы) ----------
const geoCache = {};
const geo = (k, f) => (geoCache[k] ||= f());
const matCache = {};
const mat = (hex, extra = {}) => (matCache[hex + JSON.stringify(extra)] ||= new THREE.MeshStandardMaterial({
  color: hex, flatShading: true, roughness: 0.85, metalness: 0.05, ...extra,
}));

function mesh(g, m, x, y, z) { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); return o; }
function box(w, h, d, color, x, y, z) {
  const o = mesh(geo('box', () => new THREE.BoxGeometry(1, 1, 1)), mat(color), x, y + h / 2, z);
  o.scale.set(w, h, d); return o;
}
function cyl(r, h, color, x, y, z, seg = 14) {
  const o = mesh(geo('cyl' + seg, () => new THREE.CylinderGeometry(1, 1, 1, seg)), mat(color), x, y + h / 2, z);
  o.scale.set(r, h, r); return o;
}
function frustum(r, h, color, x, y, z) {
  const o = mesh(geo('frus', () => new THREE.CylinderGeometry(0.7, 1, 1, 14, 1, true)), mat(color, { side: THREE.DoubleSide }), x, y + h / 2, z);
  o.scale.set(r, h, r); return o;
}
function cone(r, h, color, x, y, z, seg = 6, rotY = 0) {
  const o = mesh(geo('cone' + seg, () => new THREE.ConeGeometry(1, 1, seg)), mat(color), x, y + h / 2, z);
  o.scale.set(r, h, r); o.rotation.y = rotY; return o;
}

// ---------- модели зданий ----------
const rot = (o, x = 0, y = 0, z = 0) => { o.rotation.set(x, y, z); return o; };
const pad = (w, d, c = 0x8b9096) => box(w, 0.025, d, c, 0, 0, 0);
function fence(g, w, d, c = 0x6d7176) {
  for (let i = 0; i <= 6; i++) {
    const x = -w / 2 + (w * i) / 6;
    g.add(box(0.01, 0.05, 0.01, c, x, 0.025, d / 2)); g.add(box(0.01, 0.05, 0.01, c, x, 0.025, -d / 2));
  }
  g.add(box(w, 0.008, 0.008, c, 0, 0.06, d / 2)); g.add(box(w, 0.008, 0.008, c, 0, 0.06, -d / 2));
}
function tree(x, z, s = 1) { const g = new THREE.Group(); g.add(cone(0.035 * s, 0.1 * s, 0x2f6b3a, x, 0.025, z, 6)); return g; }

function modelHousing(level) {
  const g = new THREE.Group();
  g.add(pad(0.54, 0.5, 0x9a9a92));
  const spots = [[-0.12, -0.1], [0.12, -0.1], [-0.12, 0.12], [0.12, 0.12]];
  for (let i = 0; i < Math.min(4, 1 + level); i++) {
    const [x, z] = spots[i];
    const h = 0.26 + 0.07 * level + 0.05 * (i % 2);
    g.add(box(0.17, h, 0.17, 0xddd5c4, x, 0.025, z));
    for (let k = 0; k < Math.floor(h / 0.07); k++) g.add(box(0.172, 0.02, 0.172, 0x5d7a99, x, 0.06 + k * 0.07, z));
    g.add(box(0.19, 0.025, 0.19, 0x6b6b70, x, 0.025 + h, z));
  }
  g.add(tree(0, -0.02, 1.3)); g.add(tree(-0.22, 0.0, 1)); g.add(tree(0.22, 0.02, 1));
  return g;
}
function modelMine(level) {
  const g = new THREE.Group();
  g.add(pad(0.58, 0.46, 0x5d584f));
  // копёр: две наклонные стойки, шкив, перекладины
  g.add(rot(box(0.022, 0.4, 0.022, 0x7d6849, -0.17, 0.025, -0.1), 0, 0, 0.22));
  g.add(rot(box(0.022, 0.4, 0.022, 0x7d6849, -0.05, 0.025, -0.1), 0, 0, -0.22));
  g.add(rot(box(0.022, 0.4, 0.022, 0x7d6849, -0.17, 0.025, -0.02), 0, 0, 0.22));
  g.add(rot(box(0.022, 0.4, 0.022, 0x7d6849, -0.05, 0.025, -0.02), 0, 0, -0.22));
  g.add(box(0.14, 0.02, 0.1, 0x5a4a38, -0.11, 0.38 + 0.0, -0.06));
  g.add(rot(cyl(0.06, 0.02, 0xd8c070, -0.11, 0.4, -0.06, 14), Math.PI / 2, 0, 0));
  for (const y of [0.14, 0.26]) g.add(box(0.14, 0.012, 0.012, 0x7d6849, -0.11, y, -0.1));
  // здание ствола и конвейер
  g.add(box(0.2, 0.13, 0.15, 0x8a7a5a, 0.07, 0.025, 0.1));
  g.add(box(0.22, 0.02, 0.17, 0x44464c, 0.07, 0.155, 0.1));
  g.add(rot(box(0.34, 0.018, 0.04, 0x3d4046, 0.2, 0.15, -0.02), 0, 0, 0.5));
  for (let i = 0; i < 1 + level; i++) g.add(cone(0.1 + 0.02 * i, 0.12 + 0.03 * i, i % 2 ? 0x6a4a3a : 0x4b3d34, 0.25 + i * 0.07, 0.025, -0.12 + i * 0.1, 7));
  // рельсы и вагонетка
  g.add(box(0.3, 0.008, 0.008, 0x888, -0.05, 0.03, 0.2)); g.add(box(0.3, 0.008, 0.008, 0x888, -0.05, 0.03, 0.23));
  g.add(box(0.06, 0.04, 0.045, 0xd9902f, -0.12, 0.04, 0.215));
  fence(g, 0.56, 0.44);
  return g;
}
function modelRefinery(level) {
  const g = new THREE.Group();
  g.add(pad(0.6, 0.52, 0x4d5359));
  for (let i = 0; i < 2 + level; i++) {
    const x = -0.2 + (i % 2) * 0.14, z = 0.12 + Math.floor(i / 2) * 0.14 - (i > 1 ? 0 : 0);
    g.add(cyl(0.062, 0.1 + 0.02 * (i % 2), 0xe6eaee, x, 0.025, z));
    g.add(cyl(0.066, 0.012, 0xb34a3a, x, 0.12 + 0.02 * (i % 2), z));
  }
  // колонны
  for (const [x, h] of [[0.04, 0.5], [0.15, 0.4]]) {
    g.add(cyl(0.032, h, 0xb8bec4, x, 0.025, -0.08, 10));
    for (let k = 1; k < 5; k++) g.add(cyl(0.038, 0.012, 0x8b9299, x, 0.025 + (h * k) / 5, -0.08, 10));
    g.add(cone(0.032, 0.05, 0x7b828a, x, 0.025 + h, -0.08, 10));
  }
  g.add(box(0.34, 0.02, 0.02, 0x8d949b, -0.02, 0.14, 0.02)); g.add(box(0.34, 0.02, 0.02, 0x8d949b, -0.02, 0.18, 0.02));
  for (const x of [-0.18, -0.02, 0.14]) g.add(box(0.014, 0.16, 0.014, 0x6d747a, x, 0.025, 0.02));
  g.add(box(0.14, 0.1, 0.1, 0x93392d, 0.2, 0.025, 0.14));
  // факел
  g.add(cyl(0.01, 0.44, 0x70777e, -0.25, 0.025, -0.15, 6));
  g.add(cone(0.028, 0.07, 0xff8a2a, -0.25, 0.465, -0.15, 6));
  g.userData.smoke = [[-0.25, 0.55, -0.15]];
  return g;
}
function modelPower(level) {
  const g = new THREE.Group();
  g.add(pad(0.66, 0.54, 0x7b838b));
  g.add(box(0.36, 0.14, 0.2, 0xa9b2ba, -0.08, 0.025, 0.14));
  g.add(box(0.38, 0.02, 0.22, 0x555f69, -0.08, 0.165, 0.14));
  g.add(box(0.14, 0.3, 0.14, 0x8e979f, -0.08, 0.025, -0.02));
  // красно-белая труба
  for (let k = 0; k < 6; k++) g.add(cyl(0.032 - k * 0.002, 0.07, k % 2 ? 0xe9e9ec : 0xb83a30, 0.2, 0.025 + k * 0.07, -0.12, 12));
  // градирни
  const n = 1 + Math.min(level, 2);
  for (let i = 0; i < n; i++) g.add(frustum(0.1, 0.3, 0xd4d6da, -0.2 + i * 0.2, 0.025, -0.2, 16));
  // открытое распределительное устройство
  for (let i = 0; i < 3; i++) { g.add(box(0.012, 0.14, 0.012, 0x6a7078, 0.1 + i * 0.07, 0.025, 0.18)); g.add(box(0.05, 0.01, 0.01, 0x6a7078, 0.1 + i * 0.07, 0.15, 0.18)); }
  g.userData.smoke = [[0.2, 0.47, -0.12], ...Array.from({ length: n }, (_, i) => [-0.2 + i * 0.2, 0.33, -0.2])];
  return g;
}
function modelElectronics(level) {
  const g = new THREE.Group();
  g.add(pad(0.66, 0.54, 0x7d858d));
  g.add(box(0.46, 0.1, 0.26, 0xcdd2d8, -0.03, 0.025, 0));
  for (let i = 0; i < 4; i++) g.add(rot(box(0.1, 0.045, 0.26, 0x9aa3ab, -0.18 + i * 0.12, 0.125, 0), 0, 0, 0.32));
  if (level > 1) for (let i = 0; i < 3; i++) g.add(rot(box(0.12, 0.012, 0.09, 0x27457a, -0.15 + i * 0.14, 0.2, 0.0), 0, 0, -0.25));
  g.add(box(0.14, 0.2, 0.12, 0x8db2cc, 0.24, 0.025, -0.08));
  g.add(box(0.15, 0.015, 0.13, 0x3b4652, 0.24, 0.225, -0.08));
  for (let i = 0; i < 3; i++) g.add(box(0.05, 0.05, 0.03, 0x39424c, -0.18 + i * 0.1, 0.025, 0.17));
  if (level > 2) { g.add(cyl(0.01, 0.2, 0x8a939c, -0.28, 0.12, -0.18, 6)); g.add(cone(0.05, 0.03, 0xe6e6e9, -0.28, 0.32, -0.18, 12)); }
  for (let i = 0; i < 3; i++) g.add(box(0.05, 0.03, 0.09, i % 2 ? 0x2f7bd0 : 0xdd8f2c, 0.2 + (i % 2) * 0.05, 0.025, 0.14 + (i > 1 ? 0.06 : 0)));
  return g;
}
function modelSteelworks(level) {
  const g = new THREE.Group();
  g.add(pad(0.66, 0.54, 0x555a60));
  g.add(cyl(0.075, 0.44, 0x8b4a3a, -0.18, 0.025, -0.08, 12));
  for (let k = 1; k < 5; k++) g.add(cyl(0.082, 0.014, 0x56423a, -0.18, 0.025 + k * 0.085, -0.08, 12));
  g.add(cone(0.07, 0.07, 0x6a3a2c, -0.18, 0.465, -0.08, 12));
  g.add(box(0.06, 0.05, 0.02, 0xff7a1a, -0.18, 0.04, 0.0, ));
  for (const z of [-0.18, 0.02]) g.add(cyl(0.045, 0.34 + 0.02 * level, 0xb5b9bd, -0.02, 0.025, z, 10));
  g.add(box(0.4, 0.11, 0.2, 0x6f757b, 0.12, 0.025, 0.16));
  g.add(box(0.42, 0.02, 0.22, 0x474c52, 0.12, 0.135, 0.16));
  g.add(cone(0.14, 0.12, 0x2b2a2a, 0.24, 0.025, -0.14, 7));
  g.add(cyl(0.02, 0.5, 0x7a8087, 0.25, 0.025, 0.0, 8));
  g.userData.smoke = [[-0.18, 0.55, -0.08], [0.25, 0.55, 0.0]];
  return g;
}
function modelGoldmine(level) {
  const g = modelMine(level);
  g.add(box(0.2, 0.012, 0.16, 0xe3b02f, 0.07, 0.17, 0.1));   // золотая кровля
  for (let i = 0; i < 3; i++) g.add(box(0.05, 0.04, 0.04, 0xf2c94c, 0.28 + i * 0.045, 0.025, 0.2 - (i % 2) * 0.04));
  g.add(box(0.07, 0.05, 0.05, 0xf2c94c, -0.12, 0.06, 0.215));
  return g;
}
function modelRaremine(level) {
  const g = modelMine(level);
  g.add(box(0.2, 0.012, 0.16, 0x4a6fb5, 0.07, 0.17, 0.1));
  for (let i = 0; i < 3; i++) g.add(cone(0.035, 0.12 + i * 0.03, i % 2 ? 0x8f7fe0 : 0x58c5e8, 0.26 + i * 0.06, 0.025, 0.22 - (i % 2) * 0.05, 5));
  return g;
}
function modelFarm(level) {
  const g = new THREE.Group();
  g.add(pad(0.66, 0.54, 0x8a9a52));
  // грядки
  for (let i = 0; i < 3 + level; i++) g.add(box(0.5, 0.012, 0.05, i % 2 ? 0xc9b35a : 0x6f9a3c, -0.02, 0.025, -0.22 + i * 0.075));
  g.add(box(0.2, 0.12, 0.14, 0xb8473a, 0.2, 0.025, 0.16));                       // амбар
  g.add(rot(box(0.22, 0.02, 0.16, 0x6b3a30, 0.2, 0.15, 0.16), 0, 0, 0));
  g.add(cyl(0.05, 0.2, 0xd8dade, -0.2, 0.025, 0.18, 12));                         // силос
  g.add(cone(0.055, 0.05, 0x9aa0a6, -0.2, 0.225, 0.18, 12));
  if (level > 1) { g.add(cyl(0.045, 0.16, 0xd8dade, -0.08, 0.025, 0.2, 12)); g.add(cone(0.05, 0.04, 0x9aa0a6, -0.08, 0.185, 0.2, 12)); }
  if (level > 2) g.add(box(0.08, 0.05, 0.05, 0xd8a52c, 0.02, 0.025, 0.2));       // трактор
  return g;
}
function modelHydro(level) {
  const g = new THREE.Group();
  g.add(pad(0.66, 0.54, 0x6f8896));
  g.add(box(0.56, 0.12, 0.12, 0xb9c1c8, 0, 0.025, -0.1));                         // плотина
  g.add(box(0.58, 0.015, 0.14, 0x7a8590, 0, 0.145, -0.1));
  g.add(box(0.5, 0.005, 0.2, 0x3b8fd6, 0, 0.03, 0.12));                           // вода
  const n = 1 + level;
  for (let i = 0; i < n; i++) g.add(box(0.08, 0.1, 0.1, 0xe3e6ea, -0.2 + (i * 0.4) / Math.max(1, n - 1 || 1), 0.025, 0.0));
  g.add(box(0.16, 0.14, 0.12, 0x8d979f, 0.22, 0.025, 0.12));
  for (let i = 0; i < 2; i++) g.add(box(0.012, 0.16, 0.012, 0x6a7078, 0.12 + i * 0.06, 0.025, 0.2));
  return g;
}
function modelWarehouse(level) {
  const g = new THREE.Group();
  g.add(pad(0.66, 0.54, 0x6c7178));
  const n = 1 + Math.min(level, 2);
  for (let i = 0; i < n; i++) {
    g.add(box(0.46, 0.14, 0.14, i % 2 ? 0xb58a4a : 0x9aa6b0, 0, 0.025, -0.2 + i * 0.18));
    g.add(box(0.48, 0.02, 0.16, 0x4f5a66, 0, 0.165, -0.2 + i * 0.18));
    g.add(box(0.1, 0.08, 0.01, 0x3a4048, 0.12, 0.03, -0.12 + i * 0.18));
  }
  for (let i = 0; i < 3; i++) g.add(box(0.06, 0.05, 0.05, [0xd8a52c, 0x4a7fb5, 0xb8473a][i], -0.24 + i * 0.07, 0.025, 0.22));
  return g;
}
function modelPort(level) {
  const g = new THREE.Group();
  g.add(pad(0.66, 0.54, 0x58707e));
  g.add(box(0.6, 0.01, 0.2, 0x2f78b5, 0, 0.022, 0.2));                            // акватория
  g.add(box(0.5, 0.03, 0.06, 0x9a9388, 0, 0.025, 0.08));                          // причал
  // краны
  for (let i = 0; i < 1 + Math.min(level, 2); i++) {
    const x = -0.18 + i * 0.2;
    g.add(box(0.015, 0.24, 0.015, 0xd89a2c, x, 0.05, 0.06));
    g.add(box(0.015, 0.015, 0.2, 0xd89a2c, x, 0.29, 0.0));
  }
  // контейнеры
  const cols = [0xb8473a, 0x3d77b5, 0xd8a52c, 0x4f9a5a];
  for (let i = 0; i < 6; i++) g.add(box(0.1, 0.05, 0.05, cols[i % 4], -0.22 + (i % 3) * 0.12, 0.025 + Math.floor(i / 3) * 0.05, -0.12));
  g.add(box(0.14, 0.1, 0.1, 0x8e979f, 0.24, 0.025, -0.14));
  return g;
}
const MODELS = { housing: modelHousing, mine: modelMine, goldmine: modelGoldmine, raremine: modelRaremine, refinery: modelRefinery, power: modelPower, electronics: modelElectronics, steelworks: modelSteelworks, farm: modelFarm, hydro: modelHydro, warehouse: modelWarehouse, port: modelPort };

function scaffold() {
  const g = new THREE.Group();
  const wire = new THREE.MeshBasicMaterial({ color: 0xe8b83a, wireframe: true });
  const b = new THREE.Mesh(geo('box', () => new THREE.BoxGeometry(1, 1, 1)), wire);
  b.scale.set(0.3, 0.22, 0.3); b.position.y = 0.11; g.add(b);
  g.add(box(0.34, 0.025, 0.34, 0x6a6f75, 0, 0, 0));
  g.add(cyl(0.012, 0.42, 0xe8b83a, 0.17, 0, 0.17, 6));
  g.add(box(0.3, 0.015, 0.015, 0xe8b83a, 0.03, 0.4, 0.17));
  return g;
}

function depositModel(kind) {
  const g = new THREE.Group();
  if (kind === 'steel') {
    const rock = (s, x, z, c, extra) => {
      const m = new THREE.Mesh(geo('rock', () => new THREE.IcosahedronGeometry(1, 0)), mat(c, extra));
      m.scale.set(s, s * 0.75, s * 0.9); m.position.set(x, s * 0.4, z); return m;
    };
    g.add(rock(0.42, 0, 0, 0x7a6f64)); g.add(rock(0.3, 0.45, 0.2, 0x6f665d)); g.add(rock(0.22, -0.3, 0.38, 0x857a6e));
    g.add(rock(0.16, 0.18, -0.3, 0xd98e3f, { emissive: 0x4a2a08 }));
  } else if (kind === 'gold') {
    const rock = (sc, x, z, c, extra) => {
      const m = new THREE.Mesh(geo('rock', () => new THREE.IcosahedronGeometry(1, 0)), mat(c, extra));
      m.scale.set(sc, sc * 0.7, sc * 0.9); m.position.set(x, sc * 0.35, z); return m;
    };
    g.add(rock(0.38, 0, 0, 0x8a7d5c)); g.add(rock(0.26, 0.4, 0.22, 0x7a6f52));
    for (const [x, z, sc] of [[0.1, 0.3, 0.13], [-0.25, 0.1, 0.1], [0.3, -0.2, 0.12], [-0.05, -0.3, 0.09]]) g.add(rock(sc, x, z, 0xf2c94c, { emissive: 0x6a4a00 }));
  } else if (kind === 'rare') {
    g.add(cyl(0.34, 0.02, 0x4b4660, 0, 0, 0, 12));
    for (const [x, z, h, c] of [[0, 0, 0.5, 0x58c5e8], [0.22, 0.1, 0.35, 0x8f7fe0], [-0.2, 0.15, 0.32, 0x6ad7d0], [0.05, -0.25, 0.28, 0xa68cf0], [-0.15, -0.12, 0.4, 0x58c5e8]]) {
      g.add(cone(0.07, h, c, x, 0.02, z, 5));
    }
  } else {
    g.add(cyl(0.38, 0.02, 0x1a1a22, 0, 0, 0, 18));
    g.add(cyl(0.05, 0.6, 0x2a2a30, 0.1, 0, 0, 6));
    g.add(box(0.5, 0.06, 0.08, 0x2a2a30, 0.1, 0.55, 0));
    g.add(cyl(0.14, 0.012, 0x0f0f14, -0.42, 0, 0.3, 12));
  }
  return g;
}

// «запекаем» группу моделей в один меш с цветами вершин: один вызов отрисовки на город
function bake(group) {
  group.updateMatrixWorld(true);
  const pos = [], col = [];
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  group.traverse((o) => {
    if (!o.isMesh || !o.material || !o.material.isMeshStandardMaterial) return;
    const g = o.geometry, p = g.attributes.position, idx = g.index;
    const cnt = idx ? idx.count : p.count;
    c.copy(o.material.color);
    if (o.material.emissive && o.material.emissive.getHex() !== 0) c.lerp(o.material.emissive, 0.35).addScalar(0.12);
    for (let i = 0; i < cnt; i++) {
      v.fromBufferAttribute(p, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld);
      pos.push(v.x, v.y, v.z); col.push(c.r, c.g, c.b);
    }
  });
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  const m = new THREE.Mesh(g, bakedMat());
  m.frustumCulled = false;
  return m;
}
let bakedMaterial = null;
const bakedMat = () => (bakedMaterial ||= new THREE.MeshStandardMaterial({
  vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide,
}));

const WALLS = [0xe9dfca, 0xdacfb6, 0xcdc1a2, 0xf0e8d8, 0xcfae8e, 0xd8d2c6];
const TALL = [0xa9bccb, 0xbfc9d0, 0xd8d3c6, 0x9fb0b8];
const territoryAtOwner = (w, x, z) => territoryAt(w, x, z)[3];
const CAR_COLORS = [0xd8433a, 0x2f6fd0, 0xe9e9ec, 0x2b2d33, 0xe3b02f, 0x3c9a5a];

// лента вдоль поверхности (дороги и улицы). acc — накопитель вершин.
function addStrip(acc, w, pts, width, lift, color) {
  const rs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.35));
    for (let k = 0; k < n; k++) rs.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  rs.push(pts[pts.length - 1]);
  const base = acc.pos.length / 3;
  const c = new THREE.Color(color);
  for (let i = 0; i < rs.length; i++) {
    const a = rs[Math.max(0, i - 1)], b = rs[Math.min(rs.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    for (const sd of [-1, 1]) {
      const x = rs[i][0] - tz * sd * width / 2, z = rs[i][1] + tx * sd * width / 2;
      acc.pos.push(x, surfaceY(w, x, z) + lift, z);
      acc.col.push(c.r, c.g, c.b);
    }
    if (i > 0) { const k = base + (i - 1) * 2; acc.idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
}
function stripMesh(acc) {
  if (!acc.idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(acc.pos), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(acc.col), 3));
  g.setIndex(acc.idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  }));
  m.frustumCulled = false;
  return m;
}
const newAcc = () => ({ pos: [], col: [], idx: [] });

// ---------- 3D-карта ----------
export class MapView {
  constructor(canvas, game, opts = {}) {
    this.c = canvas;
    this.headless = !canvas || !!opts.headless;
    this.labelsEl = opts.labels || null;
    this.texSize = opts.texSize || 0;
    this.sel = -1;
    this.onTap = () => {};
    this.dirty = true;
    this.w = opts.width || 390;
    this.h = opts.height || 560;
    this.pointers = new Map();
    this.cam = { tx: 0, tz: 0, yaw: 0, pitch: 0.95, dist: 60 };
    this.fitDist = 100;
    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.8);
    this.tmpV = new THREE.Vector3();
    this.dummy = new THREE.Object3D();
    this.pinMode = null;
    this.t0 = 0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e345c);
    this.camera = new THREE.PerspectiveCamera(40, this.w / this.h, 1, 600);
    this.scene.add(new THREE.HemisphereLight(0xe3efff, 0x4d5a3c, 1.9));
    const sun = new THREE.DirectionalLight(0xfff1d6, 1.8);
    sun.position.set(-30, 50, -20);
    this.scene.add(sun);

    if (!this.headless) {
      try {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
      } catch (e) {
        this.webglError = e; // у устройства нет WebGL: логика игры работает, рисовать нечем
        this.headless = true;
      }
      this.bind();
      this.resize();
    }
    this.setGame(game, opts.pre || null);
  }

  // ---- построение мира ----
  setGame(game, pre = null) {
    this.g = game;
    this.pre = pre;
    this.wd = game.world;
    if (this.root) {
      this.scene.remove(this.root);
      this.root.traverse((o) => { if (o.geometry) o.geometry.dispose?.(); if (o.isInstancedMesh) o.dispose(); });
    }
    this.root = new THREE.Group();
    this.scene.add(this.root);
    const provs = game.provs;
    this.radius = HALF * 0.9;

    this.buildTerrain();
    this.buildTrees();
    this.buildRoads();
    this.buildBorders();

    this.selData = new Uint8Array(SEL_TEX * SEL_TEX * 4);
    this.selTex = new THREE.DataTexture(this.selData, SEL_TEX, SEL_TEX, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.selTex.colorSpace = THREE.SRGBColorSpace;
    this.selTex.magFilter = THREE.LinearFilter; this.selTex.minFilter = THREE.LinearFilter; this.selTex.generateMipmaps = false;
    this.selTex.needsUpdate = true;
    this.selMesh = new THREE.Mesh(this.terrain.geometry, new THREE.MeshBasicMaterial({
      map: this.selTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    this.selMesh.position.y = 0.02; this.selMesh.frustumCulled = false;
    this.root.add(this.selMesh);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 }));
    this.ring.renderOrder = 10; this.ring.visible = false;
    this.root.add(this.ring);

    // место будущей постройки (призрак)
    this.ghost = new THREE.Group(); this.ghost.visible = false;
    this.ghostDisc = new THREE.Mesh(new THREE.RingGeometry(0, 1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4cd964, transparent: true, opacity: 0.35, depthTest: false }));
    this.ghostDisc.renderOrder = 9;
    this.ghostRing = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4cd964, depthTest: false }));
    this.ghostRing.renderOrder = 9;
    this.ghost.add(this.ghostDisc, this.ghostRing);
    this.ghostType = null;
    this.root.add(this.ghost);

    this.cityGroups = provs.map(() => { const grp = new THREE.Group(); this.root.add(grp); return grp; });
    this.layouts = provs.map((p) => this.cityLayout(p));
    this.sig = provs.map(() => '');
    this.hsig = '';
    this.ssig = '';
    this.houseMeshes = [];
    this.streetMesh = null;
    this.smoke = provs.map(() => []);
    this.buildCars();
    this.buildLabels();
    this.sync();

    this.fit();
    this.select(-1);
  }

  buildTerrain() {
    const SEG = 280;
    const geom = new THREE.PlaneGeometry(SZ, SZ, SEG, SEG);
    geom.rotateX(-Math.PI / 2);
    const P = geom.attributes.position, UV = geom.attributes.uv;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), z = P.getZ(i);
      P.setY(i, surfaceY(this.wd, x, z));
      UV.setXY(i, (x + HALF) / SZ, (z + HALF) / SZ);
    }
    P.needsUpdate = true;
    geom.computeBoundingSphere(); geom.computeBoundingBox();

    const size = this.texSize || (this.headless ? 128 : TEX);
    const px = this.pre && this.pre.length === size * size * 4 ? this.pre : paintTerrain(this.wd, this.g.states.map((s) => s.color), size);
    const tex = new THREE.DataTexture(new Uint8Array(px.buffer), size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
    if (this.renderer) tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    tex.needsUpdate = true;
    this.terrainTex = tex;

    // мелкая текстура-«шум» поверх земли: вблизи земля не размыта
    const dt = new THREE.DataTexture(makeDetail(128), 128, 128, THREE.RGBAFormat, THREE.UnsignedByteType);
    dt.wrapS = THREE.RepeatWrapping; dt.wrapT = THREE.RepeatWrapping;
    dt.magFilter = THREE.LinearFilter; dt.minFilter = THREE.LinearMipmapLinearFilter; dt.generateMipmaps = true;
    if (this.renderer) dt.anisotropy = 4;
    dt.needsUpdate = true;
    const m = new THREE.MeshBasicMaterial({ map: tex });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.detailMap = { value: dt };
      sh.fragmentShader = sh.fragmentShader
        .replace('void main() {', 'uniform sampler2D detailMap;\nvoid main() {')
        .replace('#include <map_fragment>', `#include <map_fragment>
          float dn = texture2D(detailMap, vMapUv * 190.0).r;
          float dm = texture2D(detailMap, vMapUv * 45.0).g;
          diffuseColor.rgb *= 1.0 + (dn - 0.5) * 0.34 + (dm - 0.5) * 0.24;`);
    };
    this.terrain = new THREE.Mesh(geom, m);
    this.root.add(this.terrain);
  }

  buildTrees() {
    const w = this.wd;
    const pines = [], oaks = [], peaks = [], bushes = [];
    const STEP = 0.5;
    // просеки: вдоль границ, дорог и вокруг КПП деревья не растут
    const clear = new Set();
    const mark = (x, z, r) => {
      const cx = Math.floor((x + HALF) / STEP), cz = Math.floor((z + HALF) / STEP);
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) clear.add((cz + dz) * 1000 + cx + dx);
    };
    for (const b of w.borders || []) for (const [x, z] of b.pts) mark(x, z, 1);
    for (const r of w.roads) for (const [x, z] of r.pts) mark(x, z, 0);
    for (const c of w.checkpoints || []) mark(c.x, c.z, 3);
    for (let gz = 0; gz < SZ / STEP; gz++) {
      for (let gx = 0; gx < SZ / STEP; gx++) {
        const k = gz * 1000 + gx;
        if (clear.has(k)) continue;
        const x = -HALF + (gx + hash(k) * 0.9) * STEP, z = -HALF + (gz + hash(k + 0.5) * 0.9) * STEP;
        const hv = gridSample(w.h, x, z);
        if (hv > 0.012 && hv < 0.3) {
          const f = gridSample(w.forest, x, z);
          if (f > 0.16 && hash(k + 3) < f * 0.95 && pines.length + oaks.length < 16000) {
            const s = 0.75 + hash(k + 7) * 0.7;
            const t = { x, z, y: surfaceFromH(hv), s, c: hash(k + 11) };
            if (hv > 0.14 || hash(k + 13) < 0.38) pines.push(t); else oaks.push(t);
          } else if (f < 0.1 && hv > 0.03 && hash(k + 23) < 0.035 && bushes.length < 4500 && gridSample(w.river, x, z) < 0.2) {
            bushes.push({ x, z, y: surfaceFromH(hv), s: 0.5 + hash(k + 29) * 0.6, c: hash(k + 31) });
          }
        } else if (hv >= 0.3 && hash(k + 17) < Math.min(0.3, (hv - 0.3) * 3)) {
          peaks.push({ x, z, y: surfaceFromH(hv) - 0.25, s: 0.7 + hash(k + 19) * 0.9, c: hv });
        }
      }
    }
    const mk = (g, list, base, colors, sx, sy, yOff) => {
      const im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.95 }), Math.max(1, list.length));
      const c = new THREE.Color();
      list.forEach((t, i) => {
        this.dummy.position.set(t.x, t.y + yOff * t.s, t.z);
        this.dummy.rotation.set(0, hash(i + base) * 6.28, 0);
        this.dummy.scale.set(sx * t.s, sy * t.s, sx * t.s);
        this.dummy.updateMatrix();
        im.setMatrixAt(i, this.dummy.matrix);
        c.set(colors[Math.floor(t.c * colors.length) % colors.length]);
        im.setColorAt(i, c);
      });
      im.count = list.length;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.frustumCulled = false;
      this.root.add(im);
    };
    mk(new THREE.ConeGeometry(0.3, 1, 6), pines, 0, [0x2c5f37, 0x336b3d, 0x264f30, 0x3d7544], 1, 1.25, 0.62);
    mk(new THREE.IcosahedronGeometry(0.34, 0), oaks, 100, [0x4a8a45, 0x3f7d3d, 0x5b9a4b, 0x6aa356], 1, 1.1, 0.38);
    mk(new THREE.IcosahedronGeometry(0.2, 0), bushes, 300, [0x5d8f48, 0x6d9a4f, 0x7a8f4a, 0x4f8040], 1, 0.7, 0.1);
    mk(new THREE.ConeGeometry(0.42, 1, 5), peaks, 200, [0x8b8479, 0x9b958a, 0x7a746c, 0xa7a8ac, 0xe8eaee], 1, 1.5, 0.4);
    this.treeCount = pines.length + oaks.length;
  }

  // дороги между городами — настоящие ленты поверх рельефа
  buildRoads() {
    const acc = newAcc();
    const capSet = new Set(this.wd.provs.filter((p) => p.capital).map((p) => p.id));
    // кусок ломаной между расстояниями s0..s1
    const sub = (pts, s0, s1) => {
      const out = []; let d = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1], l = Math.hypot(bx - ax, bz - az);
        if (d + l > s0 && d < s1) {
          const f0 = Math.max(0, (s0 - d) / l), f1 = Math.min(1, (s1 - d) / l);
          if (!out.length) out.push([ax + (bx - ax) * f0, az + (bz - az) * f0]);
          out.push([ax + (bx - ax) * f1, az + (bz - az) * f1]);
        }
        d += l;
      }
      return out;
    };
    for (const r of this.wd.roads) {
      const major = capSet.has(r.a) || capSet.has(r.b);
      addStrip(acc, this.wd, r.pts, major ? 0.46 : 0.34, 0.05, major ? 0x2e3236 : 0x5d5446);   // обочина
      addStrip(acc, this.wd, r.pts, major ? 0.34 : 0.22, 0.062, major ? 0x4a4f55 : 0x9a8a70);  // полотно
      let total = 0;
      for (let i = 1; i < r.pts.length; i++) total += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]);
      if (major) for (let s = 0.6; s < total - 0.9; s += 0.8) {
        const d = sub(r.pts, s, s + 0.4);
        if (d.length > 1) addStrip(acc, this.wd, d, 0.035, 0.074, 0xe8e2c0);
      }
      // мосты: настил там, где дорога пересекает реку
      let from = -1;
      for (let s = 0; s <= total + 0.001; s += 0.2) {
        const q = sub(r.pts, s, s + 0.01), pt = q[0];
        const wet = pt && gridSample(this.wd.river, pt[0], pt[1]) > 0.3;
        if (wet && from < 0) from = s;
        if (!wet && from >= 0) {
          const d = sub(r.pts, Math.max(0, from - 0.25), s + 0.25);
          if (d.length > 1) {
            addStrip(acc, this.wd, d, 0.52, 0.09, 0x6b5d49);
            addStrip(acc, this.wd, d, 0.40, 0.1, major ? 0x4a4f55 : 0x9a8a70);
            addStrip(acc, this.wd, d, 0.56, 0.085, 0x2d2a26);
          }
          from = -1;
        }
      }
    }
    const m = stripMesh(acc);
    if (m) this.root.add(m);
    this.roadLen = this.wd.roads.map((r) => {
      const cum = [0];
      for (let i = 1; i < r.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]));
      return cum;
    });
  }

  // государственные границы: полоса, забор с колючкой, вышки; КПП на дорогах
  buildBorders() {
    const w = this.wd, g = this.g;
    this.borderGroup = new THREE.Group();
    this.root.add(this.borderGroup);
    const acc = newAcc();
    const cps = w.checkpoints || [];
    const nearCp = (x, z, r) => cps.some((c) => Math.hypot(c.x - x, c.z - z) < r);
    const pos = [], col = [];
    const quad = (x0, z0, x1, z1, y0, y1, c) => {
      const cc = new THREE.Color(c);
      const a = surfaceY(w, x0, z0), b = surfaceY(w, x1, z1);
      pos.push(x0, a + y0, z0, x1, b + y0, z1, x1, b + y1, z1, x0, a + y0, z0, x1, b + y1, z1, x0, a + y1, z0);
      for (let i = 0; i < 6; i++) col.push(cc.r, cc.g, cc.b);
    };
    const posts = [], towers = new THREE.Group();
    let towerAt = 0;
    for (const bd of w.borders || []) {
      addStrip(acc, w, bd.pts, 0.8, 0.044, 0x9b8c68);   // контрольно-следовая полоса
      addStrip(acc, w, bd.pts, 0.09, 0.07, 0x23262a);    // линия границы
      // равномерная выборка вдоль ломаной
      const samples = [];
      let carry = 0;
      for (let i = 0; i < bd.pts.length - 1; i++) {
        const [ax, az] = bd.pts[i], [bx, bz] = bd.pts[i + 1], l = Math.hypot(bx - ax, bz - az);
        for (let d = carry; d < l; d += 0.42) samples.push([ax + ((bx - ax) * d) / l, az + ((bz - az) * d) / l]);
        carry = ((carry - l) % 0.42 + 0.42) % 0.42;
      }
      for (let i = 0; i < samples.length - 1; i++) {
        const [x0, z0] = samples[i], [x1, z1] = samples[i + 1];
        if (nearCp((x0 + x1) / 2, (z0 + z1) / 2, 0.85)) continue;
        if (gridSample(w.h, x0, z0) < 0.005) continue;
        quad(x0, z0, x1, z1, 0.0, 0.38, 0x8c938c);
        quad(x0, z0, x1, z1, 0.38, 0.44, 0x3a3d40);
        quad(x0, z0, x1, z1, 0.44, 0.52, 0xd5d8dc);   // колючая проволока поверху
        if (i % 2 === 0) posts.push([x0, z0]);
        if (++towerAt % 34 === 0 && !nearCp(x0, z0, 2.2)) {
          const t = new THREE.Group();
          const side = (towerAt / 34) % 2 ? bd.a : bd.b;
          const roofCol = side >= 0 && side < g.states.length ? HEX(g.states[side].color) : 0x777777;
          for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) t.add(box(0.02, 0.4, 0.02, 0x5b5f55, lx * 0.07, 0, lz * 0.07));
          t.add(box(0.2, 0.12, 0.2, 0x6c7468, 0, 0.4, 0));
          t.add(box(0.26, 0.03, 0.26, roofCol, 0, 0.52, 0));
          t.add(box(0.12, 0.03, 0.04, 0x2b2f33, 0, 0.44, 0.1));
          t.position.set(x0, surfaceY(w, x0, z0), z0);
          t.scale.setScalar(2.2);
          towers.add(t);
        }
      }
    }
    const sm = stripMesh(acc);
    if (sm) this.borderGroup.add(sm);
    if (pos.length) {
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      bg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
      const m = new THREE.Mesh(bg, bakedMat()); m.frustumCulled = false;
      this.borderGroup.add(m);
    }
    if (posts.length) {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x40453f, flatShading: true }), posts.length);
      const d = new THREE.Object3D();
      posts.forEach(([x, z], i) => { d.position.set(x, surfaceY(w, x, z) + 0.28, z); d.scale.set(0.08, 0.56, 0.08); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
      im.frustumCulled = false;
      this.borderGroup.add(im);
    }
    const tb = bake(towers);
    if (tb) this.borderGroup.add(tb);

    // КПП
    const stat = new THREE.Group();
    this.cps = [];
    for (const c of cps) {
      const nx = -c.tz, nz = c.tx;
      const sideA = territoryAtOwner(w, c.x + nx * 0.9, c.z + nz * 0.9);
      const sideB = territoryAtOwner(w, c.x - nx * 0.9, c.z - nz * 0.9);
      const cg = new THREE.Group();
      cg.position.set(c.x, surfaceY(w, c.x, c.z), c.z);
      cg.rotation.y = Math.atan2(-nz, nx);
      cg.scale.setScalar(1.6);
      cg.add(box(1.7, 0.016, 1.3, 0x3a3e43, 0, 0.06, 0));
      for (const [v, st] of [[0.66, sideA], [-0.66, sideB]]) {
        const sc = st >= 0 && st < g.states.length ? HEX(g.states[st].color) : 0x888888;
        cg.add(box(0.3, 0.26, 0.3, 0xdfe3e6, v, 0.07, 0.38));
        cg.add(box(0.36, 0.04, 0.36, sc, v, 0.33, 0.38));
        cg.add(box(0.12, 0.08, 0.02, 0x2a3440, v, 0.17, 0.54));
        cg.add(cyl(0.012, 0.62, 0xdddddd, v, 0.07, -0.42, 6));
        cg.add(box(0.22, 0.13, 0.012, sc, v + (v > 0 ? -0.12 : 0.12), 0.55, -0.42));
        // мешки с песком и ограждение
        cg.add(box(0.26, 0.06, 0.07, 0x9c8e6a, v, 0.07, -0.18));
      }
      stat.add(cg);
      // стрела шлагбаума: от будки стороны A поперёк дороги
      const arm = new THREE.Group();
      arm.position.set(0.66 - 0.16, 0.2, 0.02);
      arm.rotation.y = Math.atan2(-nz, nx);
      arm.position.set(c.x + nx * 0.8, surfaceY(w, c.x, c.z) + 0.34, c.z + nz * 0.8);
      arm.scale.setScalar(1.6);
      const piv = new THREE.Group();
      for (let k = 0; k < 6; k++) piv.add(box(0.17, 0.04, 0.04, k % 2 ? 0xf2f2f2 : 0xd23b32, -0.17 * (k + 0.5), -0.02, 0));
      const lamp = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 0), new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
      lamp.position.set(0.03, 0.1, 0);
      piv.add(lamp);
      arm.add(piv);
      this.borderGroup.add(arm);
      this.cps.push({ cp: c, arm, piv, lamp, cur: 0, target: 0 });
    }
    const sb = bake(stat);
    if (sb) this.borderGroup.add(sb);
    this.dipRev = -1;
    this.updateCheckpoints(true);
  }

  // шлагбаумы: закрытые поперёк дороги, открытые подняты; машины не едут через закрытые КПП
  updateCheckpoints(instant = false) {
    const g = this.g;
    if (!g.dip || !this.cps) return;
    this.dipRev = g.dip.rev;
    this.roadBlocks = this.wd.roads.map(() => []);
    for (const c of this.cps) {
      const closed = isClosed(g, c.cp.a, c.cp.b);
      c.target = closed ? 0 : 1;
      if (instant) c.cur = c.target;
      c.lamp.material.color.setHex(closed ? 0xff3b30 : 0x35d36b);
      if (closed) this.roadBlocks[c.cp.road].push(c.cp.s);
    }
    for (const arr of this.roadBlocks) arr.sort((a, b) => a - b);
    this.applyArms();
    this.dirty = true;
  }
  applyArms() {
    let moving = false;
    for (const c of this.cps) {
      if (Math.abs(c.cur - c.target) > 0.001) { c.cur += Math.sign(c.target - c.cur) * Math.min(0.08, Math.abs(c.target - c.cur)); moving = true; }
      c.piv.rotation.z = -c.cur * 1.25;
    }
    return moving;
  }

  // машины на дорогах
  buildCars() {
    this.cars = [];
    this.wd.roads.forEach((r, ri) => {
      const total = this.roadLen[ri][this.roadLen[ri].length - 1];
      const n = 1 + Math.floor(total / 9);
      for (let k = 0; k < n; k++) {
        const key = ri * 17 + k;
        this.cars.push({ ri, s: hash(key) * total, v: (1.2 + hash(key + 1) * 1.6) * (k % 2 ? -1 : 1), color: CAR_COLORS[Math.floor(hash(key + 2) * CAR_COLORS.length)], truck: hash(key + 3) < 0.25 });
      }
    });
    const mkCar = (g) => { const im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true }), Math.max(1, this.cars.length)); im.frustumCulled = false; im.count = this.cars.length; this.root.add(im); return im; };
    this.carMesh = mkCar(new THREE.BoxGeometry(0.15, 0.1, 0.3).translate(0, 0.07, 0));
    const c = new THREE.Color();
    this.cars.forEach((car, i) => { c.set(car.color); this.carMesh.setColorAt(i, c); });
    if (this.carMesh.instanceColor) this.carMesh.instanceColor.needsUpdate = true;
    // клубы дыма заводов
    this.puffMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1 }), 400);
    this.puffMesh.frustumCulled = false; this.puffMesh.count = 0;
    this.root.add(this.puffMesh);
    this.updateCars(0);
  }

  updateCars(time) {
    const w = this.wd;
    this.cars.forEach((car, i) => {
      const cum = this.roadLen[car.ri], pts = w.roads[car.ri].pts, total = cum[cum.length - 1];
      let lo = 0, hi = total;
      const bl = this.roadBlocks && this.roadBlocks[car.ri];
      if (bl && bl.length) {
        const s0 = car.s % total;
        for (const b of bl) { if (b < s0) lo = Math.max(lo, b + 0.55); else hi = Math.min(hi, b - 0.55); }
        if (hi - lo < 0.6) hi = lo + 0.6;
      }
      const L = hi - lo;
      let d = ((((car.s % total) - lo) + car.v * time) % (L * 2) + L * 2) % (L * 2);
      if (car.s % total < lo) d = (car.v * time % (L * 2) + L * 2) % (L * 2);
      const dist = lo + (d <= L ? d : L * 2 - d), fwd = d <= L;
      let k = 1; while (k < cum.length - 1 && cum[k] < dist) k++;
      const f = (dist - cum[k - 1]) / ((cum[k] - cum[k - 1]) || 1);
      const ax = pts[k - 1][0], az = pts[k - 1][1], bx = pts[k][0], bz = pts[k][1];
      const tx = bx - ax, tz = bz - az, l = Math.hypot(tx, tz) || 1;
      const side = (fwd ? 1 : -1) * 0.06;
      const x = ax + tx * f - (tz / l) * side, z = az + tz * f + (tx / l) * side;
      this.dummy.position.set(x, surfaceY(w, x, z) + 0.06, z);
      this.dummy.rotation.set(0, Math.atan2(tx, tz) + (fwd ? 0 : Math.PI), 0);
      this.dummy.scale.set(1, 1, car.truck ? 1.5 : 1);
      this.dummy.updateMatrix();
      this.carMesh.setMatrixAt(i, this.dummy.matrix);
    });
    this.carMesh.instanceMatrix.needsUpdate = true;
    // дым
    const src = this.smoke.flat();
    const c = new THREE.Color();
    let n = 0;
    for (let i = 0; i < src.length && n < 400; i++) {
      for (let k = 0; k < 3 && n < 400; k++, n++) {
        const ph = ((time * 0.35 + k / 3 + src[i].ph) % 1);
        this.dummy.position.set(src[i].x + ph * 0.5, src[i].y + ph * 1.9, src[i].z + ph * 0.2);
        this.dummy.rotation.set(ph * 3, ph * 2, 0);
        const sc = (0.06 + ph * 0.17) * (1 - Math.max(0, ph - 0.7) * 3);
        this.dummy.scale.setScalar(Math.max(0.001, sc));
        this.dummy.updateMatrix();
        this.puffMesh.setMatrixAt(n, this.dummy.matrix);
        c.setScalar(src[i].dark ? 0.28 + ph * 0.2 : 0.85 - ph * 0.15);
        this.puffMesh.setColorAt(n, c);
      }
    }
    this.puffMesh.count = n;
    this.puffMesh.instanceMatrix.needsUpdate = true;
    if (this.puffMesh.instanceColor) this.puffMesh.instanceColor.needsUpdate = true;
  }

  // город: сетка кварталов с улицами и домами (порядок — от центра к окраинам)
  cityLayout(p) {
    const w = this.wd;
    const th = hash(p.id * 13 + 2) * Math.PI / 2, ct = Math.cos(th), st = Math.sin(th), S = 0.86;
    const dep = Object.values(p.depositPos || {});
    const blocks = [];
    for (let i = -3; i <= 3; i++) {
      for (let j = -3; j <= 3; j++) {
        const lx = i * S, lz = j * S, d = Math.hypot(lx, lz);
        if (d > 2.75) continue;
        const x = p.x + lx * ct - lz * st, z = p.z + lx * st + lz * ct;
        const hv = gridSample(w.h, x, z);
        if (hv < 0.02 || gridSample(w.river, x, z) > 0.25 || dep.some((q) => Math.hypot(q[0] - x, q[1] - z) < 1.2)) continue;
        blocks.push({ i, j, x, z, d: d + hash(p.id * 7 + i * 5 + j) * 0.25 });
      }
    }
    blocks.sort((a, b) => a.d - b.d);
    const houses = [], edges = [], seen = new Set();
    blocks.forEach((b, bi) => {
      const core = b.d < 1.35, mid = b.d < 2.1;
      const spots = core ? [[-0.17, -0.17], [0.17, 0.17]] : [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]];
      spots.forEach(([ox, oz], k) => {
        const x = b.x + (ox * ct - oz * st), z = b.z + (ox * st + oz * ct);
        const key = p.id * 4000 + bi * 8 + k;
        const hv = gridSample(w.h, x, z);
        houses.push({
          x, z, y: surfaceFromH(hv), rot: -th + (hash(key) < 0.5 ? 0 : Math.PI / 2) * 0, w: core ? 0.3 : mid ? 0.22 + hash(key + 1) * 0.05 : 0.19 + hash(key + 1) * 0.05,
          h: core ? 0.5 + hash(key + 2) * 0.5 : mid ? 0.22 + hash(key + 2) * 0.14 : 0.15 + hash(key + 2) * 0.1,
          wall: core ? TALL[Math.floor(hash(key + 3) * TALL.length)] : WALLS[Math.floor(hash(key + 3) * WALLS.length)], tone: 0.88 + hash(key + 4) * 0.24, tall: core,
        });
      });
      const o = bi * spots.length;
      for (const [a, c2, d2, e2] of [[-1, -1, 1, -1], [-1, 1, 1, 1], [-1, -1, -1, 1], [1, -1, 1, 1]]) {
        const key = `${b.i * 2 + a},${b.j * 2 + c2}-${b.i * 2 + d2},${b.j * 2 + e2}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const pt = (u, v) => [p.x + (u * S / 2) * ct - (v * S / 2) * st, p.z + (u * S / 2) * st + (v * S / 2) * ct];
        edges.push({ a: pt(b.i * 2 + a, b.j * 2 + c2), b: pt(b.i * 2 + d2, b.j * 2 + e2), order: o });
      }
    });
    return { houses, edges };
  }

  houseCount(p) { return Math.max(8, Math.min(120, Math.round(8 + p.pop / 55))); }

  rebuildHouses(counts) {
    for (const m of this.houseMeshes) { this.root.remove(m); m.dispose(); }
    this.houseMeshes = [];
    const { provs, states } = this.g;
    const total = counts.reduce((a, b) => a + b, 0);
    const mk = (g) => {
      const im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9 }), Math.max(1, total));
      im.frustumCulled = false; im.count = total;
      return im;
    };
    const walls = mk(geo('hbox', () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)));
    const roofs = mk(geo('hroof', () => new THREE.ConeGeometry(0.78, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0)));
    const col = new THREE.Color(), base = new THREE.Color();
    let n = 0;
    for (const p of provs) {
      base.set(states[p.owner].color).multiplyScalar(0.75).lerp(new THREE.Color(0x8a4636), 0.45);
      for (let i = 0; i < counts[p.id]; i++, n++) {
        const l = this.layouts[p.id].houses[i];
        this.dummy.position.set(l.x, l.y - 0.02, l.z);
        this.dummy.rotation.set(0, l.rot, 0);
        this.dummy.scale.set(l.w, l.h, l.w);
        this.dummy.updateMatrix(); walls.setMatrixAt(n, this.dummy.matrix);
        col.set(l.wall).multiplyScalar(l.tone); walls.setColorAt(n, col);
        this.dummy.position.y = l.y - 0.02 + l.h;
        if (l.tall) this.dummy.scale.set(l.w * 1.06, 0.05, l.w * 1.06); else this.dummy.scale.set(l.w * 1.2, l.w * 0.75, l.w * 1.2);
        this.dummy.updateMatrix(); roofs.setMatrixAt(n, this.dummy.matrix);
        if (l.tall) col.setHex(0x6e7278); else col.copy(base).multiplyScalar(l.tone);
        roofs.setColorAt(n, col);
      }
    }
    for (const im of [walls, roofs]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; this.root.add(im); this.houseMeshes.push(im); }
  }

  rebuildStreets(counts) {
    if (this.streetMesh) { this.root.remove(this.streetMesh); this.streetMesh.geometry.dispose(); this.streetMesh = null; }
    const acc = newAcc();
    for (const p of this.g.provs) {
      for (const e of this.layouts[p.id].edges) {
        if (e.order >= counts[p.id]) continue;
        addStrip(acc, this.wd, [e.a, e.b], 0.3, 0.05, 0x9b988f); // тротуар
        addStrip(acc, this.wd, [e.a, e.b], 0.19, 0.062, 0x4d5056); // проезжая часть
      }
    }
    this.streetMesh = stripMesh(acc);
    if (this.streetMesh) this.root.add(this.streetMesh);
  }

  signature(p) {
    return p.buildings.map((b) => `${b.type}${b.level}${b.buildLeft > 0 ? 'c' : ''}@${b.x},${b.z}`).join(',') + '|' + DEPOSIT_KINDS.map((k) => (p.deposits[k] ? k[0] : '')).join('') + '|' + p.owner;
  }

  rebuildCity(p) {
    const grp = this.cityGroups[p.id];
    while (grp.children.length) {
      const o = grp.children[0]; grp.remove(o);
      if (o.geometry && o.userData.baked) o.geometry.dispose();
    }
    const st = this.g.states[p.owner];
    const sg = new THREE.Group(), fg = new THREE.Group();
    for (const kind of DEPOSIT_KINDS) {
      const d = p.depositPos && p.depositPos[kind];
      if (!p.deposits[kind] || !d) continue;
      const m = depositModel(kind);
      m.scale.setScalar(p.deposits[kind] > 1 ? 1.5 : 1.2);
      m.position.set(d[0], surfaceY(this.wd, d[0], d[1]), d[1]);
      sg.add(m);
    }
    if (p.capital) {
      const t = new THREE.Group();
      t.add(box(0.7, 0.12, 0.7, 0xd8b04a, 0, 0, 0));
      t.add(box(0.28, 1.0, 0.28, 0xe9e3d3, 0, 0.12, 0));
      t.add(cone(0.26, 0.28, 0xb0392e, 0, 1.12, 0, 4, Math.PI / 4));
      t.add(cyl(0.02, 0.6, 0xe7e7e7, 0, 1.38, 0, 6));
      t.add(box(0.5, 0.28, 0.025, HEX(st.color), 0.27, 1.65, 0));
      t.position.set(p.x, surfaceY(this.wd, p.x, p.z), p.z);
      sg.add(t);
    }
    const smoke = [];
    p.buildings.forEach((b) => {
      const y = surfaceY(this.wd, b.x, b.z);
      const m = new THREE.Group();
      if (b.level > 0) m.add(MODELS[b.type](b.level));
      m.position.set(b.x, y, b.z); m.rotation.y = -Math.atan2(b.z - p.z, b.x - p.x) + Math.PI / 2; m.scale.setScalar(BSCALE);
      sg.add(m);
      m.updateMatrixWorld(true);
      if (b.level > 0 && b.buildLeft === 0 && (b.eff ?? 1) > 0.05) {
        const model = m.children[0];
        for (const q of (model && model.userData.smoke) || []) {
          const v = new THREE.Vector3(q[0], q[1], q[2]); m.localToWorld(v);
          smoke.push({ x: v.x, y: v.y, z: v.z, ph: hash(b.x * 7 + q[0] * 13), dark: b.type === 'refinery' || b.type === 'steelworks' });
        }
      }
      if (b.buildLeft > 0) {
        const sc = scaffold();
        if (b.level > 0) sc.position.set(0.18, 0, 0.18);
        const wrap = new THREE.Group();
        wrap.add(sc);
        wrap.position.set(b.x, y, b.z); wrap.scale.setScalar(BSCALE);
        fg.add(wrap);
      }
    });
    this.smoke[p.id] = smoke;
    const baked = bake(sg);
    if (baked) { baked.userData.baked = true; grp.add(baked); }
    grp.add(fg);
  }

  sync() {
    const { provs } = this.g;
    if (this.g.dip && this.g.dip.rev !== this.dipRev) this.updateCheckpoints();
    if (this.cps && this.cps.length && this.applyArms()) this.dirty = true;
    for (const p of provs) {
      const s = this.signature(p);
      if (s !== this.sig[p.id]) { this.sig[p.id] = s; this.rebuildCity(p); }
    }
    const counts = provs.map((p) => Math.min(this.layouts[p.id].houses.length, this.houseCount(p)));
    const hs = counts.join(',') + provs.map((p) => p.owner).join('');
    if (hs !== this.hsig) {
      this.hsig = hs; this.rebuildHouses(counts);
      const ss = provs.map((p) => this.layouts[p.id].edges.filter((e) => e.order < counts[p.id]).length).join(',');
      if (ss !== this.ssig) { this.ssig = ss; this.rebuildStreets(counts); }
    }
  }

  // ---- призрак постройки, булавки месторождений ----
  setGhost(type, x, z, ok) {
    if (!type) { this.ghost.visible = false; this.ghostType = null; this.dirty = true; return; }
    if (this.ghostType !== type) {
      if (this.ghostModel) this.ghost.remove(this.ghostModel);
      this.ghostModel = new THREE.Group();
      const mdl = MODELS[type](1);
      mdl.scale.setScalar(BSCALE);
      this.ghostModel.add(mdl);
      this.ghost.add(this.ghostModel);
      this.ghostType = type;
    }
    const y = surfaceY(this.wd, x, z);
    this.ghost.position.set(x, y, z);
    const c = ok ? 0x4cd964 : 0xff5a5a;
    this.ghostDisc.material.color.setHex(c); this.ghostRing.material.color.setHex(c);
    this.ghostDisc.scale.setScalar(1.15); this.ghostRing.scale.setScalar(1.15);
    this.ghostDisc.position.y = 0.12; this.ghostRing.position.y = 0.12;
    this.ghostModel.visible = true;
    this.ghost.visible = true;
    this.dirty = true;
  }

  setPins(mode) { this.pinMode = mode; this.dirty = true; }

  // ---- подписи городов (HTML поверх карты) ----
  buildLabels() {
    if (!this.labelsEl) { this.labels = null; this.pins = null; return; }
    this.labelsEl.innerHTML = '';
    this.labels = this.g.provs.map(() => {
      const el = document.createElement('div');
      el.className = 'clabel';
      this.labelsEl.appendChild(el);
      return { el, text: '', vis: false };
    });
    this.pins = [];
    for (const p of this.g.provs) {
      for (const kind of DEPOSIT_KINDS) {
        const d = p.depositPos && p.depositPos[kind];
        if (!p.deposits[kind] || !d) continue;
        const el = document.createElement('div');
        el.className = 'dpin ' + kind;
        el.textContent = DEPOSITS[kind].icon;
        el.style.display = 'none';
        this.labelsEl.appendChild(el);
        this.pins.push({ el, p, kind, x: d[0], z: d[1], vis: false });
      }
    }
  }

  updateLabels() {
    if (!this.labels) return;
    const { provs, states, playerState } = this.g;
    const close = this.cam.dist < this.fitDist * 0.55;
    const v = this.tmpV;
    for (const p of provs) {
      const L = this.labels[p.id];
      const show = p.owner === playerState || p.capital || this.cam.dist < this.fitDist * 0.75 || p.id === this.sel;
      let vis = false;
      if (show) {
        v.set(p.x, surfaceY(this.wd, p.x, p.z) + 1.9, p.z).project(this.camera);
        if (v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05) {
          vis = true;
          L.el.style.transform = `translate(-50%,-100%) translate(${((v.x + 1) / 2) * this.w}px,${((1 - v.y) / 2) * this.h}px)`;
        }
      }
      if (vis !== L.vis) { L.vis = vis; L.el.style.display = vis ? '' : 'none'; }
      if (!vis) continue;
      const text = `${p.capital ? '★ ' : ''}${p.name}${close ? ' · ' + Math.round(p.pop / 100) / 10 + 'k' : ''}`;
      const cls = 'clabel' + (p.id === this.sel ? ' sel' : '') + (p.owner === playerState ? ' mine' : '');
      if (L.text !== text + cls) {
        L.text = text + cls; L.el.textContent = text; L.el.className = cls; L.el.style.setProperty('--c', states[p.owner].color);
      }
    }
    for (const pin of this.pins || []) {
      let vis = false;
      const m = this.pinMode;
      if (m && (m === 'all' || m === pin.kind)) {
        v.set(pin.x, surfaceY(this.wd, pin.x, pin.z) + 1.2, pin.z).project(this.camera);
        if (v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05) {
          vis = true;
          pin.el.style.transform = `translate(-50%,-100%) translate(${((v.x + 1) / 2) * this.w}px,${((1 - v.y) / 2) * this.h}px)`;
          const mine = pin.p.owner === playerState;
          const used = pin.p.buildings.some((b) => b.type === DEPOSITS[pin.kind].building);
          const cls = `dpin ${pin.kind}${mine ? ' mine' : ''}${used ? ' used' : ''}`;
          if (pin.cls !== cls) { pin.cls = cls; pin.el.className = cls; pin.el.style.setProperty('--c', states[pin.p.owner].color); }
        }
      }
      if (vis !== pin.vis) { pin.vis = vis; pin.el.style.display = vis ? '' : 'none'; }
    }
  }

  // ---- камера ----
  updateCamera() {
    const { tx, tz, yaw, pitch, dist } = this.cam;
    const cp = Math.cos(pitch);
    this.camera.position.set(tx + Math.sin(yaw) * cp * dist, Math.sin(pitch) * dist + 1, tz + Math.cos(yaw) * cp * dist);
    this.camera.lookAt(tx, 1, tz);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  clampCam() {
    const lim = HALF * 0.9;
    this.cam.tx = Math.max(-lim, Math.min(lim, this.cam.tx));
    this.cam.tz = Math.max(-lim, Math.min(lim, this.cam.tz));
    this.cam.dist = Math.min(this.fitDist * 1.15, Math.max(4, this.cam.dist));
  }

  fit() {
    const aspect = this.w / this.h;
    const fov = this.camera.fov * DEG;
    const fovH = 2 * Math.atan(Math.tan(fov / 2) * aspect);
    const fmin = Math.min(fov, fovH);
    this.fitDist = (this.radius / Math.sin(fmin / 2)) * 0.74;
    this.cam.tx = 0; this.cam.tz = 0; this.cam.yaw = 0; this.cam.pitch = 0.95;
    this.cam.dist = this.fitDist;
    this.dirty = true;
  }

  focus(p, zoom = 0.3) { this.focusAt(p.x, p.z, Math.max(14, this.fitDist * zoom)); }

  focusAt(x, z, dist) {
    this.cam.dist = Math.min(this.cam.dist, dist);
    const k = this.cam.dist * 0.1;
    this.cam.tx = x + Math.sin(this.cam.yaw) * k;
    this.cam.tz = z + Math.cos(this.cam.yaw) * k;
    this.clampCam();
    this.dirty = true;
  }

  select(id) {
    this.sel = id;
    if (id >= 0) {
      const p = this.g.provs[id];
      this.selData.set(paintSelection(this.wd, id));
      this.selTex.needsUpdate = true;
      this.selMesh.visible = true;
      this.ring.position.set(p.x, surfaceY(this.wd, p.x, p.z) + 0.1, p.z);
      this.ring.scale.setScalar(2.9);
      this.ring.visible = true;
    } else {
      this.selMesh.visible = false;
      this.ring.visible = false;
    }
    this.dirty = true;
  }

  resize() {
    if (!this.c) return;
    const r = this.c.getBoundingClientRect();
    this.w = Math.max(1, Math.floor(r.width));
    this.h = Math.max(1, Math.floor(r.height));
    if (this.renderer) {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(this.w, this.h, false);
    }
    this.dirty = true;
  }

  groundAt(px, py) {
    this.raycaster.setFromCamera(new THREE.Vector2((px / this.w) * 2 - 1, -(py / this.h) * 2 + 1), this.camera);
    return this.raycaster.ray.intersectPlane(this.plane, this.tmpV) ? this.tmpV.clone() : null;
  }

  // что под пальцем: { x, z, land, id } (id — провинция, -1 в море)
  pick(px, py) {
    this.raycaster.setFromCamera(new THREE.Vector2((px / this.w) * 2 - 1, -(py / this.h) * 2 + 1), this.camera);
    const res = this.raycaster.intersectObject(this.terrain, false);
    if (!res.length) return null;
    const { x, z } = res[0].point;
    const land = gridSample(this.wd.h, x, z) > 0.004;
    return { x, z, land, id: land ? territoryAt(this.wd, x, z)[0] : -1 };
  }

  hit(px, py) { const r = this.pick(px, py); return r ? r.id : -1; }

  // ---- жесты ----
  bind() {
    const c = this.c;
    c.style.touchAction = 'none';
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    const local = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      const l = local(e);
      this.pointers.set(e.pointerId, { ...l, btn: e.button });
      this.updateCamera();
      this.tap = this.pointers.size === 1 ? { ...l, t: performance.now(), moved: false } : null;
      this.pinch = null;
    });
    c.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const l = local(e);
      if (this.pointers.size === 1) {
        if (this.tap && Math.hypot(l.x - this.tap.x, l.y - this.tap.y) > 8) this.tap.moved = true;
        if (prev.btn === 2) { // правая кнопка: вращение
          this.cam.yaw -= (l.x - prev.x) * 0.008;
          this.cam.pitch = Math.min(1.3, Math.max(0.5, this.cam.pitch + (l.y - prev.y) * 0.005));
        } else if (this.tap && this.tap.moved) {
          const a = this.groundAt(prev.x, prev.y);
          const b = this.groundAt(l.x, l.y);
          if (a && b) { this.cam.tx += a.x - b.x; this.cam.tz += a.z - b.z; }
        }
        this.pointers.set(e.pointerId, { ...l, btn: prev.btn });
        this.clampCam();
        this.dirty = true;
      } else if (this.pointers.size === 2) {
        this.pointers.set(e.pointerId, { ...l, btn: prev.btn });
        const [p1, p2] = [...this.pointers.values()];
        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
        if (this.pinch) {
          const a = this.groundAt(this.pinch.mx, this.pinch.my);
          this.cam.dist *= this.pinch.dist / dist;
          this.clampCam();
          let da = ang - this.pinch.ang;
          if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
          this.cam.yaw -= da;
          this.updateCamera();
          const b = this.groundAt(mx, my);
          if (a && b) { this.cam.tx += a.x - b.x; this.cam.tz += a.z - b.z; }
          this.clampCam();
        }
        this.pinch = { dist, ang, mx, my };
        if (this.tap) this.tap.moved = true;
        this.dirty = true;
      }
    });
    const up = (e) => {
      const had = this.pointers.delete(e.pointerId);
      this.pinch = null;
      if (had && this.tap && !this.tap.moved && performance.now() - this.tap.t < 500 && this.pointers.size === 0) {
        const l = local(e);
        this.updateCamera();
        this.onTap(this.pick(l.x, l.y));
      }
      if (this.pointers.size === 0) this.tap = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cam.dist *= e.deltaY < 0 ? 0.9 : 1.1;
      this.clampCam();
      this.dirty = true;
    }, { passive: false });
  }

  draw() {
    this.sync();
    // «жизнь» на карте (машины, дым) крутится, пока камера близко
    const now = typeof performance !== 'undefined' ? performance.now() / 1000 : 0;
    this.animating = !this.headless && this.cam.dist < this.fitDist * 0.62;
    if (this.animating || !this.animStarted) { this.animStarted = true; this.updateCars(this.animating ? now : this.lastAnim || 0); if (this.animating) this.lastAnim = now; }
    this.updateCamera();
    this.updateLabels();
    if (this.renderer) this.renderer.render(this.scene, this.camera);
    this.dirty = this.animating;
  }
}
