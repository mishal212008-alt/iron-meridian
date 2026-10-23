// HTML-панели интерфейса (без состояния: всё берётся из игры).
import { BUILDINGS, BUILD_ORDER, CITY_LEVELS, ECON, MAX_LEVEL, RES, RES_ICON, RES_LABEL, STATES_DEF, TERRAIN } from './data.js';
import { buildError, cityName, costOf, housingCap, jobsOf, levelOf, slots, upgradeError } from './sim.js';

export function fmt(n) {
  const a = Math.abs(n);
  if (a >= 100000) return Math.round(n / 1000) + 'k';
  if (a >= 10000) return (n / 1000).toFixed(1) + 'k';
  return String(Math.round(n));
}
const signed = (n) => (n >= 0 ? '+' : '−') + fmt(Math.abs(n));

export function resbarHtml(g) {
  const s = g.states[g.playerState];
  const items = RES.map((k) => {
    const r = s.rate[k] || 0;
    const cls = r > 0.05 ? 'pos' : r < -0.05 ? 'neg' : '';
    return `<span class="res" title="${RES_LABEL[k]}"><b>${RES_ICON[k]}</b>${fmt(s[k])}<i class="${cls}">${signed(r)}</i></span>`;
  });
  const e = s.energy;
  const ep = Math.round(e.ratio * 100);
  const ecls = ep >= 95 ? 'pos' : ep >= 60 ? 'warn' : 'neg';
  items.push(`<span class="res" title="Энергия: выработка / потребление"><b>⚡</b><i class="${ecls}">${ep}%</i></span>`);
  return items.join('');
}

function costHtml(cost, s) {
  return Object.entries(cost).map(([k, v]) => {
    const lack = s[k] < v ? ' lack' : '';
    return `<span class="cost${lack}">${RES_ICON[k]}${fmt(v)}</span>`;
  }).join('');
}

function ratesText(type, level) {
  const d = BUILDINGS[type];
  const parts = [];
  if (d.produces) for (const [k, v] of Object.entries(d.produces)) parts.push(`+${v * level}${RES_ICON[k]}`);
  if (d.consumes) for (const [k, v] of Object.entries(d.consumes)) parts.push(`−${v * level}${RES_ICON[k]}`);
  if (d.energy < 0) parts.push(`+${-d.energy * level}${RES_ICON.energy}`);
  if (d.energy > 0) parts.push(`−${d.energy * level}${RES_ICON.energy}`);
  if (d.housing) parts.push(`🏠${d.housing * level}`);
  return parts.join(' ');
}

export function sheetHtml(g, p) {
  const owner = g.states[p.owner];
  const mine = p.owner === g.playerState;
  const s = g.states[g.playerState];
  const cap = housingCap(p);
  const jobs = jobsOf(p);
  const workers = Math.round(p.pop * ECON.workerShare);
  const lvl = levelOf(p.pop);
  const next = CITY_LEVELS[lvl + 1];
  const nSlots = slots(p);

  let html = `<div class="sheet-head"><div>
      <h2>${p.capital ? '★ ' : ''}${p.name}</h2>
      <div class="sub"><span class="dot" style="background:${owner.color}"></span>${owner.name} · ${TERRAIN[p.terrain].name} · ${cityName(p)}</div>
    </div><button class="x" data-act="close" aria-label="Закрыть">✕</button></div>`;

  html += `<div class="facts">
      <div><span>Население</span><b>${fmt(p.pop)} / ${fmt(cap)}</b></div>
      <div><span>Работа</span><b>${fmt(Math.min(workers, jobs))} из ${fmt(workers)} раб.</b></div>
      <div><span>Месторождения</span><b>${p.deposits.steel ? '⛰️ руда' + (p.deposits.steel > 1 ? ' (богатая)' : '') : '—'} ${p.deposits.oil ? '🛢 нефть' + (p.deposits.oil > 1 ? ' (богатая)' : '') : ''}</b></div>
      <div><span>Рост города</span><b>${next ? 'до «' + next.name + '» ' + fmt(next.min) + ' чел.' : 'максимум'}</b></div>
    </div>`;

  html += `<h3>Здания <small>${p.buildings.length}/${nSlots}</small></h3>`;
  if (!p.buildings.length) html += '<p class="muted">Пока ничего не построено.</p>';
  p.buildings.forEach((b, i) => {
    const d = BUILDINGS[b.type];
    const building = b.buildLeft > 0;
    const status = building
      ? `<span class="tag work">🚧 ${b.level === 0 ? 'строится' : 'улучшение'}: ${b.buildLeft} дн.</span>`
      : `<span class="tag">${ratesText(b.type, b.level)}</span>`;
    let actions = '';
    if (mine) {
      if (!building && b.level < MAX_LEVEL) {
        const c = costOf(b.type, b.level + 1);
        const err = upgradeError(g, p, i);
        actions += `<button class="btn small" data-act="upgrade" data-i="${i}" ${err ? 'disabled' : ''}>⬆ ${costHtml(c, s)}</button>`;
      }
      actions += `<button class="btn small ghost" data-act="demolish" data-i="${i}" aria-label="Снести">🗑</button>`;
    }
    html += `<div class="brow">
        <div class="bicon">${d.icon}</div>
        <div class="binfo"><b>${d.name}</b> <span class="lv">${b.level === 0 ? '' : 'ур. ' + b.level + '/' + MAX_LEVEL}</span><div>${status}</div></div>
        <div class="bact">${actions}</div>
      </div>`;
  });

  if (mine) {
    html += '<h3>Построить</h3><div class="buildgrid">';
    for (const type of BUILD_ORDER) {
      const d = BUILDINGS[type];
      const err = buildError(g, p, type);
      html += `<button class="bbtn" data-act="build" data-type="${type}" ${err ? 'disabled' : ''}>
          <div class="bt"><span>${d.icon}</span><b>${d.name}</b></div>
          <div class="bd">${d.desc}</div>
          <div class="bc">${costHtml(d.cost, s)} <span class="days">⏱ ${d.days} дн.</span></div>
          ${err ? `<div class="err">${err}</div>` : ''}
        </button>`;
    }
    html += '</div>';
  } else {
    html += '<p class="muted">Чужая провинция. Дипломатия и военные действия появятся на следующих этапах.</p>';
  }
  return html;
}

export function startHtml(hasSave) {
  const cards = STATES_DEF.map((s) => `
    <button class="scard" data-act="pick" data-id="${s.id}" style="--c:${s.color}">
      <div class="sname">${s.name}</div><div class="sdesc">${s.desc}</div>
    </button>`).join('');
  return `<div class="start-box">
      <h1>ЖЕЛЕЗНЫЙ<br>МЕРИДИАН</h1>
      <p class="muted">Стратегия: экономика, логистика, ракеты, армии. Этап 1: карта, города и экономика.</p>
      ${hasSave ? '<button class="btn big" data-act="continue">▶ Продолжить игру</button>' : ''}
      <h3>Новая игра: выбери государство</h3>
      <div class="scards">${cards}</div>
    </div>`;
}
