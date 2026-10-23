import { SPEEDS, VERSION } from './data.js';
import {
  SAVE_KEY, deserialize, demolish, newGame, serialize, startBuild, startUpgrade, tick,
} from './sim.js';
import { MapView } from './render.js';
import { TABS, buildHtml, cardHtml, cityHtml, prodHtml, resbarHtml, stateHtml, startHtml } from './ui.js';

const $ = (id) => document.getElementById(id);
let game = null;
let view = null;
let selected = -1;
let tab = null; // 'city' | 'build' | 'prod' | 'state' | null
let speedIdx = 1;
let acc = 0;
let last = 0;
let looping = false;
let panelDirty = false;
let panelAt = 0;

const wide = () => !!(window.matchMedia && window.matchMedia('(min-width: 900px)').matches);

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
    view = new MapView($('map'), game, { labels: $('labels') });
    if (view.webglError) toast('3D недоступно на этом устройстве (нет WebGL). Игра работает без картинки.');
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => view && view.resize()).observe($('mapwrap'));
  } else {
    view.setGame(game);
    view.resize();
    view.fit();
  }
  view.onSelect = (id) => select(id);
  selected = -1;
  tab = null;
  speedIdx = 1;
  refreshTop();
  const cap = game.provs[game.states[game.playerState].capital];
  select(cap.id, true);
  if (!looping) { looping = true; requestAnimationFrame(loop); }
}

function select(id, focus = false) {
  selected = id;
  view.select(id);
  if (id >= 0) {
    if (focus) view.focus(game.provs[id]);
    if (tab === null && wide()) tab = 'city';
    if (tab === 'prod' || tab === 'state') tab = 'city';
  }
  refreshPanel();
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

function refreshPanel() {
  panelDirty = false;
  panelAt = performance.now();
  const el = $('panel');
  const p = selected >= 0 ? game.provs[selected] : null;
  document.querySelectorAll('#rail [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $('app').classList.toggle('panel-open', !!tab);
  if (tab) {
    const top = el.scrollTop;
    const html = tab === 'city' ? cityHtml(game, p)
      : tab === 'build' ? buildHtml(game, p)
        : tab === 'prod' ? prodHtml(game) : stateHtml(game);
    el.innerHTML = html;
    el.classList.remove('hidden');
    el.scrollTop = top;
  } else {
    el.classList.add('hidden');
  }
  // карточка выбранного города: пока панель закрыта
  const card = $('card');
  if (p && !tab) { card.innerHTML = cardHtml(game, p); card.classList.remove('hidden'); } else card.classList.add('hidden');
}

function refreshAll() { refreshTop(); refreshPanel(); if (view) view.dirty = true; }

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
  panelDirty = true;
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
  if (game && panelDirty && t - panelAt > 450) refreshPanel();
  if (view && view.dirty) view.draw();
  requestAnimationFrame(loop);
}

// ---- события ----

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const prov = selected >= 0 ? game && game.provs[selected] : null;
  if (act === 'pick') {
    game = newGame({ playerState: Number(el.dataset.id), seed: Math.floor(Math.random() * 1e6) });
    save();
    begin();
  } else if (act === 'continue') {
    try { game = deserialize(localStorage.getItem(SAVE_KEY)); begin(); } catch { toast('Не удалось загрузить сохранение'); }
  } else if (act === 'tab') {
    tab = tab === el.dataset.tab ? null : el.dataset.tab;
    refreshPanel();
  } else if (act === 'close') {
    tab = null;
    refreshPanel();
  } else if (act === 'card-close') {
    select(-1);
  } else if (act === 'pick-city') {
    select(Number(el.dataset.id), true);
  } else if (act === 'build' && prov) {
    const err = startBuild(game, prov, el.dataset.type);
    if (err) toast(err);
    refreshAll();
  } else if (act === 'upgrade' && prov) {
    const err = startUpgrade(game, prov, Number(el.dataset.i));
    if (err) toast(err);
    refreshAll();
  } else if (act === 'demolish' && prov) {
    if (confirm('Снести здание? Вернётся 30% стоимости.')) {
      demolish(game, prov, Number(el.dataset.i));
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
