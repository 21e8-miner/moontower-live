// Builds the skew balance: an equal-arm balance that weighs TLT's put wing against its call wing.
// Writes balance.html (the card), balance.js (kit + live code), balance.css (kit styles) and preview.html.
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import * as k from "../../../../.claude/skills/anatomy/kit/iso-kit.mjs";
import * as G from "../../../../.claude/skills/anatomy/kit/lathe.mjs";
import { kitScript } from "../../../../.claude/skills/anatomy/scripts/inline-kit.mjs";
import * as M from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(homedir(), ".claude/skills/anatomy");
const WIDTH = 760, HEIGHT = 430;

// ---- plan (world units, z up)
const PLATE = { x: -134, y: -62, w: 268, d: 124, r: 8 };
const PLATE_H = 12, FOOT_H = 5;
const BY = 8;                                   // the balance's axis line (y of column, pans, beam)
const COL = [0, BY], COL_R = 6, COL_TOP = 108;
const KNIFE_Z = 112, KNIFE_H = 6;
const BEAM_Z = KNIFE_Z + KNIFE_H + 2.5;         // beam centre line when level
const ARM = 95;                                 // pivot to each hook
const BEAM_W = 4, BEAM_H = 5;
const HANG = 72;                                // hook to pan top
const PAN_R = 24, PAN_H = 1.6;
const PAN_Z = BEAM_Z - HANG;                    // pan top at rest (level beam)
const WEIGHT_R = 9, WEIGHT_H = 2.6;
const PTR_LEN = BEAM_Z - 19;                    // pointer tip 1 unit above the scale face at z 18
const PTR_Y = BY + COL_R + 3.5;                 // pointer plane, in front of the column
const SCALE = { x: -21, y: PTR_Y - 2.5, w: 42, d: 6, r: 1 }, SCALE_TOP = 18;
const DIAL = [-72, 40], DIAL_R = 16, DIAL_Z = 10, DIAL_H = 8, DIAL_TOP = DIAL_Z + DIAL_H;
const PED = { x: DIAL[0] - 21, y: DIAL[1] - 19, w: 42, d: 38, r: 4 };
const STOP_H = 28;

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [-ARM - PAN_R, BY - PAN_R, PAN_Z + 40], [ARM + PAN_R, BY + PAN_R, PAN_Z + 40], [0, BY, BEAM_Z + 4], [-ARM - 4, BY, BEAM_Z + ARM * Math.sin(M.MAX_TILT) + 4]],
  WIDTH, HEIGHT, { pad: 26, azimuth: 88, elevation: 28 });

const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (pts) => [...pts].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const depth = (x, y, z = 0) => k.depthOf([x, y, z], P);

// ---- base plate on feet, groove, corner screws, ruler strip, label plate
function plate() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(PLATE, 22))) {
    out.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
  const screws = k.corners(PLATE, 10);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  // ruler strip along the right edge, ticks hanging from its inner edge
  const strip = { x: PLATE.x + PLATE.w - 15, y: -48, w: 7, d: 96, r: 1 };
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const t = k.topTicks(strip.y + 4, strip.y + strip.d - 4, 4, 5, strip.x + 0.3, 0.6, [2, 3.6], P, "y");
  out.push(L(k.lineOnTop([strip.x + 3.9, strip.y - 0.4], [strip.x + 3.9, strip.y + strip.d + 0.4], 0.6, P), { tone: "mid" }));   // the scale line the ticks end on
  out.push(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }));
  out.push(D([at([strip.x + 3.5, strip.y + 2, 0.6]), at([strip.x + 3.5, strip.y + strip.d - 2, 0.6])], { size: 0.45 }));
  // label plate, front right
  const label = { x: 56, y: 42, w: 46, d: 13, r: 1.2 };
  out.push(S(k.slabOf(label, 0, 0.8, P, 4), { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(label, 1.6), 0.8, P), { tone: "faint" }));
  [[4, 30], [7.5, 22], [11, 26]].forEach(([dy, len]) => out.push(L(k.lineOnTop([label.x + 5, label.y + dy], [label.x + 5 + len, label.y + dy], 0.8, P), { tone: "lo", free: true })));
  out.push(D([at([label.x + 2.5, label.y + 2.5, 0.8]), at([label.x + label.w - 2.5, label.y + label.d - 2.5, 0.8])], { size: 0.4 }));
  return out.join("");
}

