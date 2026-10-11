/* Vol Desk — Moontower front end. Vanilla JS, hand-rolled SVG. No key ships with this file. */
(() => {
'use strict';

const API = 'https://api.moontower.ai';
const POLL_MS = 5 * 60 * 1000;
const DELTAS = [90, 80, 70, 60, 50, 40, 30, 20, 10];            // vol90 … vol10 = call delta, low strike → high strike
const RANGE_DAYS = { '1M': 31, '3M': 92, '6M': 183, '1Y': 10000 };
const SEQ_LIGHT = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];
const CHAIN_FIELDS = { expiry_date: 'exp', dte: 'dte', strike: 'k', call_bid_price: 'cb', call_mid_price: 'cm', call_ask_price: 'ca',
  put_bid_price: 'pb', put_mid_price: 'pm', put_ask_price: 'pa', call_mid_iv: 'civ', put_mid_iv: 'piv', smoothed_vol: 'siv',
  call_delta: 'cd', put_delta: 'pd', call_gamma: 'g', call_theta: 'ct', put_theta: 'pt', call_vega: 'v',
  call_open_interest: 'coi', put_open_interest: 'poi', call_volume: 'cvol', put_volume: 'pvol' };

const $ = (s, r = document) => r.querySelector(s);
const state = {
  latest: null, history: null, detail: {}, ticker: null, expiry: null, range: '1Y',
  key: null, liveBoard: false, view: {}, sort: { col: 'iv_pct_1y', dir: -1 }, lastGenerated: null, nextPoll: 0,
};

/* ---------------- utils ---------------- */
const isNum = v => typeof v === 'number' && isFinite(v);
const fmt = {
  num: (v, d = 2) => isNum(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–',
  pct: (v, d = 1) => isNum(v) ? fmt.num(v, d) + '%' : '–',
  spct: (v, d = 1) => isNum(v) ? (v > 0 ? '+' : '') + fmt.num(v, d) + '%' : '–',
  snum: (v, d = 2) => isNum(v) ? (v > 0 ? '+' : '') + fmt.num(v, d) : '–',
  ord: v => { if (!isNum(v)) return '–'; const n = Math.round(v), s = ['th', 'st', 'nd', 'rd'], k = n % 100; return n + (s[(k - 20) % 10] || s[k] || s[0]); },
  date: s => { if (!s) return '–'; const d = new Date(s + 'T00:00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); },
  dateShort: s => { if (!s) return '–'; const d = new Date(s + 'T00:00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); },
  ago: iso => { if (!iso) return ''; const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000)); if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; const h = Math.round(m / 60); if (h < 36) return h + ' h ago'; return Math.round(h / 24) + ' d ago'; },
  big: v => isNum(v) ? (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : String(Math.round(v))) : '–',
};
const isDark = () => {
  const t = document.documentElement.getAttribute('data-theme');
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
function hex2rgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function ramp(t) {                                   // sequential blue; anchor flips in dark (low recedes to surface)
  const steps = isDark() ? SEQ_LIGHT.slice().reverse() : SEQ_LIGHT;
  const x = Math.max(0, Math.min(1, t)) * (steps.length - 1), i = Math.floor(x), f = x - i;
  const a = hex2rgb(steps[i]), b = hex2rgb(steps[Math.min(i + 1, steps.length - 1)]);
  return `rgb(${a.map((c, k) => Math.round(c + (b[k] - c) * f)).join(',')})`;
}
function lum(rgbStr) { const m = rgbStr.match(/\d+/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; }
const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
};
const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const k in attrs) { if (k === 'class') n.className = attrs[k]; else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]); else if (attrs[k] != null) n.setAttribute(k, attrs[k]); }
  for (const kid of kids.flat()) if (kid != null) n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  return n;
};
const lin = (d0, d1, r0, r1) => { const f = v => r0 + (v - d0) / ((d1 - d0) || 1) * (r1 - r0); f.invert = p => d0 + (p - r0) / ((r1 - r0) || 1) * (d1 - d0); return f; };
function niceTicks(lo, hi, n = 5) {
  if (!(hi > lo)) { hi = lo + 1; }
  const span = hi - lo, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= n + 1) || mag * 10;
  const t0 = Math.ceil(lo / step) * step, out = [];
  for (let v = t0; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
const pad = (lo, hi, f = 0.08) => { const s = (hi - lo) || Math.abs(hi) || 1; return [lo - s * f, hi + s * f]; };

/* ---------------- tooltip ---------------- */
const tip = $('#tip');
function showTip(x, y, title, rows) {
  tip.replaceChildren(h('div', { class: 't' }, title), ...rows.map(r => h('div', { class: 'r' },
    h('span', {}, r.color ? h('i', { style: `background:${r.color}` }) : null, r.label), h('b', {}, r.value))));
  tip.hidden = false;
  const W = tip.offsetWidth, H = tip.offsetHeight, vw = innerWidth, vh = innerHeight;
  let left = x + 14, top = y + 14;
  if (left + W > vw - 8) left = x - W - 14;
  if (top + H > vh - 8) top = y - H - 14;
  tip.style.left = Math.max(8, left) + 'px'; tip.style.top = Math.max(8, top) + 'px';
}
const hideTip = () => { tip.hidden = true; };

/* ---------------- chart frame ---------------- */
function frame(plot, height, m = { t: 12, r: 16, b: 28, l: 44 }) {
  const w = Math.max(280, plot.clientWidth || 600);
  const svg = el('svg', { width: w, height, viewBox: `0 0 ${w} ${height}`, role: 'img' });
  const g = el('g', { transform: `translate(${m.l},${m.t})` }, svg);
  return { svg, g, w, h: height, iw: w - m.l - m.r, ih: height - m.t - m.b, m };
}
function yGrid(f, ticks, y, fmtFn = v => fmt.num(v, 1)) {
  const gg = el('g', { class: 'grid' }, f.g);
  for (const t of ticks) {
    const yy = y(t);
    el('line', { x1: 0, x2: f.iw, y1: yy, y2: yy }, gg);
    const tx = el('text', { x: -8, y: yy + 3.5, 'text-anchor': 'end' }, f.g); tx.textContent = fmtFn(t);
  }
}
function xBaseline(f) { el('line', { class: 'axis', x1: 0, x2: f.iw, y1: f.ih, y2: f.ih, stroke: css('--axis') }, f.g); }
function xLabel(f, x, text, anchor = 'middle', dy = 18) { const t = el('text', { x, y: f.ih + dy, 'text-anchor': anchor }, f.g); t.textContent = text; return t; }
function linePath(pts) { return pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(''); }
function marker(g, x, y, color, r = 4) { el('circle', { cx: x, cy: y, r: r + 2, fill: css('--surface') }, g); return el('circle', { cx: x, cy: y, r, fill: color }, g); }
function endLabels(f, items) {                       // items: [{y, text, color}] → collision-safe end labels with leader lines
  const sorted = items.filter(i => isNum(i.y)).sort((a, b) => a.y - b.y); const H = 14;
  for (let i = 1; i < sorted.length; i++) if (sorted[i].y - sorted[i - 1].y < H) sorted[i].ly = sorted[i - 1].ly + H; 
  for (const it of sorted) if (it.ly == null) it.ly = it.y;
  for (const it of sorted) {
    const x = f.iw + 6;
    if (Math.abs(it.ly - it.y) > 1) el('line', { x1: f.iw + 1, y1: it.y, x2: x - 1, y2: it.ly, stroke: css('--axis'), 'stroke-width': 1 }, f.g);
    el('line', { x1: x, x2: x + 10, y1: it.ly, y2: it.ly, stroke: it.color, 'stroke-width': 2 }, f.g);
    const t = el('text', { x: x + 14, y: it.ly + 3.5, class: 'ink2' }, f.g); t.textContent = it.text;
  }
}
function legend(entries) {
  return h('div', { class: 'legend' }, entries.map(e => h('span', {}, h('i', { class: e.shape || '', style: `background:${e.color}` }), e.label)));
}
function emptyState(plot, msg, strong) { plot.replaceChildren(h('div', { class: 'empty' }, strong ? h('strong', {}, strong) : null, strong ? ' ' : null, msg)); }
function tableEl(cols, rows, opts = {}) {
  const thead = h('thead', {}, h('tr', {}, cols.map(c => h('th', { class: c.left ? 'l' : '' }, c.label))));
  const tbody = h('tbody', {}, rows.map(r => h('tr', {}, cols.map(c => h('td', { class: c.left ? 'l' : '' }, c.fmt ? c.fmt(r) : String(r[c.key] ?? '–'))))));
  return h('div', { class: 'tbl-wrap' + (opts.tall ? ' tall' : '') }, h('table', { class: 'tbl' }, thead, tbody));
}
/* per-card chart/table toggle */
function cardTools(cardId, hasTable = true) {
  const card = $('#' + cardId), tools = $('.card-tools', card);
  tools.replaceChildren();
  if (!hasTable) return;
  const mode = state.view[cardId] || 'chart';
  for (const m of ['chart', 'table']) {
    tools.appendChild(h('button', { type: 'button', 'aria-pressed': String(mode === m), onclick: () => { state.view[cardId] = m; renderAll(); } }, m === 'chart' ? 'Chart' : 'Table'));
  }
}
const viewOf = id => state.view[id] || 'chart';

/* ---------------- data ---------------- */
async function getJSON(url, bust = true) {
  const r = await fetch(url + (bust ? (url.includes('?') ? '&' : '?') + 'v=' + Date.now() : ''), { cache: 'no-store' });
  if (!r.ok) throw new Error(r.status + ' ' + url);
  return r.json();
}
async function api(path, params) {
  const q = new URLSearchParams();
  for (const k in params) { const v = params[k]; if (Array.isArray(v)) v.forEach(x => q.append(k, x)); else if (v != null) q.set(k, v); }
  const r = await fetch(`${API}${path}?${q}`, { headers: { 'X-API-Key': state.key, Accept: 'application/json' } });
  if (!r.ok) { let d = ''; try { d = JSON.stringify((await r.json()).detail) } catch (e) {} throw new Error(`${r.status} on ${path} ${d}`); }
  const j = await r.json();
  return j && j.data !== undefined ? j.data : j;
}
const round = (v, n) => isNum(v) ? +v.toFixed(n) : v;
function trimChain(chain, spot) {
  const per = {};
  for (const row of chain) {
    if (!(row.dte > 0) || row.dte > 420 || row.strike == null) continue;
    const sp = row.spot_price || spot; if (!sp) continue;
    (per[row.expiry_date] ||= []).push([Math.abs(row.strike - sp), row]);
  }
  const out = [];
  for (const exp of Object.keys(per).sort()) {
    const rows = per[exp].sort((a, b) => a[0] - b[0]).slice(0, 60).map(x => x[1]).sort((a, b) => a.strike - b.strike);
    for (const row of rows) { const o = {}; for (const s in CHAIN_FIELDS) o[CHAIN_FIELDS[s]] = typeof row[s] === 'number' ? round(row[s], 5) : row[s]; out.push(o); }
  }
  return out;
}
async function liveDetail(t) {
  const [surface, cone, chain, skew] = await Promise.all([
    api('/v1/impliedvol', { ticker: t }), api('/v1/volcone', { ticker: t }), api('/v1/optionchain', { ticker: t }), api('/v1/skew', { ticker: t })]);
  const spot = (surface.find(r => r.spot_price) || {}).spot_price || null;
  return { ticker: t, as_of: surface[0] && surface[0].date, snapshot_at: surface[0] && surface[0].snapshot_at, spot,
    surface: surface.filter(r => r.dte <= 420), cone, skew: skew.filter(r => r.maturity <= 420), chain: trimChain(chain, spot), live: true };
}
async function getDetail(t) {
  if (state.detail[t]) return state.detail[t];
  let d = null;
  if ((state.latest.featured || []).includes(t)) {
    try { d = await getJSON(`data/featured/${t}.json`); } catch (e) { console.warn(e); }
  }
  if (!d && state.key) {
    try { d = await liveDetail(t); } catch (e) { console.warn(e); setNote('Live fetch failed: ' + e.message); }
  }
  if (d) state.detail[t] = d;
  return d;
}
const byTicker = rows => rows.reduce((m, r) => ((m[r.ticker] ||= []).push(r), m), {});
const nearestBy = (rows, f, target) => rows.reduce((b, r) => (r[f] != null && (!b || Math.abs(r[f] - target) < Math.abs(b[f] - target))) ? r : b, null);
async function liveBoard() {
  const tickers = state.latest.universe.map(u => u.ticker);
  const [price, cmiv, ivrank, rviv, cockpit, skew] = await Promise.all(['price', 'cmiv', 'ivrank', 'rviv', 'cockpit', 'skew'].map(e => api('/v1/' + e, { ticker: tickers })));
  const P = byTicker(price), C = byTicker(cmiv), I = byTicker(ivrank), R = byTicker(rviv), K = byTicker(cockpit), S = byTicker(skew);
  const last = a => (a && a[a.length - 1]) || {};
  const x100 = v => isNum(v) ? round(v * 100, 2) : null;
  let asOf = state.latest.as_of;
  const universe = state.latest.universe.map(u => {
    const t = u.ticker, p = last(P[t]), cm = last(C[t]), ir = last(I[t]), rv = last(R[t]), ck = last(K[t]);
    const sk = nearestBy((S[t] || []).filter(s => s.risk_reversal_25d != null), 'maturity', 30) || {};
    if (p.date && p.date > asOf) asOf = p.date;
    return { ...u, date: p.date, snapshot_at: p.snapshot_at, close: p.close, ret_1d: ck.daily_return, ret_1w: ck.weekly_return, ret_1m: ck.monthly_return, sd_200: ck.sd_from_200ma,
      iv10: x100(cm.iv_10d), iv30: x100(cm.iv_30d), iv60: x100(cm.iv_60d), iv90: x100(cm.iv_90d), iv6m: x100(cm.iv_6m), iv1y: x100(cm.iv_1y),
      iv30_chg_1d: x100(ck.iv_30d_daily_change), iv30_chg_1w: x100(ck.iv_30d_weekly_change),
      iv_rank_1y: ir.iv_rank_1y, iv_pct_1y: ir.iv_pct_1y, iv_pct_3m: ir.iv_pct_3m, iv_pct_1m: ir.iv_pct_1m,
      rv7: ck.rv_7d, rv30: rv.rv_30d, rv90: ck.rv_90d, rv_pct: rv.rv_percentile, vrp: rv.vrp, term_30_10: ck.term_structure_30d_10d, term_90_30: ck.term_structure_90d_30d,
      rr25: sk.risk_reversal_25d, rr25_pct: sk.risk_reversal_25d_percentile, skew25p: sk.skew_25d_put, skew25p_pct: sk.skew_25d_put_percentile, skew25c_pct: sk.skew_25d_call_percentile, skew_maturity: sk.maturity };
  });
  state.latest = { ...state.latest, universe, as_of: asOf, generated_at: new Date().toISOString(), live: true };
  state.liveBoard = true;
}

/* ---------------- KPIs ---------------- */
function sparkSvg(vals, w = 120, hgt = 28) {
  const v = vals.filter(isNum); if (v.length < 2) return null;
  const svg = el('svg', { width: w, height: hgt, viewBox: `0 0 ${w} ${hgt}`, class: 'spark', 'aria-hidden': 'true' });
  const x = lin(0, v.length - 1, 2, w - 6), [lo, hi] = pad(Math.min(...v), Math.max(...v), 0.1), y = lin(lo, hi, hgt - 3, 3);
  el('path', { d: linePath(v.map((d, i) => [x(i), y(d)])), fill: 'none', stroke: css('--deemph'), 'stroke-width': 1.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
  el('circle', { cx: x(v.length - 1), cy: y(v[v.length - 1]), r: 3, fill: css('--s1') }, svg);
  return svg;
}
function tile(label, value, sub, opts = {}) {
  const t = h('div', { class: 'tile' + (opts.hero ? ' hero' : '') }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value));
  if (sub) t.appendChild(h('div', { class: 'delta ' + (opts.dir || '') }, sub));
  if (opts.meter != null) t.appendChild(h('div', { class: 'meter' }, h('span', { style: `width:${Math.max(0, Math.min(100, opts.meter))}%` })));
  if (opts.spark) t.appendChild(opts.spark);
  return t;
}
function renderKpis() {
  const u = currentU(); const box = $('#kpis'); if (!u) { box.replaceChildren(); return; }
  const hist = (state.history[u.ticker] || []).slice(-22);
  const dir = v => !isNum(v) ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '';
  const vrpWord = isNum(u.vrp) ? (u.vrp > 5 ? 'implied rich vs realized' : u.vrp < -5 ? 'implied cheap vs realized' : 'implied ≈ realized') : '';
  const termWord = isNum(u.term_30_10) ? (u.term_30_10 > 0.02 ? 'upward-sloping (contango)' : u.term_30_10 < -0.02 ? 'inverted (backwardation)' : 'flat') : '';
  box.replaceChildren(
    tile('Spot · ' + u.ticker, isNum(u.close) ? '$' + fmt.num(u.close, 2) : '–', isNum(u.ret_1d) ? fmt.spct(u.ret_1d * 100, 2) + ' today · ' + fmt.spct((u.ret_1w || 0) * 100, 1) + ' 1w' : '', { dir: dir(u.ret_1d), spark: sparkSvg(hist.map(r => r.c)) }),
    tile('Implied vol, 30-day', fmt.pct(u.iv30), isNum(u.iv30_chg_1d) ? fmt.snum(u.iv30_chg_1d, 2) + ' pts today · ' + fmt.snum(u.iv30_chg_1w, 2) + ' 1w' : '', { hero: true, spark: sparkSvg(hist.map(r => r.iv30), 240, 34) }),
    tile('IV percentile, 1y', fmt.ord(u.iv_pct_1y), isNum(u.iv_rank_1y) ? 'rank ' + fmt.num(u.iv_rank_1y, 0) + ' · 3m pct ' + fmt.ord(u.iv_pct_3m) : '', { meter: u.iv_pct_1y }),
    tile('Realized vol, 30-day', fmt.pct(u.rv30), isNum(u.rv_pct) ? fmt.ord(u.rv_pct) + ' percentile · 7d ' + fmt.pct(u.rv7) : ''),
    tile('Vol risk premium', fmt.snum(u.vrp, 1), vrpWord + ' · 100·ln(IV/RV)'),
    tile('Term 30d / 10d', fmt.spct(isNum(u.term_30_10) ? u.term_30_10 * 100 : null, 1), termWord + (isNum(u.term_90_30) ? ' · 90/30 ' + fmt.spct(u.term_90_30 * 100, 1) : '')),
    tile('25Δ risk reversal', fmt.snum(u.rr25, 3), isNum(u.rr25_pct) ? fmt.ord(u.rr25_pct) + ' pct 1y · ' + (u.skew_maturity || '~30') + 'd · put skew ' + fmt.snum(u.skew25p, 3) : 'no skew row'),
  );
}

/* ---------------- surface heatmap ---------------- */
function renderSurface(d) {
  const plot = $('#card-surface .plot'), desc = $('#surface-desc');
  cardTools('card-surface', !!d);
  if (!d) { desc.textContent = ''; return noDetail(plot); }
  const rows = d.surface.filter(r => r.dte > 0).sort((a, b) => a.dte - b.dte);
  desc.textContent = `${d.ticker} · ${fmt.date(d.as_of)} · spot $${fmt.num(d.spot, 2)} · ${rows.length} expiries × 9 call-delta buckets. Click a row to select that expiry.`;
  const vals = rows.flatMap(r => DELTAS.map(k => r['vol' + k])).filter(isNum).sort((a, b) => a - b);
  if (!vals.length) return emptyState(plot, 'No surface rows.');
  const lo = vals[Math.floor(vals.length * 0.02)], hi = vals[Math.ceil(vals.length * 0.98) - 1];
  if (viewOf('card-surface') === 'table') {
    plot.replaceChildren(tableEl([{ label: 'Expiry', left: true, fmt: r => fmt.date(r.expiry_date) }, { label: 'DTE', key: 'dte' },
      ...DELTAS.map(k => ({ label: k + 'Δ', fmt: r => fmt.pct(r['vol' + k]) }))], rows, { tall: false }));
    return;
  }
  const m = { t: 26, r: 16, b: 44, l: 112 };
  const cellH = Math.max(14, Math.min(22, Math.floor(520 / rows.length)));
  const f = frame(plot, m.t + m.b + cellH * rows.length, m);
  const cellW = f.iw / DELTAS.length;
  // column headers
  DELTAS.forEach((k, i) => { const t = el('text', { x: i * cellW + cellW / 2, y: -10, 'text-anchor': 'middle', class: k === 50 ? 'ink' : '' }, f.g); t.textContent = k + 'Δ'; if (k === 50) t.setAttribute('font-weight', '600'); });
  rows.forEach((r, j) => {
    const y = j * cellH, sel = r.expiry_date === state.expiry;
    const lab = el('text', { x: -8, y: y + cellH / 2 + 3.5, 'text-anchor': 'end', class: sel ? 'ink' : '' }, f.g);
    lab.textContent = `${fmt.dateShort(r.expiry_date)} · ${r.dte}d`; if (sel) lab.setAttribute('font-weight', '600');
    DELTAS.forEach((k, i) => {
      const v = r['vol' + k]; if (!isNum(v)) return;
      const fill = ramp((v - lo) / ((hi - lo) || 1));
      const c = el('rect', { x: i * cellW + 1, y: y + 1, width: cellW - 2, height: cellH - 2, rx: 2, fill, class: 'cell', tabindex: 0, role: 'button' }, f.g);
      const title = `${fmt.date(r.expiry_date)} · ${r.dte} dte · ${k}Δ`;
      const show = ev => showTip(ev.clientX ?? 0, ev.clientY ?? 0, title, [{ label: 'Implied vol', value: fmt.pct(v, 2) }, { label: 'vs ATM', value: isNum(r.vol50) ? fmt.snum(v - r.vol50, 2) + ' pts' : '–' }]);
      c.addEventListener('pointermove', show); c.addEventListener('pointerleave', hideTip); c.addEventListener('focus', ev => { const b = c.getBoundingClientRect(); showTip(b.left + b.width / 2, b.top, title, [{ label: 'Implied vol', value: fmt.pct(v, 2) }]); }); c.addEventListener('blur', hideTip);
      c.addEventListener('click', () => setExpiry(r.expiry_date));
      if (k === 50 && cellW >= 40) { const t = el('text', { x: i * cellW + cellW / 2, y: y + cellH / 2 + 3.5, 'text-anchor': 'middle', 'pointer-events': 'none' }, f.g); t.textContent = fmt.num(v, 1); t.style.fill = lum(fill) > 0.55 ? '#0b0b0b' : '#ffffff'; t.setAttribute('font-size', '10.5'); }
    });
    if (sel) el('rect', { x: 0, y: y + 0.5, width: f.iw, height: cellH - 1, fill: 'none', stroke: css('--ink'), 'stroke-width': 1.5, rx: 3, 'pointer-events': 'none' }, f.g);
  });
  // x caption + color scale
  const cap = el('text', { x: 0, y: f.ih + 16, class: 'ink2' }, f.g); cap.textContent = 'call delta — lower strikes (puts) ← → higher strikes (calls)';
  const sw = Math.min(180, f.iw * 0.4), sx = f.iw - sw, sy = f.ih + 8;
  const grad = el('linearGradient', { id: 'seqgrad', x1: 0, x2: 1, y1: 0, y2: 0 }, el('defs', {}, f.svg));
  for (let i = 0; i <= 10; i++) el('stop', { offset: (i * 10) + '%', 'stop-color': ramp(i / 10) }, grad);
  el('rect', { x: sx, y: sy, width: sw, height: 8, rx: 2, fill: 'url(#seqgrad)' }, f.g);
  const l1 = el('text', { x: sx - 6, y: sy + 7.5, 'text-anchor': 'end' }, f.g); l1.textContent = fmt.pct(lo, 0);
  const l2 = el('text', { x: sx + sw + 6, y: sy + 7.5 }, f.g); l2.textContent = fmt.pct(hi, 0);
  plot.replaceChildren(f.svg);
}

/* ---------------- vol cone ---------------- */
function renderCone(d) {
  const plot = $('#card-cone .plot'); cardTools('card-cone', !!d);
  if (!d) return noDetail(plot);
  const rows = (d.cone || []).filter(r => isNum(r.rv_median)).sort((a, b) => a.window_days - b.window_days);
  if (!rows.length) return emptyState(plot, 'No cone rows.');
  if (viewOf('card-cone') === 'table') {
    plot.replaceChildren(tableEl([{ label: 'Window', left: true, fmt: r => r.window_days + 'd' }, { label: 'Min', fmt: r => fmt.pct(r.rv_min) }, { label: 'Q25', fmt: r => fmt.pct(r.rv_q25) },
      { label: 'Median', fmt: r => fmt.pct(r.rv_median) }, { label: 'Q75', fmt: r => fmt.pct(r.rv_q75) }, { label: 'Max', fmt: r => fmt.pct(r.rv_max) },
      { label: 'RV now', fmt: r => fmt.pct(r.rv_current) }, { label: 'ATM IV', fmt: r => fmt.pct(r.iv_50d) }, { label: 'IV dte', key: 'iv_dte' }], rows)); return;
  }
  const f = frame(plot, 300, { t: 14, r: 72, b: 30, l: 44 });
  const x = i => rows.length > 1 ? i / (rows.length - 1) * f.iw : f.iw / 2;
  const all = rows.flatMap(r => [r.rv_max, r.rv_min, r.rv_current, r.iv_50d]).filter(isNum);
  const [lo, hi] = pad(Math.min(...all), Math.max(...all), 0.06), y = lin(Math.max(0, lo), hi, f.ih, 0);
  yGrid(f, niceTicks(Math.max(0, lo), hi, 5), y, v => fmt.num(v, 0) + '%');
  const band = (k1, k2, op) => el('path', { d: linePath(rows.map((r, i) => [x(i), y(r[k1])])) + rows.map((r, i) => [x(i), y(r[k2])]).reverse().map(p => 'L' + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('') + 'Z', fill: css('--ink'), opacity: op }, f.g);
  band('rv_max', 'rv_min', isDark() ? 0.08 : 0.05); band('rv_q75', 'rv_q25', isDark() ? 0.14 : 0.09);
  el('path', { d: linePath(rows.map((r, i) => [x(i), y(r.rv_median)])), fill: 'none', stroke: css('--muted'), 'stroke-width': 1.5, 'stroke-linejoin': 'round' }, f.g);
  const rv = rows.filter(r => isNum(r.rv_current)), iv = rows.filter(r => isNum(r.iv_50d));
  el('path', { d: linePath(rv.map(r => [x(rows.indexOf(r)), y(r.rv_current)])), fill: 'none', stroke: css('--s1'), 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, f.g);
  el('path', { d: linePath(iv.map(r => [x(rows.indexOf(r)), y(r.iv_50d)])), fill: 'none', stroke: css('--s2'), 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, f.g);
  rv.forEach(r => marker(f.g, x(rows.indexOf(r)), y(r.rv_current), css('--s1')));
  iv.forEach(r => marker(f.g, x(rows.indexOf(r)), y(r.iv_50d), css('--s2')));
  xBaseline(f); rows.forEach((r, i) => xLabel(f, x(i), r.window_days + 'd', i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle'));
  const lastRv = rv[rv.length - 1], lastIv = iv[iv.length - 1];
  endLabels(f, [lastRv && { y: y(lastRv.rv_current), text: 'RV ' + fmt.num(lastRv.rv_current, 1), color: css('--s1') }, lastIv && { y: y(lastIv.iv_50d), text: 'IV ' + fmt.num(lastIv.iv_50d, 1), color: css('--s2') }].filter(Boolean));
  // crosshair
  const cross = el('line', { y1: 0, y2: f.ih, stroke: css('--axis'), 'stroke-width': 1, visibility: 'hidden' }, f.g);
  const hit = el('rect', { x: 0, y: 0, width: f.iw, height: f.ih, class: 'hit' }, f.g);
  hit.addEventListener('pointermove', ev => {
    const b = f.svg.getBoundingClientRect(), px = ev.clientX - b.left - f.m.l;
    let bi = 0; rows.forEach((r, i) => { if (Math.abs(x(i) - px) < Math.abs(x(bi) - px)) bi = i; });
    const r = rows[bi]; cross.setAttribute('x1', x(bi)); cross.setAttribute('x2', x(bi)); cross.setAttribute('visibility', 'visible');
    showTip(ev.clientX, ev.clientY, `${r.window_days}-day window · 1y of ${r.rv_observations} obs`, [
      { label: 'Realized now', value: fmt.pct(r.rv_current), color: css('--s1') }, { label: `ATM implied (${r.iv_dte}d)`, value: fmt.pct(r.iv_50d), color: css('--s2') },
      { label: 'Median', value: fmt.pct(r.rv_median) }, { label: 'Q25 – Q75', value: fmt.num(r.rv_q25, 1) + ' – ' + fmt.num(r.rv_q75, 1) }, { label: 'Min – Max', value: fmt.num(r.rv_min, 1) + ' – ' + fmt.num(r.rv_max, 1) }]);
  });
  hit.addEventListener('pointerleave', () => { hideTip(); cross.setAttribute('visibility', 'hidden'); });
  plot.replaceChildren(legend([{ label: 'Realized vol, current', color: css('--s1') }, { label: 'ATM implied vol', color: css('--s2') }, { label: 'Median', color: css('--muted') }, { label: 'Interquartile', color: css('--axis'), shape: 'rect' }, { label: '1y range', color: css('--grid'), shape: 'rect' }]), f.svg);
}

/* ---------------- IV vs RV history ---------------- */
function renderHistory() {
  const plot = $('#card-history .plot'), desc = $('#history-desc'); cardTools('card-history', true);
  const t = state.ticker, all = (state.history[t] || []);
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - RANGE_DAYS[state.range]);
  const rows = all.filter(r => (isNum(r.iv30) || isNum(r.rv30)) && new Date(r.d) >= cutoff);
  if (rows.length < 2) { desc.textContent = ''; return emptyState(plot, 'No history for ' + t + ' yet. History accumulates from the daily refresh.'); }
  const last = rows[rows.length - 1];
  desc.textContent = `${t} · ${fmt.date(rows[0].d)} → ${fmt.date(last.d)} · VRP now ${fmt.snum(last.vrp, 1)} (IV30 ${fmt.pct(last.iv30)} vs RV30 ${fmt.pct(last.rv30)})`;
  if (viewOf('card-history') === 'table') {
    plot.replaceChildren(tableEl([{ label: 'Date', left: true, fmt: r => fmt.date(r.d) }, { label: 'Close', fmt: r => fmt.num(r.c, 2) }, { label: 'IV30', fmt: r => fmt.pct(r.iv30) },
      { label: 'RV30', fmt: r => fmt.pct(r.rv30) }, { label: 'VRP', fmt: r => fmt.snum(r.vrp, 1) }, { label: 'IV10', fmt: r => fmt.pct(r.iv10) }, { label: 'IV90', fmt: r => fmt.pct(r.iv90) }], rows.slice().reverse())); return;
  }
  const f = frame(plot, 300, { t: 14, r: 72, b: 30, l: 44 });
  const t0 = +new Date(rows[0].d), t1 = +new Date(last.d), x = lin(t0, t1, 0, f.iw);
  const vals = rows.flatMap(r => [r.iv30, r.rv30]).filter(isNum), [lo, hi] = pad(Math.min(...vals), Math.max(...vals), 0.08), y = lin(Math.max(0, lo), hi, f.ih, 0);
  yGrid(f, niceTicks(Math.max(0, lo), hi, 5), y, v => fmt.num(v, 0) + '%');
  const seg = key => { const out = []; let cur = []; for (const r of rows) { if (isNum(r[key])) cur.push([x(+new Date(r.d)), y(r[key])]); else if (cur.length) { out.push(cur); cur = []; } } if (cur.length) out.push(cur); return out.map(linePath).join(''); };
  el('path', { d: seg('iv30') + 'L' + f.iw + ',' + f.ih + 'L0,' + f.ih + 'Z', fill: css('--s1'), opacity: 0.08, 'pointer-events': 'none' }, f.g);
  el('path', { d: seg('rv30'), fill: 'none', stroke: css('--s2'), 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, f.g);
  el('path', { d: seg('iv30'), fill: 'none', stroke: css('--s1'), 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, f.g);
  xBaseline(f);
  const nT = Math.max(2, Math.min(6, Math.floor(f.iw / 90)));
  for (let i = 0; i < nT; i++) { const tt = t0 + (t1 - t0) * i / (nT - 1); xLabel(f, x(tt), new Date(tt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), i === 0 ? 'start' : i === nT - 1 ? 'end' : 'middle'); }
  endLabels(f, [{ y: y(last.iv30), text: 'IV ' + fmt.num(last.iv30, 1), color: css('--s1') }, { y: y(last.rv30), text: 'RV ' + fmt.num(last.rv30, 1), color: css('--s2') }]);
  const cross = el('line', { y1: 0, y2: f.ih, stroke: css('--axis'), visibility: 'hidden' }, f.g);
  const dotA = el('circle', { r: 4, fill: css('--s1'), stroke: css('--surface'), 'stroke-width': 2, visibility: 'hidden' }, f.g);
  const dotB = el('circle', { r: 4, fill: css('--s2'), stroke: css('--surface'), 'stroke-width': 2, visibility: 'hidden' }, f.g);
  const hit = el('rect', { x: 0, y: 0, width: f.iw, height: f.ih, class: 'hit' }, f.g);
  hit.addEventListener('pointermove', ev => {
    const b = f.svg.getBoundingClientRect(), tt = x.invert(ev.clientX - b.left - f.m.l);
    let bi = 0; rows.forEach((r, i) => { if (Math.abs(+new Date(r.d) - tt) < Math.abs(+new Date(rows[bi].d) - tt)) bi = i; });
    const r = rows[bi], px = x(+new Date(r.d));
    cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
    for (const [dot, k] of [[dotA, 'iv30'], [dotB, 'rv30']]) { if (isNum(r[k])) { dot.setAttribute('cx', px); dot.setAttribute('cy', y(r[k])); dot.setAttribute('visibility', 'visible'); } else dot.setAttribute('visibility', 'hidden'); }
    showTip(ev.clientX, ev.clientY, fmt.date(r.d), [{ label: 'IV 30d', value: fmt.pct(r.iv30), color: css('--s1') }, { label: 'RV 30d', value: fmt.pct(r.rv30), color: css('--s2') },
      { label: 'VRP', value: fmt.snum(r.vrp, 1) }, { label: 'Close', value: isNum(r.c) ? '$' + fmt.num(r.c, 2) : '–' }]);
  });
  hit.addEventListener('pointerleave', () => { hideTip(); [cross, dotA, dotB].forEach(n => n.setAttribute('visibility', 'hidden')); });
  plot.replaceChildren(legend([{ label: 'Implied vol, 30-day constant maturity', color: css('--s1') }, { label: 'Realized vol, trailing 30 days', color: css('--s2') }]), f.svg);
}

/* ---------------- skew smile ---------------- */
function renderSmile(d) {
  const plot = $('#card-smile .plot'), desc = $('#smile-desc'); cardTools('card-smile', !!d);
  if (!d) { desc.textContent = ''; return noDetail(plot); }
  const rows = d.surface.filter(r => r.dte > 0).sort((a, b) => a.dte - b.dte);
  const sel = rows.find(r => r.expiry_date === state.expiry) || rows[0];
  if (!sel) return emptyState(plot, 'No expiries.');
  const sk = (d.skew || []).find(s => s.expiry_date === sel.expiry_date) || {};
  desc.textContent = `${d.ticker} ${fmt.date(sel.expiry_date)} (${sel.dte}d) in color, every other expiry in gray` +
    (isNum(sk.risk_reversal_25d) ? ` · 25Δ RR ${fmt.snum(sk.risk_reversal_25d, 3)} (${fmt.ord(sk.risk_reversal_25d_percentile)} pct) · 25Δ put skew ${fmt.snum(sk.skew_25d_put, 3)} (${fmt.ord(sk.skew_25d_put_percentile)} pct)` : '');
  if (viewOf('card-smile') === 'table') {
    plot.replaceChildren(tableEl([{ label: 'Delta', left: true, fmt: r => r.k + 'Δ' }, { label: 'IV', fmt: r => fmt.pct(r.v, 2) }, { label: 'vs ATM', fmt: r => fmt.snum(r.v - sel.vol50, 2) + ' pts' }],
      DELTAS.map(k => ({ k, v: sel['vol' + k] })))); return;
  }
  const f = frame(plot, 300, { t: 14, r: 56, b: 30, l: 44 });
  const x = i => i / (DELTAS.length - 1) * f.iw;
  const allV = rows.flatMap(r => DELTAS.map(k => r['vol' + k])).filter(isNum).sort((a, b) => a - b);
  const selV = DELTAS.map(k => sel['vol' + k]).filter(isNum);
  const lo = Math.min(allV[Math.floor(allV.length * 0.03)], ...selV), hi = Math.max(allV[Math.ceil(allV.length * 0.97) - 1], ...selV);
  const [ylo, yhi] = pad(lo, hi, 0.08), y = lin(Math.max(0, ylo), yhi, f.ih, 0);
  yGrid(f, niceTicks(Math.max(0, ylo), yhi, 5), y, v => fmt.num(v, 0) + '%');
  el('line', { x1: x(4), x2: x(4), y1: 0, y2: f.ih, stroke: css('--axis') }, f.g);
  for (const r of rows) if (r !== sel) el('path', { d: linePath(DELTAS.map((k, i) => [x(i), y(Math.min(yhi, Math.max(ylo, r['vol' + k] ?? NaN)))]).filter(p => isNum(p[1]))), fill: 'none', stroke: css('--deemph'), 'stroke-width': 1, opacity: 0.9 }, f.g);
  const pts = DELTAS.map((k, i) => [x(i), y(sel['vol' + k])]).filter(p => isNum(p[1]));
  el('path', { d: linePath(pts), fill: 'none', stroke: css('--s1'), 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, f.g);
  pts.forEach(p => marker(f.g, p[0], p[1], css('--s1')));
  xBaseline(f); DELTAS.forEach((k, i) => xLabel(f, x(i), k + 'Δ', i === 0 ? 'start' : i === DELTAS.length - 1 ? 'end' : 'middle'));
  const atm = el('text', { x: x(4), y: -3, 'text-anchor': 'middle' }, f.g); atm.textContent = 'ATM';
  endLabels(f, [{ y: y(sel.vol10), text: fmt.num(sel.vol10, 1), color: css('--s1') }]);
  const cross = el('line', { y1: 0, y2: f.ih, stroke: css('--axis'), visibility: 'hidden' }, f.g);
  const hit = el('rect', { x: 0, y: 0, width: f.iw, height: f.ih, class: 'hit' }, f.g);
  hit.addEventListener('pointermove', ev => {
    const b = f.svg.getBoundingClientRect(), px = ev.clientX - b.left - f.m.l; let bi = 0;
    DELTAS.forEach((k, i) => { if (Math.abs(x(i) - px) < Math.abs(x(bi) - px)) bi = i; });
    cross.setAttribute('x1', x(bi)); cross.setAttribute('x2', x(bi)); cross.setAttribute('visibility', 'visible');
    const k = DELTAS[bi], near30 = nearestBy(rows, 'dte', 30);
    showTip(ev.clientX, ev.clientY, `${k}Δ call · ${fmt.date(sel.expiry_date)}`, [{ label: 'Implied vol', value: fmt.pct(sel['vol' + k], 2), color: css('--s1') },
      { label: 'vs ATM', value: fmt.snum(sel['vol' + k] - sel.vol50, 2) + ' pts' }, near30 && near30 !== sel ? { label: `${near30.dte}d expiry`, value: fmt.pct(near30['vol' + k], 2), color: css('--deemph') } : null].filter(Boolean));
  });
  hit.addEventListener('pointerleave', () => { hideTip(); cross.setAttribute('visibility', 'hidden'); });
  plot.replaceChildren(f.svg);
}

/* ---------------- gamma by strike ---------------- */
function renderGamma(d) {
  const plot = $('#card-gamma .plot'), desc = $('#gamma-desc'); cardTools('card-gamma', !!d);
  if (!d) { desc.textContent = ''; return noDetail(plot); }
  const rows = d.chain.filter(r => r.exp === state.expiry && isNum(r.g)).sort((a, b) => a.k - b.k);
  if (!rows.length) { desc.textContent = ''; return emptyState(plot, 'No chain rows for this expiry.'); }
  const spot = d.spot, max = rows.reduce((b, r) => r.g > b.g ? r : b, rows[0]);
  const srow = d.surface.find(r => r.expiry_date === state.expiry), dte = srow ? srow.dte : rows[0].dte, atm = nearestBy(rows, 'k', spot);
  desc.textContent = `${d.ticker} ${fmt.date(state.expiry)} · ${dte}d · peak gamma at the ${fmt.num(max.k, max.k % 1 ? 2 : 0)} strike: ${fmt.num(max.g, 3)} Δ per $1 · ATM IV ${fmt.pct(atm && atm.civ, 1)}`;
  if (viewOf('card-gamma') === 'table') {
    plot.replaceChildren(tableEl([{ label: 'Strike', left: true, fmt: r => fmt.num(r.k, 2) }, { label: 'Gamma', fmt: r => fmt.num(r.g, 4) }, { label: 'Call Δ', fmt: r => fmt.num(r.cd, 3) }, { label: 'Call mid', fmt: r => fmt.num(r.cm, 2) },
      { label: 'Call IV', fmt: r => fmt.pct(r.civ) }, { label: 'Put mid', fmt: r => fmt.num(r.pm, 2) }, { label: 'Theta', fmt: r => fmt.num(r.ct, 4) }, { label: 'Vega', fmt: r => fmt.num(r.v, 3) }], rows)); return;
  }
  const f = frame(plot, 310, { t: 22, r: 16, b: 40, l: 44 });
  const ks = rows.map(r => r.k), kmin = Math.min(...ks), kmax = Math.max(...ks);
  const step = rows.length > 1 ? Math.min(...rows.slice(1).map((r, i) => r.k - rows[i].k).filter(v => v > 0)) : 1;
  const x = lin(kmin - step / 2, kmax + step / 2, 0, f.iw), slot = x(kmin + step) - x(kmin), bw = Math.max(1, Math.min(24, slot - 2));
  const [, yhi] = pad(0, Math.max(...rows.map(r => r.g)), 0.1), y = lin(0, yhi, f.ih, 0);
  yGrid(f, niceTicks(0, yhi, 4), y, v => fmt.num(v, v < 0.05 ? 3 : 2));
  for (const r of rows) {
    const bx = x(r.k) - bw / 2, by = y(r.g), bh = f.ih - by, rr = Math.min(4, bw / 2, bh);
    const dpath = `M${bx},${f.ih}V${by + rr}Q${bx},${by} ${bx + rr},${by}H${bx + bw - rr}Q${bx + bw},${by} ${bx + bw},${by + rr}V${f.ih}Z`;
    const bar = el('path', { d: dpath, fill: r === max ? css('--s1') : css('--deemph'), class: 'bar', tabindex: 0 }, f.g);
    const title = `${fmt.num(r.k, 2)} strike · ${fmt.date(r.exp)} · ${r.dte}d`;
    const trows = [{ label: 'Gamma', value: fmt.num(r.g, 4) }, { label: 'Call mid / IV', value: `${fmt.num(r.cm, 2)} · ${fmt.pct(r.civ)}` }, { label: 'Call delta', value: fmt.num(r.cd, 3) },
      { label: 'Theta / day', value: fmt.num(r.ct, 4) }, { label: 'Put mid / IV', value: `${fmt.num(r.pm, 2)} · ${fmt.pct(r.piv)}` }, { label: 'Call breakeven', value: isNum(r.cm) ? '$' + fmt.num(r.k + r.cm, 2) + ' (' + fmt.spct((r.k + r.cm) / spot * 100 - 100, 1) + ')' : '–' }];
    bar.addEventListener('pointermove', ev => showTip(ev.clientX, ev.clientY, title, trows)); bar.addEventListener('pointerleave', hideTip);
    bar.addEventListener('focus', () => { const b = bar.getBoundingClientRect(); showTip(b.left, b.top, title, trows); }); bar.addEventListener('blur', hideTip);
  }
  if (isNum(spot) && spot >= kmin && spot <= kmax) { el('line', { x1: x(spot), x2: x(spot), y1: 0, y2: f.ih + 4, stroke: css('--ink-2'), 'stroke-width': 1 }, f.g); const t = el('text', { x: x(spot), y: f.ih + 32, 'text-anchor': 'middle', class: 'ink2' }, f.g); t.textContent = 'spot ' + fmt.num(spot, 2); }
  const ml = el('text', { x: Math.min(f.iw - 40, Math.max(40, x(max.k))), y: y(max.g) - 6, 'text-anchor': 'middle', class: 'ink' }, f.g); ml.textContent = `max Γ · ${fmt.num(max.k, max.k % 1 ? 2 : 0)}`; ml.setAttribute('font-weight', '600');
  xBaseline(f);
  const n = Math.max(2, Math.min(8, Math.floor(f.iw / 70)));
  niceTicks(kmin, kmax, n).forEach(k => { if (k >= kmin && k <= kmax) xLabel(f, x(k), fmt.num(k, k % 1 ? 1 : 0)); });
  plot.replaceChildren(f.svg);
}

/* ---------------- option chain ---------------- */
function renderChain(d) {
  const plot = $('#card-chain .plot'), desc = $('#chain-desc'); cardTools('card-chain', false);
  if (!d) { desc.textContent = ''; return noDetail(plot); }
  const rows = d.chain.filter(r => r.exp === state.expiry).sort((a, b) => a.k - b.k);
  if (!rows.length) { desc.textContent = ''; return emptyState(plot, 'No chain rows for this expiry.'); }
  const spot = d.spot, atmIdx = rows.reduce((b, r, i) => Math.abs(r.k - spot) < Math.abs(rows[b].k - spot) ? i : b, 0);
  const win = rows.slice(Math.max(0, atmIdx - 10), atmIdx + 11), max = rows.reduce((b, r) => (r.g || 0) > (b.g || 0) ? r : b, rows[0]);
  const srow = d.surface.find(r => r.expiry_date === state.expiry);
  desc.textContent = `${d.ticker} ${fmt.date(state.expiry)} · ${srow ? srow.dte : rows[0].dte}d · ${win.length} strikes around spot $${fmt.num(spot, 2)} · breakeven = strike ± mid; move = breakeven vs spot · snapshot ${(d.snapshot_at || '').replace('T', ' ').slice(0, 16)} UTC`;
  const n = (v, dgt = 2) => fmt.num(v, dgt);
  const head1 = h('tr', {}, h('th', { class: 'grp', colspan: 8 }, 'CALLS'), h('th', {}, ''), h('th', { class: 'grp', colspan: 7 }, 'PUTS'));
  const head2 = h('tr', {}, ...['Bid', 'Mid', 'Ask', 'IV', 'Δ', 'Γ', 'Θ', 'Breakeven ↑'].map(x => h('th', {}, x)), h('th', {}, 'Strike'), ...['Breakeven ↓', 'Θ', 'Δ', 'IV', 'Bid', 'Mid', 'Ask'].map(x => h('th', {}, x)));
  const body = h('tbody', {}, win.map((r, i) => {
    const cbe = isNum(r.cm) ? r.k + r.cm : null, pbe = isNum(r.pm) ? r.k - r.pm : null;
    const tr = h('tr', { class: (rows[atmIdx] === r ? 'atm ' : '') + (r === max ? 'maxg' : '') },
      h('td', {}, n(r.cb)), h('td', {}, n(r.cm)), h('td', {}, n(r.ca)), h('td', {}, fmt.pct(r.civ)), h('td', {}, n(r.cd, 3)), h('td', {}, n(r.g, 3)), h('td', {}, n(r.ct, 3)),
      h('td', {}, cbe != null ? `${n(cbe)} (${fmt.spct(cbe / spot * 100 - 100, 1)})` : '–'),
      h('td', { class: 'k' }, n(r.k, r.k % 1 ? 2 : 0), r === max ? h('span', { class: 'badge' }, 'max Γ') : null, rows[atmIdx] === r ? h('span', { class: 'badge' }, 'ATM') : null),
      h('td', {}, pbe != null ? `${n(pbe)} (${fmt.spct(pbe / spot * 100 - 100, 1)})` : '–'), h('td', {}, n(r.pt, 3)), h('td', {}, isNum(r.pd) ? n(-Math.abs(r.pd), 3) : '–'), h('td', {}, fmt.pct(r.piv)),
      h('td', {}, n(r.pb)), h('td', {}, n(r.pm)), h('td', {}, n(r.pa)));
    return tr;
  }));
  plot.replaceChildren(h('div', { class: 'tbl-wrap tall' }, h('table', { class: 'tbl chain-tbl' }, h('thead', {}, head1, head2), body)));
}

/* ---------------- vol board ---------------- */
const BOARD_COLS = [
  { key: 'ticker', label: 'Ticker', left: true, str: true, fmt: u => h('span', { class: 'tick' }, (state.latest.featured || []).includes(u.ticker) ? h('i', { title: 'surface & chain pre-fetched' }) : null, u.ticker) },
  { key: 'category', label: 'Group', left: true, str: true, fmt: u => h('span', { class: 'cat' }, u.category || '') },
  { key: 'close', label: 'Last', fmt: u => fmt.num(u.close, 2) },
  { key: 'ret_1d', label: '1D', fmt: u => h('span', { class: u.ret_1d > 0 ? 'pos' : u.ret_1d < 0 ? 'neg' : '' }, fmt.spct(isNum(u.ret_1d) ? u.ret_1d * 100 : null, 2)) },
  { key: 'iv30', label: 'IV30', fmt: u => fmt.pct(u.iv30) },
  { key: 'iv30_chg_1d', label: 'ΔIV 1d', fmt: u => fmt.snum(u.iv30_chg_1d, 2) },
  { key: 'iv_pct_1y', label: 'IV pct 1y', fmt: u => h('span', { class: 'cellbar' }, h('span', { class: 'track' }, h('span', { style: `width:${Math.max(0, Math.min(100, u.iv_pct_1y || 0))}%` })), h('span', { class: 'num' }, fmt.num(u.iv_pct_1y, 0))) },
  { key: 'rv30', label: 'RV30', fmt: u => fmt.pct(u.rv30) },
  { key: 'vrp', label: 'VRP', fmt: u => { const v = u.vrp || 0, w = Math.min(50, Math.abs(v) / 60 * 50); return h('span', { class: 'cellbar' }, h('span', { class: 'divbar' }, h('span', { class: v >= 0 ? 'p' : 'n', style: `width:${w}%` })), h('span', { class: 'num' }, fmt.snum(u.vrp, 1))); } },
  { key: 'term_30_10', label: 'Term 30/10', fmt: u => fmt.spct(isNum(u.term_30_10) ? u.term_30_10 * 100 : null, 1) },
  { key: 'rr25_pct', label: 'RR25 pct', fmt: u => fmt.num(u.rr25_pct, 0) },
  { key: 'next_earnings', label: 'Earnings', str: true, fmt: u => u.next_earnings ? fmt.dateShort(u.next_earnings) : '' },
  { key: 'spark', label: 'IV30 · 1M', fmt: u => { const s = sparkSvg((state.history[u.ticker] || []).slice(-22).map(r => r.iv30), 90, 22); return s ? h('span', { class: 'spark-cell' }, s) : ''; } },
];
function renderBoard() {
  const plot = $('#card-board .plot'); cardTools('card-board', false);
  const u = state.latest.universe.slice(), { col, dir } = state.sort, c = BOARD_COLS.find(c => c.key === col);
  if (c && c.key !== 'spark') u.sort((a, b) => { const x = a[col], y = b[col]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (c.str ? String(x).localeCompare(String(y)) : x - y) * dir; });
  $('#board-desc').textContent = `${u.length} names · as of ${fmt.date(state.latest.as_of)} · click a column to sort, a row to load that name`;
  const thead = h('thead', {}, h('tr', {}, BOARD_COLS.map(cdef => h('th', { class: 'sortable' + (cdef.left ? ' l' : ''), 'aria-sort': col === cdef.key ? (dir > 0 ? 'ascending' : 'descending') : 'none',
    onclick: () => { state.sort = { col: cdef.key, dir: col === cdef.key ? -dir : (cdef.str ? 1 : -1) }; renderBoard(); } }, cdef.label))));
  const tbody = h('tbody', {}, u.map(row => h('tr', { class: 'row-click' + (row.ticker === state.ticker ? ' sel' : ''), onclick: () => setTicker(row.ticker) },
    BOARD_COLS.map(cdef => h('td', { class: cdef.left ? 'l' : '' }, cdef.fmt(row))))));
  plot.replaceChildren(h('div', { class: 'tbl-wrap tall' }, h('table', { class: 'tbl' }, thead, tbody)));
}

/* ---------------- trade ideas ---------------- */
function renderIdeas() {
  const plot = $('#card-ideas .plot'), desc = $('#ideas-desc'); cardTools('card-ideas', false);
  const I = state.latest.ideas; if (!I || !I.rows || !I.rows.length) { desc.textContent = ''; return emptyState(plot, 'No trade ideas in this snapshot.'); }
  desc.textContent = `Moontower preset screens, top names by score · ${I.universe_size || ''} names scored · trade date ${fmt.date(I.trade_date)}`;
  const order = ['Buy Vol', 'Sell Vol', 'Long Calendar', 'Short Calendar'];
  const groups = order.filter(o => I.rows.some(r => r.idea === o)).concat([...new Set(I.rows.map(r => r.idea))].filter(x => !order.includes(x)));
  plot.replaceChildren(h('div', { class: 'ideas-grid' }, groups.map(g => {
    const rows = I.rows.filter(r => r.idea === g && isNum(r.totalScore)).sort((a, b) => b.totalScore - a.totalScore).slice(0, 8);
    const top = Math.max(1, ...rows.map(r => r.totalScore));
    return h('div', { class: 'idea-col' }, h('h3', {}, g, h('span', { class: 'cat' }, 'score')), h('ol', {}, rows.map(r => h('li', { title: `IV pct ${fmt.num(r.ivPercentile, 0)} · VRP pct ${fmt.num(r.vrpPercentile, 0)} · term ${fmt.num(r.termStructureRatio, 2)}`, onclick: () => setTicker(r.ticker) },
      h('b', {}, r.ticker), h('span', { class: 'track' }, h('span', { style: `width:${Math.max(2, r.totalScore / top * 100)}%` })), h('span', { class: 'sc' }, fmt.num(r.totalScore, 0))))));
  })));
}

/* ---------------- orchestration ---------------- */
const currentU = () => state.latest && state.latest.universe.find(u => u.ticker === state.ticker);
function noDetail(plot) {
  const feat = (state.latest.featured || []).join(', ');
  emptyState(plot, state.key ? `Could not load ${state.ticker} live. Check the key and credits, then reselect.` : `Surface, cone, skew and chain are pre-fetched for ${feat}. Add your Moontower key (Live key) to pull ${state.ticker} on demand.`, 'Detail not loaded.');
}
function setNote(txt) { $('#refresh-note').textContent = txt; }
function populateExpiries(d) {
  const sel = $('#expiry-select'); sel.replaceChildren();
  if (!d) { sel.appendChild(h('option', {}, '—')); sel.disabled = true; return; }
  sel.disabled = false;
  const exps = d.surface.filter(r => r.dte > 0).sort((a, b) => a.dte - b.dte);
  if (!exps.some(e => e.expiry_date === state.expiry)) { const near = nearestBy(exps, 'dte', 30); state.expiry = near ? near.expiry_date : (exps[0] && exps[0].expiry_date); }
  for (const e of exps) sel.appendChild(h('option', { value: e.expiry_date, selected: e.expiry_date === state.expiry ? '' : null }, `${fmt.date(e.expiry_date)} · ${e.dte}d`));
}
function setExpiry(e) { state.expiry = e; $('#expiry-select').value = e; pushUrl(); renderDetail(); }
async function setTicker(t) {
  if (!t) return; state.ticker = t; $('#ticker-select').value = t; pushUrl();
  renderKpis(); renderHistory(); renderBoard();
  document.querySelectorAll('#card-surface .plot, #card-cone .plot, #card-smile .plot, #card-gamma .plot, #card-chain .plot').forEach(p => p.classList.add('stale'));
  const d = await getDetail(t);
  document.querySelectorAll('.plot.stale').forEach(p => p.classList.remove('stale'));
  if (state.ticker !== t) return;
  populateExpiries(d); renderDetail();
}
function renderDetail() {
  const d = state.detail[state.ticker] || null;
  renderSurface(d); renderCone(d); renderSmile(d); renderGamma(d); renderChain(d);
}
function renderAll() { if (!state.latest) return; renderKpis(); renderHistory(); renderBoard(); renderIdeas(); renderDetail(); renderStatus(); }
function renderStatus() {
  const L = state.latest, u = currentU();
  const snap = (u && u.snapshot_at) || '';
  let et = '';
  if (snap) { const dt = new Date(snap.replace(' ', 'T') + (snap.endsWith('Z') ? '' : 'Z')); et = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'; }
  $('#asof-text').replaceChildren('As of ', h('strong', {}, fmt.date(L.as_of)), et ? ` · ${et} snapshot` : '', L.generated_at ? ` · refreshed ${fmt.ago(L.generated_at)}` : '');
  const fresh = L.generated_at && (Date.now() - new Date(L.generated_at)) < 26 * 3600 * 1000;
  $('#live-dot').className = 'dot' + (fresh ? ' fresh' : '');
  $('#mode-chip').textContent = state.liveBoard ? 'Live · your key' : state.key ? 'Snapshot + live detail' : 'Snapshot · auto-refreshed';
  $('#key-btn').classList.toggle('active', !!state.key);
  $('#foot-meta').textContent = `snapshot generated ${L.generated_at ? new Date(L.generated_at).toLocaleString() : '–'} · ${L.api_calls || 0} API calls per refresh`;
}
function pushUrl() { const q = new URLSearchParams(); if (state.ticker) q.set('t', state.ticker); if (state.expiry) q.set('e', state.expiry); if (state.range !== '1Y') q.set('r', state.range); history.replaceState(null, '', '?' + q); }

async function loadData(first) {
  const [latest, hist] = await Promise.all([getJSON('data/latest.json'), getJSON('data/history.json')]);
  state.latest = latest; state.history = hist; state.lastGenerated = latest.generated_at; state.detail = {};
  const sel = $('#ticker-select'); sel.replaceChildren();
  const groups = {};
  for (const u of latest.universe) (groups[u.category || 'Other'] ||= []).push(u);
  for (const g of Object.keys(groups).sort()) sel.appendChild(h('optgroup', { label: g }, groups[g].map(u => h('option', { value: u.ticker }, u.ticker + ((latest.featured || []).includes(u.ticker) ? ' ●' : '')))));
  if (first) {
    const q = new URLSearchParams(location.search);
    state.ticker = latest.universe.some(u => u.ticker === q.get('t')) ? q.get('t') : (latest.featured || []).includes('TLT') ? 'TLT' : (latest.featured || [])[0] || latest.universe[0].ticker;
    if (q.get('e')) state.expiry = q.get('e');
    if (RANGE_DAYS[q.get('r')]) { state.range = q.get('r'); document.querySelectorAll('#range-seg button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.range === state.range))); }
  }
  sel.value = state.ticker;
}
async function poll() {
  try {
    const r = await fetch('data/latest.json?v=' + Date.now(), { cache: 'no-store' }); const j = await r.json();
    if (j.generated_at !== state.lastGenerated && !state.liveBoard) {
      document.querySelectorAll('.plot').forEach(p => p.classList.add('stale'));
      await loadData(false); renderAll(); await setTicker(state.ticker);
      document.querySelectorAll('.plot').forEach(p => p.classList.remove('stale'));
    }
  } catch (e) { console.warn('poll failed', e); }
  state.nextPoll = Date.now() + POLL_MS;
}
function tickNote() {
  if (state.liveBoard) { setNote('Board pulled live with your key'); return; }
  const s = Math.max(0, Math.round((state.nextPoll - Date.now()) / 1000));
  setNote(`Checks for a new snapshot in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
}

function bindUI() {
  $('#ticker-select').addEventListener('change', e => setTicker(e.target.value));
  $('#expiry-select').addEventListener('change', e => setExpiry(e.target.value));
  $('#range-seg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; state.range = b.dataset.range; document.querySelectorAll('#range-seg button').forEach(x => x.setAttribute('aria-checked', String(x === b))); pushUrl(); renderHistory(); });
  $('#theme-btn').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme'); const next = cur === 'dark' ? 'light' : cur === 'light' ? null : (isDark() ? 'light' : 'dark');
    if (next) { document.documentElement.setAttribute('data-theme', next); try { localStorage.setItem('theme', next); } catch (e) {} } else { document.documentElement.removeAttribute('data-theme'); try { localStorage.removeItem('theme'); } catch (e) {} }
    renderAll();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderAll);
  $('#key-btn').addEventListener('click', () => { const kb = $('#keybar'); kb.hidden = !kb.hidden; if (!kb.hidden) $('#key-input').focus(); });
  $('#key-form').addEventListener('submit', e => {
    e.preventDefault(); const v = $('#key-input').value.trim();
    if (!/^mtw_[A-Za-z0-9_-]{8,}$/.test(v)) { setNote('That does not look like a Moontower key (mtw_…)'); return; }
    state.key = v; try { localStorage.setItem('mtw_key', v); } catch (err) {} $('#key-input').value = ''; $('#keybar').hidden = true; state.detail = {}; renderStatus(); setTicker(state.ticker);
  });
  $('#key-clear').addEventListener('click', () => { state.key = null; state.liveBoard = false; try { localStorage.removeItem('mtw_key'); } catch (e) {} $('#keybar').hidden = true; renderStatus(); });
  $('#key-refresh').addEventListener('click', async () => {
    if (!state.key) { setNote('Save a key first'); return; }
    document.querySelectorAll('.plot').forEach(p => p.classList.add('stale')); setNote('Pulling the board live…');
    try { await liveBoard(); state.detail = {}; renderAll(); await setTicker(state.ticker); } catch (e) { setNote('Live board failed: ' + e.message); }
    document.querySelectorAll('.plot').forEach(p => p.classList.remove('stale'));
  });
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderAll, 120); });
}

async function boot() {
  try { const t = localStorage.getItem('theme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch (e) {}
  try { state.key = localStorage.getItem('mtw_key') || null; } catch (e) {}
  bindUI();
  try { await loadData(true); } catch (e) { $('#asof-text').textContent = 'Could not load data'; $('#kpis').replaceChildren(h('div', { class: 'empty' }, 'data/latest.json is missing. Run scripts/fetch_data.py or wait for the refresh action.')); return; }
  renderAll(); await setTicker(state.ticker);
  state.nextPoll = Date.now() + POLL_MS; setInterval(poll, POLL_MS); setInterval(tickNote, 1000); tickNote();
  setInterval(renderStatus, 60000);
}
boot();
})();
