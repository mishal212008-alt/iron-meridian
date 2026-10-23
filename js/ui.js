// HTML-панели интерфейса (без состояния: всё берётся из игры).
import { BASE_PRICE, BUILDINGS, BUILD_ORDER, CITY_LEVELS, DEPOSITS, DEPOSIT_KINDS, ECON, MAX_LEVEL, RES, RES_ICON, RES_LABEL, STATES_DEF, STOCK_TARGET, TERRAIN, TRADE_RES } from './data.js';
import {
  STATUS_LABEL, dealsBetween, evaluate, fairPrice, hintsFor, isClosed, offerError, offerText, relOf, relWord, statusOf, summarizeNeeds, tradeBlock, valueFor,
} from './diplomacy.js';
import {
  QUESTS, buildError, canAfford, cityName, cityProduction, costOf, currentQuest, forecast, housingCap, jobsOf, levelOf, marketBuyPrice, marketSellPrice, moodOf, slots, staffing, storageFill, totalPop, unemployment, upgradeError,
} from './sim.js';

export function fmt(n) {
  const a = Math.abs(n);
  if (a >= 100000) return Math.round(n / 1000) + 'k';
  if (a >= 10000) return (n / 1000).toFixed(1) + 'k';
  return String(Math.round(n));
}
const signed = (n) => (n >= 0 ? '+' : '−') + fmt(Math.abs(n));
const pct = (x) => Math.round(x * 100) + '%';

export const TABS = {
  city: { icon: '🏙️', name: 'Город' },
  build: { icon: '🏗️', name: 'Строить' },
  prod: { icon: '🏭', name: 'Заводы' },
  res: { icon: '🧭', name: 'Ресурсы' },
  budget: { icon: '💰', name: 'Бюджет' },
  dip: { icon: '🤝', name: 'Дипломатия' },
  state: { icon: '📊', name: 'Страна' },
  flow: { icon: '📈', name: 'Разбор' },
};

const chip = (id, cap, val, delta, cls = '', tab = '') =>
  `<button class="stat-chip ${cls}" data-act="chip" data-k="${id}" data-tab="${tab}"><small>${cap}</small><b data-v="${id}">${val}</b>${delta ? `<i class="${delta[1]}">${delta[0]}</i>` : ''}</button>`;
const dl = (r, unit = '/д') => {
  const c = r > 0.05 ? 'pos' : r < -0.05 ? 'neg' : '';
  return [signed(r) + unit, c];
};

export function resbarHtml(g) {
  const s = g.states[g.playerState];
  const mood = moodOf(g, s);
  const sf = storageFill(s);
  const ep = Math.round(s.energy.ratio * 100);
  const en = s.energy.supply - s.energy.demand;
  const pop = totalPop(g, s);
  const popPrev = s.popPrev ?? pop;
  const out = [];
  out.push(chip('money', 'Деньги', fmt(s.money) + '💰', dl(s.rate.money || 0), 'key' + ((s.rate.money || 0) < -0.05 || s.debt ? ' neg' : ''), 'budget'));
  out.push(chip('pop', 'Население', fmt(pop), dl(pop - popPrev, ''), '', 'city'));
  out.push(chip('energy', 'Энергия', ep + '%', [signed(en), en >= 0 ? 'pos' : 'neg'], ep < 60 ? 'neg' : ep < 95 ? 'warn' : '', 'flow'));
  out.push(chip('steel', 'Сталь', fmt(s.steel), dl(s.rate.steel || 0), (s.rate.steel || 0) < -0.05 ? 'neg' : '', 'flow'));
  out.push(chip('fuel', 'Топливо', fmt(s.fuel), dl(s.rate.fuel || 0), (s.rate.fuel || 0) < -0.05 && s.fuel < 150 ? 'neg' : '', 'flow'));
  out.push(chip('electronics', 'Электроника', fmt(s.electronics), dl(s.rate.electronics || 0), '', 'flow'));
  out.push(chip('food', 'Еда', fmt(s.food), dl(s.rate.food || 0), s.foodRatio < 0.9 ? 'neg' : '', 'flow'));
  out.push(chip('storage', 'Склад', Math.round(sf.fill * 100) + '%', null, sf.fill > 0.95 ? 'neg' : sf.fill > 0.8 ? 'warn' : '', 'res'));
  out.push(chip('mood', 'Настроение', mood + '%', null, mood < 50 ? 'neg' : mood < 75 ? 'warn' : '', 'state'));
  return out.join('');
}

// ---- оповещения (тап — к городу) ----
export function alertsOf(g) {
  const s = g.states[g.playerState];
  const mine = g.provs.filter((p) => p.owner === g.playerState);
  const cap = g.provs[s.capital];
  const out = [];
  if (s.energy.ratio < 0.95) out.push({ kind: 'bad', text: `⚡ Нехватка энергии ${Math.round(s.energy.ratio * 100)}%`, pid: cap.id });
  if (s.foodRatio < 0.95 || s.food < s.foodNeed * 3) {
    const worst = mine.slice().sort((a, b) => b.pop - a.pop)[0];
    out.push({ kind: s.foodRatio < 0.9 ? 'bad' : 'warn', text: s.foodRatio < 0.9 ? '🌾 Голод: постройте ферму' : '🌾 Еда на исходе', pid: (worst || cap).id });
  }
  const short = mine.filter((p) => jobsOf(p) > 0 && staffing(p) < 0.8).sort((a, b) => staffing(a) - staffing(b))[0];
  if (short) out.push({ kind: 'warn', text: `👷 Не хватает рабочих: ${short.name}`, pid: short.id });
  const sf = storageFill(s);
  if (sf.fill > 0.9) out.push({ kind: 'warn', text: `📦 Склад почти полон (${RES_ICON[sf.res]})`, pid: cap.id });
  if (s.debt) out.push({ kind: 'bad', text: '💸 Казна пуста', pid: -1 });
  const q = currentQuest(g);
  if (q) out.push({ kind: 'good', text: `🎯 ${q.text}`, pid: -1, act: 'goals' });
  return out;
}
export function alertsHtml(g) {
  return alertsOf(g).map((a) => `<button class="alert ${a.kind}" data-act="${a.act || 'alert'}" data-pid="${a.pid}">${a.text}</button>`).join('');
}
export function ribbonHtml(g) {
  if (!g.feed.length) return '<span class="none">События появятся здесь</span>';
  return g.feed.slice(0, 12).map((e) => `<button class="ev ${e.kind || ''}" data-act="alert" data-pid="${e.pid}"><small>д.${e.day}</small>${e.text}</button>`).join('');
}

