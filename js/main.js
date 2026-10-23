import { SPEEDS, VERSION } from './data.js';
import {
  SAVE_KEY, buyShortage, canAfford, cancelBuild, costOf, deserialize, demolish, forecast, newGame, plotError, sellSurplus, serialize, staffing, startBuild, startUpgrade, tick, totalPop, unemployment,
} from './sim.js';
import { MapView } from './render.js';
import { TEX, paintTerrainAsync } from './terrain.js';
import { slots } from './sim.js';
import { BUILDINGS, RES_ICON } from './data.js';
import { alertsHtml, alertsOf, budgetHtml, buildHtml, cardHtml, cityHtml, flowHtml, fmt, prodHtml, resHtml, resbarHtml, ribbonHtml, stateHtml, startHtml } from './ui.js';
import { dipAction as dipActionImpl, dipColorOf, dipHtml, dipIncoming, dipLinks, dipSignature, newDipUi } from './dipui.js';

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
let dipUi = newDipUi();
let dipSig = '';
let placing = null; // { type, x, z, pid, err }
let flowKey = 'steel';
let sliding = false;
let alertSig = '';
let feedSig = '';
let lastTab = null;
let fpsN = 0, fpsT = 0, mmDirty = true, mmAt = 0, mmBase = null;

// ---- настройки (хранятся на устройстве) ----
const SET_KEY = 'iron-meridian-settings';
const settings = { speed: 1, autopause: false, sound: false, vibrate: true, quality: 'medium', fps: false, difficulty: 'normal', layers: { deposits: false, borders: true, energy: false, unemp: false, dip: false } };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SET_KEY) || '{}')); settings.layers = Object.assign({ deposits: false, borders: true, energy: false, unemp: false, dip: false }, settings.layers); } catch { /* пусто */ }
function saveSettings() { try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch { /* пусто */ } }
const buzz = (ms = 15) => { if (settings.vibrate && navigator.vibrate) { try { navigator.vibrate(ms); } catch { /* пусто */ } } };
let actx = null;
function beep(f = 660, d = 0.08) {
  if (!settings.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), gn = actx.createGain();
    o.frequency.value = f; o.type = 'triangle'; gn.gain.value = 0.06;
    o.connect(gn); gn.connect(actx.destination); o.start(); o.stop(actx.currentTime + d);
  } catch { /* пусто */ }
}

const wide = () => !!(window.matchMedia && window.matchMedia('(min-width: 900px)').matches);

function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
}
function save() {
  if (!game) return false;
  try { localStorage.setItem(SAVE_KEY, serialize(game)); return true; } catch { return false; }
}

function showStart() {
  $('start').innerHTML = startHtml(hasSave(), settings.difficulty);
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
  game = newGame({ playerState: stateId, seed: Math.floor(Math.random() * 1e6), difficulty: settings.difficulty });
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
  view.setQuality(settings.quality);
  view.unempOf = unemployment;
  view.dipColor = (p) => dipColorOf(game, p);
  view.dipLinks = () => dipLinks(game);
  applyLayers();
  $('fps').classList.toggle('hidden', !settings.fps);
  makeMinimap(px);
  placing = null;
  dipUi = newDipUi(); dipSig = dipSignature(game);
  selected = -1;
  tab = null;
  speedIdx = settings.speed;
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
  let fcTxt = '';
  if (has && placing.pid >= 0) {
    const f = forecast(placing.type, 1, game.provs[placing.pid]);
    fcTxt = f.indirect ? ' · польза косвенная' : f.net > 0.05 ? ` · <b class="pos">+${f.net.toFixed(1)}💰 в день</b>, окупится за ~${Math.round(f.payback)} дн.` : '';
  }
  const msg = !has ? placing.err : okp ? 'Место подходит' + fcTxt : placing.err;
  return `<div class="pb-t">${d.icon} <b>${d.name}</b> ${costTxt}</div>
    <div class="pb-s ${okp ? 'ok2' : has ? 'bad2' : 'muted'}">${msg}</div>
    <div class="two"><button class="btn" data-act="place-ok" ${okp && canAfford(s, cost) ? '' : 'disabled'}>✓ Построить здесь</button><button class="btn ghost" data-act="place-cancel">✕ Отмена</button></div>`;
}