// ---- pan rest stops: two posts under each pan
function stops() {
  const out = [];
  for (const x of [-ARM - 13, -ARM + 13, ARM - 13, ARM + 13]) {
    out.push(S(k.cylinder(x, BY, 3.2, 0, 2, P, 20), { tone: "lo" }));
    out.push(S(k.cylinder(x, BY, 2.2, 2, STOP_H - 2, P, 20), { tone: "mid", crease: "none" }));
    out.push(S(k.cylinder(x, BY, 3, STOP_H, 1.2, P, 20), { tone: "mid" }));
  }
  return out.join("");
}

// ---- column with base flange, seams, collar, cap and the knife-edge block
function column() {
  const out = [];
  const [x, y] = COL;
  out.push(S(k.cylinder(x, y, 12, 0, 3, P, 40, 0.5), { tone: "mid" }));
  out.push(D([0, 2.1, 4.2].map((a) => at([x + Math.cos(a) * 9, y + Math.sin(a) * 9, 3])), { size: 0.45 }));
  out.push(S(k.cylinder(x, y, COL_R, 3, 66, P, 32), { tone: "mid", crease: "none" }));
  out.push(L([30, 52].map((z) => k.sideArc(x, y, COL_R, z, P, 18)).join(""), { tone: "faint" }));
  out.push(S(k.cylinder(x, y, COL_R + 1.8, 69, 4, P, 32), { tone: "mid" }));
  out.push(L(k.knurl(x, y, COL_R + 1.8, 69, 73, 30, P), { tone: "lo" }));
  out.push(S(k.cylinder(x, y, COL_R, 73, COL_TOP - 73, P, 32), { tone: "mid", crease: "none" }));
  out.push(L(k.sideArc(x, y, COL_R, 92, P, 18), { tone: "faint" }));
  out.push(S(k.cylinder(x, y, COL_R + 1, COL_TOP, KNIFE_Z - COL_TOP, P, 32), { tone: "mid" }));
  const knife = { x: x - 6, y: y - 6, w: 12, d: 12, r: 2 };
  out.push(S(k.slabOf(knife, KNIFE_Z, KNIFE_H, P, 4, 0.6), { tone: "mid" }));
  out.push(D([at([x - 3.5, y + 3.5, KNIFE_Z + KNIFE_H]), at([x + 3.5, y - 3.5, KNIFE_Z + KNIFE_H])], { size: 0.45 }));
  // pointer hub boss, a short disc along +y out of the column
  const F = G.frameAlong([x, y + COL_R - 0.5, BEAM_Z - 1], [0, 1, 0]);
  out.push(S(G.disc(0, PTR_Y - (y + COL_R - 0.5), 2.6, F, P), { tone: "mid" }));
  return out.join("");
}

// ---- scale pedestal under the pointer tip, ticks hanging from its back edge toward the viewer
function scale() {
  const out = [];
  out.push(S(k.slabOf(SCALE, 0, SCALE_TOP - 1, P, 3, 0.5), { tone: "mid" }));
  out.push(S(k.slabOf(k.insetPlan(SCALE, -0.8), SCALE_TOP - 1, 1, P, 3), { tone: "hi", crease: "lo" }));
  const t = k.topTicks(SCALE.x + 3, SCALE.x + SCALE.w - 3, 2, 3, SCALE.y - 0.8 + 0.6, SCALE_TOP, [2, 3.4], P);
  out.push(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }));
  out.push(L(k.lineOnTop([0, SCALE.y - 0.2], [0, SCALE.y + SCALE.d + 0.2], SCALE_TOP, P), { tone: "hi" }));
  return out.join("");
}