// ---- мини-превью зданий (рисуются сверху, без внешних картинок) ----
const PV = {};
export function previewUrl(type, level = 1) {
  const key = type + level;
  if (PV[key] !== undefined) return PV[key];
  let url = '';
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const x = c.getContext('2d');
    if (x) {
      const R = (cx, cy, w, h, col, r = 3) => { x.fillStyle = col; x.beginPath(); (x.roundRect || x.rect).call(x, cx, cy, w, h, r); x.fill(); };
      const C = (cx, cy, r, col) => { x.fillStyle = col; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); };
      const grd = { farm: '#8a9a52', hydro: '#4b7f9a', warehouse: '#6c7178', port: '#4a6f84', housing: '#7c8a4e', mine: '#6b5a44', goldmine: '#6b5a44', raremine: '#55506b', refinery: '#555a60', power: '#6a7078', steelworks: '#55504a', electronics: '#5a6a78' }[type] || '#666';
      R(4, 4, 88, 88, grd, 14);
      const n = Math.min(level, 3);
      if (type === 'housing') { for (let i = 0; i < 3 + n; i++) R(12 + (i % 3) * 26, 14 + Math.floor(i / 3) * 34, 22, 26, ['#c4553f', '#4f7ec2', '#9aa0a6', '#9a6b48'][i % 4], 4); }
      else if (type === 'farm') { for (let i = 0; i < 4; i++) R(10, 12 + i * 14, 50, 9, i % 2 ? '#c9b35a' : '#6f9a3c', 3); R(62, 40, 24, 22, '#b8473a', 4); C(74, 20, 9 + n * 2, '#d8dade'); }
      else if (type === 'hydro') { R(8, 26, 80, 18, '#c8d0d6', 4); R(8, 52, 80, 30, '#2f78b5', 6); for (let i = 0; i <= n; i++) R(16 + i * 22, 30, 12, 10, '#7a8590', 2); }
      else if (type === 'warehouse') { for (let i = 0; i < 1 + n; i++) R(10, 12 + i * 26, 76, 20, i % 2 ? '#b58a4a' : '#9aa6b0', 3); R(60, 74, 12, 10, '#d8a52c', 2); }
      else if (type === 'port') { R(6, 56, 84, 34, '#2f78b5', 6); R(10, 44, 76, 10, '#9a9388', 2); for (let i = 0; i < 1 + n; i++) R(18 + i * 26, 14, 6, 30, '#d89a2c', 2); R(14, 18, 18, 10, '#b8473a', 2); }
      else if (type === 'mine' || type === 'goldmine' || type === 'raremine') { C(34, 52, 22, '#2b2a2a'); R(54, 18, 28, 26, '#8d949b', 4); R(12, 14, 36, 8, '#555', 2); C(70, 70, 8, type === 'goldmine' ? '#f2c94c' : type === 'raremine' ? '#58c5e8' : '#8b7a60'); }
      else if (type === 'refinery') { C(26, 30, 14, '#d8dade'); C(26, 66, 14, '#d8dade'); C(62, 30, 12, '#b8bec4'); R(52, 54, 34, 12, '#93392d', 3); R(56, 74, 6, 14, '#70777e', 2); }
      else if (type === 'power') { for (let i = 0; i < 1 + n; i++) C(26 + i * 24, 28, 14, '#d4d6da'); C(70, 66, 8, '#b83a30'); R(12, 56, 44, 26, '#a9b2ba', 3); }
      else if (type === 'steelworks') { C(28, 30, 12, '#8b4a3a'); R(48, 18, 36, 14, '#6f757b', 3); R(12, 56, 70, 20, '#474c52', 3); C(72, 40, 7, '#ff7a1a'); }
      else if (type === 'electronics') { R(12, 22, 56, 26, '#cdd2d8', 3); for (let i = 0; i < 4; i++) R(14 + i * 14, 24, 10, 22, '#9aa3ab', 2); R(70, 40, 16, 28, '#8db2cc', 3); R(12, 58, 60, 12, '#39424c', 3); }
      for (let i = 0; i < n; i++) { x.fillStyle = '#ff9a2e'; x.fillRect(8 + i * 10, 86, 8, 5); }
      url = c.toDataURL();
    }
  } catch { url = ''; }
  PV[key] = url;
  return url;
}
const pvImg = (type, level = 1) => { const u = previewUrl(type, level); return u ? `<img class="pvimg" src="${u}" alt="">` : `<div class="pvimg bicon">${BUILDINGS[type].icon}</div>`; };
const lvSq = (lv) => `<span class="lvsq">${Array.from({ length: MAX_LEVEL }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</span>`;

function costHtml(cost, s) {
  return Object.entries(cost).map(([k, v]) => `<span class="cost${s[k] < v ? ' lack' : ''}">${RES_ICON[k]}${fmt(v)}</span>`).join('');
}

function ratesText(type, level) {
  const d = BUILDINGS[type];
  const parts = [];
  if (d.produces) for (const [k, v] of Object.entries(d.produces)) parts.push(`+${v * level}${RES_ICON[k]}`);
  if (d.consumes) for (const [k, v] of Object.entries(d.consumes)) parts.push(`−${v * level}${RES_ICON[k]}`);
  if (d.energy < 0) parts.push(`+${-d.energy * level}${RES_ICON.energy}`);
  if (d.energy > 0) parts.push(`−${d.energy * level}${RES_ICON.energy}`);
  if (d.housing) parts.push(`🏠${d.housing * level}`);
  parts.push(`👷${d.jobs * level}`);
  return parts.join(' ');
}

const dot = (c) => `<span class="dot" style="background:${c}"></span>`;
const head = (title, sub) => `<div class="phead"><div><h2>${title}</h2><div class="sub">${sub}</div></div><button class="x" data-act="close" aria-label="Закрыть">✕</button></div>`;
const cityBtn = (g, p, extra = '') => `<button class="chip ${extra}" data-act="pick-city" data-id="${p.id}">${dot(g.states[p.owner].color)}${p.capital ? '★ ' : ''}${p.name}</button>`;

// ---- советы по городу ----
function cityAdvice(g, p) {
  const tips = [];
  const s = g.states[p.owner];
  const cap = housingCap(p), jobs = jobsOf(p), workers = p.pop * ECON.workerShare;
  const has = (t) => p.buildings.some((b) => b.type === t);
  if (s.foodRatio < 0.95) tips.push(['bad', 'Не хватает еды: рост остановлен, налог ниже. Построй ферму на равнине.']);
  if (p.pop >= cap * 0.9) tips.push(['warn', 'Жильё почти заполнено: рост остановится. Постройте жилой квартал.']);
  if (jobs < workers * 0.7) tips.push(['info', `Безработные: ${fmt(workers - jobs)} чел. Постройте производство, чтобы получать больше налогов.`]);
  if (jobs > workers * 1.05) tips.push(['warn', (p.hired ? `Нанято ${fmt(p.hired)} рабочих из соседних городов, но этого мало. ` : '') + 'Не хватает рабочих рук: нужно жильё.']);
  if (s.energy.ratio < 0.9) tips.push(['bad', 'В стране дефицит энергии. Постройте электростанцию (или ГЭС у реки) и следите за топливом.']);
  for (const k of DEPOSIT_KINDS) {
    if (p.deposits[k] && !has(DEPOSITS[k].building)) tips.push(['good', `Здесь есть месторождение (${DEPOSITS[k].name.toLowerCase()}): постройте «${BUILDINGS[DEPOSITS[k].building].name}».`]);
  }
  if (p.hasRiver && !has('hydro')) tips.push(['info', 'У города есть река: гидростанция даёт энергию без топлива.']);
  if (p.buildings.length >= slots(p)) {
    const nxt = CITY_LEVELS[levelOf(p.pop) + 1];
    tips.push(['info', nxt ? `Все места заняты. Рост до «${nxt.name}» (${fmt(nxt.min)} чел.) даст новые места.` : 'Все места заняты.']);
  }
  return tips;
}

