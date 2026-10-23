import { SPEEDS, VERSION } from './data.js';
import {
  SAVE_KEY, deserialize, demolish, newGame, serialize, startBuild, startUpgrade, tick,
} from './sim.js';
import { MapView } from './render.js';
import { econHtml, resbarHtml, sheetHtml, startHtml } from './ui.js';

const $ = (id) => document.getElementById(id);
let game = null;
let view = null;
let selected = -1;
let panel = null; // 'prov' | 'econ' | null
let speedIdx = 1;
let acc = 0;
let last = 0;
let looping = false;

const SH_KEY = 'iron-meridian-shadows';
function shadowsWanted() {
  try {
    const v = localStorage.getItem(SH_KEY);
    if (v !== null) return v === '1';
  } catch { /* нет доступа к хранилищу */ }
  return !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || ''); // на телефонах по умолчанию без теней
}
function setShadowsLabel() {
  const on = view ? view.shadows : shadowsWanted();
  $('btn-shadows').textContent = '🌓 Тени: ' + (on ? 'вкл' : 'выкл');
}

function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
}
function save() {
  if (!game) return false;
  try { localStorage.setItem(SAVE_KEY, serialize(game)); return true; } catch { return false; }
}

function showStart() {
  $('start').innerHTML = startHtml(hasSave());
  $('start').classList.remove('hidden');
  $('menu').classList.add('hidden');
}

function begin() {
  $('start').classList.add('hidden');
  $('menu').classList.add('hidden');
  if (!view) {
    view = new MapView($('map'), game, { shadows: shadowsWanted() });
    if (view.webglError) toast('3D недоступно на этом устройстве (нет WebGL). Игра работает без картинки.');
  } else {
    view.setGame(game);
    view.resize();
    view.fit();
  }
  view.onSelect = (id) => select(id);
  selected = -1;
  panel = null;
  speedIdx = 1;
  setShadowsLabel();
  refreshTop();
  const cap = game.provs[game.states[game.playerState].capital];
  select(cap.id, true);
  if (!looping) { looping = true; requestAnimationFrame(loop); }
}

function select(id, focus = false) {
  selected = id;
  view.select(id);
  panel = id >= 0 ? 'prov' : null;
  if (focus && id >= 0) view.focus(game.provs[id]);
  refreshSheet();
}

function refreshTop() {
  const s = game.states[game.playerState];
  $('state-name').textContent = s.name;
  $('state-name').style.color = s.color;
  $('day').textContent = 'День ' + game.day;
  $('resbar').innerHTML = resbarHtml(game);
  document.querySelectorAll('#speeds button').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.speed) === speedIdx);
  });
}

function refreshSheet() {
  const el = $('sheet');
  if (panel === 'prov' && selected >= 0) {
    const top = el.scrollTop;
    el.innerHTML = sheetHtml(game, game.provs[selected]);
    el.classList.remove('hidden');
    el.scrollTop = top;
  } else if (panel === 'econ') {
    const top = el.scrollTop;
    el.innerHTML = econHtml(game);
    el.classList.remove('hidden');
    el.scrollTop = top;
  } else {
    el.classList.add('hidden');
  }
}

function refreshAll() { refreshTop(); refreshSheet(); if (view) view.dirty = true; }

function toast(text) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 3500);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
}

function advanceDay() {
  tick(game);
  for (const e of game.events.splice(0)) toast(e);
  if (game.day % 10 === 0) save();
  refreshTop();
  if (panel) refreshSheet();
  view.dirty = true;
}

function loop(t) {
  const dt = Math.min(0.25, (t - last) / 1000 || 0);
  last = t;
  if (game && speedIdx > 0) {
    acc += dt * SPEEDS[speedIdx];
    let n = 0;
    while (acc >= 1 && n < 8) { acc -= 1; n++; advanceDay(); }
    if (n === 8) acc = 0;
  }
  if (view && view.dirty) view.draw();
  requestAnimationFrame(loop);
}

// ---- события ----

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'pick') {
    game = newGame({ playerState: Number(el.dataset.id), seed: Math.floor(Math.random() * 1e6) });
    save();
    begin();
  } else if (act === 'continue') {
    try { game = deserialize(localStorage.getItem(SAVE_KEY)); begin(); } catch { toast('Не удалось загрузить сохранение'); }
  } else if (act === 'close') {
    if (panel === 'econ') { panel = selected >= 0 ? null : null; refreshSheet(); } else select(-1);
  } else if (act === 'nav-prov') {
    if (selected < 0) toast('Коснись провинции на карте');
    else { panel = panel === 'prov' ? null : 'prov'; refreshSheet(); }
  } else if (act === 'nav-econ') {
    panel = panel === 'econ' ? null : 'econ';
    refreshSheet();
  } else if (act === 'build' && selected >= 0) {
    const err = startBuild(game, game.provs[selected], el.dataset.type);
    if (err) toast(err);
    refreshAll();
  } else if (act === 'upgrade' && selected >= 0) {
    const err = startUpgrade(game, game.provs[selected], Number(el.dataset.i));
    if (err) toast(err);
    refreshAll();
  } else if (act === 'demolish' && selected >= 0) {
    if (confirm('Снести здание? Вернётся 30% стоимости.')) {
      demolish(game, game.provs[selected], Number(el.dataset.i));
      refreshAll();
    }
  } else if (act === 'menu') {
    $('menu-ver').textContent = 'Версия ' + VERSION;
    setShadowsLabel();
    $('menu').classList.remove('hidden');
  } else if (act === 'menu-close') {
    $('menu').classList.add('hidden');
  } else if (act === 'save') {
    toast(save() ? 'Игра сохранена' : 'Не удалось сохранить');
    $('menu').classList.add('hidden');
  } else if (act === 'shadows') {
    if (view) {
      view.setShadows(!view.shadows);
      try { localStorage.setItem(SH_KEY, view.shadows ? '1' : '0'); } catch { /* ничего */ }
      setShadowsLabel();
    }
  } else if (act === 'new') {
    if (confirm('Начать новую игру? Несохранённый прогресс пропадёт.')) { showStart(); }
  } else if (act === 'fit') {
    if (view) view.fit();
  }
});

$('speeds').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  speedIdx = Number(b.dataset.speed);
  refreshTop();
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && game) { e.preventDefault(); speedIdx = speedIdx === 0 ? 1 : 0; refreshTop(); }
});
window.addEventListener('resize', () => { if (view) view.resize(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

showStart();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
