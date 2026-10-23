// Интерфейс дипломатии: HTML-панели и обработчики действий. Состояние показа — в объекте ui (его держит main.js).
import { DIP, DIP_COST, ESCALATION, IDEO_NAMES, PERS_NAMES, RES_ICON, RES_LABEL, TRADE_RES, TREATIES } from './data.js';
import {
  CB_LABEL, DEMANDS, KIND_NAME, STATUS_LABEL, aggrWord, ambSlots, ambUsed, answerBargain, answerCall, answerOffer, appointAmbassador, backdown, breakConsequences, breakTies, breakTreaty, callError,
  cancelDeal, cbFor, crisisOf, dealsBetween, declareWar, effPower, escalate, establishTies, expelAmbassador, fairPrice, fearOf, gift, hintsFor, infIncome, infOf, interdependence, isClosed,
  joinSanctions, liftSanctions, mediateCrisis, offerCost, offerError, offerText, perceive, preview, propose, recallAmbassador, relItems, relOf, relTrend, relWord, repWord, respond, scoreFor,
  scout, sendAid, setBorder, setEmbargo, sideOf, startCrisis, statusOf, summarizeNeeds, threatTo, tradeBlock, traitKnown, treatiesBetween, valueFor, warBetween, warError, warPreview,
  prerequisite,
} from './diplomacy.js';

const fmt = (n) => { const a = Math.abs(n); return a >= 100000 ? Math.round(n / 1000) + 'k' : a >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)); };
const price1 = (v) => (Math.round(v * 10) / 10).toString();
const dot = (c) => `<span class="dot" style="background:${c}"></span>`;
const head = (title, sub) => `<div class="phead"><div><h2>${title}</h2><div class="sub">${sub}</div></div><button class="x" data-act="close" aria-label="Закрыть">✕</button></div>`;
const relBar = (r) => {
  const pos = Math.round(((r + 100) / 200) * 100);
  const c = r < -25 ? 'bad' : r < 15 ? 'mid' : 'ok';
  return `<div class="relbar"><i class="${c}" style="left:${Math.min(pos, 50)}%;width:${Math.abs(pos - 50)}%;${pos < 50 ? '' : 'left:50%'}"></i><u style="left:${pos}%"></u></div>`;
};
const arrow = (t) => (t > 1.5 ? '<b class="pos">▲</b>' : t < -1.5 ? '<b class="neg">▼</b>' : '<b class="muted">●</b>');
const threatWord = (v) => (v >= 55 ? ['высокая', 't-hi'] : v >= 28 ? ['средняя', 't-mid'] : ['низкая', 't-lo']);
const days = (n) => `${Math.max(0, Math.ceil(n))} дн.`;
const TREATY_ICONS = (g, a, b) => treatiesBetween(g, a, b).map((t) => `<span title="${TREATIES[t.kind].name}">${TREATIES[t.kind].icon}</span>`).join('');
const nm = (g, i) => g.states[i].name;

export const newDipUi = () => ({
  view: 'list', tab: 'states', target: -1, result: null, confirm: null, kind: null, params: {}, logFilter: 'all',
  form: { dir: 'sell', res: 'gold', amt: 6, price: 6, days: 30 }, aid: { res: 'food', amt: 40 },
});

// ---------- входящее: предложения, ультиматумы, призывы ----------
export function dipIncoming(g) {
  const me = g.playerState, d = g.dip, out = [];
  for (const o of d.offers) if (o.to === me) out.push({ type: 'offer', id: o.id, crit: false, o, left: o.expires - g.day });
  for (const c of d.calls) if (c.state === 'open' && c.ally === me) out.push({ type: 'call', id: c.id, crit: true, c, left: c.deadline - g.day });
  for (const c of d.crises) {
    if (c.state !== 'open') continue;
    if (c.b === me && c.awaiting === 'target') out.push({ type: 'crisis', id: c.id, crit: c.step >= 2, c, left: c.deadline - g.day });
    if (c.a === me && c.flags.bargain) out.push({ type: 'bargain', id: c.id, crit: false, c, left: c.deadline - g.day });
    if (c.a === me && c.awaiting === 'instigator' && c.refused && !c.flags.bargain) out.push({ type: 'refused', id: c.id, crit: false, c, left: c.deadline - g.day });
  }
  return out;
}
export const dipSignature = (g) => dipIncoming(g).map((i) => i.type + i.id + (i.c ? i.c.step : '')).join(',');