const needBar = (label, v, txt) => {
  const c = v >= 0.95 ? 'ok' : v >= 0.6 ? 'mid' : 'bad';
  return `<div class="need"><span>${label}</span><div class="bar"><div class="${c}" style="width:${Math.round(Math.min(1, v) * 100)}%"></div></div><b>${txt}</b></div>`;
};
export function bStatus(b) {
  if (b.buildLeft > 0) return ['warn', b.level === 0 ? `строится, ${b.buildLeft} дн.` : `улучшается, ${b.buildLeft} дн.`];
  if (b.limit) return ['bad', b.limit.text];
  return ['okc', 'работает'];
}

export function questHtml(g) {
  const q = currentQuest(g);
  if (!q) return '';
  const n = QUESTS.findIndex((x) => x.id === q.id) + 1;
  return `<div class="quest"><div class="qi2">🎯</div><div><b>Совет штаба · цель ${n} из ${QUESTS.length}</b><div>${q.text}</div><small>Награда: ${q.reward}💰</small></div></div>`;
}

export function cityHtml(g, p) {
  if (!p) return citiesListHtml(g);
  const owner = g.states[p.owner];
  const mine = p.owner === g.playerState;
  const s = g.states[g.playerState];
  const cap = housingCap(p);
  const jobs = jobsOf(p);
  const workers = Math.round(p.pop * ECON.workerShare);
  const lvl = levelOf(p.pop);
  const cur = CITY_LEVELS[lvl], next = CITY_LEVELS[lvl + 1];
  const nSlots = slots(p);
  const prog = next ? Math.min(1, (p.pop - cur.min) / (next.min - cur.min)) : 1;

  let html = head(`${p.capital ? '★ ' : ''}${p.name}`, `${dot(owner.color)}${owner.name} · ${cityName(p)} · ${TERRAIN[p.terrain].name}${p.coastal ? ' · у моря' : ''}`);
  if (mine) html += questHtml(g);

  html += `<div class="growth"><div class="gl"><span>Население ${fmt(p.pop)} из ${fmt(cap)}</span><span>${next ? 'до «' + next.name + '» ' + fmt(next.min) : 'максимальный уровень'}</span></div>
      <div class="bar"><div style="width:${Math.round(prog * 100)}%" class="ok"></div></div></div>`;

  if (mine) {
    const fed = s.foodRatio, en = s.energy.ratio, st = staffing(p);
    html += '<h3>Потребности</h3>';
    html += needBar('🌾 Еда', fed, Math.round(fed * 100) + '%');
    html += needBar('⚡ Энергия', en, Math.round(en * 100) + '%');
    html += needBar('👷 Работа', Math.min(1, st), `${fmt(Math.min(workers + (p.hired || 0), jobs))}/${fmt(jobs)}`);
    if (p.hired) html += `<div class="fc">👷 Нанято из соседних городов: <b>${fmt(p.hired)}</b> чел.</div>`;
    else if (jobs > workers * 1.02) html += '<div class="fc">Соседи свободных рабочих не дают: нужно жильё.</div>';
  }

  html += `<div class="facts">
      <div><span>Трудоспособные</span><b>${fmt(workers)}</b></div>
      <div><span>Рабочие места</span><b>${fmt(jobs)}</b></div>
      ${DEPOSIT_KINDS.map((k) => `<div><span>${DEPOSITS[k].name}</span><b>${p.deposits[k] ? DEPOSITS[k].icon + ' ' + (p.deposits[k] > 1 ? 'богатое' : 'есть') : '—'}</b></div>`).join('')}
      ${p.hasRiver ? '<div><span>Река</span><b>🌊 есть</b></div>' : ''}
    </div>`;

  if (mine) {
    const tips = cityAdvice(g, p);
    if (tips.length) html += '<div class="tips">' + tips.slice(0, 4).map(([k, t]) => `<div class="tip ${k}">${t}</div>`).join('') + '</div>';
  }

  html += `<h3>Здания <small>${p.buildings.length}/${nSlots}</small></h3>`;
  if (!p.buildings.length) html += '<p class="muted">Пока ничего не построено.</p>';
  p.buildings.forEach((b, i) => {
    const d = BUILDINGS[b.type];
    const building = b.buildLeft > 0;
    const [sc, st] = bStatus(b);
    let effect = ratesText(b.type, Math.max(1, b.level));
    if (!building && b.level > 0) { const f = forecast(b.type, b.level, p); if (b.type !== 'housing' && f.net) effect += ` · <b class="${f.net >= 0 ? 'pos' : 'neg'}">${signed(f.net)}💰/д</b>`; }
    let actions = '';
    if (mine) {
      if (building) actions += `<button class="btn small" data-act="cancel" data-i="${i}" aria-label="Отменить стройку">↩ Отмена</button>`;
      if (!building && b.level < MAX_LEVEL) {
        const err = upgradeError(g, p, i);
        const gain = forecast(b.type, b.level + 1, p).net - forecast(b.type, b.level, p).net;
        actions += `<button class="btn small" data-act="upgrade" data-i="${i}" ${err ? 'disabled' : ''} title="${err || ''}">⬆ ${costHtml(costOf(b.type, b.level + 1), s)}${gain > 0.05 ? ` <b class="pos">${signed(gain)}</b>` : ''}</button>`;
      }
      if (!building) actions += `<button class="btn small ghost" data-act="demolish" data-i="${i}" aria-label="Снести">🗑</button>`;
    }
    html += `<div class="brow pv">${pvImg(b.type, b.level)}
        <div class="binfo"><b>${d.name}</b>${lvSq(b.level)}<div class="fc">${effect}</div><div class="stline ${sc}">${st}${b.eff !== undefined && !building && b.type !== 'housing' ? ' · ' + pct(Math.min(1, b.eff)) : ''}</div>
        ${mine ? `<div class="bact">${actions}</div>` : ''}</div></div>`;
  });
  if (mine) html += `<button class="btn big red" data-act="tab" data-tab="build">🏗️ Строить в городе «${p.name}»</button>`;
  else html += `<p class="muted">Чужой город (${owner.name}).</p><button class="btn big" data-act="dip-open" data-id="${owner.id}">🤝 Дипломатия с ${owner.name}</button>`;

  const nb = g.nbrs[p.id] || [];
  if (nb.length) html += `<h3>Соседние города</h3><div class="chips">${nb.map((id) => cityBtn(g, g.provs[id])).join('')}</div>`;
  return html;
}

