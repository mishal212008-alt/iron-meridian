// HTML-панели интерфейса (без состояния: всё берётся из игры).
import { BUILDINGS, BUILD_ORDER, CITY_LEVELS, ECON, MAX_LEVEL, RES, RES_ICON, RES_LABEL, STATES_DEF, TERRAIN } from './data.js';
import { buildError, cityName, costOf, housingCap, jobsOf, levelOf, slots, staffing, upgradeError } from './sim.js';

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
  if (p.deposits.steel && !has('mine')) tips.push(['good', 'Здесь есть руда: постройте рудник.']);
  if (p.deposits.oil && !has('refinery')) tips.push(['good', 'Здесь есть нефть: постройте НПЗ.']);
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
      <div><span>Руда</span><b>${p.deposits.steel ? '⛰️ ' + (p.deposits.steel > 1 ? 'богатая' : 'есть') : '—'}</b></div>
      <div><span>Нефть</span><b>${p.deposits.oil ? '🛢 ' + (p.deposits.oil > 1 ? 'богатая' : 'есть') : '—'}</b></div>
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
  else html += '<p class="muted">Чужой город. Дипломатия, торговля и военные действия появятся на следующих этапах.</p>';

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
          <div class="tag">${fmt(p.pop)} чел. · зданий ${p.buildings.length}/${slots(p)}${p.deposits.steel ? ' · ⛰️' : ''}${p.deposits.oil ? ' · 🛢' : ''}</div></div></button>`;
  }
  return html;
}

export function buildHtml(g, p) {
  const s = g.states[g.playerState];
  const mineSel = p && p.owner === g.playerState;
  let html = head('Строительство', mineSel ? `${dot(s.color)}Город «${p.name}»: ${p.buildings.length}/${slots(p)} мест` : 'Выбери свой город на карте или в списке');
  if (!mineSel) html += `<p class="muted">Ниже — что можно построить и где это лучше всего делать.</p>`;
  const mineCities = g.provs.filter((q) => q.owner === g.playerState);
  for (const type of BUILD_ORDER) {
    const d = BUILDINGS[type];
    const err = mineSel ? buildError(g, p, type) : 'Сначала выбери город';
    const spots = mineCities.filter((q) => !buildError(g, q, type)).sort((a, b) => {
      const sa = (d.needs ? a.deposits[d.needs] : 0) * 100000 + a.pop, sb = (d.needs ? b.deposits[d.needs] : 0) * 100000 + b.pop;
      return sb - sa;
    }).slice(0, 5);
    const spotText = d.needs ? (mineCities.filter((q) => q.deposits[d.needs]).length ? 'Месторождения: ' : 'В вашей стране нет месторождения') : 'Подходящие города:';
    const spotCities = d.needs ? mineCities.filter((q) => q.deposits[d.needs] && q.buildings.length < slots(q)).slice(0, 5) : spots;
    html += `<div class="bcard">
        <div class="bt"><span>${d.icon}</span><b>${d.name}</b></div>
        <div class="bd">${d.desc}</div>
        <div class="bd">Эффект (1 ур.): ${ratesText(type, 1)}</div>
        <div class="bc">${costHtml(d.cost, s)} <span class="days">⏱ ${d.days} дн.</span></div>
        ${spotCities.length ? `<div class="spots"><span class="muted">${spotText}</span><div class="chips">${spotCities.map((q) => cityBtn(g, q)).join('')}</div></div>` : (d.needs ? `<div class="err">${spotText}</div>` : '')}
        <button class="btn" data-act="build" data-type="${type}" ${err ? 'disabled' : ''}>${err ? err : 'Построить здесь'}</button>
      </div>`;
  }
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
  }
  html += '</div>';

  html += `<h3>Энергосеть</h3><div class="facts"><div><span>Выработка</span><b>${s.energy.supply.toFixed(0)}</b></div><div><span>Потребление</span><b>${s.energy.demand.toFixed(0)}</b></div></div>
      <div class="bar"><div style="width:${Math.min(100, ep)}%" class="${ep >= 95 ? 'ok' : ep >= 60 ? 'mid' : 'bad'}"></div></div>`;
  if (ep < 95) html += '<div class="tip bad">Дефицит энергии замедляет всё производство и налоги. Постройте электростанцию и держите запас топлива.</div>';
  if (s.fuel < 40) html += '<div class="tip bad">Топливо почти закончилось: электростанции встанут. Постройте НПЗ у нефти.</div>';

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
  return `<div class="card-main">
      <div><b>${p.capital ? '★ ' : ''}${p.name}</b><div class="sub">${dot(owner.color)}${owner.name} · ${cityName(p)} · ${fmt(p.pop)} чел.</div></div>
      <button class="x" data-act="card-close" aria-label="Закрыть">✕</button>
    </div>
    <div class="card-btns"><button class="btn small" data-act="tab" data-tab="city">Подробно</button>${mine ? '<button class="btn small" data-act="tab" data-tab="build">🏗️ Строить</button>' : ''}</div>`;
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
