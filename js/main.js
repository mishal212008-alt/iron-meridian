import { SPEEDS, VERSION } from './data.js';
import {
  SAVE_KEY, canAfford, costOf, deserialize, demolish, newGame, plotError, serialize, startBuild, startUpgrade, tick,
} from './sim.js';
import { MapView } from './render.js';
import { TEX, paintTerrainAsync } from './terrain.js';
import { slots } from './sim.js';
import { BUILDINGS, RES_ICON } from './data.js';
import { buildHtml, cardHtml, cityHtml, fmt, prodHtml, resHtml, resbarHtml, stateHtml, startHtml } from './ui.js';

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
let placing = null; // { type, x, z, pid, err }

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

function loading(on, title = 'Создаём мир…', pct = 0, text = '') {
  $('loading').classList.toggle('hidden', !on);
  if (!on) return;
  $('load-title').textContent = title;
  $('load-bar').style.width = Math.round(pct * 100) + '%';
  if (text) $('load-text').textContent = text;
}
const tick1 = () => new Promise((r) => setTimeout(r, 30));

async function startNew(stateId) {
  $('start').classList.add('hidden');
  loading(true, 'Создаём мир…', 0.05, 'Рельеф, реки, леса, города, дороги');
  await tick1();
  game = newGame({ playerState: stateId, seed: Math.floor(Math.random() * 1e6) });
  save();
  await begin();
}

async function begin() {
  $('start').classList.add('hidden');
  $('menu').classList.add('hidden');
  loading(true, 'Рисуем землю…', 0.2, 'Текстуры, поля, границы');
  await tick1();
  const colors = game.states.map((s) => s.color);
  const px = await paintTerrainAsync(game.world, colors, TEX, (f) => loading(true, 'Рисуем землю…', 0.2 + 0.7 * f));
  loading(true, 'Строим города…', 0.95);
  await tick1();
  if (!view) {
    view = new MapView($('map'), game, { labels: $('labels'), pre: px });
    if (view.webglError) toast('3D недоступно на этом устройстве (нет WebGL). Игра работает без картинки.');
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => view && view.resize()).observe($('mapwrap'));
  } else {
    view.setGame(game, px);
    view.resize();
    view.fit();
  }
  view.onTap = onTap;
  placing = null;
  selected = -1;
  tab = null;
  speedIdx = 1;
  refreshTop();
  const cap = game.provs[game.states[game.playerState].capital];
  select(cap.id, true);
  loading(false);
  if (!looping) { looping = true; requestAnimationFrame(loop); }
}

function onTap(hit) {
  if (placing) { placeAt(hit); return; }
  select(hit ? hit.id : -1);
}

function placeBarHtml() {
  const d = BUILDINGS[placing.type];
  const s = game.states[game.playerState];
  const cost = costOf(placing.type, 1);
  const costTxt = Object.entries(cost).map(([k, v]) => `<span class="cost${s[k] < v ? ' lack' : ''}">${RES_ICON[k]}${fmt(v)}</span>`).join('');
  const has = placing.x !== null;
  const okp = has && !placing.err;
  const msg = !has ? placing.err : okp ? 'Место подходит' : placing.err;
  return `<div class="pb-t">${d.icon} <b>${d.name}</b> ${costTxt}</div>
    <div class="pb-s ${okp ? 'ok2' : has ? 'bad2' : 'muted'}">${msg}</div>
    <div class="two"><button class="btn" data-act="place-ok" ${okp && canAfford(s, cost) ? '' : 'disabled'}>✓ Построить здесь</button><button class="btn ghost" data-act="place-cancel">✕ Отмена</button></div>`;
}

function startPlacing(type, focusAt) {
  tab = null;
  placing = { type, x: null, z: null, pid: -1, err: 'Коснись карты на своей территории' };
  if (view) {
    view.setPins(type === 'mine' ? 'steel' : type === 'refinery' ? 'oil' : null);
    view.setGhost(null);
    if (focusAt) view.focusAt(focusAt[0], focusAt[1], Math.max(14, view.fitDist * 0.25));
    else {
      const cap = game.provs[selected >= 0 && game.provs[selected].owner === game.playerState ? selected : game.states[game.playerState].capital];
      view.focus(cap, 0.35);
    }
  }
  refreshPanel();
}

function stopPlacing() {
  placing = null;
  if (view) { view.setGhost(null); view.setPins(tab === 'res' ? 'all' : null); }
  refreshPanel();
}