export function citiesListHtml(g) {
  const mine = g.provs.filter((p) => p.owner === g.playerState).sort((a, b) => b.pop - a.pop);
  let html = head('Мои города', `${mine.length} городов. Коснись города на карте или выбери здесь`);
  for (const p of mine) {
    html += `<button class="brow rowbtn" data-act="pick-city" data-id="${p.id}">
        <div class="bicon">${p.capital ? '★' : '🏘️'}</div>
        <div class="binfo"><b>${p.name}</b> <span class="lv">${cityName(p)}</span>
          <div class="tag">${fmt(p.pop)} чел. · зданий ${p.buildings.length}/${slots(p)}${DEPOSIT_KINDS.map((k) => (p.deposits[k] ? ' · ' + DEPOSITS[k].icon : '')).join('')}</div></div></button>`;
  }
  return html;
}

export function buildHtml(g, p) {
  const s = g.states[g.playerState];
  const mineSel = p && p.owner === g.playerState;
  let html = head('Строительство', mineSel ? `${dot(s.color)}Выбран город «${p.name}»: ${p.buildings.length}/${slots(p)} мест` : `${dot(s.color)}Выбери здание, потом место на карте`);
  html += questHtml(g);
  html += '<p class="muted">Нажми «Выбрать место», затем коснись карты на своей территории. Зелёный круг — можно строить.</p>';
  const mineCities = g.provs.filter((q) => q.owner === g.playerState);
  for (const type of BUILD_ORDER) {
    const d = BUILDINGS[type];
    const cost = costOf(type, 1);
    const afford = canAfford(s, cost);
    const err = mineSel ? buildError(g, p, type) : null;
    const free = (q) => q.buildings.length < slots(q);
    let spotCities = mineCities.filter(free);
    if (d.needs) spotCities = spotCities.filter((q) => q.deposits[d.needs]);
    if (d.needsRiver) spotCities = spotCities.filter((q) => q.hasRiver);
    spotCities = spotCities.sort((a, b) => b.pop - a.pop).slice(0, 5);
    let why = '';
    if (d.needs && !mineCities.some((q) => q.deposits[d.needs])) why = 'В вашей стране нет месторождения: ' + DEPOSITS[d.needs].name.toLowerCase();
    else if (d.needsRiver && !mineCities.some((q) => q.hasRiver)) why = 'Нет города у реки';
    else if (!mineCities.some(free)) why = 'Нет свободных мест: города должны вырасти';
    else if (!afford) why = 'Не хватает: ' + Object.entries(cost).filter(([k, v]) => s[k] < v).map(([k, v]) => `${RES_ICON[k]}${fmt(v - s[k])}`).join(' ');
    const fc = forecast(type, 1, mineSel ? p : (d.needs ? { deposits: { [d.needs]: 1 } } : null));
    const fcTxt = fc.indirect ? 'польза косвенная: больше склад / торговля'
      : fc.net > 0.05 ? `+${fc.net.toFixed(1)}💰/день · окупится за ~${Math.round(fc.payback)} дн.` : fc.net < -0.05 ? `${fc.net.toFixed(1)}💰/день: окупается косвенно` : 'окупаемость косвенная';
    html += `<div class="bcard">
        <div class="brow pv" style="border:0;background:none;padding:0;margin:0">${pvImg(type)}<div class="binfo"><div class="bt"><b>${d.name}</b></div>
        <div class="bd">${d.desc}</div></div></div>
        <div class="bd">В день (1 ур.): ${ratesText(type, 1)}</div>
        <div class="bc">${costHtml(cost, s)} <span class="days">⏱ ${d.days} дн.</span></div>
        <div class="fc">📈 Прогноз: <b>${fcTxt}</b></div>
        ${d.needs || d.needsRiver ? `<div class="spots"><span class="muted">Где можно:</span><div class="chips">${spotCities.map((q) => cityBtn(g, q)).join('') || '<span class="err">нигде</span>'}</div></div>` : ''}
        ${why ? `<div class="err">⛔ ${why}</div>` : ''}
        <div class="two">
          <button class="btn" data-act="place" data-type="${type}" ${afford && !why ? '' : 'disabled'}>${afford ? '📍 Выбрать место' : 'Не хватает ресурсов'}</button>
          ${mineSel ? `<button class="btn ghost" data-act="build" data-type="${type}" ${err ? 'disabled' : ''} title="${err || ''}">⚡ Авто</button>` : ''}
        </div>
        ${err && mineSel && !why ? `<div class="err">Авто: ${err}</div>` : ''}
      </div>`;
  }
  return html;
}

export function resHtml(g) {
  const s = g.states[g.playerState];
  const mine = g.provs.filter((p) => p.owner === g.playerState);
  let html = head('Ресурсы на карте', 'Месторождения и кто сколько производит');
  html += '<p class="muted">Пока открыта эта вкладка, на карте видны все месторождения: ⛰️ руда, 🛢 нефть, 🪙 золото, 💎 редкие металлы. У каждого государства свой набор, поэтому торговля важна.</p>';

  const deps = [];
  for (const p of g.provs) for (const kind of DEPOSIT_KINDS) if (p.deposits[kind]) deps.push({ p, kind });
  const row = ({ p, kind }) => {
    const bType = DEPOSITS[kind].building;
    const used = p.buildings.filter((b) => b.type === bType);
    const own = p.owner === g.playerState;
    const d = p.depositPos[kind];
    const status = used.length ? `<span class="tag work">⚙ ${BUILDINGS[bType].name}${used.some((b) => b.buildLeft > 0) ? ' (строится)' : ' ур.' + used[0].level}</span>` : '<span class="tag">свободно</span>';
    return `<div class="brow"><div class="bicon">${DEPOSITS[kind].icon}</div>
        <div class="binfo"><b>${DEPOSITS[kind].name}${p.deposits[kind] > 1 ? ' (богатое)' : ''}</b> <span class="lv">${dot(g.states[p.owner].color)}${p.name}</span><div>${status}</div></div>
        <div class="bact"><button class="btn small ghost" data-act="look" data-x="${d[0]}" data-z="${d[1]}" aria-label="Показать">🔎</button>
        ${own && !used.length ? `<button class="btn small" data-act="place" data-type="${bType}" data-x="${d[0]}" data-z="${d[1]}" ${canAfford(s, costOf(bType, 1)) ? '' : 'disabled'}>🏗️</button>` : ''}</div></div>`;
  };
  html += `<h3>Ваши месторождения <small>${deps.filter((d) => d.p.owner === g.playerState).length}</small></h3>`;
  html += deps.filter((d) => d.p.owner === g.playerState).map(row).join('') || '<p class="muted">Нет.</p>';
  html += '<h3>Чужие месторождения</h3>' + (deps.filter((d) => d.p.owner !== g.playerState).map(row).join('') || '<p class="muted">Нет.</p>');

  html += '<h3>Распределение производства</h3>';
  const prod = mine.map((p) => ({ p, c: cityProduction(p, s) }));
  for (const k of RES) {
    const list = prod.map(({ p, c }) => ({ p, v: c[k].prod, u: c[k].cons })).filter((x) => x.v > 0.05 || x.u > 0.05).sort((a, b) => b.v - a.v).slice(0, 6);
    const max = Math.max(1, ...list.map((x) => x.v));
    html += `<div class="pgroup"><div class="pg-h">${RES_ICON[k]} ${RES_LABEL[k]} <span class="muted">на складе ${fmt(s[k])}</span></div>`;
    html += list.length ? list.map((x) => `<button class="prow" data-act="pick-city" data-id="${x.p.id}"><span>${x.p.name}</span><span class="mini wide"><i style="width:${Math.round((x.v / max) * 100)}%" class="ok"></i></span><span class="pc wide pos">+${x.v.toFixed(1)}</span>${x.u > 0.05 ? `<span class="pc wide neg">−${x.u.toFixed(1)}</span>` : ''}</button>`).join('') : '<p class="muted">Никто не производит.</p>';
    html += '</div>';
  }
  html += '<div class="tip info">Ресурсы общие для всей страны. Склады и перевозки колоннами появятся на следующем этапе: тогда расстояние между городами будет иметь значение.</div>';
  return html;
}