function demandNote(g, c) {
  const dm = c.demand;
  const pay = dm.kind === 'tribute' ? Math.min(g.states[c.b].money, dm.amount) : dm.kind === 'resource' ? Math.min(g.states[c.b][dm.res], dm.amount) : 0;
  return { text: dm.text, pay };
}
function incomingCard(g, it) {
  const me = g.playerState;
  const timer = `<span class="timer ${it.left <= 2 ? 'hot' : ''}">⏳ ${days(it.left)}</span>`;
  if (it.type === 'offer') {
    const o = it.o, err = offerError(g, o);
    return `<div class="offer"><div class="of-h">${dot(g.states[o.from].color)}<b>${offerText(g, o)}</b>${timer}</div>
      ${o.params && o.params.sweet && o.params.sweet.money ? `<div class="muted small">Вместе с договором вам отдадут ${o.params.sweet.money}💰</div>` : ''}
      ${err ? `<div class="err">${err}</div>` : ''}
      <div class="two"><button class="btn" data-act="offer-yes" data-id="${o.id}" ${err ? 'disabled' : ''}>✓ Принять</button><button class="btn ghost" data-act="offer-no" data-id="${o.id}">✕ Отказать</button></div>
      <div class="muted small">Отказ слегка охладит отношения.</div></div>`;
  }
  if (it.type === 'call') {
    const c = it.c, war = g.dip.wars.find((w) => w.id === c.war);
    const enemies = war ? (c.side === 'A' ? war.sideB : war.sideA) : [];
    const err = callError(g, c);
    return `<div class="offer crit"><div class="of-h">⚔ <b>${nm(g, c.to)} призывает вас в войну против ${enemies.map((e) => nm(g, e)).join(', ')}</b>${timer}</div>
      <div class="muted small">${c.binding ? 'Обязательная помощь по договору.' : 'Помощь по желанию.'}</div>
      ${err ? `<div class="err">${err}</div>` : ''}
      <div class="two"><button class="btn danger2" data-act="call-yes" data-id="${c.id}" ${err ? 'disabled' : ''}>⚔ Вступить</button><button class="btn ghost" data-act="call-no" data-id="${c.id}">Не вступать</button></div>
      <div class="muted small">Вступление: война с ${enemies.map((e) => nm(g, e)).join(', ')}, границы и торговля с ними закроются.<br>Отказ: ${c.binding ? `договор будет нарушен, репутация надёжности −${DIP.repViolation} у всех` : 'отношения с союзником слегка ухудшатся'}. Молчание = отказ.</div></div>`;
  }
  if (it.type === 'crisis') {
    const c = it.c, dn = demandNote(g, c), step = ESCALATION[c.step];
    const hasFriends = g.dip.treaties.some((t) => t.state === 'active' && ['ally', 'defense', 'protect'].includes(t.kind) && (t.a === me || t.b === me));
    const meds = mediators(g, c).slice(0, 2);
    return `<div class="offer crit"><div class="of-h">${step.icon} <b>${step.name}: ${nm(g, c.a)} требует ${dn.text}</b>${timer}</div>
      <div class="muted small">Ступень ${c.step + 1} из 6. ${step.info}${c.flags.mobilize ? ' Обе страны несут расходы мобилизации.' : ''}${c.flags.blockade ? ' Торговля блокирована.' : ''}</div>
      <div class="optlist">
        <button class="opt" data-act="dip-resp" data-id="${c.id}" data-ch="yield"><b>Уступить</b><small>${dn.text}${c.step >= 2 ? '. Потеря лица −10 (престиж)' : '. Без потери лица'}</small></button>
        <button class="opt" data-act="dip-resp" data-id="${c.id}" data-ch="bargain"><b>Торговаться</b><small>Предложить половину требований; они могут отказать</small></button>
        <button class="opt" data-act="dip-resp" data-id="${c.id}" data-ch="refuse"><b>Отказать</b><small>${c.step >= 2 ? `${nm(g, c.a)} получит повод к войне.` : 'Кризис может обостриться.'} Риск войны.</small></button>
        <button class="opt" data-act="dip-resp" data-id="${c.id}" data-ch="appeal" ${hasFriends ? '' : 'disabled'}><b>Обратиться за помощью</b><small>${hasFriends ? 'Союзники могут выступить в вашу поддержку' : 'Нет союзников'}</small></button>
        ${meds.map((m) => `<button class="opt" data-act="dip-med" data-id="${c.id}" data-who="${m}"><b>Посредничество: ${nm(g, m)}</b><small>Спор улаживается компромиссом без потери лица. Стоит 3 🕊️</small></button>`).join('')}
      </div></div>`;
  }
  if (it.type === 'bargain') {
    const c = it.c;
    return `<div class="offer"><div class="of-h">🤝 <b>${nm(g, c.b)} предлагает компромисс: половина требований (${c.demand.text})</b>${timer}</div>
      <div class="two"><button class="btn" data-act="dip-bg" data-id="${c.id}" data-yes="1">✓ Принять</button><button class="btn ghost" data-act="dip-bg" data-id="${c.id}" data-yes="0">✕ Отклонить</button></div></div>`;
  }
  const c = it.c;
  return `<div class="offer"><div class="of-h">${ESCALATION[c.step].icon} <b>${nm(g, c.b)} отказала. Что дальше?</b>${timer}</div>
    <div class="two"><button class="btn" data-act="dip-esc" data-id="${c.id}">⬆ Эскалация</button><button class="btn ghost" data-act="dip-bd" data-id="${c.id}">⬇ Отступить</button></div></div>`;
}
function mediators(g, c) {
  const me = g.playerState;
  return [0, 1, 2, 3].filter((m) => m !== c.a && m !== c.b && m !== me && g.dip.ties[m][me] && g.dip.ties[m][c.a] && g.dip.inf[m] >= DIP_COST.mediate && relOf(g, m, me) > 0);
}

// ---------- список государств ----------
function listHtml(g, ui) {
  const me = g.playerState;
  let html = head('Дипломатия', `🕊️ влияние <b>${Math.floor(infOf(g, me))}</b> (+${infIncome(g, me).toFixed(1)}/дн.) · послов ${ambUsed(g, me)}/${ambSlots(g, me)}`);
  html += `<div class="seg"><button class="${ui.tab === 'states' ? 'on' : ''}" data-act="dip-tab" data-tab="states">Государства</button><button class="${ui.tab === 'log' ? 'on' : ''}" data-act="dip-tab" data-tab="log">Журнал</button><button class="${ui.tab === 'sum' ? 'on' : ''}" data-act="dip-tab" data-tab="sum">Сводка</button></div>`;
  if (ui.result) html += resultHtml(ui.result);
  if (ui.confirm) html += confirmHtml(ui.confirm);
  if (ui.tab === 'log') return html + logHtml(g, ui);
  if (ui.tab === 'sum') return html + summaryHtml(g);
  const inc = dipIncoming(g);
  if (inc.length) html += `<h3>📨 Требуют ответа <small>${inc.length}</small></h3>` + inc.map((i) => incomingCard(g, i)).join('');
  html += '<h3>Государства</h3>';
  for (const st of g.states) {
    if (st.id === me) continue;
    const rel = relOf(g, me, st.id), status = statusOf(g, me, st.id);
    const [tw, tc] = threatWord(threatTo(g, me, st.id));
    const ties = g.dip.ties[me][st.id];
    html += `<button class="dipcard" data-act="dip-open" data-id="${st.id}" style="--c:${st.color}">
        <div class="dc-h"><span class="sname">${st.name}</span><span class="stat ${status}">${STATUS_LABEL[status]}</span></div>
        <div class="dc-r"><span>${ties ? relWord(rel) + ' (' + Math.round(rel) + ')' : 'нет дипотношений'} ${ties ? arrow(relTrend(g, me, st.id)) : ''}</span>${relBar(rel)}</div>
        <div class="dc-f"><span class="dtr">${TREATY_ICONS(g, me, st.id) || '<span class="muted">без договоров</span>'}</span><span class="thr ${tc}">угроза: ${tw}</span>${g.dip.amb[me][st.id] ? '<span>🎩 посол</span>' : ''}</div>
      </button>`;
  }
  return html;
}
const resultHtml = (r) => `<div class="tip ${r.ok ? 'good' : 'bad'}"><b>${r.msg}</b>${(r.reasons || []).map((x) => `<div>${x}</div>`).join('')}${r.counter ? `<div>💬 Встречное: ${r.counter.text}</div>` : ''}</div>`;
function confirmHtml(c) {
  return `<div class="confirm"><h3>${c.title}</h3>${c.lines.map((l) => `<div class="cl">• ${l}</div>`).join('')}
    <div class="two"><button class="btn ${c.danger ? 'danger2' : ''}" data-act="dip-yes">${c.yesText || 'Подтвердить'}</button><button class="btn ghost" data-act="dip-no">Отмена</button></div></div>`;
}