// ---- dial gauge on a pedestal: 1-year IV percentile
function dial() {
  const out = [];
  const [x, y] = DIAL;
  out.push(S(k.slabOf(PED, 0, DIAL_Z, P, 5, 0.8), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(PED, 3), DIAL_Z, P), { tone: "faint" }));
  out.push(D(k.corners(PED, 4).map(([px, py]) => at([px, py, DIAL_Z])), { size: 0.45 }));
  out.push(S(k.cylinder(x, y, DIAL_R, DIAL_Z, DIAL_H, P, 64, 0.8), { tone: "hi", crease: "lo" }));
  out.push(L(k.knurl(x, y, DIAL_R, DIAL_TOP - 3, DIAL_TOP, 72, P, 0.3), { tone: "lo" }));
  out.push(L(k.sideArc(x, y, DIAL_R, DIAL_TOP - 3, P, 40), { tone: "faint" }));
  out.push(L(k.ring(x, y, DIAL_R - 2.2, DIAL_TOP, P, 64), { tone: "lo" }));
  const ticks = k.radialTicks(x, y, DIAL_R - 3, 30, 5, DIAL_TOP, [1.3, 2.8], P, -0.75 * Math.PI, 1.5 * Math.PI);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(S(k.slabOf({ x: x + DIAL_R - 1, y: y - 2.4, w: 5, d: 4.8, r: 1.2 }, DIAL_Z + 1.5, 5, P, 3), { tone: "mid" }));
  out.push(S(k.slabOf({ x: x + DIAL_R + 3.6, y: y - 3.2, w: 2.6, d: 6.4, r: 1.2 }, DIAL_Z + 0.7, 6.6, P, 3), { tone: "mid" }));
  out.push(L(k.ring(x, y, 1.6, DIAL_TOP, P, 16), { tone: "mid" }));
  out.push(k.faceTextSvg(k.topMatrix([x, y + 8.5], DIAL_TOP, P, "x"), "IV %ILE", { size: 2.2, tone: "lo", anchor: "middle" }));
  return out.join("");
}
const needleAt = (pct) => {
  const a = M.needleOf(pct);
  const [x, y] = DIAL;
  return k.lineOnTop([x - Math.sin(a) * 3.2, y + Math.cos(a) * 3.2], [x + Math.sin(a) * (DIAL_R - 4), y - Math.cos(a) * (DIAL_R - 4)], DIAL_TOP + 0.2, P);
};

// ---- pan with rim ring, hub and weight discs (built at rest, moved by dz)
function pan(cx, side) {
  const out = [`<path class="iso-halo" d="${k.haloOf({ x: cx - PAN_R + 4, y: BY - PAN_R + 4, w: 2 * PAN_R - 8, d: 2 * PAN_R - 8, r: PAN_R - 4 }, 0, 0.1, P)}" style="filter:blur(6px);opacity:.5"/>`];
  out.push(S(k.cylinder(cx, BY, PAN_R, PAN_Z - PAN_H, PAN_H, P, 64, 0.5), { tone: "mid" }));
  out.push(L(k.ring(cx, BY, PAN_R - 2.6, PAN_Z, P, 64), { tone: "lo" }));
  out.push(L(k.ring(cx, BY, 2.4, PAN_Z, P, 16), { tone: "lo" }));
  out.push(D([at([cx, BY, PAN_Z])], { size: 0.45 }));
  for (let i = 0; i < M.MAX_WEIGHTS; i++) {
    const z = PAN_Z + i * WEIGHT_H;
    const body = S(k.cylinder(cx, BY, WEIGHT_R, z, WEIGHT_H, P, 40, 0.4), { tone: "hi", crease: "lo", inner: L(k.sideArc(cx, BY, WEIGHT_R, z + WEIGHT_H / 2, P, 24), { tone: "faint" }) });
    out.push(`<g data-weight="${side}${i}">${body}</g>`);
  }
  return out.join("");
}
// hanger wires from the hook to three rim points, drawn in the page from the live hook position
const rimAngles = [Math.PI * 0.5, Math.PI * 1.1667, Math.PI * 1.8333];
const rimPoints = (cx) => rimAngles.map((a) => [cx + Math.cos(a) * (PAN_R - 2.6), BY + Math.sin(a) * (PAN_R - 2.6)]);   // on the rim ring

// ---- beam, hooks, pointer: rebuilt in the page per frame from the tilt
const POLY = [[-BEAM_W / 2, -BEAM_H / 2], [BEAM_W / 2, -BEAM_H / 2], [BEAM_W / 2, BEAM_H / 2], [-BEAM_W / 2, BEAM_H / 2]];
const beamFrame = (t) => G.frameOf([0, BY, BEAM_Z], [Math.cos(t), 0, Math.sin(t)], [0, 1, 0], [-Math.sin(t), 0, Math.cos(t)]);
const hookAt = (t, side) => [side * ARM * Math.cos(t), BY, BEAM_Z + side * ARM * Math.sin(t)];
const panDz = (t, side) => side * ARM * Math.sin(t);
const pointerD = (t) => k.segment([0, PTR_Y, BEAM_Z - 1], [Math.sin(t) * PTR_LEN, PTR_Y, BEAM_Z - 1 - Math.cos(t) * PTR_LEN], P);
function beamSvg(t) {
  const F = beamFrame(t);
  const out = [S(G.prismOf(F, POLY, -ARM - 3, ARM + 3, P), { tone: "hi", crease: "lo" })];
  out.push(S(G.sphereOf([0, BY, BEAM_Z], 3.4, P), { tone: "hi" }));
  return out.join("");
}
const hooksSvg = (t) => [-1, 1].map((side) => S(G.sphereOf(hookAt(t, side), 2.6, P), { tone: "hi" })).join("");
const wiresSvg = (t, side) => {
  const h = hookAt(t, side), dz = panDz(t, side);
  return rimPoints(side * ARM).map(([x, y]) => k.segment(h, [x, y, PAN_Z + dz], P)).join("");
};