export function prodHtml(g) {
  const s = g.states[g.playerState];
  const mine = g.provs.filter((p) => p.owner === g.playerState);
  const ep = Math.round(s.energy.ratio * 100);
  let html = head('Заводы', `${dot(s.color)}${s.name} · день ${g.day}`);

  const rows = [];
  for (const p of mine) p.buildings.forEach((b) => { if (BUILDINGS[b.type].produces || BUILDINGS[b.type].energy < 0 || b.type !== 'housing') rows.push({ p, b }); });
  const score = ({ b }) => (b.buildLeft > 0 ? 1.5 : b.level === 0 ? 2 : Math.min(1, b.eff ?? 1) - (b.limit ? 0.5 : 0));
  rows.sort((a, c) => score(a) - score(c));
  const probs = rows.filter((r) => r.b.limit && r.b.buildLeft <= 0).length;
  html += probs ? `<div class="tip bad">Простаивают: ${probs}. Проблемные здания — вверху списка.</div>` : '<div class="tip good">Все здания работают.</div>';
  if (ep < 95) html += `<div class="tip bad">Дефицит энергии ${ep}%: всё производство и налоги замедлены.</div>`;
  html += '<table class="ptab">';
  for (const { p, b } of rows) {
    const d = BUILDINGS[b.type];
    const [sc, st] = bStatus(b);
    const e = Math.min(1, b.eff ?? 0);
    html += `<tr class="${sc === 'bad' ? 'prob' : ''}" data-act="pick-city" data-id="${p.id}" style="cursor:pointer">
        <td>${d.icon}</td><td><b>${d.name}</b> ${lvSq(b.level)}<div class="fc">${p.name}</div></td>
        <td style="width:34%"><div class="mini wide"><i style="width:${b.buildLeft > 0 ? 0 : Math.round(e * 100)}%" class="${e > 0.9 ? 'ok' : e > 0.5 ? 'mid' : 'bad'}"></i></div><div class="stline ${sc}">${st}${b.buildLeft > 0 ? '' : ' · ' + pct(e)}</div></td></tr>`;
  }
  html += '</table>';
  if (!rows.length) html += '<p class="muted">Нет производственных зданий.</p>';

  html += '<h3>Ресурсы в день</h3><div class="restable">';
  for (const k of RES) {
    const f = s.flow[k] || { prod: 0, cons: 0 };
    const net = s.rate[k] || 0;
    html += `<div class="rrow"><span class="rn">${RES_ICON[k]} ${RES_LABEL[k]}</span><span class="rs">${fmt(s[k])}</span>
        <span class="pos">+${f.prod.toFixed(1)}</span><span class="neg">−${f.cons.toFixed(1)}</span><b class="${net >= 0 ? 'pos' : 'neg'}">${signed(net)}</b></div>`;
    const tr = s.trade ? s.trade[k] : 0;
    if (Math.abs(tr) > 0.05) html += `<div class="rsub">🤝 торговля: <b class="${tr >= 0 ? 'pos' : 'neg'}">${signed(tr)}</b> в день</div>`;
  }
  html += '</div>';
  return html;
}

// ---- разбор ресурса по источникам (тап по чипу сверху) ----
export function flowHtml(g, k) {
  const s = g.states[g.playerState];
  const mine = g.provs.filter((p) => p.owner === g.playerState);
  const label = k === 'energy' ? 'Энергия' : RES_LABEL[k];
  let html = head(`${k === 'energy' ? '⚡' : RES_ICON[k]} ${label}`, k === 'energy' ? 'Выработка и потребление' : `На складе ${fmt(s[k])} из ${fmt(s.cap)}`);
  const src = {}, use = {};
  for (const p of mine) for (const b of p.buildings) {
    if (b.level <= 0) continue;
    const d = BUILDINGS[b.type], e = Math.min(1, b.eff ?? 1);
    let pr = 0, co = 0;
    if (k === 'energy') { if (d.energy < 0) pr = -d.energy * b.level * e; else co = d.energy * b.level * (b.type === 'housing' ? 1 : 1); }
    else { pr = (d.produces && d.produces[k] || 0) * b.level * e; co = (d.consumes && d.consumes[k] || 0) * b.level * e; }
    if (pr) src[b.type] = (src[b.type] || 0) + pr;
    if (co) use[b.type] = (use[b.type] || 0) + co;
  }
  const line = (name, v, cls) => `<div class="frow"><span>${name}</span><b class="${cls}">${cls === 'pos' ? '+' : '−'}${v.toFixed(1)}</b></div>`;
  html += '<h3>Откуда</h3><div class="frows">' + (Object.entries(src).map(([t, v]) => line(BUILDINGS[t].icon + ' ' + BUILDINGS[t].name, v, 'pos')).join('') || '<p class="muted">Ничего не производится.</p>') + '</div>';
  html += '<h3>Куда уходит</h3><div class="frows">';
  html += Object.entries(use).map(([t, v]) => line(BUILDINGS[t].icon + ' ' + BUILDINGS[t].name, v, 'neg')).join('');
  if (k === 'food') html += line('👥 Жители', s.foodNeed, 'neg');
  html += '</div>';
  const tr = s.trade ? s.trade[k] : 0;
  if (k !== 'energy' && Math.abs(tr) > 0.05) html += `<div class="frow"><span>🤝 Договоры</span><b class="${tr >= 0 ? 'pos' : 'neg'}">${signed(tr)}</b></div>`;
  if (k === 'energy') html += `<div class="facts"><div><span>Выработка</span><b>${s.energy.supply.toFixed(0)}</b></div><div><span>Потребление</span><b>${s.energy.demand.toFixed(0)}</b></div></div>`;
  else html += `<div class="facts"><div><span>Итого за день</span><b class="${(s.rate[k] || 0) >= 0 ? 'pos' : 'neg'}">${signed(s.rate[k] || 0)}</b></div><div><span>Цена на рынке</span><b>${BASE_PRICE[k] ? marketSellPrice(k, s[k]).toFixed(2) + '💰' : '—'}</b></div></div>`;
  return html;
}

