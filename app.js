/* Vol Desk — Moontower front end. Vanilla JS, hand-rolled SVG. No key ships with this file. */
(() => {
'use strict';

const API = 'https://api.moontower.ai';
const POLL_MS = 5 * 60 * 1000;
const DELTAS = [90, 80, 70, 60, 50, 40, 30, 20, 10];            // vol90 … vol10 = call delta, low strike → high strike
const RANGE_DAYS = { '1M': 31, '3M': 92, '6M': 183, '1Y': 10000 };
const SHOP_DELTAS = [25, 15, 10];                                 // the OTM call shelf: 25Δ, 15Δ, 10Δ
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
  latest: null, history: null, analog: null, detail: {}, ticker: null, expiry: null, range: '1Y', delta: 15, ivCase: 'flat', target: { price: null, days: 60 },
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
/* ---------------- tiles + the cost of vol in one sentence ---------------- */
function renderKpis() {
  const u = currentU(); const box = $('#kpis'); if (!u) { box.replaceChildren(); return; }
  const hist = (state.history[u.ticker] || []).slice(-22);
  const dir = v => !isNum(v) ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '';
  const vrpWord = isNum(u.vrp) ? (u.vrp > 10 ? 'implied well above realized · buyers pay up' : u.vrp > 3 ? 'implied above realized' : u.vrp < -3 ? 'implied below realized · vol on sale' : 'implied ≈ realized') : '';
  const skewWord = isNum(u.rr25) ? (u.rr25 > 0.02 ? 'puts richer than calls · upside is the cheap wing' : u.rr25 < -0.02 ? 'calls richer than puts' : 'wings about even') : '';
  box.replaceChildren(
    tile('Spot · ' + u.ticker, isNum(u.close) ? '$' + fmt.num(u.close, 2) : '–', isNum(u.ret_1d) ? fmt.spct(u.ret_1d * 100, 2) + ' today · ' + fmt.spct((u.ret_1w || 0) * 100, 1) + ' 1w' : '', { dir: dir(u.ret_1d), spark: sparkSvg(hist.map(r => r.c)) }),
    tile('Implied vol, 30-day', fmt.pct(u.iv30), `${fmt.ord(u.iv_pct_1y)} percentile of its year · ${fmt.snum(u.iv30_chg_1d, 2)} today · ${fmt.snum(u.iv30_chg_1w, 2)} 1w`, { hero: true, meter: u.iv_pct_1y, spark: sparkSvg(hist.map(r => r.iv30), 240, 34) }),
    tile('Vol risk premium', fmt.snum(u.vrp, 1), `${vrpWord} · RV30 ${fmt.pct(u.rv30)}`),
    tile('25Δ risk reversal', fmt.snum(u.rr25, 3), `${skewWord} · ${fmt.ord(u.rr25_pct)} pct 1y`),
  );
}
function renderRent(d) {
  const box = $('#rent'), u = currentU(); if (!u) { box.replaceChildren(); return; }
  const ideas = (state.latest.ideas && state.latest.ideas.rows) || [], sc = ideas.find(r => r.idea === 'Short Calendar');
  const atm = atmByExpiry(d).filter(r => r.dte <= MAX_DTE_SHOP);
  const med = a => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;
  const fm = med(atm.filter(r => r.dte >= 7 && r.dte <= 35).map(r => r.vol50)), bm = med(atm.filter(r => r.dte >= 60 && r.dte <= 130).map(r => r.vol50));
  let shelf = '';
  if (isNum(fm) && isNum(bm)) shelf = fm - bm > 0.3 ? `front-month vol (~${fmt.num(fm, 1)}) is the richest shelf; two to four months out (~${fmt.num(bm, 1)}) is cheaper per unit of time` : bm - fm > 0.3 ? `two to four months out (~${fmt.num(bm, 1)}) costs ${fmt.num(bm - fm, 1)} vol pts more than the front (~${fmt.num(fm, 1)}): the time a rally thesis needs is the expensive part of the ticket` : `the curve is flat to six months, so pick the expiry by the horizon, not the price of vol`;
  const lead = `Buying TLT upside today means renting vol at the ${fmt.ord(u.iv_pct_1y)} percentile of its year, ${fmt.snum(u.vrp, 0)} over realized` + (sc && isNum(sc.rank) ? `; Moontower ranks TLT ${fmt.ord(sc.rank)} of ${sc.of} on its sell-front-vol (Short Calendar) screen` : '') + (shelf ? `; ${shelf}.` : '.');
  box.replaceChildren(h('p', { class: 'rent-lead' }, h('span', { class: 'label' }, 'Cost of vol'), lead));
}

/* ---------------- a call's value at a future price after N days (straight-line path if the expiry comes first) ---------------- */
function valueAtPrice(l, spot, price, days, shift = 0) {
  const expired = days >= l.dte;
  const S = expired ? spot + (price - spot) * l.dte / days : price;
  const T = expired ? 0 : (l.dte - days) / 365, sig = Math.max(0.01, l.sig + shift / 100);
  const value = bsCall(S, l.k, T, sig);
  return { value, mult: value / l.mid, expired };
}
function targetInfo(d) {
  const t = state.target, u = currentU(); if (!d || !u || !isNum(t.price) || !(t.price > 0)) return null;
  const spot = d.spot, move = t.price / spot - 1, bp = move * 100 * BP_PER_PCT;
  const hist = (state.history[state.ticker] || []).slice().reverse();
  const seen = hist.find(r => isNum(r.c) && (move >= 0 ? r.c >= t.price : r.c <= t.price));
  const sel = atmByExpiry(d).find(r => r.expiry_date === state.expiry), T = sel ? sel.dte / 365 : null, sig = sel ? sel.vol50 / 100 : null;
  const pEnd = T && sig ? (move >= 0 ? pAbove(spot, t.price, T, sig) : 1 - pAbove(spot, t.price, T, sig)) : null;
  const pT = T && sig && move > 0 ? pTouch(spot, t.price, T, sig) : null;
  return { price: t.price, days: t.days, move, bp, seen, sel, pEnd, pTouch: pT };
}
const sameLine = (a, b) => a && b && a.exp === b.exp && a.tgt === b.tgt && a.k === b.k;
function bestAtTarget(d, ti) {                     // highest value ÷ premium at the target, liquid lines first; max loss is the premium for every line
  if (!ti) return null;
  const all = shopLines(d), liquid = all.filter(l => !l.wide && !l.thin), alive = liquid.filter(l => l.dte >= ti.days);   // outlive the horizon, trade cleanly
  const pool = alive.length ? alive : liquid.length ? liquid : all;
  let best = null;
  for (const l of pool) { const v = valueAtPrice(l, d.spot, ti.price, ti.days); if (!best || v.mult > best.v.mult) best = { l, v }; }
  return best;
}
function applyBest(d) {                              // point the page at the best line for the target
  const b = bestAtTarget(d, targetInfo(d)); if (!b) return;
  state.delta = b.l.tgt; state.expiry = b.l.exp; const sel = $('#expiry-select'); if (sel) sel.value = b.l.exp;
}
function renderTargetNote(d) {
  const box = $('#target-note'), ti = targetInfo(d);
  if (!ti) { box.hidden = true; box.replaceChildren(); return; }
  const dir = ti.move >= 0 ? 'rally' : 'sell-off';
  box.hidden = false;
  box.replaceChildren(h('span', { class: 'label' }, 'Target'),
    h('b', {}, '$' + fmt.num(ti.price, 2)), ` in ${ti.days} days = ${fmt.spct(ti.move * 100, 1)} ≈ ${fmt.num(Math.abs(ti.bp), 0)} bp ${dir} (duration ${DUR_TLT})`,
    ti.seen ? ` · TLT last traded there ${fmt.date(ti.seen.d)} ($${fmt.num(ti.seen.c, 2)})` : ' · not seen in the past year',
    ti.sel ? ` · by ${fmt.dateShort(ti.sel.expiry_date)} expiry at today's ATM vol: P(${ti.move >= 0 ? '≥' : '≤'} target at expiry) ${fmt.pct((ti.pEnd || 0) * 100, 0)}` + (isNum(ti.pTouch) ? `, P(touch) ${fmt.pct(ti.pTouch * 100, 0)}` : '') : '',
    ...(() => { const b = bestAtTarget(d, ti); const nk = v => fmt.num(v, v % 1 ? 2 : 0); return b ? [' · best R/R: ', h('b', {}, `${b.l.tgt}Δ ${nk(b.l.k)}C ${fmt.dateShort(b.l.exp)}`), ` ×${fmt.num(b.v.mult, 1)} for ${fmt.num(b.l.mid, 2)}${b.v.expired ? ' (expires first)' : ''}`, h('span', { class: 'cat' }, ' · liquid lines that outlive the horizon, max loss = premium')] : []; })());
}

/* ---------------- Fig 1: the convexity shop, one line per expiry at the chosen delta ---------------- */
function deltaTools(cardId) {
  const tools = $('#' + cardId + ' .card-tools'); tools.replaceChildren();
  for (const dl of SHOP_DELTAS) tools.appendChild(h('button', { type: 'button', 'aria-pressed': String(state.delta === dl), onclick: () => setDelta(dl) }, dl + 'Δ'));
}
function renderShop(d) {
  const plot = $('#card-wings .plot'), desc = $('#wings-desc'); deltaTools('card-wings');
  const lines = shopLines(d).filter(l => l.tgt === state.delta);
  if (!lines.length) { desc.textContent = ''; readout('wings', ''); return emptyState(plot, 'No chain loaded.'); }
  const best = lines.reduce((b, l) => l.gpd > b.gpd ? l : b, lines[0]), sel = lines.find(l => l.exp === state.expiry), ti = targetInfo(d), rr = bestAtTarget(d, ti);
  const nk = v => fmt.num(v, v % 1 ? 2 : 0);
  readout('wings', sel ? `${fmt.dateShort(sel.exp)} · ${nk(sel.k)}C ${fmt.num(sel.mid, 2)} · Γ/$ ${fmt.num(sel.gpd, 2)} · θ ${fmt.num(sel.thetaPct, 1)}%/d · P(> BE) ${fmt.pct(sel.pAbove * 100, 0)}` : '');
  desc.textContent = `The ${state.delta}Δ call in each expiry to six months · spot $${fmt.num(d.spot, 2)} · 1% of TLT ≈ ${fmt.num(BP_PER_PCT, 2)} bp (duration ${DUR_TLT}) · best gamma per dollar is ${fmt.dateShort(best.exp)} ${nk(best.k)}C, which also decays ${fmt.num(-best.thetaPct, 1)}% a day · half-life = days until the call is worth half its mid with spot unchanged · probabilities from the call's own IV · max loss = premium`;
  const th = (t, cls) => h('th', { class: cls || '' }, t);
  const head = h('tr', {}, th('Expiry', 'l'), th('DTE'), th('Strike'), th('Mid'), th('% of spot'), th('IV'), th('Move to BE'), th('Γ per $'), th('Θ / day'), th('Half-life'), th('P(> BE)'), th('P(touch)'), th('Spread'), th('OI'), ti ? th(`At $${fmt.num(ti.price, 0)} · ${ti.days}d`) : null);
  const body = h('tbody', {}, lines.map(l => h('tr', { class: 'row-click' + (l.exp === state.expiry ? ' sel' : '') + (rr && sameLine(rr.l, l) ? ' bestrr' : ''), onclick: () => setExpiry(l.exp) },
    h('td', { class: 'l' }, h('span', { class: 'tick' }, fmt.date(l.exp)), rr && sameLine(rr.l, l) ? h('span', { class: 'rr' }, 'best R/R') : null), h('td', {}, String(l.dte)),
    h('td', {}, nk(l.k)), h('td', {}, fmt.num(l.mid, 2)), h('td', {}, fmt.pct(l.cost * 100, 2)), h('td', {}, fmt.pct(l.iv, 1)),
    h('td', {}, fmt.spct(l.move * 100, 1), h('span', { class: 'cat' }, ' · ' + fmt.num(l.bp, 0) + ' bp')),
    h('td', { class: l === best ? 'lead' : '' }, fmt.num(l.gpd, 2)),
    h('td', { class: l.thetaPct < -3 ? 'neg' : '' }, fmt.pct(l.thetaPct, 1)), h('td', {}, isNum(l.half) ? fmt.num(l.half, 0) + 'd' : '–'),
    h('td', {}, fmt.pct(l.pAbove * 100, 0)), h('td', {}, fmt.pct(l.pTouch * 100, 0)),
    h('td', { class: l.wide ? 'neg' : '' }, fmt.pct(l.spread, 1), l.wide ? h('span', { class: 'flag' }, 'wide') : null),
    h('td', { class: l.thin ? 'neg' : '' }, fmt.big(l.oi), l.thin ? h('span', { class: 'flag' }, 'thin') : null),
    ti ? (() => { const v = valueAtPrice(l, d.spot, ti.price, ti.days); return h('td', { class: 'tgt' + (v.mult < 1 ? ' neg' : '') }, fmt.num(v.value, 2) + ' · ×' + fmt.num(v.mult, 1), v.expired ? h('span', { class: 'cat' }, ' exp.') : null); })() : null)));
  plot.replaceChildren(h('div', { class: 'tbl-wrap tall' }, h('table', { class: 'tbl shop-tbl' }, h('thead', {}, head), body)));
}

/* ---------------- Fig 2: what the selected call pays if the rally arrives ---------------- */
function renderThesis(d) {
  const plot = $('#card-thesis .plot'), desc = $('#thesis-desc'), tools = $('#card-thesis .card-tools'); tools.replaceChildren();
  for (const c of [['flat', 'IV flat'], ['down', `IV ${IV_SHIFT}`]]) tools.appendChild(h('button', { type: 'button', 'aria-pressed': String(state.ivCase === c[0]), onclick: () => { state.ivCase = c[0]; renderThesis(state.detail[state.ticker] || null); } }, c[1]));
  const l = shopLines(d).find(x => x.exp === state.expiry && x.tgt === state.delta);
  if (!l) { desc.textContent = ''; readout('thesis', ''); return emptyState(plot, 'Select an expiry with OTM calls.'); }
  const spot = d.spot, dte = l.dte, nk = v => fmt.num(v, v % 1 ? 2 : 0), shift = state.ivCase === 'flat' ? 0 : IV_SHIFT;
  const val = (move, days) => valueAtPrice(l, spot, spot * (1 + move / 100), days, shift);
  const ti = targetInfo(d), hl = ti ? valueAtPrice(l, spot, ti.price, ti.days, shift) : val(16, 60);
  readout('thesis', `${nk(l.k)}C ${fmt.dateShort(l.exp)} · ${ti ? '$' + fmt.num(ti.price, 2) + ' in ' + ti.days + 'd' : '+16% in 60d'} → ×${fmt.num(hl.mult, 1)}${hl.expired ? ' (expired first)' : ''} · half-life ${isNum(l.half) ? fmt.num(l.half, 0) + 'd' : '–'}`);
  desc.textContent = `${nk(l.k)} call, ${fmt.date(l.exp)} (${dte}d), mid ${fmt.num(l.mid, 2)} · value ÷ premium when TLT reaches +5/+10/+16% (≈ ${SCEN_MOVES.map(m => fmt.num(m * BP_PER_PCT, 0)).join('/')} bp) after 20–90 days, IV ${shift ? shift + ' pts' : 'unchanged'} · Black-Scholes, zero drift, vol re-implied from the mid · exp. = the call expired before the move completed · max loss is the premium (×0)`;
  const head = h('tr', {}, h('th', { class: 'l' }, 'TLT move'), ...SCEN_DAYS.map(dy => h('th', {}, `in ${dy}d`)));
  const tRow = ti ? h('tr', { class: 'target' },
    h('td', { class: 'l' }, h('span', { class: 'tick' }, '$' + fmt.num(ti.price, 2)), h('span', { class: 'cat' }, ` ${fmt.spct(ti.move * 100, 1)} ≈ ${fmt.num(ti.bp, 0)} bp`)),
    ...SCEN_DAYS.map(dy => { const v = valueAtPrice(l, spot, ti.price, dy, shift); return h('td', { class: (v.mult < 1 ? 'neg' : v.mult >= 5 ? 'best' : '') + (v.expired ? ' expd' : '') }, '×' + fmt.num(v.mult, 1), v.expired ? h('span', { class: 'cat' }, ' exp.') : null); })) : null;
  const rows = SCEN_MOVES.map(mv => h('tr', { class: mv === 16 && !ti ? 'headline' : '' },
    h('td', { class: 'l' }, h('span', { class: 'tick' }, `+${mv}%`), h('span', { class: 'cat' }, ` ≈ ${fmt.num(mv * BP_PER_PCT, 0)} bp`)),
    ...SCEN_DAYS.map(dy => { const v = val(mv, dy); return h('td', { class: (v.mult < 1 ? 'neg' : v.mult >= 5 ? 'best' : '') + (v.expired ? ' expd' : '') }, '×' + fmt.num(v.mult, 1), v.expired ? h('span', { class: 'cat' }, ' exp.') : null); })));
  plot.replaceChildren(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl thesis-tbl' }, h('thead', {}, head), h('tbody', {}, tRow, rows))));
}

/* ---------------- Fig 3: call IV by expiry, with the event calendar on the axis ---------------- */
function renderTerm(d) {
  const plot = $('#card-term .plot'), desc = $('#term-desc'); cardTools('card-term', true);
  const lines = shopLines(d).filter(l => l.tgt === state.delta), atm = atmByExpiry(d).filter(r => r.dte <= MAX_DTE_SHOP);
  if (!lines.length || !atm.length) { desc.textContent = ''; readout('term', ''); return emptyState(plot, 'No chain loaded.'); }
  const pts = lines.map(l => { const a = atm.find(r => r.expiry_date === l.exp); return { exp: l.exp, dte: l.dte, call: l.iv, atm: a ? a.vol50 : null, k: l.k, mid: l.mid }; });
  const asOf = state.latest.as_of, t0 = new Date(asOf + 'T00:00:00'), dayOf = s => Math.round((new Date(s + 'T00:00:00') - t0) / 864e5);
  const { pairs, baseVol } = eventPremia(d);
  const evs = EVENTS.filter(e => dayOf(e.d) >= 0 && dayOf(e.d) <= MAX_DTE_SHOP).map(e => { const dd = dayOf(e.d), pair = pairs.find(p => p.a.dte < dd && dd <= p.b.dte); return { ...e, dd, pair }; });
  const sel = pts.find(p => p.exp === state.expiry), cheap = pts.reduce((b, p) => p.call < b.call ? p : b, pts[0]);
  readout('term', sel ? `${fmt.dateShort(sel.exp)} · ATM ${fmt.num(sel.atm, 1)} · ${state.delta}Δ call ${fmt.num(sel.call, 1)}` : '');
  desc.textContent = `ATM and ${state.delta}Δ-call implied vol for each expiry to six months · lowest call IV ${fmt.dateShort(cheap.exp)} (${fmt.num(cheap.call, 1)}) · marks on the axis are scheduled events; hover one for the extra move the surface prices across it (base vol ${fmt.num(baseVol, 1)}) · FOMC dates verified, others approximate`;
  if (viewOf('card-term') === 'table') {
    plot.replaceChildren(tableEl([{ label: 'Expiry', left: true, fmt: r => fmt.date(r.exp) }, { label: 'DTE', key: 'dte' }, { label: 'ATM IV', fmt: r => fmt.pct(r.atm) }, { label: `${state.delta}Δ call IV`, fmt: r => fmt.pct(r.call) }, { label: 'Strike', fmt: r => fmt.num(r.k, 2) }, { label: 'Mid', fmt: r => fmt.num(r.mid, 2) }], pts)); return;
  }
  const f = frame(plot, 310, { t: 14, r: 64, b: 56, l: 44 });
  const x = lin(0, MAX_DTE_SHOP, 0, f.iw), vals = pts.flatMap(p => [p.call, p.atm]).filter(isNum), [lo, hi] = pad(Math.min(...vals), Math.max(...vals), 0.12), y = lin(Math.max(0, lo), hi, f.ih, 0);
  yGrid(f, niceTicks(Math.max(0, lo), hi, 5), y, v => fmt.num(v, 0) + '%');
  if (sel) el('line', { x1: x(sel.dte), x2: x(sel.dte), y1: 0, y2: f.ih, stroke: css('--lit'), 'stroke-width': 1, 'stroke-dasharray': '1 3' }, f.g);
  const path = key => linePath(pts.filter(p => isNum(p[key])).map(p => [x(p.dte), y(p[key])]));
  el('path', { d: path('atm'), fill: 'none', stroke: css('--s1'), 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, f.g);
  el('path', { d: path('call'), fill: 'none', stroke: css('--s2'), 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, f.g);
  for (const p of pts) { if (isNum(p.atm)) marker(f.g, x(p.dte), y(p.atm), css('--s1'), p === sel ? 5 : 3.5); if (isNum(p.call)) marker(f.g, x(p.dte), y(p.call), css('--s2'), p === sel ? 5 : 3.5); }
  xBaseline(f);
  for (const tk of [0, 30, 60, 90, 120, 150, 180]) xLabel(f, x(tk), tk + 'd', tk === 0 ? 'start' : tk === 180 ? 'end' : 'middle');
  // events on the axis: a tick, a short label on alternating rows, a hit area for the premium
  const short = e => e.kind === 'fomc' ? 'FOMC' : e.kind === 'cpi' ? 'CPI' : /Refund/.test(e.label) ? 'Refund' : '30y';
  const narrow = f.iw < 520, rowEnd = [-1e9, -1e9, -1e9];
  evs.forEach(e => {
    const ex = x(e.dd);
    el('line', { x1: ex, x2: ex, y1: f.ih, y2: f.ih + 5, stroke: e.kind === 'fomc' ? css('--hi') : css('--mid'), 'stroke-width': e.kind === 'fomc' ? 1.5 : 1 }, f.g);
    if (narrow && e.kind !== 'fomc') return;                                   // on a phone only FOMC gets a word; the rest keep their tick and tooltip
    const label = short(e), w = label.length * 5.6 + 6, row = rowEnd.findIndex(end => ex - w / 2 > end);
    if (row < 0) return;
    rowEnd[row] = ex + w / 2;
    const t = el('text', { x: ex, y: f.ih + 30 + row * 10, 'text-anchor': 'middle', class: e.kind === 'fomc' ? 'ink2' : '' }, f.g); t.textContent = label; t.setAttribute('font-size', '9');
    const hit = el('rect', { x: ex - 12, y: f.ih, width: 24, height: 44, class: 'hit' }, f.g);
    const rows = [{ label: 'When', value: fmt.date(e.d) + (e.end ? '–' + new Date(e.end + 'T00:00:00').getDate() : '') + ' · ' + e.dd + 'd' }, { label: e.v ? 'Source' : 'Approximate', value: e.v ? 'verified' : e.note }];
    if (e.pair) rows.push({ label: `${fmt.dateShort(e.pair.a.expiry_date)}→${fmt.dateShort(e.pair.b.expiry_date)} fwd vol`, value: fmt.num(e.pair.fwdVol, 1) + '%' }, { label: 'Extra move priced', value: e.pair.extraMove > 0.05 ? '+' + fmt.num(e.pair.extraMove, 2) + '%' : 'none over base' });
    hit.addEventListener('pointermove', ev => showTip(ev.clientX, ev.clientY, e.label, rows)); hit.addEventListener('pointerleave', hideTip);
  });
  const last = pts[pts.length - 1];
  endLabels(f, [{ y: y(last.atm), text: 'ATM ' + fmt.num(last.atm, 1), color: css('--s1') }, { y: y(last.call), text: state.delta + 'Δ ' + fmt.num(last.call, 1), color: css('--s2') }]);
  const cross = el('line', { y1: 0, y2: f.ih, stroke: css('--axis'), visibility: 'hidden' }, f.g);
  const hit = el('rect', { x: 0, y: 0, width: f.iw, height: f.ih, class: 'hit' }, f.g);
  hit.addEventListener('pointermove', ev => {
    const b = f.svg.getBoundingClientRect(), dd = x.invert(ev.clientX - b.left - f.m.l);
    const p = pts.reduce((q, r) => Math.abs(r.dte - dd) < Math.abs(q.dte - dd) ? r : q, pts[0]);
    cross.setAttribute('x1', x(p.dte)); cross.setAttribute('x2', x(p.dte)); cross.setAttribute('visibility', 'visible');
    showTip(ev.clientX, ev.clientY, `${fmt.date(p.exp)} · ${p.dte}d`, [{ label: 'ATM IV', value: fmt.pct(p.atm), color: css('--s1') }, { label: `${state.delta}Δ call IV`, value: fmt.pct(p.call), color: css('--s2') }, { label: 'Strike · mid', value: `${fmt.num(p.k, 2)} · ${fmt.num(p.mid, 2)}` }]);
  });
  hit.addEventListener('click', ev => { const b = f.svg.getBoundingClientRect(), dd = x.invert(ev.clientX - b.left - f.m.l); const p = pts.reduce((q, r) => Math.abs(r.dte - dd) < Math.abs(q.dte - dd) ? r : q, pts[0]); setExpiry(p.exp); });
  hit.addEventListener('pointerleave', () => { hideTip(); cross.setAttribute('visibility', 'hidden'); });
  plot.replaceChildren(legend([{ label: 'ATM implied vol', color: css('--s1') }, { label: `${state.delta}Δ call implied vol`, color: css('--s2') }, { label: 'Scheduled event', color: css('--hi'), shape: 'dot' }]), f.svg);
}

/* ---------------- orchestration ---------------- */
const currentU = () => state.latest && state.latest.universe.find(u => u.ticker === state.ticker);
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
  const pv = anaVis.map(a => a.cr).filter(isNum), hasPx = pv.length > 1;
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
  const leg = [{ label: 'Implied vol, 30-day', color: css('--s1') }, { label: 'Realized vol, 30-day', color: css('--s2') }];
  if (anaVis.length) leg.push({ label: '2023 IV30, peak-aligned', color: css('--mid') }, { label: '2023 close, rebased (right axis)', color: css('--mid') });
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
function atmByExpiry(d) { return (d && d.surface || []).filter(r => r.dte >= 2 && isNum(r.vol50)).sort((a, b) => a.dte - b.dte); }
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
  renderTargetNote(d); renderShop(d); renderThesis(d); renderTerm(d);
}
function setTarget(price, days) {
  state.target = { price: isNum(price) && price > 0 ? price : null, days: isNum(days) && days >= 1 ? Math.round(days) : 60 };
  const d = state.detail[state.ticker] || null; if (d) applyBest(d); pushUrl(); renderTargetNote(d); renderShop(d); renderThesis(d); renderTerm(d);
}
function setDelta(v) { state.delta = v; pushUrl(); const d = state.detail[state.ticker] || null; renderShop(d); renderThesis(d); renderTerm(d); }
async function loadDetail() {
  document.querySelectorAll('#card-wings .plot, #card-thesis .plot, #card-term .plot').forEach(p => p.classList.add('stale'));
  const d = await getDetail(state.ticker);
  document.querySelectorAll('.plot.stale').forEach(p => p.classList.remove('stale'));
  populateExpiries(d); if (d && isNum(state.target.price)) { applyBest(d); pushUrl(); } renderDetail(d);
}
function renderDetail(d) {
  renderRent(d); renderTargetNote(d); renderShop(d); renderThesis(d); renderTerm(d);
}
function renderAll() { if (!state.latest) return; renderKpis(); renderHistory(); renderDetail(state.detail[state.ticker] || null); renderStatus(); }
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
function pushUrl() { const q = new URLSearchParams(); if (state.expiry) q.set('e', state.expiry); if (state.range !== '1Y') q.set('r', state.range); if (state.delta !== 15) q.set('d', state.delta); if (isNum(state.target.price)) { q.set('p', state.target.price); q.set('n', state.target.days); } history.replaceState(null, '', q.toString() ? '?' + q : location.pathname); }

async function loadData(first) {
  const [latest, hist, analog] = await Promise.all([getJSON('data/latest.json'), getJSON('data/history.json'), getJSON('data/analog_2023.json').catch(e => { console.warn('no analog file', e.message); return null; })]);
  state.latest = latest; state.history = hist; state.analog = analog; state.lastGenerated = latest.generated_at; state.detail = {};
  state.ticker = latest.universe.some(u => u.ticker === 'TLT') ? 'TLT' : latest.universe[0].ticker;
  if (first) {
    const q = new URLSearchParams(location.search);
    if (q.get('e')) state.expiry = q.get('e');
    if (SHOP_DELTAS.includes(+q.get('d'))) state.delta = +q.get('d');
    if (+q.get('p') > 0) { state.target = { price: +q.get('p'), days: +q.get('n') >= 1 ? Math.round(+q.get('n')) : 60 }; $('#target-price').value = state.target.price; $('#target-days').value = state.target.days; }
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
  let tt; const onTarget = () => { clearTimeout(tt); tt = setTimeout(() => setTarget(parseFloat($('#target-price').value), parseFloat($('#target-days').value)), 250); };
  $('#target-price').addEventListener('input', onTarget); $('#target-days').addEventListener('input', onTarget);
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
