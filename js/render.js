// Отрисовка карты на canvas + управление пальцами (сдвиг, щипок, тап).
import { BUILDINGS, TERRAIN } from './data.js';

const S3 = Math.sqrt(3);
// направление ребра i: 0=В, 1=ЮВ, 2=ЮЗ, 3=З, 4=СЗ, 5=СВ
const DIRS_EVEN = [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]];
const DIRS_ODD = [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]];

export class MapView {
  constructor(canvas, game) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.g = game;
    this.size = 34;
    this.sel = -1;
    this.onSelect = () => {};
    this.cam = { x: 0, y: 0, z: 1 };
    this.minZ = 0.3; this.maxZ = 5;
    this.cell = new Map();
    for (const p of game.provs) this.cell.set(p.row * game.cols + p.col, p);
    this.worldW = this.size * S3 * (game.cols + 0.5);
    this.worldH = this.size * (1.5 * game.rows + 0.5);
    this.pointers = new Map();
    this.dirty = true;
    this.bind();
    this.resize();
    this.fit();
  }

  center(p) {
    return {
      x: this.size * S3 * (p.col + 0.5 * (p.row & 1)) + (this.size * S3) / 2,
      y: this.size * 1.5 * p.row + this.size,
    };
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.w = Math.max(1, Math.floor(r.width));
    this.h = Math.max(1, Math.floor(r.height));
    this.c.width = Math.floor(this.w * this.dpr);
    this.c.height = Math.floor(this.h * this.dpr);
    this.dirty = true;
  }

  fit() {
    const z = Math.min(this.w / this.worldW, this.h / this.worldH) * 0.96;
    this.fitZ = z;
    this.minZ = z * 0.7;
    this.maxZ = z * 6;
    this.cam.z = z;
    this.cam.x = (this.w - this.worldW * z) / 2;
    this.cam.y = (this.h - this.worldH * z) / 2;
    this.dirty = true;
  }

  focus(p) {
    const c = this.center(p);
    this.cam.z = Math.max(this.cam.z, this.fitZ * 2);
    this.cam.x = this.w / 2 - c.x * this.cam.z;
    this.cam.y = this.h * 0.32 - c.y * this.cam.z;
    this.dirty = true;
  }

  zoomAt(px, py, factor) {
    const z0 = this.cam.z;
    const z1 = Math.min(this.maxZ, Math.max(this.minZ, z0 * factor));
    this.cam.x = px - ((px - this.cam.x) * z1) / z0;
    this.cam.y = py - ((py - this.cam.y) * z1) / z0;
    this.cam.z = z1;
    this.dirty = true;
  }

  bind() {
    const c = this.c;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.tap = this.pointers.size === 1
        ? { x: e.clientX, y: e.clientY, t: performance.now(), moved: false } : null;
      this.pinch = null;
    });
    c.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const rect = c.getBoundingClientRect();
      if (this.pointers.size === 1) {
        this.cam.x += e.clientX - prev.x;
        this.cam.y += e.clientY - prev.y;
        if (this.tap && Math.hypot(e.clientX - this.tap.x, e.clientY - this.tap.y) > 8) this.tap.moved = true;
        this.dirty = true;
      } else if (this.pointers.size === 2) {
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2 - rect.left, my = (a.y + b.y) / 2 - rect.top;
        if (this.pinch) {
          this.zoomAt(mx, my, dist / this.pinch.dist);
          this.cam.x += mx - this.pinch.mx;
          this.cam.y += my - this.pinch.my;
        }
        this.pinch = { dist, mx, my };
        if (this.tap) this.tap.moved = true;
        return;
      }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    const up = (e) => {
      const had = this.pointers.delete(e.pointerId);
      this.pinch = null;
      if (had && this.tap && !this.tap.moved && performance.now() - this.tap.t < 500 && this.pointers.size === 0) {
        const rect = c.getBoundingClientRect();
        this.onSelect(this.hit(e.clientX - rect.left, e.clientY - rect.top));
      }
      if (this.pointers.size === 0) this.tap = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });
  }

  hit(px, py) {
    const wx = (px - this.cam.x) / this.cam.z;
    const wy = (py - this.cam.y) / this.cam.z;
    let best = -1, bd = this.size * 0.95;
    for (const p of this.g.provs) {
      const c = this.center(p);
      const d = Math.hypot(c.x - wx, c.y - wy);
      if (d < bd) { bd = d; best = p.id; }
    }
    return best;
  }

  hexPath(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = ((60 * i - 30) * Math.PI) / 180;
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  draw() {
    const { ctx, dpr, cam, g, size } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#12202e';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, dpr * cam.x, dpr * cam.y);

    // заливка
    for (const p of g.provs) {
      const c = this.center(p);
      this.hexPath(ctx, c.x, c.y, size);
      ctx.fillStyle = TERRAIN[p.terrain].color;
      ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = g.states[p.owner].color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // границы: между государствами толще, у моря тонкая светлая
    for (const p of g.provs) {
      const c = this.center(p);
      const dirs = p.row & 1 ? DIRS_ODD : DIRS_EVEN;
      for (let i = 0; i < 6; i++) {
        const n = this.cell.get((p.row + dirs[i][1]) * g.cols + (p.col + dirs[i][0]));
        const sameOwner = n && n.owner === p.owner;
        if (n && sameOwner) continue;
        if (n && n.id < p.id) continue; // каждая граница один раз
        const a1 = ((60 * i - 30) * Math.PI) / 180, a2 = ((60 * i + 30) * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(c.x + size * Math.cos(a1), c.y + size * Math.sin(a1));
        ctx.lineTo(c.x + size * Math.cos(a2), c.y + size * Math.sin(a2));
        if (!n) { ctx.strokeStyle = 'rgba(210,230,255,.55)'; ctx.lineWidth = 1.5; }
        else { ctx.strokeStyle = '#0b0f14'; ctx.lineWidth = 3; }
        ctx.stroke();
      }
    }
    // тонкая сетка внутри государств
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = 'rgba(0,0,0,.22)';
    for (const p of g.provs) {
      const c = this.center(p);
      this.hexPath(ctx, c.x, c.y, size);
      ctx.stroke();
    }

    // значки
    const px = size * cam.z; // размер гекса на экране
    for (const p of g.provs) {
      const c = this.center(p);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (p.capital) {
        ctx.font = `${size * 0.55}px sans-serif`;
        ctx.fillStyle = '#fff';
        ctx.fillText('★', c.x, c.y - size * 0.32);
      }
      const done = p.buildings.filter((b) => b.level > 0);
      if (px > 22 && done.length) {
        ctx.font = `${size * 0.3}px sans-serif`;
        const icons = done.slice(0, 4).map((b) => BUILDINGS[b.type].icon).join('');
        ctx.fillText(icons + (done.length > 4 ? '+' : ''), c.x, c.y + size * 0.12);
      }
      if (p.buildings.some((b) => b.buildLeft > 0) && px > 22) {
        ctx.font = `${size * 0.28}px sans-serif`;
        ctx.fillText('🚧', c.x + size * 0.5, c.y - size * 0.45);
      }
      if (px > 38) {
        ctx.font = `${size * 0.24}px sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.fillText(p.name, c.x, c.y + size * 0.55);
      }
      if (px > 30 && (p.deposits.steel || p.deposits.oil)) {
        ctx.font = `${size * 0.24}px sans-serif`;
        ctx.fillText((p.deposits.steel ? '⛰️' : '') + (p.deposits.oil ? '🛢' : ''), c.x - size * 0.42, c.y - size * 0.4);
      }
    }

    // выделение
    if (this.sel >= 0) {
      const p = g.provs[this.sel];
      const c = this.center(p);
      this.hexPath(ctx, c.x, c.y, size - 1);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    this.dirty = false;
  }
}