// ---------- журнал ----------
const FILTERS = [['all', 'Все'], ['war', 'Войны'], ['crisis', 'Кризисы'], ['treaty', 'Договоры'], ['trade', 'Торговля'], ['event', 'События'], ['mine', 'Мои']];
function logHtml(g, ui) {
  const me = g.playerState;
  let html = '<div class="chips">' + FILTERS.map(([k, n]) => `<button class="chipf ${ui.logFilter === k ? 'on' : ''}" data-act="dip-lf" data-f="${k}">${n}</button>`).join('') + '</div>';
  let items = g.dip.log;
  if (ui.logFilter === 'mine') items = items.filter((l) => l.a === me || l.b === me);
  else if (ui.logFilter !== 'all') items = items.filter((l) => l.kind === ui.logFilter || (ui.logFilter === 'war' && l.kind === 'war') || (ui.logFilter === 'trade' && l.kind === 'deal'));
  if (!items.length) return html + '<p class="muted">Пока ничего не происходило.</p>';
  html += '<div class="wlog">' + items.slice(0, 60).map((l) => {
    const pid = l.a >= 0 ? g.states[l.a].capital : -1;
    return `<button class="le ${l.important ? 'imp' : ''}" ${pid >= 0 ? `data-act="dip-fly" data-pid="${pid}"` : ''}><small>д.${l.day}</small>${l.text}</button>`;
  }).join('') + '</div>';
  return html;
}

// ---------- сводка мира ----------
function summaryHtml(g) {
  let html = '<h3>Силы в мире</h3>';
  const total = g.states.reduce((s, _, i) => s + effPower(g, i), 0);
  for (const st of g.states) {
    const p = effPower(g, st.id) / Math.max(0.01, total);
    html += `<div class="brow"><div class="binfo"><b>${dot(st.color)}${st.name}</b> <span class="lv">${Math.round(p * 100)}% мощи · репутация: ${repWord(g.dip.rep[st.id].reliab)}, ${aggrWord(g.dip.rep[st.id].aggr)}</span>
      <div class="pwr"><i style="width:${Math.round(p * 100)}%;background:${st.color}"></i></div></div></div>`;
  }
  const wars = g.dip.wars.filter((w) => w.state !== 'ended');
  html += '<h3>Войны</h3>' + (wars.length ? wars.map((w) => `<div class="brow"><div class="binfo"><b>${w.sideA.map((i) => nm(g, i)).join(', ')} ⚔ ${w.sideB.map((i) => nm(g, i)).join(', ')}</b>
      <div class="muted small">${w.state === 'ceasefire' ? '🏳️ перемирие до дня ' + w.ceaseUntil : 'идёт ' + (g.day - w.start) + ' дн., счёт ' + Math.round(w.score) + ', усталость ' + Math.round(w.exh.A) + '/' + Math.round(w.exh.B)}</div></div></div>`).join('') : '<p class="muted">Мир.</p>');
  const blocs = g.dip.treaties.filter((t) => t.state === 'active' && ['ally', 'defense', 'protect', 'offense'].includes(t.kind));
  html += '<h3>Блоки и союзы</h3>' + (blocs.length ? blocs.map((t) => `<div class="brow"><div class="binfo">${TREATIES[t.kind].icon} <b>${nm(g, t.a)} — ${nm(g, t.b)}</b> <span class="lv">${TREATIES[t.kind].name}${t.terms.target !== undefined ? ' против ' + nm(g, t.terms.target) : ''}</span></div></div>`).join('') : '<p class="muted">Блоков нет.</p>');
  const crises = g.dip.crises.filter((c) => c.state === 'open');
  if (crises.length) html += '<h3>Кризисы</h3>' + crises.map((c) => `<div class="brow"><div class="binfo">${ESCALATION[c.step].icon} <b>${nm(g, c.a)} → ${nm(g, c.b)}</b> <span class="lv">${ESCALATION[c.step].name}: ${c.demand.text}</span></div></div>`).join('');
  return html;
}