// ---- assemble, back to front by the depth of each stack's footprint
const T0 = 0;
const stacks = [
  { d: depth(-ARM, BY), svg: `<g data-part="panL" transform="${k.translateAlong(P, [0, 0, 0])}">${pan(-ARM, "L")}</g><path data-part="wiresL" class="iso-line" data-tone="mid" d="${wiresSvg(T0, -1)}"/>` },
  { d: depth(0, BY), svg: column() },
  { d: depth(0, PTR_Y + 10), svg: scale() + `<path data-part="pointer" class="iso-line" data-tone="lit" data-free="end" d="${pointerD(T0)}" style="stroke-width:1.1"/>` + D([at([0, PTR_Y + 0.3, BEAM_Z - 1])], { size: 0.55, tone: "hi" }) },
  { d: depth(ARM, BY), svg: `<g data-part="panR" transform="${k.translateAlong(P, [0, 0, 0])}">${pan(ARM, "R")}</g><path data-part="wiresR" class="iso-line" data-tone="mid" d="${wiresSvg(T0, 1)}"/>` },
  { d: depth(DIAL[0], DIAL[1]), svg: dial() + `<path data-part="needle" class="iso-line" data-tone="hi" data-free="start" d="${needleAt(50)}" style="stroke-width:1"/>` },
].sort((a, b) => a.d - b.d);

const svg = k.figureSvg({
  width: WIDTH, height: HEIGHT,
  label: "An equal-arm balance on a base plate. The left pan holds the put wing's 25-delta implied volatility as a stack of weights, the right pan the call wing's. The beam tilts toward the heavier, richer side and a pointer hanging from the pivot swings toward the cheaper wing. A dial gauge on the plate reads the one-year implied-volatility percentile.",
  body: [plate(), stops(), ...stacks.map((s) => s.svg), `<g data-part="beam">${beamSvg(T0)}</g>`, `<g data-part="hooks">${hooksSvg(T0)}</g>`],
});

// lathe.mjs inlined beside the kit: drop its import (the kit is in the same script) and its exports
const latheSrc = readFileSync(join(SKILL, "kit/lathe.mjs"), "utf8").replace(/^import[^\n]*\n/m, "").replace(/^export /gm, "");
const modelSrc = readFileSync(join(HERE, "model.mjs"), "utf8").replace(/^export /gm, "");

