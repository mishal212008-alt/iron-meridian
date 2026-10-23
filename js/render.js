// 3D-карта на Three.js: объёмные гексы-провинции, модели зданий, камера с жестами.
// Сцена строится без WebGL, поэтому её можно проверять в node (режим headless).
import * as THREE from './vendor/three.min.js';
import { TERRAIN } from './data.js';
import { levelOf } from './sim.js';

const S3 = Math.sqrt(3);
const DEG = Math.PI / 180;
const TILE_H = { plains: 0.35, coast: 0.25, hills: 0.7, mountains: 1.15 };
const BASE = -0.25; // низ плиток уходит под воду
const DIRS_EVEN = [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]];
const DIRS_ODD = [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]];
const SLOT_ANGLES = [-60, 0, 60, 120, 180, 240].map((a) => a * DEG);

const hash = (n) => { const x = Math.sin(n * 12.9898 + 4.1) * 43758.5453; return x - Math.floor(x); };

// ---------- простые «кирпичики» моделей (общие геометрии и материалы) ----------
const geoCache = {};
const geo = (k, f) => (geoCache[k] ||= f());
const matCache = {};
const mat = (hex, extra = {}) => (matCache[hex + JSON.stringify(extra)] ||= new THREE.MeshStandardMaterial({
  color: hex, flatShading: true, roughness: 0.85, metalness: 0.05, ...extra,
}));

function mesh(g, m, x, y, z) { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; return o; }
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

function cityModel(p, st) {
  const g = new THREE.Group();
  const lvl = levelOf(p.pop);
  const n = [4, 7, 10][lvl];
  const walls = [0xdcd5c4, 0xcdc3ae, 0xbab1a0, 0xe5dfd0];
  const roofs = [0x9c4a3c, 0x6e7f8f, 0x8a6f5a];
  for (let i = 0; i < n; i++) {
    const a = i * 137.5 * DEG, r = 0.13 + 0.04 * Math.pow(i, 0.85);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const tall = lvl === 2 && i > 6;
    const h = tall ? 0.22 + hash(p.id * 7 + i) * 0.1 : 0.07 + hash(p.id * 13 + i) * 0.07;
    const w = tall ? 0.09 : 0.075;
    g.add(box(w, h, w, walls[Math.floor(hash(p.id + i * 3) * walls.length)], x, 0, z));
    if (!tall) g.add(cone(w * 0.8, 0.05, roofs[Math.floor(hash(p.id * 5 + i) * roofs.length)], x, h, z, 4, Math.PI / 4));
  }
  if (p.capital) {
    g.add(box(0.12, 0.04, 0.12, 0xd8b04a, 0, 0, 0));
    g.add(cyl(0.01, 0.5, 0xe7e7e7, 0, 0.04, 0, 6));
    const flag = box(0.2, 0.11, 0.012, new THREE.Color(st.color).getHex(), 0.1, 0.4, 0);
    g.add(flag);
  }
  return g;
}

function depositModel(p) {
  const g = new THREE.Group();
  if (p.deposits.steel) {
    const m = new THREE.Mesh(geo('rock', () => new THREE.IcosahedronGeometry(1, 0)), mat(0x7a6f64));
    m.scale.set(0.1, 0.08, 0.09); m.position.set(-0.05, 0.05, 0); m.castShadow = true; g.add(m);
    const m2 = new THREE.Mesh(geo('rock', () => new THREE.IcosahedronGeometry(1, 0)), mat(0xd98e3f, { emissive: 0x4a2a08 }));
    m2.scale.set(0.05, 0.05, 0.05); m2.position.set(0.06, 0.04, 0.03); g.add(m2);
  }
  if (p.deposits.oil) {
    const off = p.deposits.steel ? 0.2 : 0;
    g.add(cyl(0.1, 0.012, 0x15151b, off, 0, 0, 16));
    g.add(cyl(0.012, 0.16, 0x2a2a30, off + 0.03, 0, 0, 6));
    g.add(box(0.12, 0.015, 0.02, 0x2a2a30, off + 0.03, 0.15, 0));
  }
  return g;
}

