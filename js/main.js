import { SPEEDS, VERSION, STATES_DEF } from './data.js';
import {
  SAVE_KEY, deserialize, demolish, newGame, serialize, startBuild, startUpgrade, tick,
} from './sim.js';
import { MapView } from './render.js';
import { resbarHtml, sheetHtml, startHtml } from './ui.js';

const $ = (id) => document.getElementById(id);
let game = null;
let view = null;
let selected = -1;
let speedIdx = 1;
let acc = 0;
let last = 0;
let looping = false;

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
    view = new MapView($('map'), game);
  } else {
    view.g = game;
    view.cell.clear();
    for (const p of game.provs) view.cell.set(p.row * game.cols + p.col, p);
    view.resize();
    view.fit();
  }
  view.onSelect = (id) => { select(id); };
  selected = -1;
  view.sel = -1;
  speedIdx = 1;
  refreshAll();
  const cap = game.provs[game.states[game.playerState].capital];
  select(cap.id, true);
  if (!looping) { looping = true; requestAnimationFrame(loop); }
}

function select(id, focus = false) {
  selected = id;
  view.sel = id;
  if (focus && id >= 0) view.focus(game.provs[id]);
  view.dirty = true;
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
  if (selected < 0) { el.classList.add('hidden'); return; }
  const top = el.scrollTop;
  el.innerHTML = sheetHtml(game, game.provs[selected]);
  el.classList.remove('hidden');
  el.scrollTop = top;
}

function refreshAll() { refreshTop(); refreshSheet(); }

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
  if (selected >= 0) refreshSheet();
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
    select(-1);
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
    $('menu').classList.remove('hidden');
  } else if (act === 'menu-close') {
    $('menu').classList.add('hidden');
  } else if (act === 'save') {
    toast(save() ? 'Игра сохранена' : 'Не удалось сохранить');
    $('menu').classList.add('hidden');
  } else if (act === 'new') {
    if (confirm('Начать новую игру? Несохранённый прогресс пропадёт.')) { showStart(); }
  } else if (act === 'fit') {
    view.fit();
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
window.addEventListener('resize', () => { if (view) { view.resize(); } });
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

showStart();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