// ---- бюджет и рынок ----
export function budgetHtml(g) {
  const s = g.states[g.playerState];
  const b = s.budget;
  let html = head('Бюджет', `${dot(s.color)}Итоги последнего дня · лимит торговли ${Math.floor(s.marketLeft)}/${s.mcap}`);
  const inc = [['Налоги', b.tax], ['Продажа на рынке', b.sales], ['Сделки', Math.max(0, b.deals)]];
  const exp = [['Содержание зданий', b.upkeep], ['Закупки', b.buy], ['Стройка', b.build], ['Сделки', Math.max(0, -b.deals)]];
  const ti = inc.reduce((a, x) => a + x[1], 0), te = exp.reduce((a, x) => a + x[1], 0);
  html += `<h3>Доходы <small class="pos">+${fmt(ti)}</small></h3><div class="frows">${inc.map(([n, v]) => `<div class="frow"><span>${n}</span><b class="pos">+${fmt(v)}</b></div>`).join('')}</div>`;
  html += `<h3>Расходы <small class="neg">−${fmt(te)}</small></h3><div class="frows">${exp.map(([n, v]) => `<div class="frow"><span>${n}</span><b class="neg">−${fmt(v)}</b></div>`).join('')}</div>`;
  html += `<div class="facts"><div><span>Итого за день</span><b class="${ti - te >= 0 ? 'pos' : 'neg'}">${signed(ti - te)}💰</b></div><div><span>В казне</span><b>${fmt(s.money)}💰</b></div></div>`;
  if (s.debt) html += '<div class="tip bad">Казна пуста: расходы больше доходов. Продайте излишки или сократите стройку.</div>';

  html += '<h3>Мировой рынок</h3><p class="muted">Цена продажи падает, когда на складе больше целевого запаса. Купить дороже, чем продать.</p>';
  for (const k of TRADE_RES) {
    const sell = marketSellPrice(k, s[k]) * ((STATES_DEF[s.id] && STATES_DEF[s.id].bonus && STATES_DEF[s.id].bonus.sell) || 1), buy = marketBuyPrice(k, s[k]);
    const tgt = STOCK_TARGET[k];
    const surplus = s[k] > tgt, lack = s[k] < tgt;
    const auto = s.auto[k];
    html += `<div class="mkt"><div class="mt">${RES_ICON[k]} ${RES_LABEL[k]} <span class="fc">${fmt(s[k])} / цель ${fmt(tgt)}</span></div>
        <div class="mp">продать ${sell.toFixed(2)} · купить ${buy.toFixed(2)}</div>
        <div class="two"><button class="btn small" data-act="m-sell" data-k="${k}" ${surplus ? '' : 'disabled'}>Продать излишки</button><button class="btn small" data-act="m-buy" data-k="${k}" ${lack ? '' : 'disabled'}>Докупить</button></div>
        <label class="auto"><input type="checkbox" data-auto-on="${k}" ${auto != null ? 'checked' : ''}> Авто-продажа выше <b data-auto-v="${k}">${auto != null ? fmt(auto) : '—'}</b>
        <input type="range" data-auto="${k}" min="0" max="${Math.round(s.cap)}" step="${Math.max(1, Math.round(s.cap / 100))}" value="${auto != null ? Math.round(auto) : Math.round(tgt * 1.5)}" ${auto != null ? '' : 'disabled'}></label></div>`;
  }
  return html;
}

export function goalsHtml(g) {
  return '<h3>Цели</h3><div>' + QUESTS.map((q) => { const d = g.quests.done.includes(q.id); return `<div class="goal ${d ? 'done' : ''}"><span>${d ? '✅' : '⬜'}</span><span>${q.text} <small class="muted">+${q.reward}💰</small></span></div>`; }).join('') + '</div>';
}

export function stateHtml(g) {
  const s = g.states[g.playerState];
  const mine = g.provs.filter((p) => p.owner === g.playerState);
  const pop = mine.reduce((a, p) => a + p.pop, 0);
  const jobs = mine.reduce((a, p) => a + Math.min(p.pop * ECON.workerShare, jobsOf(p)), 0);
  const counts = {};
  for (const p of mine) for (const b of p.buildings) if (b.level > 0) counts[b.type] = (counts[b.type] || 0) + b.level;

  let html = head(s.name, `${dot(s.color)}Страна · день ${g.day}`);
  html += goalsHtml(g);
  html += `<div class="facts">
      <div><span>Города</span><b>${mine.length}</b></div>
      <div><span>Население</span><b>${fmt(pop)}</b></div>
      <div><span>Заняты</span><b>${fmt(jobs)}</b></div>
      <div><span>Безработные</span><b>${fmt(Math.max(0, pop * ECON.workerShare - jobs))}</b></div>
    </div>`;
  html += '<h3>Здания (сумма уровней)</h3><div class="facts">';
  for (const t of BUILD_ORDER) html += `<div><span>${BUILDINGS[t].icon} ${BUILDINGS[t].name}</span><b>${counts[t] || 0}</b></div>`;
  html += '</div>';

  html += '<h3>Государства</h3>';
  for (const st of g.states) {
    const ps = g.provs.filter((p) => p.owner === st.id);
    const bn = ps.reduce((a, p) => a + p.buildings.filter((b) => b.level > 0).length, 0);
    html += `<div class="brow"><div class="bicon"><span class="dot big" style="background:${st.color}"></span></div>
        <div class="binfo"><b>${st.name}</b>${st.id === g.playerState ? ' <span class="lv">вы</span>' : ''}
        <div class="tag">${ps.length} гор. · ${fmt(ps.reduce((a, p) => a + p.pop, 0))} чел. · ${bn} зданий</div></div></div>`;
  }
  html += '<h3>Города</h3>' + mine.sort((a, b) => b.pop - a.pop).map((p) => `<button class="prow" data-act="pick-city" data-id="${p.id}"><span>${p.capital ? '★ ' : ''}${p.name}</span><span class="lv">${cityName(p)}</span><span class="pc wide">${fmt(p.pop)}</span></button>`).join('');
  return html;
}