const live = `
const P = ${JSON.stringify(P)};
const BY = ${BY}, BEAM_Z = ${BEAM_Z}, ARM = ${ARM}, PAN_Z = ${PAN_Z}, PAN_R = ${PAN_R}, PTR_Y = ${PTR_Y}, PTR_LEN = ${PTR_LEN};
const DIAL = ${JSON.stringify(DIAL)}, DIAL_R = ${DIAL_R}, DIAL_TOP = ${DIAL_TOP};
const POLY = ${JSON.stringify(POLY)};
const rimAngles = ${JSON.stringify(rimAngles)};
const rimPoints = (cx) => rimAngles.map((a) => [cx + Math.cos(a) * (PAN_R - 2.6), BY + Math.sin(a) * (PAN_R - 2.6)]);   // on the rim ring
const beamFrame = (t) => G.frameOf([0, BY, BEAM_Z], [Math.cos(t), 0, Math.sin(t)], [0, 1, 0], [-Math.sin(t), 0, Math.cos(t)]);
const hookAt = (t, side) => [side * ARM * Math.cos(t), BY, BEAM_Z + side * ARM * Math.sin(t)];
const panDz = (t, side) => side * ARM * Math.sin(t);
const pointerD = (t) => segment([0, PTR_Y, BEAM_Z - 1], [Math.sin(t) * PTR_LEN, PTR_Y, BEAM_Z - 1 - Math.cos(t) * PTR_LEN], P);
const needleAt = (pct) => { const a = needleOf(pct); const [x, y] = DIAL; return lineOnTop([x - Math.sin(a) * 3.2, y + Math.cos(a) * 3.2], [x + Math.sin(a) * (DIAL_R - 4), y - Math.cos(a) * (DIAL_R - 4)], DIAL_TOP + 0.2, P); };
const beamSvg = (t) => solidSvg(G.prismOf(beamFrame(t), POLY, -ARM - 3, ARM + 3, P), { tone: "hi", crease: "lo" }) + solidSvg(G.sphereOf([0, BY, BEAM_Z], 3.4, P), { tone: "hi" });
const hooksSvg = (t) => [-1, 1].map((side) => solidSvg(G.sphereOf(hookAt(t, side), 2.6, P), { tone: "hi" })).join("");
const wiresD = (t, side) => { const h = hookAt(t, side), dz = panDz(t, side); return rimPoints(side * ARM).map(([x, y]) => segment(h, [x, y, PAN_Z + dz], P)).join(""); };

const stage = document.querySelector("[data-balance]");
const svg = stage.querySelector("svg");
const q = (sel) => svg.querySelector(sel);
const refs = { beam: q('[data-part="beam"]'), hooks: q('[data-part="hooks"]'), panL: q('[data-part="panL"]'), panR: q('[data-part="panR"]'),
  wiresL: q('[data-part="wiresL"]'), wiresR: q('[data-part="wiresR"]'), pointer: q('[data-part="pointer"]'), needle: q('[data-part="needle"]') };
const weights = { L: [...svg.querySelectorAll('[data-weight^="L"]')], R: [...svg.querySelectorAll('[data-weight^="R"]')] };
const readout = stage.closest(".iso-plate").querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");

// ---- state: a list of expiries, each { label, putIV, callIV, atmIV, pct }
let rows = [], index = 0, picked = 0, onPick = null;
let tilt = { at: 0, rate: 0 }, needle = { at: 0 }, shownL = -1, shownR = -1;
let frame = 0, last = 0, clock = 0, touring = !still.matches, visible = false, idleTimer = 0, pct = 0;
const stiff = 60, drag = 9;                          // a slow, well-damped beam, as a real balance settles
function draw() {
  refs.beam.innerHTML = beamSvg(tilt.at);
  refs.hooks.innerHTML = hooksSvg(tilt.at);
  refs.panL.setAttribute("transform", translateAlong(P, [0, 0, panDz(tilt.at, -1)]));
  refs.panR.setAttribute("transform", translateAlong(P, [0, 0, panDz(tilt.at, 1)]));
  refs.wiresL.setAttribute("d", wiresD(tilt.at, -1));
  refs.wiresR.setAttribute("d", wiresD(tilt.at, 1));
  refs.pointer.setAttribute("d", pointerD(tilt.at));
  refs.needle.setAttribute("d", needleAt(needle.at));
  const r = rows[index];
  if (!r) return;
  const nL = weightsOf(r.putIV), nR = weightsOf(r.callIV);
  if (nL !== shownL) { weights.L.forEach((g, i) => g.style.display = i < nL ? "" : "none"); shownL = nL; }
  if (nR !== shownR) { weights.R.forEach((g, i) => g.style.display = i < nR ? "" : "none"); shownR = nR; }
  const diff = r.putIV - r.callIV;
  const verdict = Math.abs(diff) < 0.3 ? "wings even" : diff > 0 ? "calls cheaper" : "puts cheaper";
  const text = r.label + " · P " + r.putIV.toFixed(1) + " / C " + r.callIV.toFixed(1) + " · " + verdict;
  if (readout && readout.textContent !== text) readout.textContent = text;
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  const calm = still.matches;
  if (touring && rows.length > 1) { clock += dt; const next = Math.floor(clock / 2.6) % rows.length; if (next !== index) { index = next; if (onPick) onPick(rows[index], false); } }
  const r = rows[index];
  const want = r ? tiltOf(r.putIV, r.callIV) : 0;
  if (calm) { tilt.at = want; tilt.rate = 0; } else for (let i = 0; i < 4; i++) { tilt.rate += ((want - tilt.at) * stiff - tilt.rate * drag) * dt / 4; tilt.at += tilt.rate * dt / 4; }
  if (Math.abs(want - tilt.at) < 2e-4 && Math.abs(tilt.rate) < 2e-4) { tilt.at = want; tilt.rate = 0; }
  needle.at = calm ? pct : needle.at + (pct - needle.at) * (1 - Math.exp(-dt / 0.5));
  if (Math.abs(pct - needle.at) < 0.05) needle.at = pct;
  draw();
  const settled = !touring && tilt.rate === 0 && tilt.at === want && needle.at === pct;
  frame = visible && !settled ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
const pick = (i, byUser) => { index = Math.max(0, Math.min(rows.length - 1, i)); if (onPick) onPick(rows[index], byUser); run(); };
const steer = (i) => { touring = false; pick(i, true); clearTimeout(idleTimer); idleTimer = setTimeout(() => { touring = !still.matches; clock = index * 2.6; run(); }, 6000); };
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
stage.addEventListener("pointermove", (ev) => {
  if (rows.length < 2) return;
  const box = svg.getBoundingClientRect();
  const share = Math.max(0, Math.min(1, ((ev.clientX - box.left) / box.width - 0.12) / 0.76));
  const i = Math.round(share * (rows.length - 1));
  if (i !== index) steer(i);
});
stage.addEventListener("keydown", (ev) => {
  let to = null;
  if (ev.key === "ArrowRight" || ev.key === "ArrowUp") to = index + 1;
  if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") to = index - 1;
  if (ev.key === "Home") to = 0;
  if (ev.key === "End") to = rows.length - 1;
  if (to === null) return;
  ev.preventDefault(); steer(to);
  stage.setAttribute("aria-valuetext", readout.textContent);
});
window.Balance = {
  /** rows: [{ label, putIV, callIV, atmIV }], pct: 1y IV percentile, start: index to show first */
  set({ rows: list, pct: p, start = 0, hold = false }) {
    rows = list || []; pct = p || 0; index = Math.max(0, Math.min(rows.length - 1, start));
    if (hold) { touring = false; clearTimeout(idleTimer); idleTimer = setTimeout(() => { touring = !still.matches; clock = index * 2.6; run(); }, 6000); }
    stage.setAttribute("aria-valuemax", String(Math.max(0, rows.length - 1)));
    draw(); run();
  },
  select(i) { steer(i); },
  onPick(fn) { onPick = fn; },
};
draw();
`;