// ---------- карточка государства ----------
function traitsHtml(g, me, t) {
  const P = g.dip.pers[t], rows = [];
  for (const k of Object.keys(PERS_NAMES)) {
    if (traitKnown(g, me, t, k)) {
      if (k === 'ideo') rows.push(`<div class="trait"><span>${PERS_NAMES[k]}</span><b>${IDEO_NAMES[P.ideo] || P.ideo}</b></div>`);
      else rows.push(`<div class="trait"><span>${PERS_NAMES[k]}</span><div class="tbar"><i style="width:${Math.round(P[k] * 100)}%"></i></div></div>`);
    } else rows.push(`<div class="trait unk"><span>${PERS_NAMES[k]}</span><b>? неизвестно</b></div>`);
  }
  return rows.join('');
}
function stateHtml(g, ui) {
  const me = g.playerState, t = ui.target, st = g.states[t], my = g.states[me], d = g.dip;
  const rel = relOf(g, me, t), status = statusOf(g, me, t), ties = d.ties[me][t];
  let html = `<div class="phead"><div><h2>${dot(st.color)}${st.name}</h2><div class="sub"><span class="stat ${status}">${STATUS_LABEL[status]}</span> · ${ties ? relWord(rel) + ' (' + Math.round(rel) + ')' : 'нет дипотношений'} ${arrow(relTrend(g, me, t))}</div></div><button class="x" data-act="close" aria-label="Закрыть">✕</button></div>`;
  html += `<button class="btn small ghost backbtn" data-act="dip-back">← Все государства</button>`;
  html += `<div class="muted small">🕊️ у вас ${Math.floor(infOf(g, me))} очков влияния</div>`;
  if (ui.result) html += resultHtml(ui.result);
  if (ui.confirm) html += confirmHtml(ui.confirm);
  html += relBar(rel);
  // срочное
  const inc = dipIncoming(g).filter((i) => (i.o && (i.o.from === t)) || (i.c && (i.c.a === t || i.c.b === t || i.c.to === t)));
  if (inc.length) html += inc.map((i) => incomingCard(g, i)).join('');

  // разбор отношения
  const items = relItems(g, me, t).slice().sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const itemsBack = relItems(g, t, me).slice().sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  html += '<h3>Почему так</h3><div class="factors"><div class="fh">Как мы относимся к ним</div>' + (items.length ? items.map(facRow).join('') : '<div class="muted small">Ничего заметного.</div>') + '</div>';
  if (ties && d.know[me][t] >= 30) html += '<div class="factors"><div class="fh">Как они относятся к нам</div>' + (itemsBack.length ? itemsBack.map(facRow).join('') : '<div class="muted small">Ничего заметного.</div>') + '</div>';
  else if (ties) html += '<div class="muted small">Чтобы понимать их отношение к вам, нужна разведка (знаний ≥ 30).</div>';

  // сила, угроза, личность
  const per = perceive(g, me, t), noise = Math.round((per.noise || 0) * 100);
  const [tw, tc] = threatWord(threatTo(g, me, t));
  html += `<h3>Сила и репутация</h3>
    <div class="brow"><div class="binfo"><b>Мощь ${Math.round(per.power)}</b> <span class="lv">у вас ${Math.round(effPower(g, me))}${noise > 8 ? ' · оценка неточна (±' + noise + '%)' : ''}</span>
      <div>Угроза для вас: <span class="thr ${tc}">${tw}</span> · ${t >= 0 && d.adj[me][t] > 0 ? 'граница общая' : 'через соседей'}</div>
      <div>Репутация: ${repWord(d.rep[t].reliab)} (${Math.round(d.rep[t].reliab)}), ${aggrWord(d.rep[t].aggr)}</div></div></div>`;
  html += `<h3>Личность <small>знаний ${Math.round(d.know[me][t])}/100</small></h3><div class="traits">${traitsHtml(g, me, t)}</div>`;
  if (ties) html += `<button class="btn small" data-act="dip-scout" data-id="${t}">🔎 Разведка (${DIP_COST.scout} 🕊️)</button>`;

  // активные договоры
  const trs = treatiesBetween(g, me, t);
  html += `<h3>Договоры <small>${trs.length}</small></h3>`;
  if (!trs.length) html += '<p class="muted">Нет действующих договоров.</p>';
  for (const tr of trs) {
    const info = [tr.until ? 'ещё ' + days(tr.until - g.day) : 'бессрочно'];
    if (tr.clauses.binding) info.push('обязательный'); if (tr.clauses.noChain) info.push('без цепной реакции');
    if (tr.terms.target !== undefined) info.push('против ' + nm(g, tr.terms.target));
    if (tr.kind === 'protect') info.push(tr.a === me ? 'вы покровитель' : 'вы вассал');
    const canBreak = !['truce', 'peacetreaty'].includes(tr.kind) && !(tr.kind === 'protect' && tr.b === me);
    html += `<div class="brow"><div class="bicon">${TREATIES[tr.kind].icon}</div><div class="binfo"><b>${TREATIES[tr.kind].name}</b><div class="muted small">${info.join(' · ')}</div></div>
      ${canBreak ? `<div class="bact"><button class="btn small ghost" data-act="dip-brk" data-id="${tr.id}" data-kind="${tr.kind}" aria-label="Расторгнуть">✖</button></div>` : ''}</div>`;
  }

  // война / мир
  const war = warBetween(g, me, t);
  if (war) {
    const sc = scoreFor(war, me), side = sideOf(war, me);
    html += `<h3>${war.state === 'ceasefire' ? '🏳️ Перемирие' : '💥 Война'}</h3><div class="tip ${war.state === 'ceasefire' ? 'info' : 'bad'}">${war.state === 'ceasefire' ? `Перемирие до дня ${war.ceaseUntil}.` : `Идёт ${g.day - war.start} дн. Счёт войны: <b>${sc > 0 ? '+' : ''}${Math.round(sc)}</b> в вашу ${sc >= 0 ? 'пользу' : 'сторону проигрыша'}. Усталость: вы ${Math.round(war.exh[side])}, они ${Math.round(war.exh[side === 'A' ? 'B' : 'A'])}.`}<br>Пока армий нет, война экономическая: блокада, разрыв торговли, потери производства и настроения.</div>`;
    html += '<div class="col">' + ['truce', 'whitepeace', 'peacetreaty'].filter((k) => !(war.state === 'ceasefire' && k === 'truce')).map((k) => kindBtn(g, me, t, k, true)).join('') + '</div>';
  }

  // кризис
  const cr = crisisOf(g, me, t);
  html += crisisBlock(g, ui, me, t, cr, war);

  // действия
  html += '<h3>Действия</h3><div class="col">';
  if (!ties) html += `<button class="btn" data-act="dip-ties" data-id="${t}">🤝 Установить дипотношения (${DIP_COST.relations} 🕊️)</button>`;
  else {
    if (!d.amb[me][t]) html += `<button class="btn" data-act="dip-amb" data-id="${t}">🎩 Назначить посла (${DIP_COST.amb} 🕊️)</button>`;
    else html += `<button class="btn ghost" data-act="dip-recall" data-id="${t}">🎩 Отозвать посла</button>`;
    if (d.amb[t][me]) html += `<button class="btn ghost danger" data-act="dip-png" data-id="${t}">🚫 Объявить посла персоной нон грата</button>`;
  }
  const mc = d.closed[me][t];
  html += `<button class="btn ghost" data-act="dip-border" data-closed="${mc ? 0 : 1}" ${status === 'war' ? 'disabled' : ''}>${mc ? '🚪 Открыть границу' : '🚧 Закрыть границу'}</button>`;
  html += `<button class="btn ghost" data-act="dip-emb" data-on="${d.embargo[me][t] ? 0 : 1}">${d.embargo[me][t] ? '✅ Снять эмбарго' : '⛔ Ввести эмбарго (' + DIP_COST.sanction + ' 🕊️)'}</button>`;
  const sanc = d.sanc[t];
  html += `<button class="btn ghost" data-act="dip-sanc" data-id="${t}">${sanc.includes(me) ? '✅ Выйти из санкций' : '🚫 Присоединиться к санкциям (' + DIP_COST.sanction + ' 🕊️)'}${sanc.length ? ` · уже ${sanc.length}` : ''}</button>`;
  html += `<button class="btn ghost" data-act="dip-gift" data-id="${t}" ${my.money < 100 ? 'disabled' : ''}>🎁 Подарок 100💰 (${DIP_COST.gift} 🕊️)</button>`;
  if (ties && status !== 'war') html += `<button class="btn ghost" data-act="dip-aidopen">📦 Гуманитарная помощь…</button>`;
  html += '</div>';
  if (ui.aidOpen) html += aidForm(g, ui);
  if (ties && !['war'].includes(status)) {
    html += '<h3>Предложить договор</h3><div class="col">' + ['trade', 'friend', 'nap', 'defense', 'offense', 'ally', 'protect'].map((k) => kindBtn(g, me, t, k)).join('') + `<button class="btn ghost" data-act="dip-kind" data-kind="loan">🏦 Заём…</button></div>`;
  }

  // сделки
  const deals = dealsBetween(g, me, t);
  html += `<h3>Торговые сделки <small>${deals.length}</small></h3>`;
  if (!deals.length) html += '<p class="muted">Пока нет сделок.</p>';
  for (const dl of deals) {
    const sell = dl.seller === me;
    const left = dl.until ? `ещё ${Math.max(0, dl.until - g.day)} дн.` : 'бессрочно';
    const stt = dl.state === 'blocked' ? `<span class="neg">⛔ ${dl.why}</span>` : dl.state === 'short' ? `<span class="warn">⚠ ${dl.why}</span>` : '<span class="pos">● идёт</span>';
    html += `<div class="brow"><div class="bicon">${RES_ICON[dl.res]}</div>
        <div class="binfo"><b>${sell ? 'Вы продаёте' : 'Вы покупаете'}: ${dl.amt}/дн.</b> <span class="lv">по ${price1(dl.price)}💰 · ${left}</span>
          <div>${stt} · ${sell ? '+' : '−'}${price1(dl.amt * dl.price)}💰/дн.</div></div>
        <div class="bact"><button class="btn small ghost" data-act="dip-cancel" data-id="${dl.id}" aria-label="Расторгнуть">✖</button></div></div>`;
  }
  html += `<button class="btn big" data-act="dip-kind" data-kind="deal">➕ Новая сделка…</button>`;

  // история
  const hist = d.log.filter((l) => (l.a === me && l.b === t) || (l.a === t && l.b === me) || l.a === t || l.b === t).slice(0, 8);
  if (hist.length) html += '<h3>История</h3><div class="dlog">' + hist.map((l) => `<div><span class="muted">д.${l.day}</span> ${l.text}</div>`).join('') + '</div>';
  return html;
}
const facRow = (f) => `<div class="fac"><span>${f.label}</span><b class="${f.v > 0 ? 'pos' : 'neg'}">${f.v > 0 ? '+' : ''}${Math.round(f.v * 10) / 10}</b></div>`;
function kindBtn(g, me, t, kind, peace = false) {
  const err = prerequisite(g, me, t, kind, kind === 'offense' ? { target: [0, 1, 2, 3].find((x) => x !== me && x !== t) } : kind === 'protect' ? { over: me } : {});
  const def = TREATIES[kind];
  const cost = offerCost(kind);
  return `<button class="btn ${peace ? '' : 'ghost'} kind" data-act="dip-kind" data-kind="${kind}" ${err ? 'disabled' : ''}><span>${def.icon} ${def.name} <small>${cost} 🕊️</small></span>${err ? `<small class="why">${err}</small>` : `<small class="why">${def.info}</small>`}</button>`;
}
function aidForm(g, ui) {
  const a = ui.aid, my = g.states[g.playerState];
  return `<div class="confirm"><h3>Гуманитарная помощь</h3>
    <div class="seg res">${TRADE_RES.map((r) => `<button class="${a.res === r ? 'on' : ''}" data-act="dip-aidres" data-res="${r}">${RES_ICON[r]}<small>${fmt(my[r])}</small></button>`).join('')}</div>
    <div class="stepper"><span>Количество</span><button data-act="dip-aidamt" data-d="-20">−</button><b>${a.amt}</b><button data-act="dip-aidamt" data-d="20">+</button></div>
    <div class="two"><button class="btn" data-act="dip-aidsend">Отправить (${DIP_COST.aid} 🕊️)</button><button class="btn ghost" data-act="dip-aidopen">Закрыть</button></div></div>`;
}
function crisisBlock(g, ui, me, t, cr, war) {
  let html = '';
  if (cr) {
    const iAmA = cr.a === me, step = ESCALATION[cr.step];
    html += `<h3>${step.icon} Кризис: ${step.name}</h3>
      <div class="ladder">${ESCALATION.map((s, i) => `<span class="rung ${i < cr.step ? 'done' : i === cr.step ? 'now' : ''}" title="${s.name}">${s.icon}</span>`).join('')}</div>
      <div class="tip warn">${iAmA ? 'Вы требуете' : nm(g, cr.a) + ' требует'}: <b>${cr.demand.text}</b>. Срок: ${days(cr.deadline - g.day)}. ${cr.refused ? 'Цель отказала.' : ''}</div>`;
    if (iAmA && cr.awaiting === 'instigator' && !cr.flags.bargain) {
      const next = ESCALATION[cr.step + 1];
      const cost = { 1: '30💰 + ' + DIP_COST.show, 2: DIP_COST.ultimatum, 3: DIP_COST.mobilize, 4: DIP_COST.blockade }[cr.step + 1];
      html += `<div class="col"><button class="btn" data-act="dip-esc" data-id="${cr.id}">${next.icon} ${next.name}${cr.step + 1 < 5 ? ` (${cost} 🕊️)` : ''}</button><button class="btn ghost" data-act="dip-bd" data-id="${cr.id}">⬇ Отступить${cr.step >= 2 ? ' (потеря лица)' : ''}</button></div>`;
    } else if (iAmA) {
      html += `<div class="muted small">Ждём ответа цели…</div>`;
    }
    return html;
  }
  if (!war && statusOf(g, me, t) !== 'ceasefire') {
    html += `<h3>Давление</h3><div class="muted small">Лестница: протест → показ силы → ультиматум → мобилизация → блокада → война. Цель может уступить, торговаться или отказать.</div><div class="col">`;
    for (const [k, n] of [['tribute', '💰 Требовать дань'], ['resource', '🔩 Требовать сталь'], ['open_border', '🚪 Требовать открыть границу']]) {
      html += `<button class="btn ghost" data-act="dip-crisis" data-d="${k}">${n} (${DIP_COST.protest} 🕊️)</button>`;
    }
    html += '</div>';
    const wErr = warError(g, me, t);
    html += `<button class="btn ghost danger" data-act="dip-war" ${wErr ? 'disabled' : ''}>⚔ Объявить войну${wErr ? ' — ' + wErr : ''}</button>`;
  }
  return html;
}