// компактная карточка выбранного города (на телефоне вместо панели)
export function cardHtml(g, p) {
  const owner = g.states[p.owner];
  const mine = p.owner === g.playerState;
  const s = g.states[g.playerState];
  let qb = '';
  if (mine) {
    qb = '<div class="qb">' + BUILD_ORDER.map((t) => {
      const d = BUILDINGS[t], c = costOf(t, 1), ok = canAfford(s, c);
      return `<button class="qbtn" data-act="place" data-type="${t}" ${ok ? '' : 'disabled'}><span class="qi">${d.icon}</span><span class="qn">${d.name.split(' ')[0]}</span><span class="qc">💰${fmt(c.money)}</span></button>`;
    }).join('') + '</div>';
  }
  return `<div class="card-main">
      <div><b>${p.capital ? '★ ' : ''}${p.name}</b><div class="sub">${dot(owner.color)}${owner.name} · ${cityName(p)} · ${fmt(p.pop)} чел. · зданий ${p.buildings.length}/${slots(p)}</div></div>
      <button class="x" data-act="card-close" aria-label="Закрыть">✕</button>
    </div>
    ${qb}
    <div class="card-btns"><button class="btn small" data-act="tab" data-tab="city">Подробно</button>${mine ? '<button class="btn small ghost" data-act="tab" data-tab="build">Каталог</button>' : ''}</div>`;
}

export function startHtml(hasSave, diff = 'normal') {
  const cards = STATES_DEF.map((s) => `
    <button class="scard" data-act="pick" data-id="${s.id}" style="--c:${s.color}">
      <div class="sname">${s.name}</div><div class="sdesc">${s.desc}</div>
    </button>`).join('');
  return `<div class="start-box">
      <h1>ЖЕЛЕЗНЫЙ<br>МЕРИДИАН</h1>
      <p class="muted">Стратегия: экономика, логистика, ракеты, армии. Сейчас: карта, города и экономика.</p>
      ${hasSave ? '<button class="btn big" data-act="continue">▶ Продолжить игру</button>' : ''}
      <h3>Сложность ботов</h3>
      <div class="seg">${[['easy', 'Лёгкая'], ['normal', 'Обычная'], ['hard', 'Трудная']].map(([v, n]) => `<button class="${diff === v ? 'on' : ''}" data-act="diff" data-val="${v}">${n}</button>`).join('')}</div>
      <h3>Новая игра: выбери государство</h3>
      <div class="scards">${cards}</div>
    </div>`;
}

// ================= ДИПЛОМАТИЯ =================
const price1 = (v) => (Math.round(v * 10) / 10).toString();
const relBar = (r) => {
  const pos = Math.round(((r + 100) / 200) * 100);
  const c = r < -25 ? 'bad' : r < 15 ? 'mid' : 'ok';
  return `<div class="relbar"><i class="${c}" style="left:${Math.min(pos, 50)}%;width:${Math.abs(pos - 50)}%;${pos < 50 ? '' : 'left:50%'}"></i><u style="left:${pos}%"></u></div>`;
};
const approx = (v) => (v < 30 ? 'почти нет' : v < 120 ? 'мало' : v < 500 ? 'средне' : v < 1500 ? 'много' : 'очень много');

function stateDeposits(g, id) {
  const cnt = {};
  for (const p of g.provs) if (p.owner === id) for (const k of DEPOSIT_KINDS) if (p.deposits[k]) cnt[k] = (cnt[k] || 0) + 1;
  return DEPOSIT_KINDS.map((k) => `<span class="${cnt[k] ? '' : 'none'}">${DEPOSITS[k].icon} ${cnt[k] ? '×' + cnt[k] : 'нет'}</span>`).join(' ');
}

export function dipOverviewHtml(g) {
  const me = g.playerState;
  let html = head('Дипломатия', 'Отношения, границы, договоры и торговля');
  const offers = g.dip.offers.filter((o) => o.to === me);
  if (offers.length) {
    html += `<h3>📨 Входящие предложения <small>${offers.length}</small></h3>`;
    for (const o of offers) {
      const err = offerError(g, o);
      html += `<div class="offer"><div>${dot(g.states[o.from].color)}${offerText(g, o)}</div>
        <div class="muted small">Действует ещё ${Math.max(0, o.expires - g.day)} дн.</div>
        ${err ? `<div class="err">${err}</div>` : ''}
        <div class="two"><button class="btn" data-act="offer-yes" data-id="${o.id}" ${err ? 'disabled' : ''}>✓ Принять</button><button class="btn ghost" data-act="offer-no" data-id="${o.id}">✕ Отклонить</button></div></div>`;
    }
  }
  html += '<h3>Государства</h3>';
  for (const st of g.states) {
    if (st.id === me) continue;
    const rel = relOf(g, me, st.id), status = statusOf(g, me, st.id);
    const mineClosed = g.dip.closed[me][st.id], theirClosed = g.dip.closed[st.id][me];
    const deals = dealsBetween(g, me, st.id).length;
    const nd = summarizeNeeds(g, st);
    html += `<button class="dipcard" data-act="dip-open" data-id="${st.id}" style="--c:${st.color}">
        <div class="dc-h"><span class="sname">${st.name}</span><span class="stat ${status}">${STATUS_LABEL[status]}</span></div>
        <div class="dc-r"><span>${relWord(rel)} (${Math.round(rel)})</span>${relBar(rel)}</div>
        <div class="dc-f">
          <span>${mineClosed ? '🚧 вы закрыли' : '✅ ваша граница открыта'}</span>
          <span>${theirClosed ? '🚧 они закрыли' : '✅ их граница открыта'}</span>
          <span>🤝 сделок: ${deals}</span>
        </div>
        <div class="dc-n">${nd.needs.length ? 'Нужно: ' + nd.needs.map((r) => RES_ICON[r]).join(' ') : ''}${nd.surplus.length ? ' · Излишки: ' + nd.surplus.map((r) => RES_ICON[r]).join(' ') : ''}</div>
      </button>`;
  }
  if (g.dip.log.length) {
    html += '<h3>Журнал</h3><div class="dlog">' + g.dip.log.slice(0, 10).map((l) => `<div><span class="muted">д.${l.day}</span> ${l.text}</div>`).join('') + '</div>';
  }
  html += '<div class="tip info">Закрытая граница останавливает торговлю и машины на КПП. Война пока только дипломатическая: боевые действия появятся на следующих этапах.</div>';
  return html;
}