const card = k.plateHtml({
  fig: "Fig 1",
  title: "Skew balance",
  hint: "Hover to sweep expiries · arrows step",
  readout: "loading chain…",
  keys: [
    { mark: "lit", label: "Pointer: swings toward the cheaper wing" },
    { mark: "raised", label: "Weights: one disc per 2.5 vol points of 25Δ implied vol" },
  ],
  caption: "An equal-arm balance weighs TLT's put wing against its call wing for one expiry at a time. Each pan holds that wing's 25-delta implied volatility as a stack of weights; the beam tips toward the richer side, so the pan that rises is where options are cheap. The dial reads how expensive TLT volatility is overall: its 30-day implied vol's percentile over the past year.",
  body: `<div class="iso-stage" data-balance tabindex="0" role="slider" aria-label="Skew balance: arrow keys step through expiries" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0">${svg}</div>`,
});

const script = kitScript() + "\nconst G = (() => {\n" + latheSrc + "\nreturn { frameOf, frameAlong, prismOf, sphereOf, disc };\n})();\n" + modelSrc + live;
writeFileSync(join(HERE, "balance.html"), card);
writeFileSync(join(HERE, "balance.js"), "(() => {\n" + script + "\n})();\n");
writeFileSync(join(HERE, "balance.css"), k.ISO_CSS);
// a standalone preview with sample rows, for capture.mjs
const sample = `window.addEventListener("load", () => Balance.set({ rows: [
  { label: "Oct 30 · 21d", putIV: 14.6, callIV: 12.9, atmIV: 13.1 }, { label: "Nov 20 · 42d", putIV: 14.9, callIV: 13.4, atmIV: 13.7 },
  { label: "Dec 18 · 70d", putIV: 15.0, callIV: 13.9, atmIV: 14.1 }, { label: "Jan 15 · 98d", putIV: 14.7, callIV: 14.3, atmIV: 14.2 }], pct: 92 }));`;
for (const theme of ["dark", "light"]) {
  writeFileSync(join(HERE, theme === "light" ? "preview-light.html" : "preview.html"),
    k.pageHtml({ title: "Skew balance", theme, body: card, script: script + sample, width: 820 }));
}
console.log("wrote balance.html/js/css + previews; svg bytes", svg.length, "solids", (svg.match(/iso-solid/g) || []).length, "paths", (svg.match(/<path/g) || []).length);