function startPlacing(type, focusAt) {
  tab = null;
  placing = { type, x: null, z: null, pid: -1, err: 'Коснись карты на своей территории' };
  if (view) {
    view.setPins(BUILDINGS[type].needs || null);
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
  if (view) { view.setGhost(null); view.setPins(tab === 'res' || settings.layers.deposits ? 'all' : null); }
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
    if (tab === 'dip') { const o = game.provs[id].owner; if (o !== game.playerState) { dipUi.target = o; dipUi.view = 'state'; dipUi.result = null; dipUi.confirm = null; } }
    else if (tab === 'prod' || tab === 'state' || tab === 'res') tab = 'city';
  }
  refreshPanel();
}

function refreshTop() {
  const s = game.states[game.playerState];
  $('state-name').textContent = s.name;
  $('state-name').style.color = s.color;
  $('day').textContent = 'День ' + game.day;
  // числа «тикают» при росте
  const prev = {};
  document.querySelectorAll('#resbar [data-v]').forEach((e) => { prev[e.dataset.v] = e.textContent; });
  const sy = $('resbar').scrollLeft;
  $('resbar').innerHTML = resbarHtml(game);
  $('resbar').scrollLeft = sy;
  document.querySelectorAll('#resbar [data-v]').forEach((e) => {
    if (prev[e.dataset.v] !== undefined && prev[e.dataset.v] !== e.textContent) e.parentElement.classList.add('tick');
  });
  const al = alertsHtml(game);
  if (al !== alertSig) { alertSig = al; $('alerts').innerHTML = al; }
  const fs = game.feed.length + ':' + (game.feed[0] ? game.feed[0].day + game.feed[0].text : '');
  if (fs !== feedSig) { feedSig = fs; $('ribbon').innerHTML = ribbonHtml(game); }
  const nOff = dipIncoming(game).length;
  $('dip-badge').textContent = nOff; $('dip-badge').classList.toggle('hidden', !nOff);
  document.querySelectorAll('#speeds button').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.speed) === speedIdx);
  });
}

function refreshPanel() {
  panelDirty = false;
  panelAt = performance.now();
  const el = $('pbody');
  const p = selected >= 0 ? game.provs[selected] : null;
  document.querySelectorAll('#dock [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $('app').classList.toggle('panel-open', !!tab);
  if (tab) {
    const top = el.scrollTop;
    const html = tab === 'city' ? cityHtml(game, p)
      : tab === 'build' ? buildHtml(game, p)
        : tab === 'prod' ? prodHtml(game) : tab === 'res' ? resHtml(game) : tab === 'budget' ? budgetHtml(game) : tab === 'flow' ? flowHtml(game, flowKey) : tab === 'dip' ? dipHtml(game, dipUi) : stateHtml(game);
    el.innerHTML = html;
    if (tab !== lastTab) { el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); }
    lastTab = tab;
    $('panel').classList.remove('hidden');
    el.scrollTop = top;
  } else {
    $('panel').classList.add('hidden');
    lastTab = null;
  }
  if (view && !placing) view.setPins(tab === 'res' || settings.layers.deposits ? 'all' : null);
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
  const me = game.states[game.playerState];
  me.popPrev = totalPop(game, me);
  const before = game.feed.length ? game.feed[0] : null;
  const badBefore = new Set(alertsOf(game).filter((a) => a.kind === 'bad').map((a) => a.text.slice(0, 6)));
  tick(game);
  for (const e of game.events.splice(0)) toast(e);
  { // входящие предложения, ультиматумы и призывы: срочное ставит на паузу всегда
    const sig = dipSignature(game);
    if (sig !== dipSig) {
      const old = new Set(dipSig.split(','));
      const fresh = dipIncoming(game).filter((i) => !old.has(i.type + i.id + (i.c ? i.c.step : '')));
      dipSig = sig;
      if (fresh.length) {
        buzz(40); beep(520);
        if (fresh.some((i) => i.crit) || (settings.autopause && speedIdx > 0)) { speedIdx = 0; toast('⏸ Требуется ответ: дипломатия'); }
      }
    }
  }
  if (game.day % 10 === 0) save();
  if (settings.autopause && speedIdx > 0) {
    const newEv = game.feed.length && game.feed[0] !== before;
    const newBad = alertsOf(game).some((a) => a.kind === 'bad' && !badBefore.has(a.text.slice(0, 6)));
    if (newEv || newBad) { speedIdx = 0; toast('⏸ Автопауза'); }
  }
  refreshTop();
  panelDirty = true;
  spawnIncome();
  view.dirty = true;
}