// ---------- 3D-карта ----------
export class MapView {
  constructor(canvas, game, opts = {}) {
    this.c = canvas;
    this.headless = !canvas || !!opts.headless;
    this.sel = -1;
    this.onSelect = () => {};
    this.dirty = true;
    this.w = opts.width || 390;
    this.h = opts.height || 560;
    this.shadows = opts.shadows ?? false;
    this.pointers = new Map();
    this.cam = { tx: 0, tz: 0, yaw: 0, pitch: 0.95, dist: 30 };
    this.fitDist = 30;
    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.4);
    this.tmpV = new THREE.Vector3();
    this.tmpM = new THREE.Matrix4();
    this.dummy = new THREE.Object3D();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1824);
    this.camera = new THREE.PerspectiveCamera(40, this.w / this.h, 0.5, 400);

    const hemi = new THREE.HemisphereLight(0xd5e6ff, 0x2b3b2c, 1.0);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d4, 1.9);
    this.sun.position.set(-9, 16, 7);
    this.sun.shadow.camera.left = -14; this.sun.shadow.camera.right = 14;
    this.sun.shadow.camera.top = 14; this.sun.shadow.camera.bottom = -14;
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 50;
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun);

    const sea = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x163a56, roughness: 0.35, metalness: 0.15 }));
    sea.rotation.x = -Math.PI / 2; sea.position.y = 0;
    sea.receiveShadow = true;
    this.scene.add(sea);

    this.ring = new THREE.Mesh(
      (() => { const r = new THREE.RingGeometry(0.86, 0.98, 6); r.rotateZ(30 * DEG); r.rotateX(-Math.PI / 2); return r; })(),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    this.ring.visible = false;
    this.scene.add(this.ring);

    if (!this.headless) {
      try {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      } catch (e) {
        this.webglError = e; // у устройства нет WebGL: логика игры работает, рисовать нечем
        this.headless = true;
      }
      this.bind();
      this.resize();
    }
    this.setShadows(this.shadows);
    this.setGame(game);
  }

  setShadows(on) {
    this.shadows = !!on;
    this.sun.castShadow = this.shadows;
    if (this.renderer) {
      this.renderer.shadowMap.enabled = this.shadows;
      this.sun.shadow.mapSize.set(this.shadows ? 2048 : 512, this.shadows ? 2048 : 512);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    this.dirty = true;
  }

  // ---- построение мира ----
  setGame(game) {
    this.g = game;
    if (this.world) {
      this.scene.remove(this.world);
      this.world.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
    }
    this.world = new THREE.Group();
    this.scene.add(this.world);
    const provs = game.provs;

    // позиции, центрируем карту
    const raw = provs.map((p) => ({ x: S3 * (p.col + 0.5 * (p.row & 1)), z: 1.5 * p.row }));
    const minX = Math.min(...raw.map((r) => r.x)), maxX = Math.max(...raw.map((r) => r.x));
    const minZ = Math.min(...raw.map((r) => r.z)), maxZ = Math.max(...raw.map((r) => r.z));
    const ox = (minX + maxX) / 2, oz = (minZ + maxZ) / 2;
    this.pos = provs.map((p, i) => ({ x: raw[i].x - ox, z: raw[i].z - oz, top: TILE_H[p.terrain] }));
    this.cell = new Map();
    for (const p of provs) this.cell.set(p.row * game.cols + p.col, p);
    this.radius = Math.max(...this.pos.map((q) => Math.hypot(q.x, q.z))) + 1.2;

    // плитки (один instanced mesh)
    this.tiles = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.97, 0.97, 1, 6),
      new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9 }),
      provs.length,
    );
    this.tiles.receiveShadow = true;
    const tmpC = new THREE.Color();
    provs.forEach((p, i) => {
      const q = this.pos[i];
      const H = q.top - BASE;
      this.dummy.position.set(q.x, BASE + H / 2, q.z);
      this.dummy.scale.set(1, H, 1);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.tiles.setMatrixAt(i, this.dummy.matrix);
      tmpC.set(TERRAIN[p.terrain].color).lerp(new THREE.Color(game.states[p.owner].color), 0.5);
      this.tiles.setColorAt(i, tmpC);
    });
    this.tiles.instanceMatrix.needsUpdate = true;
    this.tiles.instanceColor.needsUpdate = true;
    this.tiles.computeBoundingSphere();
    this.world.add(this.tiles);

    // границы государств: низкие стенки на рёбрах
    const walls = [];
    for (const p of provs) {
      const dirs = p.row & 1 ? DIRS_ODD : DIRS_EVEN;
      for (let i = 0; i < 6; i++) {
        const n = this.cell.get((p.row + dirs[i][1]) * game.cols + (p.col + dirs[i][0]));
        if (!n || n.owner === p.owner || n.id < p.id) continue;
        walls.push({ p, n, i });
      }
    }
    this.borders = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x0d1117, roughness: 0.8 }), Math.max(1, walls.length));
    this.borders.castShadow = true;
    walls.forEach((w, k) => {
      const a = this.pos[w.p.id], b = this.pos[w.n.id];
      const th = w.i * 60 * DEG;
      const top = Math.max(a.top, b.top);
      this.dummy.position.set(a.x + Math.cos(th) * (S3 / 2) * 0.985, top + 0.05, a.z + Math.sin(th) * (S3 / 2) * 0.985);
      this.dummy.rotation.set(0, -(th + Math.PI / 2), 0);
      this.dummy.scale.set(1.0, 0.1, 0.07);
      this.dummy.updateMatrix();
      this.borders.setMatrixAt(k, this.dummy.matrix);
    });
    this.borders.count = walls.length;
    this.borders.instanceMatrix.needsUpdate = true;
    this.world.add(this.borders);

    // деревья и горные пики (статично, instanced)
    const treeList = [], peakList = [];
    provs.forEach((p, i) => {
      const q = this.pos[i];
      if (p.terrain === 'mountains') {
        for (let k = 0; k < 3; k++) {
          const a = (hash(i * 3 + k) * 360) * DEG, r = 0.5 + hash(i * 5 + k) * 0.3;
          peakList.push({ x: q.x + Math.cos(a) * r, z: q.z + Math.sin(a) * r, y: q.top, s: 0.7 + hash(i + k * 11) * 0.6 });
        }
      } else {
        const n = p.terrain === 'hills' ? 3 : 4 + Math.floor(hash(i) * 3);
        for (let k = 0; k < n; k++) {
          const a = (hash(i * 7 + k) * 360) * DEG, r = 0.72 + hash(i * 11 + k) * 0.08;
          treeList.push({ x: q.x + Math.cos(a) * r, z: q.z + Math.sin(a) * r, y: q.top, s: 0.7 + hash(i + k * 17) * 0.6 });
        }
      }
    });
    const mkInst = (g, m, list, scale) => {
      const im = new THREE.InstancedMesh(g, m, Math.max(1, list.length));
      im.castShadow = true;
      list.forEach((t, k) => {
        this.dummy.position.set(t.x, t.y + (scale.h * t.s) / 2, t.z);
        this.dummy.rotation.set(0, hash(k) * 6, 0);
        this.dummy.scale.set(scale.r * t.s, scale.h * t.s, scale.r * t.s);
        this.dummy.updateMatrix();
        im.setMatrixAt(k, this.dummy.matrix);
        tmpC.set(scale.colors[k % scale.colors.length]);
        im.setColorAt(k, tmpC);
      });
      im.count = list.length;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      this.world.add(im);
    };
    mkInst(new THREE.ConeGeometry(1, 1, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9 }), treeList,
      { r: 0.1, h: 0.26, colors: [0x2f6b3a, 0x3a7a42, 0x285d33, 0x4a8a48] });
    mkInst(new THREE.ConeGeometry(1, 1, 5), new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.95 }), peakList,
      { r: 0.24, h: 0.62, colors: [0x8d9097, 0x9ea1a8, 0x7b7e86, 0xc9ccd2] });

    // группы провинций (города, здания, месторождения): пересобираются при изменениях
    this.pg = provs.map((p, i) => {
      const grp = new THREE.Group();
      grp.position.set(this.pos[i].x, this.pos[i].top, this.pos[i].z);
      this.world.add(grp);
      return grp;
    });
    this.sig = provs.map(() => '');
    this.sync();

    this.fit();
    this.select(-1);
  }

  signature(p) {
    return p.buildings.map((b) => `${b.type}${b.level}${b.buildLeft > 0 ? 'c' : ''}`).join(',') + '|' + levelOf(p.pop) + '|' + p.owner;
  }

  sync() {
    const { provs, states } = this.g;
    for (const p of provs) {
      const s = this.signature(p);
      if (s === this.sig[p.id]) continue;
      this.sig[p.id] = s;
      const grp = this.pg[p.id];
      while (grp.children.length) grp.remove(grp.children[0]);
      grp.add(cityModel(p, states[p.owner]));
      if (p.deposits.steel || p.deposits.oil) {
        const d = depositModel(p);
        d.position.set(0, 0, -0.78);
        grp.add(d);
      }
      p.buildings.forEach((b, i) => {
        const a = SLOT_ANGLES[i % SLOT_ANGLES.length];
        const m = new THREE.Group();
        if (b.level > 0) m.add(MODELS[b.type](b.level));
        if (b.buildLeft > 0) {
          const sc = scaffold();
          if (b.level > 0) sc.position.set(0.18, 0, 0.18);
          m.add(sc);
        }
        m.position.set(Math.cos(a) * 0.57, 0, Math.sin(a) * 0.57);
        m.rotation.y = -a + Math.PI / 2;
        m.scale.setScalar(1.2);
        grp.add(m);
      });
    }
  }

  // ---- камера ----
  updateCamera() {
    const { tx, tz, yaw, pitch, dist } = this.cam;
    const cp = Math.cos(pitch);
    this.camera.position.set(tx + Math.sin(yaw) * cp * dist, Math.sin(pitch) * dist, tz + Math.cos(yaw) * cp * dist);
    this.camera.lookAt(tx, 0.3, tz);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  fit() {
    const aspect = this.w / this.h;
    const fov = this.camera.fov * DEG;
    const fovH = 2 * Math.atan(Math.tan(fov / 2) * aspect);
    const fmin = Math.min(fov, fovH);
    this.fitDist = (this.radius / Math.sin(fmin / 2)) * 0.8;
    this.cam.tx = 0; this.cam.tz = 0; this.cam.yaw = 0; this.cam.pitch = 0.95;
    this.cam.dist = this.fitDist;
    this.dirty = true;
  }

  focus(p) {
    const q = this.pos[p.id];
    this.cam.dist = Math.min(this.cam.dist, Math.max(8, this.fitDist * 0.42));
    const k = this.cam.dist * 0.2; // провинция в верхней части экрана, над панелью
    this.cam.tx = q.x + Math.sin(this.cam.yaw) * k;
    this.cam.tz = q.z + Math.cos(this.cam.yaw) * k;
    this.dirty = true;
  }

  select(id) {
    this.sel = id;
    if (id >= 0) {
      const q = this.pos[id];
      this.ring.position.set(q.x, q.top + 0.03, q.z);
      this.ring.visible = true;
    } else this.ring.visible = false;
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

  hit(px, py) {
    this.raycaster.setFromCamera(new THREE.Vector2((px / this.w) * 2 - 1, -(py / this.h) * 2 + 1), this.camera);
    const res = this.raycaster.intersectObject(this.tiles, false);
    return res.length ? res[0].instanceId : -1;
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
          this.cam.pitch = Math.min(1.35, Math.max(0.45, this.cam.pitch + (l.y - prev.y) * 0.005));
        } else {
          const a = this.groundAt(prev.x, prev.y);
          const b = this.groundAt(l.x, l.y);
          if (a && b) { this.cam.tx += a.x - b.x; this.cam.tz += a.z - b.z; }
        }
        this.pointers.set(e.pointerId, { ...l, btn: prev.btn });
        this.dirty = true;
      } else if (this.pointers.size === 2) {
        this.pointers.set(e.pointerId, { ...l, btn: prev.btn });
        const [p1, p2] = [...this.pointers.values()];
        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
        if (this.pinch) {
          const a = this.groundAt(this.pinch.mx, this.pinch.my);
          this.cam.dist = Math.min(this.fitDist * 1.3, Math.max(4.5, this.cam.dist * (this.pinch.dist / dist)));
          let da = ang - this.pinch.ang;
          if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
          this.cam.yaw -= da;
          this.updateCamera();
          const b = this.groundAt(mx, my);
          if (a && b) { this.cam.tx += a.x - b.x; this.cam.tz += a.z - b.z; }
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
      this.cam.dist = Math.min(this.fitDist * 1.3, Math.max(4.5, this.cam.dist * (e.deltaY < 0 ? 0.9 : 1.1)));
      this.dirty = true;
    }, { passive: false });
  }

  draw() {
    this.sync();
    this.updateCamera();
    if (this.renderer) this.renderer.render(this.scene, this.camera);
    this.dirty = false;
  }
}
