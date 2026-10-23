// HTML-панели интерфейса (без состояния: всё берётся из игры).
import { BUILDINGS, BUILD_ORDER, CITY_LEVELS, DEPOSITS, DEPOSIT_KINDS, ECON, MAX_LEVEL, RES, RES_ICON, RES_LABEL, STATES_DEF, TERRAIN, TRADE_RES } from './data.js';
import {
  STATUS_LABEL, dealsBetween, evaluate, fairPrice, hintsFor, isClosed, offerError, offerText, relOf, relWord, statusOf, summarizeNeeds, tradeBlock, valueFor,
} from './diplomacy.js';
import { buildError, canAfford, cityName, cityProduction, costOf, housingCap, jobsOf, levelOf, slots, staffing, upgradeError } from './sim.js';

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
  prod: { icon: '🏭', name: 'Производство' },
  res: { icon: '🧭', name: 'Ресурсы' },
  dip: { icon: '🤝', name: 'Дипломатия' },
  state: { icon: '📊', name: 'Страна' },
};

export function resbarHtml(g) {
  const s = g.states[g.playerState];
  const items = RES.map((k) => {
    const r = s.rate[k] || 0;
    const cls = r > 0.05 ? 'pos' : r < -0.05 ? 'neg' : '';
    return `<span class="res" title="${RES_LABEL[k]}"><b>${RES_ICON[k]}</b>${fmt(s[k])}<i class="${cls}">${signed(r)}</i></span>`;
  });
  const ep = Math.round(s.energy.ratio * 100);
  const ecls = ep >= 95 ? 'pos' : ep >= 60 ? 'warn' : 'neg';
  items.push(`<span class="res" title="Энергия: выработка / потребление"><b>⚡</b><i class="${ecls}">${ep}%</i></span>`);
  return items.join('');
}

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
  if (p.pop >= cap * 0.9) tips.push(['warn', 'Жильё почти заполнено: рост остановится. Постройте жилой квартал.']);
  if (jobs < workers * 0.7) tips.push(['info', `Безработные: ${fmt(workers - jobs)} чел. Постройте производство, чтобы получать больше налогов.`]);
  if (jobs > workers * 1.05) tips.push(['warn', 'Не хватает рабочих рук: здания работают не на полную мощность. Нужно жильё.']);
  if (s.energy.ratio < 0.9) tips.push(['bad', 'В стране дефицит энергии. Постройте электростанцию и следите за топливом.']);
  for (const k of DEPOSIT_KINDS) {
    if (p.deposits[k] && !has(DEPOSITS[k].building)) tips.push(['good', `Здесь есть месторождение (${DEPOSITS[k].name.toLowerCase()}): постройте «${BUILDINGS[DEPOSITS[k].building].name}».`]);
  }
  if (p.buildings.length >= slots(p)) {
    const nxt = CITY_LEVELS[levelOf(p.pop) + 1];
    tips.push(['info', nxt ? `Все места заняты. Рост до «${nxt.name}» (${fmt(nxt.min)} чел.) даст новые места.` : 'Все места заняты.']);
  }
  return tips;
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

  html += `<div class="growth"><div class="gl"><span>Население ${fmt(p.pop)} из ${fmt(cap)}</span><span>${next ? 'до «' + next.name + '» ' + fmt(next.min) : 'максимальный уровень'}</span></div>
      <div class="bar"><div style="width:${Math.round(prog * 100)}%" class="ok"></div></div></div>`;

  html += `<div class="facts">
      <div><span>Работа</span><b>${fmt(Math.min(workers, jobs))} из ${fmt(workers)}</b></div>
      <div><span>Рабочие места</span><b>${fmt(jobs)} (${pct(staffing(p))} заняты)</b></div>
      ${DEPOSIT_KINDS.map((k) => `<div><span>${DEPOSITS[k].name}</span><b>${p.deposits[k] ? DEPOSITS[k].icon + ' ' + (p.deposits[k] > 1 ? 'богатое' : 'есть') : '—'}</b></div>`).join('')}
    </div>`;

  if (mine) {
    const tips = cityAdvice(g, p);
    if (tips.length) html += '<div class="tips">' + tips.map(([k, t]) => `<div class="tip ${k}">${t}</div>`).join('') + '</div>';
  }

  html += `<h3>Здания <small>${p.buildings.length}/${nSlots}</small></h3>`;
  if (!p.buildings.length) html += '<p class="muted">Пока ничего не построено.</p>';
  p.buildings.forEach((b, i) => {
    const d = BUILDINGS[b.type];
    const building = b.buildLeft > 0;
    const status = building
      ? `<span class="tag work">🚧 ${b.level === 0 ? 'строится' : 'улучшение'}: ${b.buildLeft} дн.</span>`
      : `<span class="tag">${ratesText(b.type, b.level)}${b.eff !== undefined && b.type !== 'housing' ? ' · загрузка ' + pct(b.eff) : ''}</span>`;
    let actions = '';
    if (mine) {
      if (!building && b.level < MAX_LEVEL) {
        const err = upgradeError(g, p, i);
        actions += `<button class="btn small" data-act="upgrade" data-i="${i}" ${err ? 'disabled' : ''}>⬆ ${costHtml(costOf(b.type, b.level + 1), s)}</button>`;
      }
      actions += `<button class="btn small ghost" data-act="demolish" data-i="${i}" aria-label="Снести">🗑</button>`;
    }
    html += `<div class="brow"><div class="bicon">${d.icon}</div>
        <div class="binfo"><b>${d.name}</b> <span class="lv">${b.level === 0 ? '' : 'ур. ' + b.level + '/' + MAX_LEVEL}</span><div>${status}</div></div>
        <div class="bact">${actions}</div></div>`;
  });
  if (mine) html += `<button class="btn big" data-act="tab" data-tab="build">🏗️ Строить в городе «${p.name}»</button>`;
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
  html += '<p class="muted">Нажми «Выбрать место», затем коснись карты на своей территории. Зелёный круг — можно строить.</p>';
  const mineCities = g.provs.filter((q) => q.owner === g.playerState);
  for (const type of BUILD_ORDER) {
    const d = BUILDINGS[type];
    const afford = canAfford(s, costOf(type, 1));
    const err = mineSel ? buildError(g, p, type) : null;
    const spotCities = (d.needs ? mineCities.filter((q) => q.deposits[d.needs] && q.buildings.length < slots(q)) : mineCities.filter((q) => q.buildings.length < slots(q)).sort((a, b) => b.pop - a.pop)).slice(0, 5);
    const noDep = d.needs && !mineCities.some((q) => q.deposits[d.needs]);
    html += `<div class="bcard">
        <div class="bt"><span>${d.icon}</span><b>${d.name}</b></div>
        <div class="bd">${d.desc}</div>
        <div class="bd">Эффект (1 ур.): ${ratesText(type, 1)}</div>
        <div class="bc">${costHtml(d.cost, s)} <span class="days">⏱ ${d.days} дн.</span></div>
        ${d.needs ? `<div class="spots"><span class="${noDep ? 'err' : 'muted'}">${noDep ? 'В вашей стране нет месторождения' : 'Строить у месторождения:'}</span><div class="chips">${spotCities.map((q) => cityBtn(g, q)).join('')}</div></div>` : ''}
        <div class="two">
          <button class="btn" data-act="place" data-type="${type}" ${afford && !noDep ? '' : 'disabled'}>${afford ? '📍 Выбрать место' : 'Не хватает ресурсов'}</button>
          ${mineSel ? `<button class="btn ghost" data-act="build" data-type="${type}" ${err ? 'disabled' : ''} title="${err || ''}">⚡ Авто</button>` : ''}
        </div>
        ${err && mineSel ? `<div class="err">${err} (авто)</div>` : ''}
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
  const prod = mine.map((p) => ({ p, c: cityProduction(p) }));
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
  let html = head('Производство', `${dot(s.color)}${s.name} · день ${g.day}`);

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

  html += `<h3>Энергосеть</h3><div class="facts"><div><span>Выработка</span><b>${s.energy.supply.toFixed(0)}</b></div><div><span>Потребление</span><b>${s.energy.demand.toFixed(0)}</b></div></div>
      <div class="bar"><div style="width:${Math.min(100, ep)}%" class="${ep >= 95 ? 'ok' : ep >= 60 ? 'mid' : 'bad'}"></div></div>`;
  if (ep < 95) html += '<div class="tip bad">Дефицит энергии замедляет всё производство и налоги. Постройте электростанцию и держите запас топлива.</div>';
  if (s.fuel < 40) html += '<div class="tip bad">Топливо почти закончилось: электростанции встанут. Постройте НПЗ у нефти или купите топливо у соседей (вкладка «Дипломатия»).</div>';

  html += '<h3>Что работает</h3>';
  const groups = BUILD_ORDER.filter((t) => t !== 'housing');
  let any = false;
  for (const t of groups) {
    const rows = [];
    for (const p of mine) p.buildings.forEach((b) => { if (b.type === t) rows.push([p, b]); });
    if (!rows.length) continue;
    any = true;
    html += `<div class="pgroup"><div class="pg-h">${BUILDINGS[t].icon} ${BUILDINGS[t].name}</div>`;
    for (const [p, b] of rows) {
      const e = b.eff ?? 0;
      html += `<button class="prow" data-act="pick-city" data-id="${p.id}"><span>${p.name}</span>
          <span class="lv">${b.buildLeft > 0 ? '🚧 ' + b.buildLeft + ' дн.' : 'ур. ' + b.level}</span>
          <span class="mini"><i style="width:${Math.round(Math.min(1, e) * 100)}%" class="${e > 0.9 ? 'ok' : e > 0.5 ? 'mid' : 'bad'}"></i></span><span class="pc">${b.buildLeft > 0 && b.level === 0 ? '—' : pct(e)}</span></button>`;
    }
    html += '</div>';
  }
  if (!any) html += '<p class="muted">Нет производственных зданий.</p>';

  html += `<h3>Скоро</h3><div class="soon">
      <div>📦 Склады и колонны снабжения <small>этап 2</small></div>
      <div>🛠️ Заводы техники и армия <small>этапы 3–4</small></div>
      <div>🚀 Ракеты, ПВО, дроны <small>этап 4</small></div></div>`;
  return html;
}

export function stateHtml(g) {
  const s = g.states[g.playerState];
  const mine = g.provs.filter((p) => p.owner === g.playerState);
  const pop = mine.reduce((a, p) => a + p.pop, 0);
  const jobs = mine.reduce((a, p) => a + Math.min(p.pop * ECON.workerShare, jobsOf(p)), 0);
  const counts = {};
  for (const p of mine) for (const b of p.buildings) if (b.level > 0) counts[b.type] = (counts[b.type] || 0) + b.level;

  let html = head(s.name, `${dot(s.color)}Страна · день ${g.day}`);
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

export function startHtml(hasSave) {
  const cards = STATES_DEF.map((s) => `
    <button class="scard" data-act="pick" data-id="${s.id}" style="--c:${s.color}">
      <div class="sname">${s.name}</div><div class="sdesc">${s.desc}</div>
    </button>`).join('');
  return `<div class="start-box">
      <h1>ЖЕЛЕЗНЫЙ<br>МЕРИДИАН</h1>
      <p class="muted">Стратегия: экономика, логистика, ракеты, армии. Сейчас: карта, города и экономика.</p>
      ${hasSave ? '<button class="btn big" data-act="continue">▶ Продолжить игру</button>' : ''}
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
