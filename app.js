/* Vol Desk — Moontower front end. Vanilla JS, hand-rolled SVG. No key ships with this file. */
(() => {
'use strict';

const API = 'https://api.moontower.ai';
const POLL_MS = 5 * 60 * 1000;
const DELTAS = [90, 80, 70, 60, 50, 40, 30, 20, 10];            // vol90 … vol10 = call delta, low strike → high strike
const RANGE_DAYS = { '1M': 31, '3M': 92, '6M': 183, '1Y': 10000 };
const SHOP_DELTAS = [25, 15, 10];                                 // the OTM call shelf George shops
const DUR_TLT = 16, BP_PER_PCT = 100 / DUR_TLT;                   // duration 16 → 1% of TLT ≈ 6.25 bp of long yield
const SCEN_MOVES = [5, 10, 16], SCEN_DAYS = [20, 40, 60, 90], IV_SHIFT = -3;
const ANALOG_PEAK = '2023-10-19';                                 // 2023 long-yield peak (10y ~5%); aligned to today's date
const MAX_DTE_SHOP = 185;
const EVENTS = [                                                   // v: verified on the primary source (see README); otherwise approximate
  { d: '2026-10-14', label: 'CPI (Sep)', kind: 'cpi', v: false, note: 'per calendar sites; confirm on bls.gov' },
  { d: '2026-10-27', end: '2026-10-28', label: 'FOMC', kind: 'fomc', v: true, note: 'federalreserve.gov' },
  { d: '2026-11-04', label: 'Refunding', kind: 'tsy', v: true, note: 'Treasury, Aug-2026 refunding statement' },
  { d: '2026-11-10', label: 'CPI (Oct)', kind: 'cpi', v: false, note: 'per calendar sites; confirm on bls.gov' },
  { d: '2026-11-12', label: '30y auction', kind: 'tsy', v: false, note: 'usual 2nd-week slot; Treasury posts the date with the Nov 4 refunding' },
  { d: '2026-12-08', end: '2026-12-09', label: 'FOMC · SEP', kind: 'fomc', v: true, note: 'federalreserve.gov' },
  { d: '2026-12-10', label: 'CPI (Nov)', kind: 'cpi', v: false, note: 'per calendar sites; confirm on bls.gov' },
  { d: '2026-12-10', label: '30y auction', kind: 'tsy', v: false, note: 'usual 2nd-week slot' },
  { d: '2027-01-13', label: 'CPI (Dec)', kind: 'cpi', v: false, note: 'BLS 2027 schedule not published yet' },
  { d: '2027-01-14', label: '30y auction', kind: 'tsy', v: false, note: 'usual 2nd-week slot' },
  { d: '2027-01-26', end: '2027-01-27', label: 'FOMC', kind: 'fomc', v: true, note: 'federalreserve.gov; tentative until the Dec meeting confirms it' },
];
const SEQ_LIGHT = ['#ececea', '#dcdcd9', '#c9c9c6', '#b4b4b8', '#9c9c9f', '#8a8a8f', '#6f6f73', '#57575a', '#404043', '#26262a'];   // paper → ink
const SEQ_DARK = ['#1a1a1a', '#232323', '#2e2e2e', '#3e3e3e', '#4f4f4f', '#6a6a6a', '#858585', '#a3a3a3', '#bdbdbd', '#d4d4d4'];
const CHAIN_FIELDS = { expiry_date: 'exp', dte: 'dte', strike: 'k', call_bid_price: 'cb', call_mid_price: 'cm', call_ask_price: 'ca',
  put_bid_price: 'pb', put_mid_price: 'pm', put_ask_price: 'pa', call_mid_iv: 'civ', put_mid_iv: 'piv', smoothed_vol: 'siv',
  call_delta: 'cd', put_delta: 'pd', call_gamma: 'g', call_theta: 'ct', put_theta: 'pt', call_vega: 'v',
  call_open_interest: 'coi', put_open_interest: 'poi', call_volume: 'cvol', put_volume: 'pvol' };

const $ = (s, r = document) => r.querySelector(s);
const state = {
  latest: null, history: null, analog: null, detail: {}, ticker: null, expiry: null, range: '1Y',
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
  const steps = isDark() ? SEQ_DARK : SEQ_LIGHT;
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

/* ---------------- option math: Black-Scholes, zero drift (no API calls) ---------------- */
function ncdf(x) {                                   // Abramowitz–Stegun 26.2.17, |err| < 7.5e-8
  const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}
function bsCall(S, K, T, sig) {                      // forward = spot (carry ≈ distribution yield on TLT)
  if (T <= 0 || sig <= 0) return Math.max(0, S - K);
  const sq = sig * Math.sqrt(T), d1 = (Math.log(S / K) + sig * sig * T / 2) / sq;
  return S * ncdf(d1) - K * ncdf(d1 - sq);
}
function impliedVol(S, K, T, price) {                // the vol that reproduces the mid under the zero-drift model
  if (!(price > 0) || T <= 0 || price <= Math.max(0, S - K)) return null;
  let lo = 0.005, hi = 3;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (bsCall(S, K, T, m) < price) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
const pAbove = (S, B, T, sig) => T > 0 ? ncdf((Math.log(S / B) - sig * sig * T / 2) / (sig * Math.sqrt(T))) : (S > B ? 1 : 0);   // P(S_T > B), lognormal, zero drift
function pTouch(S, K, T, sig) {                      // P(max S_t ≥ K) for K > S: reflection principle with log-drift −σ²/2
  if (K <= S) return 1; if (T <= 0) return 0;
  const b = Math.log(K / S), sq = sig * Math.sqrt(T), m = sig * sig * T / 2;
  return ncdf((-b - m) / sq) + (S / K) * ncdf((-b + m) / sq);
}
function halfLife(S, K, T, sig, mid) {               // days until the call is worth half its mid with spot unchanged
  const target = mid / 2; if (bsCall(S, K, 0, sig) >= target) return null;
  let lo = 0, hi = T;
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (bsCall(S, K, T - m, sig) > target) lo = m; else hi = m; }
  return (lo + hi) / 2 * 365;
}

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
const readout = (key, text) => { const n = $('#' + key + '-readout'); if (n && n.textContent !== text) n.textContent = text; };

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
const DELTA_KEYS = DELTAS;
function surfaceFromChain(chain, spot, date) {                     // IV at 90…10 call delta from the chain's fitted vol (same shape as /v1/impliedvol)
  const per = {};
  for (const r of chain) if (isNum(r.siv) && isNum(r.cd)) (per[r.exp] ||= []).push(r);
  const out = [];
  for (const exp of Object.keys(per).sort()) {
    const rows = per[exp].sort((a, b) => b.cd - a.cd), o = { date, expiry_date: exp, dte: rows[0].dte - 1, spot_price: spot };
    let any = false;
    for (const d of DELTA_KEYS) { const t = d / 100; let v = null; for (let i = 0; i + 1 < rows.length; i++) { const A = rows[i], B = rows[i + 1]; if (A.cd >= t && t >= B.cd) { const s = A.cd - B.cd; v = A.siv + (B.siv - A.siv) * (s ? (A.cd - t) / s : 0); break; } } o['vol' + d] = isNum(v) ? round(v, 2) : null; any = any || isNum(v); }
    if (any) out.push(o);
  }
  return out;
}
async function liveDetail(t) {
  const [cone, chain, skew] = await Promise.all([api('/v1/volcone', { ticker: t }), api('/v1/optionchain', { ticker: t }), api('/v1/skew', { ticker: t })]);
  const spot = (chain.find(r => r.spot_price) || {}).spot_price || null, date = (chain[0] || {}).trade_date || null;
  const trimmed = trimChain(chain, spot);
  return { ticker: t, as_of: date, snapshot_at: (chain[0] || {}).snapshot_at, spot, surface: surfaceFromChain(trimmed, spot, date), cone,
    skew: skew.filter(r => r.maturity <= 420), chain: trimmed, live: true };
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
  const t = state.ticker;
  const [cockpit, ivrank, rviv, skew] = await Promise.all(['cockpit', 'ivrank', 'rviv', 'skew'].map(e => api('/v1/' + e, { ticker: t })));
  const last = a => (a || []).filter(r => r.date).sort((p, q) => p.date < q.date ? 1 : -1)[0] || {};
  const x100 = v => isNum(v) ? round(v * 100, 2) : null;
  const ck = last(cockpit), ir = last(ivrank), rv = last(rviv), sk = nearestBy((skew || []).filter(s => s.risk_reversal_25d != null), 'maturity', 30) || {};
  const u = { ...state.latest.universe[0], date: ck.date, snapshot_at: ck.snapshot_at, close: ck.close, ret_1d: ck.daily_return, ret_1w: ck.weekly_return, ret_1m: ck.monthly_return, sd_200: ck.sd_from_200ma,
    iv10: x100(ck.iv_10d), iv30: x100(ck.iv_30d), iv90: x100(ck.iv_90d), iv6m: x100(ck.iv_6m), iv30_chg_1d: x100(ck.iv_30d_daily_change), iv30_chg_1w: x100(ck.iv_30d_weekly_change),
    iv_rank_1y: ir.iv_rank_1y, iv_pct_1y: ir.iv_pct_1y, iv_pct_3m: ir.iv_pct_3m, iv_pct_1m: ir.iv_pct_1m,
    rv7: ck.rv_7d, rv30: rv.rv_30d ?? ck.rv_30d, rv90: ck.rv_90d, rv_pct: rv.rv_percentile, vrp: rv.vrp, term_30_10: ck.term_structure_30d_10d, term_90_30: ck.term_structure_90d_30d,
    rr25: sk.risk_reversal_25d, rr25_pct: sk.risk_reversal_25d_percentile, skew25p: sk.skew_25d_put, skew25p_pct: sk.skew_25d_put_percentile, skew25c_pct: sk.skew_25d_call_percentile, skew_maturity: sk.maturity };
  state.latest = { ...state.latest, universe: [u], as_of: ck.date || state.latest.as_of, generated_at: new Date().toISOString(), live: true };
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
  desc.textContent = `${d.ticker} · ${fmt.date(d.as_of)} · spot $${fmt.num(d.spot, 2)} · ${rows.length} expiries × 9 call-delta buckets, interpolated on the chain's fitted vol.`;
  const selRow = rows.find(r => r.expiry_date === state.expiry); if (selRow) readout('surface', `${fmt.dateShort(selRow.expiry_date)} · ${selRow.dte}d · 90Δ ${fmt.num(selRow.vol90, 1)} · ATM ${fmt.num(selRow.vol50, 1)} · 10Δ ${fmt.num(selRow.vol10, 1)}`);
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
    if (sel) el('rect', { x: 0, y: y + 0.5, width: f.iw, height: cellH - 1, fill: 'none', stroke: css('--lit'), 'stroke-width': 1.2, rx: 2, 'pointer-events': 'none' }, f.g);
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
  const c30 = rows.find(r => r.window_days === 30) || rows[0]; readout('cone', `30d · RV ${fmt.num(c30.rv_current, 1)} vs median ${fmt.num(c30.rv_median, 1)} · ATM IV ${fmt.num(c30.iv_50d, 1)}`);
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
function analogRows() {                            // 2023 rows re-dated so the 2023 yield peak lands on today's as-of date
  const A = state.analog; if (!A || !A.rows || !A.rows.length) return [];
  const peak = A.rows.find(r => r.d === ANALOG_PEAK); if (!peak) return [];
  const asOf = state.latest.as_of, u = currentU(), nowClose = u && u.close;
  const shift = new Date(asOf + 'T00:00:00') - new Date(ANALOG_PEAK + 'T00:00:00');
  return A.rows.map(r => ({ d0: r.d, t: +new Date(r.d + 'T00:00:00') + shift, iv30: r.iv30, rv30: r.rv30, c: r.c, cr: isNum(nowClose) && isNum(r.c) && isNum(peak.c) ? r.c / peak.c * nowClose : null }));
}
function renderHistory() {
  const plot = $('#card-history .plot'), desc = $('#history-desc'); cardTools('card-history', true);
  const t = state.ticker, all = (state.history[t] || []);
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - RANGE_DAYS[state.range]);
  const rows = all.filter(r => (isNum(r.iv30) || isNum(r.rv30)) && new Date(r.d) >= cutoff);
  if (rows.length < 2) { desc.textContent = ''; return emptyState(plot, 'No history for ' + t + ' yet. History accumulates from the daily refresh.'); }
  const last = rows[rows.length - 1], ana = analogRows(), tNow = +new Date(last.d + 'T00:00:00');
  const anaFwd = ana.filter(a => a.t >= tNow), anaAll = ana;
  const peakRow = ana.find(a => a.d0 === ANALOG_PEAK), anaEnd = ana[ana.length - 1];
  desc.textContent = `${t} · ${fmt.date(rows[0].d)} → ${fmt.date(last.d)}` + (peakRow ? ` · grey: autumn 2023 with the ${fmt.date(ANALOG_PEAK)} yield peak placed on ${fmt.dateShort(last.d)}; IV30 ${fmt.num(peakRow.iv30, 1)} that day vs ${fmt.num(last.iv30, 1)} now, and TLT then rallied ${fmt.spct((anaEnd.c / peakRow.c - 1) * 100, 1)} into year-end` : '');
  readout('history', `${fmt.dateShort(last.d)} · IV30 ${fmt.num(last.iv30, 1)} · RV30 ${fmt.num(last.rv30, 1)} · VRP ${fmt.snum(last.vrp, 1)}` + (peakRow ? ` · 2023 peak IV30 ${fmt.num(peakRow.iv30, 1)}` : ''));
  if (viewOf('card-history') === 'table') {
    plot.replaceChildren(tableEl([{ label: 'Date', left: true, fmt: r => fmt.date(r.d) }, { label: 'Close', fmt: r => fmt.num(r.c, 2) }, { label: 'IV30', fmt: r => fmt.pct(r.iv30) },
      { label: 'RV30', fmt: r => fmt.pct(r.rv30) }, { label: 'VRP', fmt: r => fmt.snum(r.vrp, 1) }, { label: 'IV10', fmt: r => fmt.pct(r.iv10) }, { label: 'IV90', fmt: r => fmt.pct(r.iv90) }], rows.slice().reverse())); return;
  }
  const f = frame(plot, 300, { t: 14, r: 72, b: 30, l: 44 });
  const t0 = +new Date(rows[0].d), t1 = Math.max(+new Date(last.d), anaFwd.length ? anaFwd[anaFwd.length - 1].t : 0), x = lin(t0, t1, 0, f.iw);
  const anaVis = anaAll.filter(a => a.t >= t0);
  const vals = rows.flatMap(r => [r.iv30, r.rv30]).concat(anaVis.map(a => a.iv30)).filter(isNum), [lo, hi] = pad(Math.min(...vals), Math.max(...vals), 0.08), y = lin(Math.max(0, lo), hi, f.ih, 0);
  yGrid(f, niceTicks(Math.max(0, lo), hi, 5), y, v => fmt.num(v, 0) + '%');
  // right axis: close ($) for today's TLT and the rebased 2023 path
  const pv = rows.map(r => r.c).concat(anaVis.map(a => a.cr)).filter(isNum), hasPx = pv.length > 1;
  const [plo, phi] = hasPx ? pad(Math.min(...pv), Math.max(...pv), 0.1) : [0, 1], yp = lin(plo, phi, f.ih, 0);
  if (hasPx) for (const tk of niceTicks(plo, phi, 4)) { const tx = el('text', { x: f.iw + 6, y: yp(tk) + 3.5, class: 'muted' }, f.g); tx.textContent = '$' + fmt.num(tk, 0); }
  const seg = (arr, key, tOf, yOf) => { const out = []; let cur = []; for (const r of arr) { if (isNum(r[key])) cur.push([x(tOf(r)), yOf(r[key])]); else if (cur.length) { out.push(cur); cur = []; } } if (cur.length) out.push(cur); return out.map(linePath).join(''); };
  const tR = r => +new Date(r.d), tA = a => a.t;
  el('path', { d: seg(rows, 'iv30', tR, y) + 'L' + x(+new Date(last.d)) + ',' + f.ih + 'L0,' + f.ih + 'Z', fill: css('--s1'), opacity: 0.08, 'pointer-events': 'none' }, f.g);
  if (anaFwd.length) el('rect', { x: x(tNow), y: 0, width: Math.max(0, f.iw - x(tNow)), height: f.ih, fill: css('--ink'), opacity: isDark() ? 0.05 : 0.03 }, f.g);
  // analog (grey, behind)
  if (anaVis.length) {
    el('path', { d: seg(anaVis, 'cr', tA, yp), fill: 'none', stroke: css('--mid'), 'stroke-width': 1.2, 'stroke-dasharray': '2 3', 'stroke-linejoin': 'round', opacity: 0.9 }, f.g);
    el('path', { d: seg(anaVis, 'iv30', tA, y), fill: 'none', stroke: css('--mid'), 'stroke-width': 1.5, 'stroke-dasharray': '5 3', 'stroke-linejoin': 'round' }, f.g);
  }
  if (hasPx) el('path', { d: seg(rows, 'c', tR, yp), fill: 'none', stroke: css('--ink'), 'stroke-width': 1, opacity: 0.55, 'stroke-linejoin': 'round' }, f.g);
  el('path', { d: seg(rows, 'rv30', tR, y), fill: 'none', stroke: css('--s2'), 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, f.g);
  el('path', { d: seg(rows, 'iv30', tR, y), fill: 'none', stroke: css('--s1'), 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, f.g);
  if (anaFwd.length) { el('line', { x1: x(tNow), x2: x(tNow), y1: 0, y2: f.ih, stroke: css('--hi'), 'stroke-width': 1, 'stroke-dasharray': '1 3' }, f.g); const tl = el('text', { x: x(tNow) + 4, y: 10, class: 'ink2' }, f.g); tl.textContent = `today ≙ ${fmt.dateShort(ANALOG_PEAK)} 2023`; }
  xBaseline(f);
  const nT = Math.max(2, Math.min(6, Math.floor(f.iw / 90)));
  for (let i = 0; i < nT; i++) { const tt = t0 + (t1 - t0) * i / (nT - 1); xLabel(f, x(tt), new Date(tt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), i === 0 ? 'start' : i === nT - 1 ? 'end' : 'middle'); }
  const lastAna = anaFwd[anaFwd.length - 1];
  const labels = [{ y: y(last.iv30), text: 'IV ' + fmt.num(last.iv30, 1), color: css('--s1') }, { y: y(last.rv30), text: 'RV ' + fmt.num(last.rv30, 1), color: css('--s2') }];
  if (lastAna && isNum(lastAna.iv30)) labels.push({ y: y(lastAna.iv30), text: "'23 IV " + fmt.num(lastAna.iv30, 1), color: css('--mid') });
  if (lastAna && isNum(lastAna.cr)) labels.push({ y: yp(lastAna.cr), text: "'23 $" + fmt.num(lastAna.cr, 0), color: css('--mid') });
  endLabels(f, labels);
  const cross = el('line', { y1: 0, y2: f.ih, stroke: css('--axis'), visibility: 'hidden' }, f.g);
  const dotA = el('circle', { r: 4, fill: css('--s1'), stroke: css('--surface'), 'stroke-width': 2, visibility: 'hidden' }, f.g);
  const dotB = el('circle', { r: 4, fill: css('--s2'), stroke: css('--surface'), 'stroke-width': 2, visibility: 'hidden' }, f.g);
  const hit = el('rect', { x: 0, y: 0, width: f.iw, height: f.ih, class: 'hit' }, f.g);
  hit.addEventListener('pointermove', ev => {
    const b = f.svg.getBoundingClientRect(), tt = x.invert(ev.clientX - b.left - f.m.l);
    const a = anaVis.length ? anaVis.reduce((p, q) => Math.abs(q.t - tt) < Math.abs(p.t - tt) ? q : p) : null;
    const anaRows = a && Math.abs(a.t - tt) < 4 * 864e5 ? [{ label: `2023 IV30 (${fmt.dateShort(a.d0)})`, value: fmt.pct(a.iv30), color: css('--mid') }, { label: '2023 close, rebased', value: isNum(a.cr) ? '$' + fmt.num(a.cr, 2) + ' (' + fmt.num(a.c, 2) + ')' : '–' }] : [];
    if (tt > tNow + 2 * 864e5) { cross.setAttribute('x1', x(tt)); cross.setAttribute('x2', x(tt)); cross.setAttribute('visibility', 'visible'); dotA.setAttribute('visibility', 'hidden'); dotB.setAttribute('visibility', 'hidden');
      showTip(ev.clientX, ev.clientY, new Date(tt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' · analog', anaRows.length ? anaRows : [{ label: 'No analog row', value: '–' }]); return; }
    let bi = 0; rows.forEach((r, i) => { if (Math.abs(+new Date(r.d) - tt) < Math.abs(+new Date(rows[bi].d) - tt)) bi = i; });
    const r = rows[bi], px = x(+new Date(r.d));
    cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
    for (const [dot, k] of [[dotA, 'iv30'], [dotB, 'rv30']]) { if (isNum(r[k])) { dot.setAttribute('cx', px); dot.setAttribute('cy', y(r[k])); dot.setAttribute('visibility', 'visible'); } else dot.setAttribute('visibility', 'hidden'); }
    showTip(ev.clientX, ev.clientY, fmt.date(r.d), [{ label: 'IV 30d', value: fmt.pct(r.iv30), color: css('--s1') }, { label: 'RV 30d', value: fmt.pct(r.rv30), color: css('--s2') },
      { label: 'VRP', value: fmt.snum(r.vrp, 1) }, { label: 'Close', value: isNum(r.c) ? '$' + fmt.num(r.c, 2) : '–' }, ...anaRows]);
  });
  hit.addEventListener('pointerleave', () => { hideTip(); [cross, dotA, dotB].forEach(n => n.setAttribute('visibility', 'hidden')); });
  const leg = [{ label: 'Implied vol, 30-day', color: css('--s1') }, { label: 'Realized vol, 30-day', color: css('--s2') }, { label: 'TLT close (right axis)', color: css('--ink') }];
  if (anaVis.length) leg.push({ label: '2023 IV30, peak-aligned', color: css('--mid') }, { label: '2023 close, rebased to today', color: css('--mid') });
  plot.replaceChildren(legend(leg), f.svg);
}

/* ---------------- cheap wing by expiry ---------------- */
const nearestTo = (rows, key, target) => rows.reduce((b, r) => (isNum(r[key]) && (!b || Math.abs(Math.abs(r[key]) - target) < Math.abs(Math.abs(b[key]) - target))) ? r : b, null);
function wingRows(d, maxDte = 185) {
  if (!d || !d.chain) return [];
  const spot = d.spot, byExp = {};
  for (const r of d.chain) (byExp[r.exp] ||= []).push(r);
  const dteOf = {}; for (const s of d.surface || []) dteOf[s.expiry_date] = s.dte;
  const out = [];
  for (const exp of Object.keys(byExp).sort()) {
    const rows = byExp[exp], dte = dteOf[exp] ?? (rows[0].dte - 1);
    if (!(dte > 1) || dte > maxDte) continue;
    const call = nearestTo(rows.filter(r => r.k > spot), 'cd', 0.25), put = nearestTo(rows.filter(r => r.k < spot), 'pd', 0.25);
    const atm = rows.reduce((b, r) => Math.abs(r.k - spot) < Math.abs(b.k - spot) ? r : b, rows[0]);
    if (!call || !put || !isNum(call.civ) || !isNum(put.piv)) continue;
    const atmIV = isNum(atm.siv) ? atm.siv : (atm.civ + atm.piv) / 2;
    out.push({ exp, dte, label: fmt.dateShort(exp) + ' · ' + dte + 'd', spot, atmIV, atmK: atm.k,
      call: { k: call.k, mid: call.cm, iv: call.civ, delta: call.cd, be: call.k + call.cm, move: (call.k + call.cm) / spot - 1, cost: call.cm / spot },
      put: { k: put.k, mid: put.pm, iv: put.piv, delta: -Math.abs(put.pd), be: put.k - put.pm, move: (put.k - put.pm) / spot - 1, cost: put.pm / spot },
      putIV: put.piv, callIV: call.civ, diff: put.piv - call.civ });
  }
  return out;
}
function shopLines(d) {
  if (!d || !d.chain) return [];
  const spot = d.spot, byExp = {};
  for (const r of d.chain) (byExp[r.exp] ||= []).push(r);
  const dteOf = {}; for (const s of d.surface || []) dteOf[s.expiry_date] = s.dte;
  const wings = {}; for (const w of wingRows(d, MAX_DTE_SHOP)) wings[w.exp] = w;
  const out = [];
  for (const exp of Object.keys(byExp).sort()) {
    const rows = byExp[exp], dte = dteOf[exp] ?? (rows[0].dte - 1);
    if (!(dte > 1) || dte > MAX_DTE_SHOP) continue;
    const otm = rows.filter(r => r.k > spot && isNum(r.cm) && r.cm > 0 && isNum(r.cd) && isNum(r.g));
    const T = dte / 365, used = new Set();
    for (const tgt of SHOP_DELTAS) {
      const c = nearestTo(otm, 'cd', tgt / 100); if (!c || used.has(c.k)) continue; used.add(c.k);
      const sig = impliedVol(spot, c.k, T, c.cm) || (c.civ / 100);
      const be = c.k + c.cm, move = be / spot - 1;
      out.push({ exp, dte, T, tgt, k: c.k, mid: c.cm, bid: c.cb, ask: c.ca, delta: c.cd, iv: c.civ, sig, cost: c.cm / spot, be, move, bp: move * 100 * BP_PER_PCT,
        gamma: c.g, gpd: c.g / c.cm, thetaPct: isNum(c.ct) ? c.ct / c.cm * 100 : null, spread: isNum(c.ca) && isNum(c.cb) ? (c.ca - c.cb) / c.cm * 100 : null,
        oi: c.coi, vol: c.cvol, pAbove: pAbove(spot, be, T, sig), pTouch: pTouch(spot, c.k, T, sig), half: halfLife(spot, c.k, T, sig, c.cm),
        wing: wings[exp] ? wings[exp].diff : null });
    }
  }
  out.slice().sort((a, b) => b.gpd - a.gpd).forEach((l, i) => { l.rank = i + 1; });
  for (const l of out) { l.wide = isNum(l.spread) && l.spread > 10; l.thin = !(l.oi >= 1000); }
  return out;
}
const wingWord = diff => !isNum(diff) ? '–' : diff > 0.3 ? 'calls' : diff < -0.3 ? 'puts' : 'even';
function renderShop(d) {
  const plot = $('#card-wings .plot'), desc = $('#wings-desc'); cardTools('card-wings', false);
  const lines = shopLines(d);
  if (!lines.length) { desc.textContent = ''; readout('wings', ''); return emptyState(plot, 'No chain loaded.'); }
  const best = lines.find(l => l.rank === 1), sel = lines.filter(l => l.exp === state.expiry);
  const selBest = sel.length ? sel.reduce((b, l) => l.gpd > b.gpd ? l : b, sel[0]) : null;
  const nk = v => fmt.num(v, v % 1 ? 2 : 0);
  readout('wings', selBest ? `${fmt.dateShort(selBest.exp)} · best Γ/$ ${selBest.tgt}Δ ${nk(selBest.k)}C · ${fmt.num(selBest.gpd, 2)}/$ · θ ${fmt.num(selBest.thetaPct, 1)}%/d · P(touch) ${fmt.pct(selBest.pTouch * 100, 0)}` : '');
  desc.textContent = `25Δ, 15Δ and 10Δ calls for each TLT expiry to 6 months · spot $${fmt.num(d.spot, 2)} · 1% of TLT ≈ ${fmt.num(BP_PER_PCT, 2)} bp (duration ${DUR_TLT}) · ranked by gamma per dollar of premium; ` +
    `the rank-1 line is ${best.tgt}Δ ${nk(best.k)}C ${fmt.dateShort(best.exp)} (${fmt.num(best.gpd, 2)} Γ/$), which also decays ${fmt.num(-best.thetaPct, 1)}%/day · flags: spread > 10% of mid, OI < 1,000 · probabilities from the call's own IV, lognormal, zero drift · max loss = premium`;
  const th = (t, cls) => h('th', { class: cls || '' }, t);
  const head = h('tr', {}, th('Expiry', 'l'), th('DTE'), th('Δ'), th('Strike'), th('Mid'), th('IV'), th('% of spot'), th('Breakeven'), th('Move · bp'), th('Γ'), th('Γ per $'), th('Θ / day'), th('Half-life'), th('Spread'), th('OI'), th('P(> BE)'), th('P(touch)'), th('Cheaper wing'), th('Rank'));
  const body = h('tbody', {}, lines.map((l, i) => {
    const firstOfExp = i === 0 || lines[i - 1].exp !== l.exp;
    return h('tr', { class: 'row-click' + (l.exp === state.expiry ? ' sel' : '') + (firstOfExp ? ' grp-start' : '') + (l.rank <= 3 ? ' rk3' : ''), onclick: () => setExpiry(l.exp) },
      h('td', { class: 'l' }, firstOfExp ? h('span', { class: 'tick' }, fmt.date(l.exp)) : ''), h('td', {}, firstOfExp ? String(l.dte) : ''),
      h('td', {}, h('span', { class: 'dl' }, l.tgt + 'Δ'), h('span', { class: 'cat' }, ' ' + fmt.num(l.delta * 100, 0))),
      h('td', {}, nk(l.k)), h('td', {}, fmt.num(l.mid, 3)), h('td', {}, fmt.pct(l.iv, 1)), h('td', {}, fmt.pct(l.cost * 100, 2)),
      h('td', {}, fmt.num(l.be, 2)), h('td', {}, fmt.spct(l.move * 100, 1), h('span', { class: 'cat' }, ' · ' + fmt.num(l.bp, 0) + ' bp')),
      h('td', {}, fmt.num(l.gamma, 3)), h('td', { class: l.rank === 1 ? 'lead' : '' }, fmt.num(l.gpd, 2)),
      h('td', { class: l.thetaPct < -3 ? 'neg' : '' }, fmt.pct(l.thetaPct, 1)), h('td', {}, isNum(l.half) ? fmt.num(l.half, 0) + 'd' : '–'),
      h('td', { class: l.wide ? 'neg' : '' }, fmt.pct(l.spread, 1), l.wide ? h('span', { class: 'flag' }, 'wide') : null),
      h('td', { class: l.thin ? 'neg' : '' }, fmt.big(l.oi), l.thin ? h('span', { class: 'flag' }, 'thin') : null),
      h('td', {}, fmt.pct(l.pAbove * 100, 0)), h('td', {}, fmt.pct(l.pTouch * 100, 0)),
      h('td', {}, firstOfExp ? [h('span', { class: 'verdict' }, wingWord(l.wing)), ' ', h('span', { class: 'cat' }, isNum(l.wing) ? fmt.snum(-l.wing, 1) + ' pts' : '')] : ''),
      h('td', { class: l.rank === 1 ? 'lead' : '' }, String(l.rank)));
  }));
  plot.replaceChildren(h('div', { class: 'tbl-wrap tall' }, h('table', { class: 'tbl wings-tbl shop-tbl' }, h('thead', {}, head), body)));
}

/* ---------------- thesis grid: scenario P&L multiples for the selected expiry ---------------- */
function renderThesis(d) {
  const plot = $('#card-thesis .plot'), desc = $('#thesis-desc'); cardTools('card-thesis', false);
  const lines = shopLines(d).filter(l => l.exp === state.expiry);
  if (!lines.length) { desc.textContent = ''; readout('thesis', ''); return emptyState(plot, 'Select an expiry with OTM calls.'); }
  const spot = d.spot, dte = lines[0].dte, nk = v => fmt.num(v, v % 1 ? 2 : 0);
  const cases = [{ key: 'flat', label: 'IV flat' }, { key: 'down', label: `IV ${IV_SHIFT} pts` }];
  const val = (l, move, days, shift) => {
    const expired = days >= dte;
    const S = spot * (1 + move / 100 * (expired ? dte / days : 1));            // straight-line path if the expiry comes first
    const T = expired ? 0 : (dte - days) / 365, sig = Math.max(0.01, l.sig + shift / 100);
    return { mult: bsCall(S, l.k, T, sig) / l.mid, expired };
  };
  const scen = [];
  for (const mv of SCEN_MOVES) for (const dy of SCEN_DAYS) scen.push({ mv, dy });
  const headline = scen.find(s => s.mv === 16 && s.dy === 60);
  const bestOf = (s, shift) => lines.reduce((b, l) => { const v = val(l, s.mv, s.dy, shift); return !b || v.mult > b.v.mult ? { l, v } : b; }, null);
  const hb = bestOf(headline, 0), hb2 = bestOf(headline, IV_SHIFT);
  readout('thesis', `+16% in 60d · best ${hb.l.tgt}Δ ${nk(hb.l.k)}C ×${fmt.num(hb.v.mult, 1)} IV flat · ${hb2.l.tgt}Δ ${nk(hb2.l.k)}C ×${fmt.num(hb2.v.mult, 1)} IV ${IV_SHIFT}`);
  desc.textContent = `${fmt.date(state.expiry)} · ${dte}d · value ÷ premium paid when TLT reaches +5/+10/+16% (≈ ${SCEN_MOVES.map(m => fmt.num(m * BP_PER_PCT, 0)).join('/')} bp) after 20–90 days, with IV unchanged or ${IV_SHIFT} pts · Black-Scholes, zero drift, vol re-implied from each mid · a cell marked exp. means the call expired before the move completed (intrinsic on a straight-line path) · max loss is the premium (×0)`;
  const head1 = h('tr', {}, h('th', { class: 'l', rowspan: 2 }, 'Scenario'), ...lines.map(l => h('th', { class: 'grp', colspan: 2 }, `${l.tgt}Δ · ${nk(l.k)}C · mid ${fmt.num(l.mid, 2)} · half-life ${isNum(l.half) ? fmt.num(l.half, 0) + 'd' : '–'}`)));
  const head2 = h('tr', {}, ...lines.flatMap(() => cases.map(c => h('th', {}, c.label))));
  const rows = scen.map(s => {
    const cells = cases.map(c => ({ c, best: bestOf(s, c.key === 'flat' ? 0 : IV_SHIFT) }));
    return h('tr', { class: s === headline ? 'headline' : '' },
      h('td', { class: 'l' }, h('span', { class: 'tick' }, `+${s.mv}%`), h('span', { class: 'cat' }, ` ≈ ${fmt.num(s.mv * BP_PER_PCT, 0)} bp · ${s.dy}d`)),
      ...lines.flatMap(l => cells.map(({ c, best }) => { const v = val(l, s.mv, s.dy, c.key === 'flat' ? 0 : IV_SHIFT);
        return h('td', { class: (best.l === l ? 'best' : '') + (v.mult < 1 ? ' neg' : '') + (v.expired ? ' expd' : '') }, '×' + fmt.num(v.mult, 1), v.expired ? h('span', { class: 'cat' }, ' exp.') : null); })));
  });
  plot.replaceChildren(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl thesis-tbl' }, h('thead', {}, head1, head2), h('tbody', {}, rows))));
}

/* ---------------- rent gauge: what vol costs right now, in words ---------------- */
function atmByExpiry(d) { return (d && d.surface || []).filter(r => r.dte >= 2 && isNum(r.vol50)).sort((a, b) => a.dte - b.dte); }
function renderRent(d) {
  const box = $('#rent'), u = currentU(); if (!u) { box.replaceChildren(); return; }
  const ideas = (state.latest.ideas && state.latest.ideas.rows) || [], idea = n => ideas.find(r => r.idea === n);
  const sc = idea('Short Calendar'), sv = idea('Sell Vol');
  const atm = atmByExpiry(d).filter(r => r.dte <= MAX_DTE_SHOP);
  const near = t => nearestBy(atm, 'dte', t);
  const front = near(30), back = near(90), far = near(180);
  const shelves = atm.filter(r => r.dte >= 14);
  const cheap = shelves.length ? shelves.reduce((b, r) => r.vol50 < b.vol50 ? r : b, shelves[0]) : null, rich = shelves.length ? shelves.reduce((b, r) => r.vol50 > b.vol50 ? r : b, shelves[0]) : null;
  const frontMed = atm.filter(r => r.dte >= 7 && r.dte <= 35).map(r => r.vol50), backMed = atm.filter(r => r.dte >= 60 && r.dte <= 130).map(r => r.vol50);
  const med = a => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;
  const fm = med(frontMed), bm = med(backMed), backNames = atm.filter(r => r.dte >= 60 && r.dte <= 130).map(r => fmt.dateShort(r.expiry_date)).slice(0, 3).join(', ');
  let shelf = '';
  if (isNum(fm) && isNum(bm)) shelf = fm - bm > 0.3 ? `front-month vol is the richest shelf (${fmt.num(fm, 1)} vs ${fmt.num(bm, 1)}); ${backNames} are cheaper per unit of time` : bm - fm > 0.3 ? `on this surface the back (${backNames}, ~${fmt.num(bm, 1)}) costs ${fmt.num(bm - fm, 1)} vol pts more than the front (~${fmt.num(fm, 1)}): the two months of time George needs are the expensive part of the ticket` : `the curve is flat to 6 months: time costs the same vol at every shelf, so pick the expiry by the thesis horizon`;
  const pct = u.iv_pct_1y, lvl = isNum(pct) ? (pct >= 80 ? 'rich against its own year' : pct <= 20 ? 'cheap against its own year' : 'mid-range for its year') : '';
  const vrpWord = isNum(u.vrp) ? (u.vrp > 10 ? 'implied runs well above realized: buyers pay a premium' : u.vrp < -5 ? 'implied is below realized: vol is on sale' : 'implied ≈ realized') : '';
  const chg = isNum(u.iv30_chg_1d) ? (u.iv30_chg_1w < -1 ? 'softening this week' : u.iv30_chg_1w > 1 ? 'firming this week' : 'steady this week') : '';
  const lead = `Buying TLT upside today means renting vol at the ${fmt.ord(pct)} percentile of its year with a ${fmt.snum(u.vrp, 0)} premium over realized` + (sc && isNum(sc.rank) ? `; Moontower ranks TLT ${fmt.ord(sc.rank)} of ${sc.of} on its Short Calendar term-structure screen` : '') + (shelf ? `; ${shelf}.` : '.');
  const cell = (label, value, words) => h('div', { class: 'rent-cell' }, h('div', { class: 'label' }, label), h('div', { class: 'val' }, value), h('div', { class: 'words' }, words));
  box.replaceChildren(
    h('p', { class: 'rent-lead' }, h('span', { class: 'label' }, 'Rent gauge'), lead),
    h('div', { class: 'rent-row' },
      cell('IV percentile · 1y', fmt.ord(pct), lvl),
      cell('Vol risk premium', fmt.snum(u.vrp, 0), vrpWord),
      cell('IV30 change', `${fmt.snum(u.iv30_chg_1d, 2)} d · ${fmt.snum(u.iv30_chg_1w, 2)} w`, chg),
      cell('Short Calendar rank', sc && isNum(sc.rank) ? `${sc.rank} of ${sc.of}` : '–', sc ? `term-structure screen (ratio ${fmt.num(sc.termStructureRatio, 3)}, ${fmt.ord(sc.steepnessPercentile)} pct steepness) across ${state.latest.ideas.universe_size || ''} names` : 'no ideas row'),
      cell('Sell Vol rank', sv && isNum(sv.rank) ? `${sv.rank} of ${sv.of}` : '–', sv ? 'how loudly the screen says "sell this vol"' : ''),
      cell('ATM IV by shelf', front && back ? `${fmt.num(front.vol50, 1)} · ${fmt.num(back.vol50, 1)} · ${far ? fmt.num(far.vol50, 1) : '–'}` : '–', front && back ? `${front.dte}d · ${back.dte}d · ${far ? far.dte + 'd' : ''} ; cheapest ${cheap ? fmt.dateShort(cheap.expiry_date) + ' ' + fmt.num(cheap.vol50, 1) : '–'}, richest ${rich ? fmt.dateShort(rich.expiry_date) + ' ' + fmt.num(rich.vol50, 1) : '–'}` : 'no surface')));
}

/* ---------------- event strip + event premium from the surface ---------------- */
function eventPremia(d) {                            // forward variance between adjacent expiries vs a baseline → implied extra move in the gap
  const atm = atmByExpiry(d).filter(r => r.dte <= 130); const pairs = [];
  for (let i = 0; i + 1 < atm.length; i++) {
    const a = atm[i], b = atm[i + 1], gap = b.dte - a.dte; if (gap < 1) continue;
    const va = (a.vol50 / 100) ** 2 * a.dte / 365, vb = (b.vol50 / 100) ** 2 * b.dte / 365;
    pairs.push({ a, b, gap, fwdVarDay: (vb - va) / gap, fwdVol: Math.sqrt(Math.max(0, vb - va) / gap * 365) * 100 });
  }
  const base = pairs.filter(p => p.gap >= 5).map(p => p.fwdVarDay).sort((x, y) => x - y); const baseVar = base.length ? base[Math.floor(base.length / 2)] : 0;
  for (const p of pairs) p.extraMove = Math.sqrt(Math.max(0, p.fwdVarDay - baseVar) * p.gap) * 100;
  return { pairs, baseVol: Math.sqrt(Math.max(0, baseVar) * 365) * 100 };
}
function renderEvents(d) {
  const box = $('#events'); const asOf = state.latest.as_of; if (!asOf) { box.replaceChildren(); return; }
  const t0 = new Date(asOf + 'T00:00:00'), days = s => Math.round((new Date(s + 'T00:00:00') - t0) / 864e5);
  const { pairs, baseVol } = eventPremia(d);
  const ev = EVENTS.filter(e => days(e.end || e.d) >= 0 && days(e.d) <= 120);
  const chips = ev.map(e => {
    const dd = days(e.d), pair = pairs.find(p => p.a.dte < dd && dd <= p.b.dte);
    const prem = pair ? `${fmt.dateShort(pair.a.expiry_date)}→${fmt.dateShort(pair.b.expiry_date)} fwd vol ${fmt.num(pair.fwdVol, 1)}` + (pair.extraMove > 0.05 ? ` · +${fmt.num(pair.extraMove, 2)}% extra move priced` : ' · no premium over base') : 'beyond the listed expiries';
    return h('span', { class: 'ev ' + e.kind + (e.v ? '' : ' unv'), title: (e.v ? 'Verified: ' : 'Unverified: ') + e.note + ' · ' + prem },
      h('b', {}, e.label), h('span', { class: 'when' }, fmt.dateShort(e.d) + (e.end ? '–' + new Date(e.end + 'T00:00:00').getDate() : '') + ' · ' + (dd <= 0 ? 'now' : dd + 'd')),
      e.v ? null : h('i', { class: 'unvtag' }, 'approx.'),
      pair && pair.extraMove > 0.05 ? h('span', { class: 'prem' }, '+' + fmt.num(pair.extraMove, 2) + '%') : null);
  });
  box.replaceChildren(h('span', { class: 'label' }, 'Events'), ...chips,
    h('span', { class: 'ev-note' }, pairs.length ? `event premium = extra move implied by ATM-IV jumps between adjacent expiries over a ${fmt.num(baseVol, 1)} base vol · hover for the gap` : ''));
}

/* ---------------- EDV translator (arithmetic only: Moontower has no EDV data) ---------------- */
function renderEdv(d) {
  const plot = $('#card-edv .plot'); cardTools('card-edv', false);
  const DUR_EDV = 24, DUR_BOND = 22, CONV_BOND = 600, RATIO = DUR_EDV / DUR_TLT;
  const lines = shopLines(d).filter(l => l.exp === state.expiry);
  const spot = d && d.spot;
  const callAt = (l, mv, dy, shift) => { const expired = dy >= l.dte, S = spot * (1 + mv / 100 * (expired ? l.dte / dy : 1)); return bsCall(S, l.k, expired ? 0 : (l.dte - dy) / 365, Math.max(0.01, l.sig + shift / 100)) / l.mid; };
  const pick = lines.length ? lines.reduce((b, l) => callAt(l, 16, 60, 0) > callAt(b, 16, 60, 0) ? l : b, lines[0]) : null;
  const nk = v => fmt.num(v, v % 1 ? 2 : 0);
  const bondUp = DUR_BOND * 1 + 0.5 * CONV_BOND * 0.01 ** 2 * 100, bondDn = -DUR_BOND * 1 + 0.5 * CONV_BOND * 0.01 ** 2 * 100;
  const rows = [
    pick && { what: `TLT ${pick.tgt}Δ ${nk(pick.k)}C ${fmt.dateShort(pick.exp)}`, up: `×${fmt.num(callAt(pick, 16, 60, 0), 1)} (IV flat) · ×${fmt.num(callAt(pick, 16, 60, IV_SHIFT), 1)} (IV ${IV_SHIFT})`, dn: '−100% (premium)', theta: `${fmt.num(-pick.thetaPct, 1)}%/day`, iv: `yes · ${fmt.num(pick.iv, 1)} vol`, conv: `${fmt.num(pick.gpd, 2)} Γ per $` },
    { what: 'TLT shares', up: '+16%', dn: '−16%', theta: 'none (earns the distribution)', iv: 'no', conv: 'none (linear)' },
    { what: 'EDV shares', up: `+${fmt.num(DUR_EDV, 0)}%`, dn: `−${fmt.num(DUR_EDV, 0)}%`, theta: 'none (earns the distribution)', iv: 'no', conv: 'small positive (STRIPS)' },
    { what: 'Low-coupon 2050 Treasury', up: `+${fmt.num(bondUp, 0)}% (${DUR_BOND} dur + convexity)`, dn: `−${fmt.num(-bondDn, 0)}%`, theta: 'none (earns the coupon)', iv: 'no', conv: `≈ +${fmt.num(0.5 * CONV_BOND * 0.01 ** 2 * 100, 0)}% per 100 bp either way` },
  ].filter(Boolean);
  const tbl = tableEl([{ label: 'Instrument', key: 'what', left: true }, { label: '−100 bp rally (≈ 60d)', key: 'up' }, { label: '+100 bp sell-off', key: 'dn' }, { label: 'Theta', key: 'theta' }, { label: 'IV cost', key: 'iv' }, { label: 'Convexity', key: 'conv' }], rows);
  plot.replaceChildren(
    h('p', { class: 'edv-note' }, h('b', {}, 'Moontower has no EDV, ZROZ or TMF data.'), ' This card is arithmetic on stated assumptions, not market data.'),
    h('div', { class: 'edv-grid' },
      h('div', { class: 'edv-cell' }, h('div', { class: 'label' }, 'Duration ratio'), h('div', { class: 'val' }, `EDV ÷ TLT ≈ ${fmt.num(RATIO, 1)}`), h('div', { class: 'words' }, `assumes TLT ≈ ${DUR_TLT} and EDV ≈ ${DUR_EDV} years of modified duration`)),
      h('div', { class: 'edv-cell' }, h('div', { class: 'label' }, 'Translation'), h('div', { class: 'val' }, `$N of EDV ≈ $${fmt.num(RATIO, 1)}N of TLT`), h('div', { class: 'words' }, 'same rate exposure in dollars; a 100 bp rally ≈ TLT +16%, EDV +24%')),
      h('div', { class: 'edv-cell' }, h('div', { class: 'label' }, 'In TLT-call terms'), h('div', { class: 'val' }, pick ? `+${fmt.num(16 * RATIO, 0)}% EDV ≡ +16% TLT` : '–'), h('div', { class: 'words' }, 'the thesis grid above is already in the EDV-equivalent move; the call just prices the TLT leg of it'))),
    tbl,
    h('p', { class: 'edv-note' }, `Assumptions, all stated: 1% of TLT ≈ ${fmt.num(BP_PER_PCT, 2)} bp; EDV duration ${DUR_EDV}; a 1⅜%-coupon Aug-2050 Treasury has modified duration ≈ ${DUR_BOND} and convexity ≈ ${CONV_BOND}; rally reached in about 60 days; the call row uses the ${pick ? pick.tgt + 'Δ' : ''} line of the selected expiry that does best on +16% in 60d. Shares and bonds have no expiry, no theta and no vol to overpay for; the call is the only one that can go to zero, and the only one that can multiply.`));
}

/* ---------------- trade ideas (TLT only, cross-sectional rank) ---------------- */
function renderIdeas() {
  const plot = $('#card-ideas .plot'), desc = $('#ideas-desc'); cardTools('card-ideas', false);
  const I = state.latest.ideas; if (!I || !I.rows || !I.rows.length) { desc.textContent = ''; return emptyState(plot, 'No trade ideas in this snapshot.'); }
  const rows = I.rows.slice().sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
  readout('ideas', rows[0] && isNum(rows[0].rank) ? `${rows[0].idea} · rank ${rows[0].rank} of ${rows[0].of} · ${fmt.snum(rows[0].totalScore, 0)}` : '');
  desc.textContent = `Moontower's preset screens score ${I.universe_size || ''} names each trading day; this is where TLT ranks on each · trade date ${fmt.date(I.trade_date)}` + (I.note ? ` · ${I.note}` : '');
  const part = (label, v, pct) => h('div', { class: 'part' }, h('span', {}, label), h('span', { class: 'divbar' }, h('span', { class: v >= 0 ? 'p' : 'n', style: `width:${Math.min(50, Math.abs(v || 0) / 100 * 50)}%` })), h('span', { class: 'num' }, fmt.num(v, 0)));
  plot.replaceChildren(h('div', { class: 'ideas-list' }, rows.map((r, i) => h('div', { class: 'idea' + (i === 0 && r.totalScore > 0 ? ' lead' : '') },
    h('div', { class: 'name' }, r.idea, h('small', {}, isNum(r.rank) ? `rank ${r.rank} of ${r.of}` : '', r.top && r.top.length ? ` · leaders ${r.top.join(', ')}` : '')),
    h('div', { class: 'parts' }, part('IV level', r.ivScore), part('Vol premium', r.vrpScore), part('Realized', r.rvScore), part('Term slope', r.steepnessScore)),
    h('div', { class: 'score' }, h('b', {}, fmt.snum(r.totalScore, 0)), h('span', {}, 'total score'))))));
}

/* ---------------- orchestration ---------------- */
const currentU = () => state.latest && state.latest.universe.find(u => u.ticker === state.ticker);
function noDetail(plot) { emptyState(plot, state.key ? 'Could not load TLT live. Check the key and credits.' : 'The TLT chain has not been fetched yet. Wait for the next refresh, or add your Moontower key.', 'Detail not loaded.'); }
function setNote(txt) { $('#refresh-note').textContent = txt; }
function populateExpiries(d) {
  const sel = $('#expiry-select'); sel.replaceChildren();
  if (!d) { sel.appendChild(h('option', {}, '—')); sel.disabled = true; return; }
  sel.disabled = false;
  const exps = d.surface.filter(r => r.dte > 0).sort((a, b) => a.dte - b.dte);
  if (!exps.some(e => e.expiry_date === state.expiry)) { const near = nearestBy(exps, 'dte', 75); state.expiry = near ? near.expiry_date : (exps[0] && exps[0].expiry_date); }   // ~2-month thesis horizon
  for (const e of exps) sel.appendChild(h('option', { value: e.expiry_date, selected: e.expiry_date === state.expiry ? '' : null }, `${fmt.date(e.expiry_date)} · ${e.dte}d`));
}
function setExpiry(e) {
  state.expiry = e; $('#expiry-select').value = e; pushUrl();
  const d = state.detail[state.ticker] || null;
  renderSurface(d ? { ...d, surface: d.surface.filter(r => r.dte <= 185) } : d); renderShop(d); renderThesis(d); renderEdv(d);
}
async function loadDetail() {
  document.querySelectorAll('#card-surface .plot, #card-cone .plot, #card-wings .plot, #card-thesis .plot, #card-edv .plot').forEach(p => p.classList.add('stale'));
  const d = await getDetail(state.ticker);
  document.querySelectorAll('.plot.stale').forEach(p => p.classList.remove('stale'));
  populateExpiries(d); renderDetail(d);
}
function renderDetail(d) {
  renderSurface(d ? { ...d, surface: d.surface.filter(r => r.dte <= 185) } : d); renderCone(d); renderShop(d); renderThesis(d); renderRent(d); renderEvents(d); renderEdv(d);
}
function renderAll() { if (!state.latest) return; renderKpis(); renderHistory(); renderIdeas(); renderDetail(state.detail[state.ticker] || null); renderStatus(); }
function renderStatus() {
  const L = state.latest, u = currentU();
  const snap = (u && u.snapshot_at) || '';
  let et = '';
  if (snap) { const dt = new Date(snap.replace(' ', 'T') + (snap.endsWith('Z') ? '' : 'Z')); et = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'; }
  $('#asof-text').replaceChildren('As of ', h('strong', {}, fmt.date(L.as_of)), et ? ` · ${et} snapshot` : '', L.generated_at ? ` · refreshed ${fmt.ago(L.generated_at)}` : '');
  const fresh = L.generated_at && (Date.now() - new Date(L.generated_at)) < 26 * 3600 * 1000;
  $('#live-dot').className = 'dot' + (fresh ? ' fresh' : '');
  $('#mode-chip').textContent = state.liveBoard ? 'Live · your key' : state.key ? 'Snapshot · key saved' : 'Snapshot · auto-refreshed';
  $('#key-btn').classList.toggle('active', !!state.key);
  $('#foot-meta').textContent = `snapshot generated ${L.generated_at ? new Date(L.generated_at).toLocaleString() : '–'} · ${L.api_calls || 0} API calls per refresh`;
}
function pushUrl() { const q = new URLSearchParams(); if (state.expiry) q.set('e', state.expiry); if (state.range !== '1Y') q.set('r', state.range); history.replaceState(null, '', q.toString() ? '?' + q : location.pathname); }

async function loadData(first) {
  const [latest, hist, analog] = await Promise.all([getJSON('data/latest.json'), getJSON('data/history.json'), getJSON('data/analog_2023.json').catch(e => { console.warn('no analog file', e.message); return null; })]);
  state.latest = latest; state.history = hist; state.analog = analog; state.lastGenerated = latest.generated_at; state.detail = {};
  state.ticker = latest.universe.some(u => u.ticker === 'TLT') ? 'TLT' : latest.universe[0].ticker;
  if (first) {
    const q = new URLSearchParams(location.search);
    if (q.get('e')) state.expiry = q.get('e');
    if (RANGE_DAYS[q.get('r')]) { state.range = q.get('r'); document.querySelectorAll('#range-seg button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.range === state.range))); }
  }
}
async function poll() {
  try {
    const r = await fetch('data/latest.json?v=' + Date.now(), { cache: 'no-store' }); const j = await r.json();
    if (j.generated_at !== state.lastGenerated && !state.liveBoard) {
      document.querySelectorAll('.plot').forEach(p => p.classList.add('stale'));
      await loadData(false); renderAll(); await loadDetail();
      document.querySelectorAll('.plot').forEach(p => p.classList.remove('stale'));
    }
  } catch (e) { console.warn('poll failed', e); }
  state.nextPoll = Date.now() + POLL_MS;
}
function tickNote() {
  if (state.liveBoard) { setNote('Pulled live with your key'); return; }
  const s = Math.max(0, Math.round((state.nextPoll - Date.now()) / 1000));
  setNote(`Checks for a new snapshot in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
}
function bindUI() {
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
    state.key = v; try { localStorage.setItem('mtw_key', v); } catch (err) {} $('#key-input').value = ''; $('#keybar').hidden = true; renderStatus();
  });
  $('#key-clear').addEventListener('click', () => { state.key = null; state.liveBoard = false; try { localStorage.removeItem('mtw_key'); } catch (e) {} $('#keybar').hidden = true; renderStatus(); });
  $('#key-refresh').addEventListener('click', async () => {
    if (!state.key) { setNote('Save a key first'); return; }
    document.querySelectorAll('.plot').forEach(p => p.classList.add('stale')); setNote('Pulling TLT live…');
    try { await liveBoard(); state.detail = {}; state.detail[state.ticker] = await liveDetail(state.ticker); renderAll(); populateExpiries(state.detail[state.ticker]); renderDetail(state.detail[state.ticker]); }
    catch (e) { setNote('Live pull failed: ' + e.message); }
    document.querySelectorAll('.plot').forEach(p => p.classList.remove('stale'));
  });
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderAll, 120); });
}
async function boot() {
  try { const t = localStorage.getItem('theme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch (e) {}
  try { state.key = localStorage.getItem('mtw_key') || null; } catch (e) {}
  bindUI();
  try { await loadData(true); } catch (e) { $('#asof-text').textContent = 'Could not load data'; $('#kpis').replaceChildren(h('div', { class: 'empty' }, 'data/latest.json is missing. Run scripts/fetch_data.py or wait for the refresh action.')); return; }
  renderAll(); await loadDetail();
  state.nextPoll = Date.now() + POLL_MS; setInterval(poll, POLL_MS); setInterval(tickNote, 1000); tickNote();
  setInterval(renderStatus, 60000);
}
boot();
})();