// ---------- конструктор предложений ----------
export function defaultParams(g, kind, me, t) {
  const def = TREATIES[kind] || {};
  const p = { days: def.days || 0, sweet: 0, binding: false, noChain: true, target: [0, 1, 2, 3].find((x) => x !== me && x !== t), role: 'over', contrib: 0, payer: t, dmz: false, amount: 200 };
  const war = warBetween(g, me, t);
  if (kind === 'peacetreaty' && war) { const sc = scoreFor(war, me); p.payer = sc >= 0 ? t : me; p.contrib = Math.min(300, Math.round(Math.abs(sc) * 3 / 10) * 10); }
  return p;
}
export function buildParams(g, kind, ui, me, t) {
  const p = ui.params;
  const sweet = p.sweet > 0 ? { money: p.sweet } : undefined;
  switch (kind) {
    case 'defense': return { days: p.days, binding: p.binding, noChain: p.noChain, sweet };
    case 'offense': return { days: p.days, target: p.target, sweet };
    case 'protect': return { over: p.role === 'over' ? me : t, sweet };
    case 'peacetreaty': return { payer: p.payer, contrib: p.contrib, dmz: p.dmz, sweet };
    case 'loan': return { lender: me, borrower: t, amount: p.amount, days: p.days || 90 };
    case 'truce': case 'whitepeace': return { sweet };
    default: return { days: p.days, sweet };
  }
}
function offerHtml(g, ui) {
  const me = g.playerState, t = ui.target, kind = ui.kind, p = ui.params;
  const name = KIND_NAME[kind];
  let html = `<div class="phead"><div><h2>${TREATIES[kind] ? TREATIES[kind].icon : kind === 'deal' ? '📦' : '🏦'} ${name}</h2><div class="sub">для ${nm(g, t)}</div></div><button class="x" data-act="close" aria-label="Закрыть">✕</button></div>`;
  html += `<button class="btn small ghost backbtn" data-act="dip-ocancel">← К государству</button>`;
  if (ui.result) html += resultHtml(ui.result);
  if (kind === 'deal') return html + dealForm(g, ui);
  if (TREATIES[kind]) html += `<div class="muted small">${TREATIES[kind].info}</div>`;
  const step = (key, label, d, shown) => `<div class="stepper"><span>${label}</span><button data-act="dip-ps" data-k="${key}" data-d="${-d}">−</button><b>${shown}</b><button data-act="dip-ps" data-k="${key}" data-d="${d}">+</button></div>`;
  const tog = (key, label, on) => `<button class="tog ${on ? 'on' : ''}" data-act="dip-pt" data-k="${key}"><span>${label}</span><i></i></button>`;
  if (TREATIES[kind] && TREATIES[kind].days && !['truce'].includes(kind)) html += step('days', 'Срок (дней)', 30, p.days || '∞');
  if (kind === 'defense') html += tog('binding', 'Обязательный пакт (помощь обязательна)', p.binding) + tog('noChain', 'Оговорка «без цепной реакции»', p.noChain);
  if (kind === 'offense') html += `<div class="seg">${[0, 1, 2, 3].filter((x) => x !== me && x !== t).map((x) => `<button class="${p.target === x ? 'on' : ''}" data-act="dip-ptarget" data-id="${x}">против ${nm(g, x)}</button>`).join('')}</div>`;
  if (kind === 'protect') html += `<div class="seg"><button class="${p.role === 'over' ? 'on' : ''}" data-act="dip-prole" data-r="over">Я покровитель</button><button class="${p.role === 'under' ? 'on' : ''}" data-act="dip-prole" data-r="under">Я вассал</button></div>`;
  if (kind === 'peacetreaty') {
    html += `<div class="seg"><button class="${p.payer === t ? 'on' : ''}" data-act="dip-ppayer" data-id="${t}">Платят они</button><button class="${p.payer === me ? 'on' : ''}" data-act="dip-ppayer" data-id="${me}">Плачу я</button></div>`;
    html += step('contrib', 'Контрибуция 💰', 50, p.contrib) + tog('dmz', 'Демилитаризованная зона', p.dmz);
  }
  if (kind === 'loan') html += step('amount', 'Сумма займа 💰', 50, p.amount) + step('days', 'Срок (дней)', 30, p.days || 90) + `<div class="muted small">Вернут ~${Math.round(p.amount * (1 + DIP.loanRate * (p.days || 90)))}💰 к сроку.</div>`;
  if (kind !== 'loan') html += step('sweet', 'Приплата им 💰 (подсластить)', 50, p.sweet);
  const params = buildParams(g, kind, ui, me, t);
  const ev = preview(g, me, t, kind, params);
  html += evalHtml(ev);
  const dis = ev.hard || ev.have < ev.cost || ev.cool > 0;
  html += `<button class="btn big" data-act="dip-sendoffer" ${dis ? 'disabled' : ''}>📨 Предложить (${ev.cost} 🕊️)</button>`;
  if (ev.have < ev.cost) html += `<div class="err">Не хватает очков влияния: ${ev.have}/${ev.cost}</div>`;
  if (ev.cool > 0) html += `<div class="err">Недавний отказ: повторить можно через ${ev.cool} дн.</div>`;
  return html;
}
function evalHtml(ev) {
  if (ev.hard) return `<div class="tip bad"><b>Невозможно:</b> ${ev.hard}</div>`;
  const pct = Math.round(ev.p * 100), cls = pct >= 60 ? 'p-hi' : pct >= 35 ? 'p-mid' : 'p-lo';
  let html = `<h3>Вероятность согласия</h3><div class="pbar ${cls}"><i style="width:${pct}%"></i><b>${pct}%</b></div>
    <div class="muted small">${ev.accept ? 'Сейчас они согласятся' : 'Сейчас они откажут'} (баланс ${ev.score > 0 ? '+' : ''}${ev.score}). Ниже все факторы.</div><div class="factors">`;
  html += ev.factors.slice().sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).map((f) => `<div class="fac"><span>${f.label}${f.hint ? ` <small class="muted">${f.hint}</small>` : ''}</span><b class="${f.v > 0 ? 'pos' : 'neg'}">${f.v > 0 ? '+' : ''}${f.v}</b></div>`).join('');
  html += '</div>';
  if (!ev.accept && ev.reasons.length) html += `<div class="tip warn"><b>Причина отказа:</b> ${ev.reasons.join('; ')}</div>`;
  if (ev.counter) html += `<button class="btn ghost" data-act="dip-counter" data-m="${ev.counter.money}">💬 Встречное: ${ev.counter.text}</button>`;
  return html;
}
function dealForm(g, ui) {
  const me = g.playerState, t = ui.target, st = g.states[t], my = g.states[me], f = ui.form;
  const block = tradeBlock(g, me, t);
  let html = '';
  const hints = hintsFor(g, me, t).slice(0, 3);
  if (hints.length) html += '<div class="hints">' + hints.map((h) => `<button class="hint" data-act="dip-hint" data-res="${h.res}" data-dir="${h.dir}" data-price="${h.price}">💡 ${h.dir === 'sell' ? 'Продать' : 'Купить'} ${RES_ICON[h.res]} <small>${h.why}</small></button>`).join('') + '</div>';
  html += `<div class="seg"><button class="${f.dir === 'sell' ? 'on' : ''}" data-act="dip-dir" data-dir="sell">Я продаю</button><button class="${f.dir === 'buy' ? 'on' : ''}" data-act="dip-dir" data-dir="buy">Я покупаю</button></div>`;
  html += '<div class="seg res">' + TRADE_RES.map((r) => `<button class="${f.res === r ? 'on' : ''}" data-act="dip-res" data-res="${r}">${RES_ICON[r]}<small>${fmt(my[r])}</small></button>`).join('') + '</div>';
  const fair = fairPrice(f.res), dev = Math.round((f.price / fair - 1) * 100);
  html += `<div class="stepper"><span>Количество в день</span><button data-act="dip-amt" data-d="-2">−</button><b>${f.amt}</b><button data-act="dip-amt" data-d="2">+</button></div>
    <div class="stepper"><span>Цена за единицу</span><button data-act="dip-price" data-d="-0.5">−</button><b>${price1(f.price)}💰</b><button data-act="dip-price" data-d="0.5">+</button></div>
    <div class="muted small">Справочная цена ${price1(fair)}💰 ${dev === 0 ? '' : '(' + (dev > 0 ? '+' : '') + dev + '%)'} · для ${st.name} сейчас ~${price1(valueFor(g, st, f.res))}💰</div>
    <div class="seg"><button class="${f.days === 30 ? 'on' : ''}" data-act="dip-days" data-days="30">30 дн.</button><button class="${f.days === 90 ? 'on' : ''}" data-act="dip-days" data-days="90">90 дн.</button><button class="${f.days === 0 ? 'on' : ''}" data-act="dip-days" data-days="0">бессрочно</button></div>
    <div class="deal-sum">${f.dir === 'sell' ? 'Вы получаете' : 'Вы платите'}: <b>${price1(f.amt * f.price)}💰</b> в день за ${f.amt} ${RES_ICON[f.res]}</div>`;
  const seller = f.dir === 'sell' ? me : t, buyer = f.dir === 'sell' ? t : me;
  const ev = preview(g, me, t, 'deal', { seller, buyer, res: f.res, amt: f.amt, price: f.price, days: f.days });
  html += evalHtml(ev);
  html += `<button class="btn big" data-act="dip-send" ${block || ev.have < ev.cost ? 'disabled' : ''}>📨 Предложить ${st.name} (${ev.cost} 🕊️)</button>`;
  if (block) html += `<div class="err">${block}</div>`;
  return html;
}