function placeAt(hit) {
  if (!hit || !hit.land) { placing.err = 'Здесь море'; placing.x = null; view.setGhost(null); }
  else {
    const p = game.provs[hit.id];
    placing.x = Math.round(hit.x * 100) / 100; placing.z = Math.round(hit.z * 100) / 100; placing.pid = p.id;
    placing.err = p.owner !== game.playerState ? 'Чужая территория' : plotError(game, p, placing.type, hit.x, hit.z);
    if (!placing.err && p.buildings.length >= 99) placing.err = 'Нет мест';
    if (!placing.err && p.owner === game.playerState && p.buildings.length >= slotsOf(p)) placing.err = 'В этом городе нет свободных мест (город должен вырасти)';
    view.setGhost(placing.type, placing.x, placing.z, !placing.err);
  }
  refreshPanel();
}
const slotsOf = (p) => slots(p);

function select(id, focus = false) {
  selected = id;
  view.select(id);
  if (id >= 0) {
    if (focus) view.focus(game.provs[id]);
    if (tab === null && wide()) tab = 'city';
    if (tab === 'prod' || tab === 'state' || tab === 'res') tab = 'city';
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
  const el = $('pbody');
  const p = selected >= 0 ? game.provs[selected] : null;
  document.querySelectorAll('#rail [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $('app').classList.toggle('panel-open', !!tab);
  if (tab) {
    const top = el.scrollTop;
    const html = tab === 'city' ? cityHtml(game, p)
      : tab === 'build' ? buildHtml(game, p)
        : tab === 'prod' ? prodHtml(game) : tab === 'res' ? resHtml(game) : stateHtml(game);
    el.innerHTML = html;
    $('panel').classList.remove('hidden');
    el.scrollTop = top;
  } else {
    $('panel').classList.add('hidden');
  }
  if (view && !placing) view.setPins(tab === 'res' ? 'all' : null);
  const pb = $('placebar');
  if (placing) { pb.innerHTML = placeBarHtml(); pb.classList.remove('hidden'); } else pb.classList.add('hidden');
  // карточка выбранного города: пока панель закрыта
  const card = $('card');
  if (p && !tab && !placing) { card.innerHTML = cardHtml(game, p); card.classList.remove('hidden'); } else card.classList.add('hidden');
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
    startNew(Number(el.dataset.id));
  } else if (act === 'continue') {
    $('start').classList.add('hidden');
    loading(true, 'Загружаем игру…', 0.05);
    tick1().then(() => { game = deserialize(localStorage.getItem(SAVE_KEY)); return begin(); })
      .catch(() => { loading(false); showStart(); toast('Не удалось загрузить сохранение'); });
  } else if (act === 'tab') {
    if (placing) stopPlacing();
    tab = tab === el.dataset.tab ? null : el.dataset.tab;
    refreshPanel();
  } else if (act === 'place') {
    startPlacing(el.dataset.type, el.dataset.x ? [Number(el.dataset.x), Number(el.dataset.z)] : null);
  } else if (act === 'place-cancel') {
    stopPlacing();
  } else if (act === 'place-ok' && placing && placing.x !== null) {
    const p = game.provs[placing.pid];
    const err = startBuild(game, p, placing.type, { x: placing.x, z: placing.z });
    if (err) toast(err);
    else { toast(`🚧 ${BUILDINGS[placing.type].name}: стройка началась (${p.name})`); stopPlacing(); select(p.id); }
    refreshAll();
  } else if (act === 'look') {
    if (view) view.focusAt(Number(el.dataset.x), Number(el.dataset.z), Math.max(14, view.fitDist * 0.25));
  } else if (act === 'close') {
    tab = null;
    refreshPanel();
  } else if (act === 'card-close') {
    select(-1);
  } else if (act === 'pick-city') {
    if (placing) stopPlacing();
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

{ // ручка шторки (телефон): тап — выше/ниже, свайп вниз — закрыть
  const grab = $('grab');
  let y0 = null;
  grab.addEventListener('pointerdown', (e) => { y0 = e.clientY; grab.setPointerCapture(e.pointerId); });
  grab.addEventListener('pointerup', (e) => {
    if (y0 === null) return;
    const dy = e.clientY - y0; y0 = null;
    const tall = $('app').classList.contains('sheet-tall');
    if (dy > 50) { if (tall) $('app').classList.remove('sheet-tall'); else { tab = null; refreshPanel(); } }
    else if (dy < -50) $('app').classList.add('sheet-tall');
    else $('app').classList.toggle('sheet-tall');
  });
}

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
