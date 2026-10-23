// 3D-карта на Three.js: цельный рельеф с текстурой, леса, дома, здания, подписи городов,
// камера с жестами. Сцена строится без WebGL, поэтому её можно проверять в node (режим headless).
import * as THREE from './vendor/three.min.js';
import { levelOf } from './sim.js';
import {
  CELL, HEIGHT_SCALE, WORLD, fromGrid, gridSample, provAt, surfaceFromH, surfaceY, territoryAt,
} from './world.js';
import { SEL_TEX, TEX, paintSelection, paintTerrain } from './terrain.js';

const { SZ, HALF } = WORLD;
const DEG = Math.PI / 180;
const SLOT_ANGLES = [-60, 0, 60, 120, 180, 240].map((a) => a * DEG);
const RING_R = 3.5;
const BSCALE = 2.2; // масштаб моделей зданий

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
function modelHousing(level) {
  const g = new THREE.Group();
  const pos = [[-0.09, -0.07], [0.09, -0.05], [-0.02, 0.1], [0.11, 0.1]];
  for (let i = 0; i < 1 + level; i++) {
    const [x, z] = pos[i];
    const w = 0.13 + 0.02 * (i % 2), h = 0.1 + 0.03 * level;
    g.add(box(w, h, w, 0xcfc8b8, x, 0, z));
    g.add(cone(w * 0.78, 0.07, 0x9c4a3c, x, h, z, 4, Math.PI / 4));
  }
  return g;
}
function modelMine(level) {
  const g = new THREE.Group();
  g.add(box(0.36, 0.05, 0.3, 0x4a4338, 0, 0, 0));
  const hh = 0.26 + 0.05 * level;
  g.add(box(0.035, hh, 0.035, 0x7d6849, -0.06, 0.05, 0));
  g.add(box(0.035, hh, 0.035, 0x7d6849, 0.06, 0.05, 0));
  g.add(box(0.2, 0.03, 0.03, 0x7d6849, 0, 0.05 + hh, 0));
  const wheel = cyl(0.05, 0.02, 0xc9b27a, 0, 0.05 + hh - 0.01, 0.03, 12);
  wheel.rotation.x = Math.PI / 2; g.add(wheel);
  g.add(cone(0.1 + 0.025 * level, 0.1 + 0.03 * level, 0x5b4a3a, 0.11, 0.05, 0.08, 7));
  return g;
}
function modelRefinery(level) {
  const g = new THREE.Group();
  g.add(box(0.38, 0.03, 0.3, 0x59626b, 0, 0, 0));
  for (let i = 0; i < 1 + level; i++) {
    g.add(cyl(0.065, 0.14 + 0.03 * (i % 2), 0xe3e8ec, -0.12 + i * 0.12, 0.03, -0.06));
  }
  g.add(cyl(0.012, 0.36, 0x707880, 0.14, 0.03, 0.08, 6));
  g.add(cone(0.025, 0.06, 0xd9562b, 0.14, 0.39, 0.08, 6));
  g.add(box(0.28, 0.025, 0.03, 0x8d949b, 0, 0.1, 0.04));
  return g;
}
function modelPower(level) {
  const g = new THREE.Group();
  g.add(box(0.32, 0.12, 0.22, 0x9aa4ae, -0.03, 0, 0.03));
  g.add(box(0.32, 0.02, 0.22, 0x5a6670, -0.03, 0.12, 0.03));
  for (let i = 0; i < Math.min(level, 2) + 1; i++) {
    const x = 0.1 + i * 0.07, h = 0.34 + 0.04 * level;
    g.add(cyl(0.032, h, 0xd5d7de, x, 0, -0.1, 10));
    g.add(cyl(0.034, 0.05, 0xb0392e, x, h - 0.06, -0.1, 10));
  }
  g.add(frustum(0.08, 0.2, 0xb7bcc4, -0.13, 0.12, -0.11));
  return g;
}
function modelElectronics(level) {
  const g = new THREE.Group();
  g.add(box(0.4, 0.09, 0.27, 0xb4bcc5, 0, 0, 0));
  for (let i = 0; i < 3; i++) g.add(box(0.09, 0.03, 0.2, 0x5fa3d9, -0.12 + i * 0.12, 0.09, 0));
  if (level > 1) g.add(box(0.3, 0.07, 0.2, 0xaab3bc, 0, 0.09, 0));
  if (level > 2) g.add(cyl(0.025, 0.2, 0x8a939c, 0.17, 0.09, 0.1, 8));
  g.add(box(0.06, 0.07, 0.06, 0x3b4652, -0.18, 0, 0.14));
  return g;
}
const MODELS = { housing: modelHousing, mine: modelMine, refinery: modelRefinery, power: modelPower, electronics: modelElectronics };

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