export function dipHtml(g, ui) {
  if (ui.view === 'offer' && ui.target >= 0) return offerHtml(g, ui);
  if (ui.view === 'state' && ui.target >= 0 && ui.target !== g.playerState) return stateHtml(g, ui);
  return listHtml(g, ui);
}

// ---------- действия ----------
export function dipAction(g, ui, act, el, h) {
  const me = g.playerState, d = el.dataset;
  const t = d.id !== undefined && ['dip-open', 'dip-ties', 'dip-amb', 'dip-recall', 'dip-png', 'dip-scout', 'dip-gift', 'dip-sanc'].includes(act) ? Number(d.id) : ui.target;
  const res = (r) => { ui.result = r; return r; };
  const ask = (title, lines, run, opts = {}) => { ui.confirm = { title, lines, run, ...opts }; ui.result = null; };
  const f = ui.form, p = ui.params;
  switch (act) {
    case 'dip-open': ui.view = 'state'; ui.target = Number(d.id); ui.result = null; ui.confirm = null; ui.aidOpen = false; break;
    case 'dip-back': ui.view = 'list'; ui.target = -1; ui.result = null; ui.confirm = null; break;
    case 'dip-tab': ui.tab = d.tab; ui.view = 'list'; ui.result = null; break;
    case 'dip-lf': ui.logFilter = d.f; break;
    case 'dip-yes': { const run = ui.confirm && ui.confirm.run; ui.confirm = null; if (run) res(run()); break; }
    case 'dip-no': ui.confirm = null; break;
    case 'offer-yes': case 'offer-no': { const r = answerOffer(g, Number(d.id), act === 'offer-yes'); h.toast(r.msg); break; }
    case 'call-yes': case 'call-no': {
      if (act === 'call-yes') { const call = g.dip.calls.find((c) => c.id === Number(d.id)); const war = call && g.dip.wars.find((w) => w.id === call.war); const en = war ? (call.side === 'A' ? war.sideB : war.sideA) : [];
        ask('Вступить в войну?', [`Война с ${en.map((e) => nm(g, e)).join(', ')}`, 'Границы и торговля с ними закроются', 'Сделки и договоры с ними расторгнутся'], () => answerCall(g, Number(d.id), true), { danger: true, yesText: '⚔ Вступить' }); }
      else {
        const call = g.dip.calls.find((c) => c.id === Number(d.id));
        ask('Отказать в помощи?', call && call.binding ? [`Договор будет нарушен`, `Репутация надёжности −${DIP.repViolation} у ВСЕХ`, `${nm(g, call.to)} получит повод к войне против вас`] : ['Отношения с союзником слегка ухудшатся'], () => answerCall(g, Number(d.id), false), { yesText: 'Не вступать' });
      }
      break;
    }
    case 'dip-resp': {
      const c = g.dip.crises.find((x) => x.id === Number(d.id));
      const ch = d.ch;
      const lines = { yield: [`Вы выполните требование: ${c.demand.text}`, c.step >= 2 ? 'Потеря лица: престиж −10' : 'Потери лица не будет'], bargain: ['Предложите половину требований'], refuse: [c.step >= 2 ? `${nm(g, c.a)} получит повод к войне` : 'Кризис может обостриться', 'Возможна эскалация до блокады и войны'], appeal: ['Союзники могут выступить в вашу поддержку'] }[ch];
      ask({ yield: 'Уступить?', bargain: 'Торговаться?', refuse: 'Отказать?', appeal: 'Позвать на помощь?' }[ch], lines, () => respond(g, c.id, ch, me), { danger: ch === 'refuse', yesText: 'Подтвердить' });
      break;
    }
    case 'dip-med': {
      const c = g.dip.crises.find((x) => x.id === Number(d.id)), m = Number(d.who);
      ask(`Просить ${nm(g, m)} о посредничестве?`, ['Спор уладится компромиссом (половина требований) без потери лица', 'Стоит 3 🕊️'], () => {
        if (!g.dip.ties[m][me] || relOf(g, m, me) <= 0) return { ok: false, msg: 'Посредник не согласен' };
        if (!(infOf(g, me) >= 3)) return { ok: false, msg: 'Не хватает очков влияния (нужно 3)' };
        const r = mediateCrisis(g, c.id, m);
        if (r.ok) g.dip.inf[me] -= 3;
        return r;
      });
      break;
    }
    case 'dip-bg': res(answerBargain(g, Number(d.id), d.yes === '1')); break;
    case 'dip-esc': {
      const c = g.dip.crises.find((x) => x.id === Number(d.id));
      const next = ESCALATION[c.step + 1];
      ask(`${next.icon} ${next.name}`, c.step + 1 >= 5 ? warPreview(g, c.a, c.b) : [next.info, 'Отношения ухудшатся', c.step + 1 >= 3 ? 'Обе страны несут расходы мобилизации' : 'Цель получит время на ответ'], () => escalate(g, c.id), { danger: c.step + 1 >= 4, yesText: next.name });
      break;
    }
    case 'dip-bd': {
      const c = g.dip.crises.find((x) => x.id === Number(d.id));
      ask('Отступить?', [c.step >= 2 ? 'Потеря лица: престиж −15' : 'Без потерь', 'Кризис закончится'], () => backdown(g, c.id));
      break;
    }
    case 'dip-crisis': {
      const dm = d.d === 'tribute' ? DEMANDS.tribute(g, me, t, 200) : d.d === 'resource' ? DEMANDS.resource(g, me, t, 80, 'steel') : DEMANDS.open_border();
      ask('Начать давление?', [`Требование: ${dm.text}`, `Протест стоит ${DIP_COST.protest} 🕊️`, 'Цель может уступить, торговаться или отказать', 'Дальше можно эскалировать'], () => startCrisis(g, me, t, dm), { yesText: 'Вручить ноту' });
      break;
    }
    case 'dip-war': ask(`⚔ Объявить войну: ${nm(g, t)}`, warPreview(g, me, t), () => declareWar(g, me, t), { danger: true, yesText: '⚔ Объявить войну' }); break;
    case 'dip-brk': {
      const kind = d.kind;
      ask(`Расторгнуть: ${TREATIES[kind].name}`, breakConsequences(g, me, t, kind), () => breakTreaty(g, me, t, kind), { danger: true, yesText: 'Расторгнуть' });
      break;
    }
    case 'dip-ties': res(establishTies(g, me, t)); break;
    case 'dip-amb': res(appointAmbassador(g, me, t)); break;
    case 'dip-recall': res(recallAmbassador(g, me, t)); break;
    case 'dip-png': ask('Объявить посла персоной нон грата?', ['Посол выдворяется без объяснений', 'Отношения заметно ухудшатся', 'Доверие упадёт'], () => expelAmbassador(g, me, t), { danger: true, yesText: 'Выслать' }); break;
    case 'dip-scout': res(scout(g, me, t)); break;
    case 'dip-border': res(setBorder(g, me, t, d.closed === '1')); break;
    case 'dip-emb': res(setEmbargo(g, me, t, d.on === '1')); break;
    case 'dip-sanc': res(g.dip.sanc[t].includes(me) ? liftSanctions(g, me, t) : joinSanctions(g, me, t)); break;
    case 'dip-gift': res(gift(g, me, t, 100)); break;
    case 'dip-aidopen': ui.aidOpen = !ui.aidOpen; break;
    case 'dip-aidres': ui.aid.res = d.res; break;
    case 'dip-aidamt': ui.aid.amt = Math.max(10, Math.min(400, ui.aid.amt + Number(d.d))); break;
    case 'dip-aidsend': res(sendAid(g, me, t, ui.aid.res, ui.aid.amt)); break;
    case 'dip-cancel': cancelDeal(g, Number(d.id), me); res({ ok: true, msg: 'Сделка расторгнута', reasons: [] }); break;
    case 'dip-kind': ui.kind = d.kind; ui.view = 'offer'; ui.params = defaultParams(g, d.kind, me, t); ui.result = null; break;
    case 'dip-ocancel': ui.view = 'state'; ui.kind = null; ui.result = null; break;
    case 'dip-ps': { const k = d.k, dv = Number(d.d); const min = { days: 0, sweet: 0, contrib: 0, amount: 50 }[k] ?? 0; p[k] = Math.max(min, Math.min(k === 'days' ? 360 : 2000, (p[k] || 0) + dv)); break; }
    case 'dip-pt': p[d.k] = !p[d.k]; break;
    case 'dip-ptarget': p.target = Number(d.id); break;
    case 'dip-prole': p.role = d.r; break;
    case 'dip-ppayer': p.payer = Number(d.id); break;
    case 'dip-counter': p.sweet = Number(d.m); break;
    case 'dip-sendoffer': {
      const params = buildParams(g, ui.kind, ui, me, t);
      const r = propose(g, me, t, ui.kind, params);
      res(r);
      if (r.ok) { h.toast('🤝 ' + r.msg); ui.view = 'state'; ui.kind = null; }
      break;
    }
    case 'dip-dir': f.dir = d.dir; break;
    case 'dip-res': f.res = d.res; f.price = Math.round(fairPrice(f.res) * 2) / 2; break;
    case 'dip-amt': f.amt = Math.max(2, Math.min(60, f.amt + Number(d.d))); break;
    case 'dip-price': f.price = Math.max(0.5, Math.round((f.price + Number(d.d)) * 10) / 10); break;
    case 'dip-days': f.days = Number(d.days); break;
    case 'dip-hint': f.res = d.res; f.dir = d.dir; f.price = Number(d.price); break;
    case 'dip-send': {
      const seller = f.dir === 'sell' ? me : t, buyer = f.dir === 'sell' ? t : me;
      if (g.states[seller][f.res] < f.amt) res({ ok: false, msg: 'У продавца не хватает товара на складе', reasons: [] });
      else {
        const r = propose(g, me, t, 'deal', { seller, buyer, res: f.res, amt: f.amt, price: f.price, days: f.days });
        res(r);
        if (r.ok) { h.toast('🤝 ' + r.msg); ui.view = 'state'; }
      }
      break;
    }
    default: return false;
  }
  return true;
}
void cbFor; void CB_LABEL; void fearOf; void interdependence; void isClosed; void relWord; void summarizeNeeds; void RES_LABEL; void callError;