// «+12💰» над работающими зданиями (только когда камера близко)
function spawnIncome() {
  if (!view || view.cam.dist > view.fitDist * 0.45) return;
  let n = 0;
  for (const p of game.provs) {
    if (p.owner !== game.playerState) continue;
    for (const b of p.buildings) {
      if (n >= 10) return;
      if (b.level <= 0 || b.buildLeft > 0 || b.type === 'housing') continue;
      const f = forecast(b.type, b.level, p);
      const v = Math.round(f.income * Math.min(1, b.eff ?? 1));
      if (v >= 2 && (b.eff ?? 1) > 0.3) { view.floatText(b.x, b.z, `+${v}💰`); n++; }
    }
  }
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
  if (game && panelDirty && !sliding && t - panelAt > 450) refreshPanel();
  if (view && view.dirty) { view.draw(); mmDirty = true; }
  if (settings.fps) {
    fpsN++;
    if (t - fpsT > 500) { $('fps').textContent = Math.round((fpsN * 1000) / (t - fpsT)) + ' FPS'; fpsN = 0; fpsT = t; }
  }
  if (mmDirty && t - mmAt > 120) { mmDirty = false; mmAt = t; drawMinimap(); }
  requestAnimationFrame(loop);
}

// ---- миникарта ----
function makeMinimap(px) {
  const c = $('minimap');
  const size = c.width;
  const base = document.createElement('canvas');
  base.width = base.height = size;
  const x = base.getContext('2d');
  if (!x || !px) { mmBase = null; return; }
  const img = x.createImageData(size, size);
  const T = Math.round(Math.sqrt(px.length / 4));
  const st = T / size;
  for (let r = 0; r < size; r++) for (let q = 0; q < size; q++) {
    const i = ((Math.floor((r + 0.5) * st) * T) + Math.floor((q + 0.5) * st)) * 4, o = (r * size + q) * 4;
    img.data[o] = px[i]; img.data[o + 1] = px[i + 1]; img.data[o + 2] = px[i + 2]; img.data[o + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  mmBase = base;
  mmDirty = true;
}
const HALFW = 70;
function drawMinimap() {
  const c = $('minimap');
  const x = c.getContext && c.getContext('2d');
  if (!x || !game || !view) return;
  const S = c.width;
  const W = (wx, wz) => [((wx + HALFW) / (2 * HALFW)) * S, ((wz + HALFW) / (2 * HALFW)) * S];
  x.clearRect(0, 0, S, S);
  if (mmBase) x.drawImage(mmBase, 0, 0); else { x.fillStyle = '#26402a'; x.fillRect(0, 0, S, S); }
  for (const p of game.provs) {
    const [a, b] = W(p.x, p.z);
    x.fillStyle = game.states[p.owner].color;
    x.beginPath(); x.arc(a, b, p.owner === game.playerState ? 3 : 2, 0, 7); x.fill();
    if (p.id === selected) { x.strokeStyle = '#fff'; x.lineWidth = 2; x.beginPath(); x.arc(a, b, 5, 0, 7); x.stroke(); }
  }
  const pts = view.viewCorners();
  if (pts.length === 4) {
    x.strokeStyle = '#ff9a2e'; x.lineWidth = 2.5;
    x.beginPath();
    pts.forEach(([wx, wz], i) => { const [a, b] = W(Math.max(-HALFW, Math.min(HALFW, wx)), Math.max(-HALFW, Math.min(HALFW, wz))); if (i) x.lineTo(a, b); else x.moveTo(a, b); });
    x.closePath(); x.stroke();
  }
}
{
  const mm = $('minimap');
  const go = (e) => {
    if (!view) return;
    const r = mm.getBoundingClientRect();
    const wx = ((e.clientX - r.left) / r.width) * 2 * HALFW - HALFW, wz = ((e.clientY - r.top) / r.height) * 2 * HALFW - HALFW;
    view.cam.tx = wx; view.cam.tz = wz; view.clampCam(); view.dirty = true;
  };
  let down = false;
  mm.addEventListener('pointerdown', (e) => { down = true; mm.setPointerCapture(e.pointerId); go(e); });
  mm.addEventListener('pointermove', (e) => { if (down) go(e); });
  mm.addEventListener('pointerup', () => { down = false; });
}

// ---- слои карты ----
const LAYERS = [['deposits', '⛏ Месторождения'], ['borders', '🚧 Границы'], ['energy', '⚡ Энергия и занятость'], ['unemp', '🔥 Безработица'], ['dip', '🤝 Дипломатия']];
function layerBoxHtml() {
  return LAYERS.map(([k, n]) => `<label><input type="checkbox" data-layer="${k}" ${settings.layers[k] ? 'checked' : ''}>${n}</label>`).join('');
}
function applyLayers() {
  if (!view) return;
  const l = settings.layers;
  view.labelExtra = l.energy ? (p) => {
    if (!p.buildings.length) return '';
    const s = game.states[p.owner];
    return ` · ⚡${Math.round(s.energy.ratio * 100)}% 👷${Math.round(Math.min(1, staffing(p)) * 100)}%`;
  } : null;
  view.setLayers(l);
  if (!placing) view.setPins(tab === 'res' || l.deposits ? 'all' : null);
  view.labels && view.labels.forEach((L) => { L.text = ''; });
}

// ---- настройки ----
function settingsHtml() {
  const seg = (key, opts) => `<div class="seg">${opts.map(([v, n]) => `<button class="${String(settings[key]) === String(v) ? 'on' : ''}" data-act="set" data-key="${key}" data-val="${v}">${n}</button>`).join('')}</div>`;
  const chk = (key, name) => `<div class="setrow"><span>${name}</span><input type="checkbox" data-set="${key}" ${settings[key] ? 'checked' : ''}></div>`;
  return `<div class="setrow"><span>Скорость</span>${seg('speed', [[0, '⏸'], [1, '1×'], [2, '2×'], [3, '4×']])}</div>
    <div class="setrow"><span>Качество</span>${seg('quality', [['low', 'Низк.'], ['medium', 'Сред.'], ['high', 'Выс.']])}</div>
    ${chk('autopause', 'Автопауза на событиях')}${chk('sound', 'Звук')}${chk('vibrate', 'Вибрация')}${chk('fps', 'Счётчик FPS')}`;
}

// ---- события ----

function dipAction(act, el) {
  if (act === 'dip-open' && placing) stopPlacing();
  if (act === 'dip-open') tab = 'dip';
  dipActionImpl(game, dipUi, act, el, { toast });
  dipSig = dipSignature(game);
  refreshAll();
}

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
    else { toast(`🚧 ${BUILDINGS[placing.type].name}: стройка началась (${p.name})`); buzz(30); beep(620); stopPlacing(); select(p.id); }
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
    if (err) toast(err); else { buzz(30); beep(620); }
    refreshAll();
  } else if (act === 'upgrade' && prov) {
    const err = startUpgrade(game, prov, Number(el.dataset.i));
    if (err) toast(err); else { buzz(30); beep(700); }
    refreshAll();
  } else if (act === 'demolish' && prov) {
    if (confirm('Снести здание? Вернётся 30% стоимости.')) {
      demolish(game, prov, Number(el.dataset.i));
      refreshAll();
    }
  } else if (act === 'menu') {
    $('menu-ver').textContent = 'Версия ' + VERSION;
    $('settings').innerHTML = settingsHtml();
    $('menu').classList.remove('hidden');
  } else if (act === 'set') {
    const k = el.dataset.key, v = el.dataset.val;
    settings[k] = k === 'speed' ? Number(v) : v;
    if (k === 'speed') { speedIdx = settings.speed; refreshTop(); }
    if (k === 'quality' && view) view.setQuality(v);
    saveSettings();
    $('settings').innerHTML = settingsHtml();
  } else if (act === 'diff') {
    settings.difficulty = el.dataset.val; saveSettings();
    document.querySelectorAll('[data-act="diff"]').forEach((b) => b.classList.toggle('on', b.dataset.val === settings.difficulty));
  } else if (act === 'chip') {
    if (placing) stopPlacing();
    const t = el.dataset.tab;
    if (t === 'flow') flowKey = el.dataset.k;
    tab = tab === t && (t !== 'flow' || flowKey === el.dataset.k) && !el.dataset.re ? null : t;
    refreshPanel();
  } else if (act === 'alert') {
    const pid = Number(el.dataset.pid);
    if (pid >= 0) { if (placing) stopPlacing(); select(pid, true); }
  } else if (act === 'goals') {
    if (placing) stopPlacing();
    tab = 'state'; refreshPanel();
    $('menu').classList.add('hidden');
  } else if (act === 'zoom-in') { if (view) view.zoomBy(0.7);
  } else if (act === 'zoom-out') { if (view) view.zoomBy(1.4);
  } else if (act === 'home') {
    if (view) view.focus(game.provs[game.states[game.playerState].capital], 0.2);
  } else if (act === 'layers') {
    const lb = $('layerbox');
    lb.innerHTML = layerBoxHtml();
    lb.classList.toggle('hidden');
    el.classList.toggle('on', !lb.classList.contains('hidden'));
  } else if (act === 'cancel' && prov) {
    const err = cancelBuild(game, prov, Number(el.dataset.i));
    if (err) toast(err); else { toast('↩ Стройка отменена, возвращено 80% стоимости'); buzz(25); beep(330); }
    refreshAll();
  } else if (act === 'm-sell' || act === 'm-buy') {
    const me = game.states[game.playerState];
    const r = act === 'm-sell' ? sellSurplus(game, me, el.dataset.k) : buyShortage(game, me, el.dataset.k);
    toast((r.ok ? '' : '⚠ ') + r.msg);
    if (r.ok) { buzz(20); beep(act === 'm-sell' ? 740 : 520); }
    refreshAll();
  } else if (act === 'menu-close') {
    $('menu').classList.add('hidden');
  } else if (act === 'save') {
    toast(save() ? 'Игра сохранена' : 'Не удалось сохранить');
    $('menu').classList.add('hidden');
  } else if (act === 'new') {
    if (confirm('Начать новую игру? Несохранённый прогресс пропадёт.')) { showStart(); }
  } else if (act === 'fit') {
    if (view) view.fit();
  } else if (act === 'dip-fly') {
    const pid = Number(el.dataset.pid);
    if (pid >= 0 && view) view.focus(game.provs[pid]);
  } else if (act.startsWith('dip-') || act.startsWith('offer-') || act.startsWith('call-')) {
    dipAction(act, el);
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.layer) { settings.layers[t.dataset.layer] = t.checked; saveSettings(); applyLayers(); }
  else if (t.dataset.set) { settings[t.dataset.set] = t.checked; saveSettings(); $('fps').classList.toggle('hidden', !settings.fps); }
  else if (t.dataset.autoOn && game) {
    const me = game.states[game.playerState], k = t.dataset.autoOn;
    if (t.checked) { const r = document.querySelector(`[data-auto="${k}"]`); me.auto[k] = Number(r.value); } else delete me.auto[k];
    sliding = false; refreshPanel();
  } else if (t.dataset.auto) { sliding = false; refreshPanel(); }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.auto && game) {
    sliding = true;
    game.states[game.playerState].auto[t.dataset.auto] = Number(t.value);
    const lab = document.querySelector(`[data-auto-v="${t.dataset.auto}"]`);
    if (lab) lab.textContent = fmt(Number(t.value));
  }
});
document.addEventListener('pointerup', () => { if (sliding) { sliding = false; } });

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

const HOT = { Digit1: 'city', Digit2: 'prod', Digit3: 'res', Digit4: 'budget', Digit5: 'dip', Digit6: 'state', Digit7: 'build' };
window.addEventListener('keydown', (e) => {
  if (!game) return;
  if (e.code === 'Space') { e.preventDefault(); speedIdx = speedIdx === 0 ? 1 : 0; refreshTop(); }
  else if (HOT[e.code] && !e.ctrlKey && !e.metaKey && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
    if (placing) stopPlacing();
    tab = tab === HOT[e.code] ? null : HOT[e.code]; refreshPanel();
  } else if (e.code === 'Equal' || e.code === 'NumpadAdd') view.zoomBy(0.8);
  else if (e.code === 'Minus' || e.code === 'NumpadSubtract') view.zoomBy(1.25);
});
window.addEventListener('resize', () => { if (view) view.resize(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

showStart();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