// ---------- 3D-карта ----------
export class MapView {
  constructor(canvas, game, opts = {}) {
    this.c = canvas;
    this.headless = !canvas || !!opts.headless;
    this.labelsEl = opts.labels || null;
    this.texSize = opts.texSize || 0;
    this.sel = -1;
    this.onSelect = () => {};
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
    this.setGame(game);
  }

  // ---- построение мира ----
  setGame(game) {
    this.g = game;
    const world = game.world;
    this.wd = world;
    if (this.root) {
      this.scene.remove(this.root);
      this.root.traverse((o) => { if (o.geometry && o.geometry !== bakedMat) o.geometry.dispose?.(); if (o.isInstancedMesh) o.dispose(); });
    }
    this.root = new THREE.Group();
    this.scene.add(this.root);
    const provs = game.provs;
    this.radius = HALF * 0.9;

    this.buildTerrain();
    this.buildTrees();

    // выделение провинции и кольцо вокруг города
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

    // города: контейнеры с постройками + дома (instanced)
    this.cityGroups = provs.map(() => { const grp = new THREE.Group(); this.root.add(grp); return grp; });
    this.layouts = provs.map((p) => this.houseLayout(p));
    this.sig = provs.map(() => '');
    this.hsig = '';
    this.houseMeshes = [];
    this.buildLabels();
    this.sync();

    this.fit();
    this.select(-1);
  }