export function dipTargetHtml(g, ui) {
  const me = g.playerState, t = ui.target;
  const st = g.states[t], my = g.states[me];
  const rel = relOf(g, me, t), status = statusOf(g, me, t);
  const block = tradeBlock(g, me, t);
  let html = `<div class="phead"><div><h2>${dot(st.color)}${st.name}</h2><div class="sub"><span class="stat ${status}">${STATUS_LABEL[status]}</span> · ${relWord(rel)} (${Math.round(rel)})</div></div><button class="x" data-act="close" aria-label="Закрыть">✕</button></div>`;
  html += `<button class="btn small ghost backbtn" data-act="dip-back">← Все государства</button>`;
  if (ui.result) html += `<div class="tip ${ui.result.ok ? 'good' : 'bad'}"><b>${ui.result.msg}</b>${(ui.result.reasons || []).map((r) => `<div>${r}</div>`).join('')}</div>`;
  html += relBar(rel);

  // недра и склад
  html += `<h3>Что у них есть</h3><div class="deps">${stateDeposits(g, t)}</div>`;
  html += '<div class="restable">';
  for (const r of TRADE_RES) {
    const need = st[r] < (r === 'fuel' || r === 'steel' ? 160 : 60), val = valueFor(g, st, r);
    html += `<div class="rrow2"><span>${RES_ICON[r]} ${RES_LABEL[r]}</span><span>${approx(st[r])}</span><span class="${need ? 'neg' : ''}">${need ? 'нужно' : ''}</span><span class="muted">цена ~${price1(val)}💰</span></div>`;
  }
  html += '</div>';

  // границы
  const mc = g.dip.closed[me][t], tc = g.dip.closed[t][me];
  html += `<h3>Границы и КПП</h3>
    <div class="brow"><div class="binfo"><b>Ваша граница</b><div class="tag">${mc ? '🚧 закрыта для ' + st.name : '✅ открыта'}</div></div>
      <div class="bact"><button class="btn small ${mc ? '' : 'ghost'}" data-act="dip-border" data-closed="${mc ? 0 : 1}">${mc ? 'Открыть' : 'Закрыть'}</button></div></div>
    <div class="brow"><div class="binfo"><b>Граница ${st.name}</b><div class="tag">${tc ? '🚧 закрыта для вас' : '✅ открыта'}</div></div></div>`;
  if (status === 'war') html += '<div class="muted small">Во время войны границы заперты.</div>';

  // договоры
  html += '<h3>Договоры</h3>';
  const actions = [];
  const ok = (kind) => evaluate(g, me, t, kind);
  if (status === 'neutral') {
    actions.push(`<button class="btn" data-act="dip-pact" data-kind="friend">🤝 Договор о дружбе</button>`);
    actions.push(`<button class="btn ghost danger" data-act="dip-war">⚔ Объявить войну</button>`);
  } else if (status === 'friend') {
    actions.push(`<button class="btn" data-act="dip-pact" data-kind="ally">🛡 Предложить союз</button>`);
    actions.push(`<button class="btn ghost" data-act="dip-break">Расторгнуть дружбу</button>`);
  } else if (status === 'ally') {
    actions.push(`<button class="btn ghost" data-act="dip-break">Расторгнуть союз</button>`);
  } else {
    actions.push(`<button class="btn" data-act="dip-pact" data-kind="peace">🕊 Предложить мир</button>`);
  }
  actions.push(`<button class="btn ghost" data-act="dip-gift" ${my.money < 100 ? 'disabled' : ''}>🎁 Подарок 100💰 (+отношения)</button>`);
  html += `<div class="col">${actions.join('')}</div>`;
  const tipText = { neutral: 'Дружба нужна от 20 очков отношений, союз от 55. Союзники держат границы открытыми и охотнее торгуют.', friend: 'Друзья торгуют на лучших условиях. Для союза нужно доверие от 55.', ally: 'Союзники не могут закрыть друг для друга границу.', war: 'Мир возможен, когда война идёт достаточно долго и отношения не безнадёжны.' }[status];
  html += `<div class="muted small">${tipText}</div>`;

  // сделки
  const deals = dealsBetween(g, me, t);
  html += `<h3>Торговые сделки <small>${deals.length}</small></h3>`;
  if (!deals.length) html += '<p class="muted">Пока нет сделок.</p>';
  for (const d of deals) {
    const sell = d.seller === me;
    const left = d.until ? `ещё ${Math.max(0, d.until - g.day)} дн.` : 'бессрочно';
    const stt = d.state === 'blocked' ? `<span class="neg">⛔ ${d.why}</span>` : d.state === 'short' ? `<span class="warn">⚠ ${d.why}</span>` : '<span class="pos">● идёт</span>';
    html += `<div class="brow"><div class="bicon">${RES_ICON[d.res]}</div>
        <div class="binfo"><b>${sell ? 'Вы продаёте' : 'Вы покупаете'}: ${d.amt}/дн.</b> <span class="lv">по ${price1(d.price)}💰 · ${left}</span>
          <div>${stt} · ${sell ? '+' : '−'}${price1(d.amt * d.price)}💰/дн.</div></div>
        <div class="bact"><button class="btn small ghost" data-act="dip-cancel" data-id="${d.id}" aria-label="Расторгнуть">✖</button></div></div>`;
  }

  // новая сделка
  const f = ui.form;
  html += '<h3>Новая сделка</h3>';
  const hints = hintsFor(g, me, t).slice(0, 3);
  if (hints.length) {
    html += '<div class="hints">' + hints.map((h) => `<button class="hint" data-act="dip-hint" data-res="${h.res}" data-dir="${h.dir}" data-price="${h.price}">💡 ${h.dir === 'sell' ? 'Продать' : 'Купить'} ${RES_ICON[h.res]} <small>${h.why}</small></button>`).join('') + '</div>';
  }
  html += `<div class="seg"><button class="${f.dir === 'sell' ? 'on' : ''}" data-act="dip-dir" data-dir="sell">Я продаю</button><button class="${f.dir === 'buy' ? 'on' : ''}" data-act="dip-dir" data-dir="buy">Я покупаю</button></div>`;
  html += '<div class="seg res">' + TRADE_RES.map((r) => `<button class="${f.res === r ? 'on' : ''}" data-act="dip-res" data-res="${r}">${RES_ICON[r]}<small>${fmt(my[r])}</small></button>`).join('') + '</div>';
  const fair = fairPrice(f.res), dev = Math.round((f.price / fair - 1) * 100);
  html += `<div class="stepper"><span>Количество в день</span><button data-act="dip-amt" data-d="-2">−</button><b>${f.amt}</b><button data-act="dip-amt" data-d="2">+</button></div>
    <div class="stepper"><span>Цена за единицу</span><button data-act="dip-price" data-d="-0.5">−</button><b>${price1(f.price)}💰</b><button data-act="dip-price" data-d="0.5">+</button></div>
    <div class="muted small">Справочная цена ${price1(fair)}💰 ${dev === 0 ? '' : '(' + (dev > 0 ? '+' : '') + dev + '%)'} · для ${st.name} сейчас ~${price1(valueFor(g, st, f.res))}💰</div>
    <div class="seg"><button class="${f.days === 30 ? 'on' : ''}" data-act="dip-days" data-days="30">30 дн.</button><button class="${f.days === 90 ? 'on' : ''}" data-act="dip-days" data-days="90">90 дн.</button><button class="${f.days === 0 ? 'on' : ''}" data-act="dip-days" data-days="0">бессрочно</button></div>
    <div class="deal-sum">${f.dir === 'sell' ? 'Вы получаете' : 'Вы платите'}: <b>${price1(f.amt * f.price)}💰</b> в день за ${f.amt} ${RES_ICON[f.res]}</div>`;
  html += `<button class="btn big" data-act="dip-send" ${block ? 'disabled' : ''}>📨 Предложить ${st.name}</button>`;
  if (block) html += `<div class="err">${block}</div>`;
  return html;
}

export function dipHtml(g, ui) {
  return ui.target >= 0 && ui.target !== g.playerState ? dipTargetHtml(g, ui) : dipOverviewHtml(g);
}