// ---------- слой карты «Дипломатия» ----------
// цвет провинции по отношению её владельца к игроку: союзник синий, друг зелёный, нейтрал серый/жёлтый, враг красный
export function dipColorOf(g, p) {
  const me = g.playerState, o = p.owner;
  if (o === me) return 0xffc857;
  const st = statusOf(g, me, o), rel = relOf(g, me, o);
  if (st === 'war') return 0xd8362f;
  if (st === 'ceasefire') return 0xd98a2b;
  if (st === 'ally') return 0x4a90e2;
  if (st === 'friend') return 0x3fae6a;
  return rel < -25 ? 0xe0653d : rel < 12 ? 0x9aa3ab : 0x8fcf6a;
}
// стрелки напряжения и блоки: [{a, b, kind}] между столицами
export function dipLinks(g) {
  const out = [], cap = (i) => g.provs[g.states[i].capital];
  for (const w of g.dip.wars) if (w.state === 'active') out.push({ a: cap(w.a), b: cap(w.b), kind: 'war' });
  for (const c of g.dip.crises) if (c.state === 'open') out.push({ a: cap(c.a), b: cap(c.b), kind: c.step >= 3 ? 'war' : 'tension' });
  for (const t of g.dip.treaties) if (t.state === 'active' && ['ally', 'protect'].includes(t.kind)) out.push({ a: cap(t.a), b: cap(t.b), kind: 'bloc' });
  return out;
}