  buildTerrain() {
    const SEG = 200;
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
    const px = paintTerrain(this.wd, this.g.states.map((s) => s.color), size);
    const tex = new THREE.DataTexture(new Uint8Array(px.buffer), size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
    if (this.renderer) tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    tex.needsUpdate = true;
    this.terrainTex = tex;
    this.terrain = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ map: tex }));
    this.root.add(this.terrain);
  }

  buildTrees() {
    const w = this.wd;
    const pines = [], oaks = [], peaks = [];
    const STEP = 0.46;
    for (let gz = 0; gz < SZ / STEP; gz++) {
      for (let gx = 0; gx < SZ / STEP; gx++) {
        const k = gz * 1000 + gx;
        const x = -HALF + (gx + hash(k) * 0.9) * STEP, z = -HALF + (gz + hash(k + 0.5) * 0.9) * STEP;
        const hv = gridSample(w.h, x, z);
        if (hv > 0.012 && hv < 0.3) {
          const f = gridSample(w.forest, x, z);
          if (f > 0.16 && hash(k + 3) < f * 0.95 && pines.length + oaks.length < 7500) {
            const s = 0.75 + hash(k + 7) * 0.7;
            const t = { x, z, y: surfaceFromH(hv), s, c: hash(k + 11) };
            if (hv > 0.14 || hash(k + 13) < 0.38) pines.push(t); else oaks.push(t);
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
    mk(new THREE.ConeGeometry(0.42, 1, 5), peaks, 200, [0x8b8479, 0x9b958a, 0x7a746c, 0xa7a8ac, 0xe8eaee], 1, 1.5, 0.4);
    this.treeCount = pines.length + oaks.length;
  }

  // раскладка домов вокруг города (спираль), только по суше
  houseLayout(p) {
    const w = this.wd, out = [];
    const dep = Object.values(p.depositPos || {});
    for (let i = 0; out.length < 64 && i < 200; i++) {
      const ang = i * 2.39996 + hash(p.id * 31) * 6, r = 0.4 * Math.sqrt(i + 0.7) * (0.9 + hash(p.id * 97 + i) * 0.25);
      const x = p.x + Math.cos(ang) * r, z = p.z + Math.sin(ang) * r;
      const hv = gridSample(w.h, x, z);
      if (hv < 0.018 || gridSample(w.river, x, z) > 0.25) continue;
      if (dep.some((d) => Math.hypot(d[0] - x, d[1] - z) < 0.9)) continue;
      const k = p.id * 1000 + i;
      out.push({
        x, z, y: surfaceFromH(hv), rot: hash(k) * 3.14, w: 0.26 + hash(k + 1) * 0.14, h: 0.2 + hash(k + 2) * 0.18,
        wall: WALLS[Math.floor(hash(k + 3) * WALLS.length)], tone: 0.85 + hash(k + 4) * 0.3, tall: i < 7 && hash(k + 5) < 0.45,
      });
    }
    return out;
  }

  houseCount(p) { return Math.max(6, Math.min(64, Math.round(6 + p.pop / 90))); }

  rebuildHouses() {
    for (const m of this.houseMeshes) { this.root.remove(m); m.dispose(); }
    this.houseMeshes = [];
    const { provs, states } = this.g;
    const counts = provs.map((p) => Math.min(this.layouts[p.id].length, this.houseCount(p)));
    const total = counts.reduce((a, b) => a + b, 0);
    const mk = (g, shadeFn) => {
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
        const l = this.layouts[p.id][i];
        const hh = l.tall ? l.h * 2.3 : l.h;
        this.dummy.position.set(l.x, l.y - 0.02, l.z);
        this.dummy.rotation.set(0, l.rot, 0);
        this.dummy.scale.set(l.w, hh, l.w);
        this.dummy.updateMatrix(); walls.setMatrixAt(n, this.dummy.matrix);
        col.set(l.wall).multiplyScalar(l.tone); walls.setColorAt(n, col);
        this.dummy.position.y = l.y - 0.02 + hh;
        this.dummy.scale.set(l.w * 1.18, l.tall ? 0.0001 : l.w * 0.8, l.w * 1.18);
        this.dummy.updateMatrix(); roofs.setMatrixAt(n, this.dummy.matrix);
        col.copy(base).multiplyScalar(l.tone); roofs.setColorAt(n, col);
      }
    }
    for (const im of [walls, roofs]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; this.root.add(im); this.houseMeshes.push(im); }
  }

  // место здания: рудник/НПЗ — у месторождения, остальные — кольцом вокруг города
  buildingSpot(p, b, i, used) {
    const w = this.wd;
    const near = (type) => {
      const d = p.depositPos && p.depositPos[type];
      if (!d) return null;
      const k = used.filter((u) => u.type === b.type).length;
      return { x: d[0] + 1.3 + k * 1.1, z: d[1] + 0.6 - k * 0.5, ang: 0 };
    };
    if (b.type === 'mine') { const s = near('steel'); if (s) return s; }
    if (b.type === 'refinery') { const s = near('oil'); if (s) return s; }
    const a0 = SLOT_ANGLES[i % SLOT_ANGLES.length] + (Math.floor(i / 6) * 0.5);
    for (const dr of [0, 0.6, -0.6, 1.2]) {
      for (const da of [0, 20, -20, 40, -40, 60, -60, 90, -90]) {
        const a = a0 + da * DEG, r = RING_R + dr;
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        const hv = gridSample(w.h, x, z);
        if (hv < 0.025 || hv > 0.26 || gridSample(w.river, x, z) > 0.2) continue;
        if (used.some((u) => Math.hypot(u.x - x, u.z - z) < 1.5)) continue;
        return { x, z, ang: a };
      }
    }
    return { x: p.x + Math.cos(a0) * RING_R, z: p.z + Math.sin(a0) * RING_R, ang: a0 };
  }

  signature(p) {
    return p.buildings.map((b) => `${b.type}${b.level}${b.buildLeft > 0 ? 'c' : ''}`).join(',') + '|' + (p.deposits.steel ? 's' : '') + (p.deposits.oil ? 'o' : '') + '|' + p.owner;
  }

  rebuildCity(p) {
    const grp = this.cityGroups[p.id];
    while (grp.children.length) {
      const o = grp.children[0]; grp.remove(o);
      if (o.geometry && o.userData.baked) o.geometry.dispose();
    }
    const st = this.g.states[p.owner];
    const sg = new THREE.Group(), fg = new THREE.Group();
    // месторождения
    for (const kind of ['steel', 'oil']) {
      const d = p.depositPos && p.depositPos[kind];
      if (!p.deposits[kind] || !d) continue;
      const m = depositModel(kind);
      m.scale.setScalar(p.deposits[kind] > 1 ? 1.5 : 1.2);
      m.position.set(d[0], surfaceY(this.wd, d[0], d[1]), d[1]);
      sg.add(m);
    }
    // столица: башня с флагом
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
    // здания
    const used = [];
    p.buildings.forEach((b, i) => {
      const s = this.buildingSpot(p, b, i, used);
      used.push({ ...s, type: b.type });
      const y = surfaceY(this.wd, s.x, s.z);
      const m = new THREE.Group();
      if (b.level > 0) m.add(MODELS[b.type](b.level));
      m.position.set(s.x, y, s.z); m.rotation.y = -s.ang + Math.PI / 2; m.scale.setScalar(BSCALE);
      sg.add(m);
      if (b.buildLeft > 0) {
        const sc = scaffold();
        if (b.level > 0) sc.position.set(0.18, 0, 0.18);
        const wrap = new THREE.Group();
        wrap.add(sc);
        wrap.position.set(s.x, y, s.z); wrap.scale.setScalar(BSCALE);
        fg.add(wrap);
      }
    });
    const baked = bake(sg);
    if (baked) { baked.userData.baked = true; grp.add(baked); }
    grp.add(fg);
  }

  sync() {
    const { provs } = this.g;
    for (const p of provs) {
      const s = this.signature(p);
      if (s !== this.sig[p.id]) { this.sig[p.id] = s; this.rebuildCity(p); }
    }
    const hs = provs.map((p) => this.houseCount(p) + ':' + p.owner).join(',');
    if (hs !== this.hsig) { this.hsig = hs; this.rebuildHouses(); }
  }

  // ---- подписи городов (HTML поверх карты) ----
  buildLabels() {
    if (!this.labelsEl) { this.labels = null; return; }
    this.labelsEl.innerHTML = '';
    this.labels = this.g.provs.map((p) => {
      const el = document.createElement('div');
      el.className = 'clabel';
      this.labelsEl.appendChild(el);
      return { el, text: '', vis: false };
    });
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
    this.cam.dist = Math.min(this.fitDist * 1.15, Math.max(5, this.cam.dist));
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

  focus(p, zoom = 0.3) {
    this.cam.dist = Math.min(this.cam.dist, Math.max(14, this.fitDist * zoom));
    const k = this.cam.dist * 0.1;
    this.cam.tx = p.x + Math.sin(this.cam.yaw) * k;
    this.cam.tz = p.z + Math.cos(this.cam.yaw) * k;
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
      this.ring.scale.setScalar(2.6);
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

  // какой город (провинция) под пальцем
  hit(px, py) {
    this.raycaster.setFromCamera(new THREE.Vector2((px / this.w) * 2 - 1, -(py / this.h) * 2 + 1), this.camera);
    const res = this.raycaster.intersectObject(this.terrain, false);
    if (!res.length) return -1;
    const { x, z } = res[0].point;
    if (gridSample(this.wd.h, x, z) <= 0.004) return -1;
    return territoryAt(this.wd, x, z)[0];
  }

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
        this.onSelect(this.hit(l.x, l.y));
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
    this.updateCamera();
    this.updateLabels();
    if (this.renderer) this.renderer.render(this.scene, this.camera);
    this.dirty = false;
  }
}
