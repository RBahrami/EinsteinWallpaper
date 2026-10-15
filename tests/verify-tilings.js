'use strict';
/*
 * verify-tilings.js — geometric verification for every tiling family/variant.
 *
 * For each family+variant we generate a patch over a world-space window and check:
 *   1. pairwise overlap test (interior sampling, boundary-immune)
 *   2. rasterized hole test (flood fill from outside, inner window only)
 *   3. per-family invariants (edge lengths, fat/thin ratio, kind counts...)
 *
 * Run:  bun tests/verify-tilings.js   (or node tests/verify-tilings.js)
 */
const path = require('path');
const TL = require(path.join(__dirname, '..', 'js', 'tilings.js'));

/* ---------------- helpers ---------------- */
const key2 = (p, q = 1e4) => Math.round(p[0] * q) + ',' + Math.round(p[1] * q);

function centroid(poly) {
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  return [x / poly.length, y / poly.length];
}
function bboxOf(polys) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}
function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function overlaps(A, B, shrinkF = 0.8) {
  const c = centroid(A);
  const sA = A.map(([x, y]) => [c[0] + (x - c[0]) * shrinkF, c[1] + (y - c[1]) * shrinkF]);
  let n = 0;
  for (const [x, y] of sA) if (pointInPoly(x, y, B)) n++;
  return n >= 2;
}
function totalOverlaps(polys) {
  const boxes = polys.map((p) => bboxOf([p]));
  let bad = 0;
  for (let i = 0; i < polys.length; i++) {
    for (let j = i + 1; j < polys.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0) continue;
      if (overlaps(polys[i], polys[j])) { bad++; break; }
    }
  }
  return bad;
}
// rasterize + flood fill; count hole pixels inside the inner 64% window
function holesInInnerWindow(polys, RES = 420) {
  if (!polys.length) return 0;
  const bb = bboxOf(polys);
  if (!isFinite(bb.w) || !isFinite(bb.h) || bb.w <= 0 || bb.h <= 0) return 0;
  const W = RES, H = Math.max(8, Math.round(RES * bb.h / bb.w));
  const mask = new Uint8Array(W * H);
  const toX = (x) => Math.floor((x - bb.x0) / bb.w * (W - 1));
  const toY = (y) => Math.floor((y - bb.y0) / bb.h * (H - 1));
  for (const poly of polys) {
    const pts = poly.map(([x, y]) => [toX(x), toY(y)]);
    const ymin = Math.max(0, Math.min(...pts.map((p) => p[1])));
    const ymax = Math.min(H - 1, Math.max(...pts.map((p) => p[1])));
    for (let y = ymin; y <= ymax; y++) {
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
        }
      }
      xs.sort((m, n) => m - n);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(W - 1, Math.floor(xs[k + 1])); x++) mask[y * W + x] = 1;
      }
    }
  }
  const outside = new Uint8Array(W * H);
  const stack = [];
  for (let x = 0; x < W; x++) {
    if (!mask[x]) { outside[x] = 1; stack.push(x); }
    if (!mask[(H - 1) * W + x]) { outside[(H - 1) * W + x] = 1; stack.push((H - 1) * W + x); }
  }
  for (let y = 0; y < H; y++) {
    if (!mask[y * W]) { outside[y * W] = 1; stack.push(y * W); }
    if (!mask[y * W + W - 1]) { outside[y * W + W - 1] = 1; stack.push(y * W + W - 1); }
  }
  while (stack.length) {
    const idx = stack.pop();
    const x = idx % W, y = (idx / W) | 0;
    for (const n of [x > 0 ? idx - 1 : -1, x < W - 1 ? idx + 1 : -1, y > 0 ? idx - W : -1, y < H - 1 ? idx + W : -1]) {
      if (n >= 0 && !mask[n] && !outside[n]) { outside[n] = 1; stack.push(n); }
    }
  }
  // raw hole mask, eroded by 1 px to kill sub-pixel sliver artifacts
  const holeRaw = new Uint8Array(W * H);
  for (let i = 0; i < mask.length; i++) if (!mask[i] && !outside[i]) holeRaw[i] = 1;
  let holes = 0;
  const inWin = (x, y) => x > W * 0.18 && x < W * 0.82 && y > H * 0.18 && y < H * 0.82;
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    const i = y * W + x;
    if (holeRaw[i] && holeRaw[i - 1] && holeRaw[i + 1] && holeRaw[i - W] && holeRaw[i + W] && inWin(x, y)) holes++;
  }
  return holes;
}

let failures = 0;
function report(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (!ok) failures++;
}

/* ---------------- per-family checks ---------------- */
const WINDOW = { x0: -9, y0: -9, x1: 9, y1: 9 };

function checkFamily(famId, variantId) {
  const gen = TL.generate(famId, variantId, WINDOW, 40000);
  const tiles = gen.tiles;
  if (gen.lineBased) {
    // line patterns: check band coverage of the window instead of polygon tiling
    let spanning = 0;
    for (const t of tiles) {
      const [x1, y1, x2, y2] = t.line;
      const L = Math.hypot(x2 - x1, y2 - y1);
      if (L > 20) spanning++; // must span the ±9 window with margin
    }
    const ok = tiles.length >= 8 && spanning === tiles.length;
    report(`${famId}/${variantId}`, ok, `lines=${tiles.length} spanning=${spanning}`);
    return;
  }
  const central = tiles.filter((t) => t.cx > -6 && t.cx < 6 && t.cy > -6 && t.cy < 6);
  const polys = central.map((t) => t.poly);
  const ov = totalOverlaps(polys);
  const holes = holesInInnerWindow(polys);
  let extra = '';

  if (famId === 'penrose') {
    // fat/thin ratio over the whole generated window (converges to phi)
    const fat = tiles.filter((t) => t.k === 0).length;
    const thin = tiles.filter((t) => t.k === 1).length;
    const ratio = fat / thin;
    extra = ` fat/thin=${ratio.toFixed(3)}`;
    if (Math.abs(ratio - 1.618) > 0.12) { report(`${famId}/${variantId}`, false, `fat/thin ratio ${ratio.toFixed(3)} != phi`); return; }
    let badEdges = 0;
    for (const t of central) for (let i = 0; i < 4; i++) {
      const a = t.poly[i], b = t.poly[(i + 1) % 4];
      if (Math.abs(Math.hypot(a[0] - b[0], a[1] - b[1]) - 1) > 1e-6) badEdges++;
    }
    if (badEdges) { report(`${famId}/${variantId}`, false, `${badEdges} edges != 1`); return; }
  }
  if (famId === 'cairo') {
    let badPent = 0;
    for (const t of central) {
      if (t.poly.length !== 5) badPent++;
    }
    if (badPent) { report(`${famId}/${variantId}`, false, `${badPent} non-pentagons`); return; }
  }
  if (famId === 'hexagons' || famId === 'octagons' || famId === 'trihexagonal') {
    let badEdges = 0;
    for (const t of central) {
      const lens = [];
      for (let i = 0; i < t.poly.length; i++) {
        const a = t.poly[i], b = t.poly[(i + 1) % t.poly.length];
        lens.push(Math.hypot(a[0] - b[0], a[1] - b[1]));
      }
      const m = lens.reduce((s, v) => s + v, 0) / lens.length;
      for (const L of lens) if (Math.abs(L - m) > 1e-6 * Math.max(1, m)) badEdges++;
    }
    if (badEdges) { report(`${famId}/${variantId}`, false, `${badEdges} irregular edges`); return; }
  }
  if (famId === 'triangles' && variantId === 'equilateral') {
    let badEdges = 0;
    for (const t of central) {
      for (let i = 0; i < 3; i++) {
        const a = t.poly[i], b = t.poly[(i + 1) % 3];
        if (Math.abs(Math.hypot(a[0] - b[0], a[1] - b[1]) - 1) > 1e-6) badEdges++;
      }
    }
    if (badEdges) { report(`${famId}/${variantId}`, false, `${badEdges} edges != 1`); return; }
  }
  if (famId === 'squares' && variantId === 'grid') {
    for (const t of central) {
      const lens = [];
      for (let i = 0; i < 4; i++) {
        const a = t.poly[i], b = t.poly[(i + 1) % 4];
        lens.push(Math.hypot(a[0] - b[0], a[1] - b[1]));
      }
      if (Math.abs(lens[0] - 1) > 1e-6 || Math.abs(lens[1] - 1) > 1e-6) {
        report(`${famId}/${variantId}`, false, 'bad square size'); return;
      }
    }
  }

  const ok = ov === 0 && holes === 0;
  report(`${famId}/${variantId}`, ok, `tiles=${central.length} overlaps=${ov} holes=${holes}${extra}`);
}

let total = 0;
for (const fam of TL.FAMILIES) {
  if (fam.id === 'hat') continue; // verified separately below
  for (const v of fam.variants) {
    checkFamily(fam.id, v.id);
    total++;
  }
}
if (typeof Bun !== 'undefined') Bun.gc(false);

/* ---------------- hat engine re-check ---------------- */
const HT = require(path.join(__dirname, '..', 'js', 'hat-tiling.js'));
function hatPoly(T) { return HT.HAT_OUTLINE.map((p) => HT.mapply(T, p)); }
function checkHat(level, root) {
  const levels = HT.buildLevels(level);
  const { hats, hatEdge } = HT.hatsForLevel(levels, level, { root });
  let polys = hats.map((h) => hatPoly(h.T));
  // recenter the cluster (root metatiles sit at different world positions)
  let cx = 0, cy = 0;
  for (const p of polys) { const c = centroid(p); cx += c[0]; cy += c[1]; }
  cx /= polys.length; cy /= polys.length;
  polys = polys.map((p) => p.map(([x, y]) => [x - cx, y - cy]));
  const central = polys.filter((p) => { const c = centroid(p); return Math.abs(c[0]) < 30 && Math.abs(c[1]) < 30; });
  const ov = totalOverlaps(central);
  const holes = holesInInnerWindow(central, 360);
  report(`hat/${root} L${level}`, ov === 0 && holes === 0 && central.length > 0, `hats=${central.length} overlaps=${ov} holes=${holes} edge=${hatEdge.toFixed(3)}`);
  if (typeof Bun !== 'undefined') Bun.gc(false);
}
checkHat(3, 'H');
checkHat(3, 'P');
checkHat(3, 'F');
checkHat(4, 'H');
/* ---------------- budget coarsening ---------------- */
{
  const gen = TL.generate('squares', 'grid', WINDOW, 150); // tiny budget -> coarsen
  const ok = gen.tiles.length <= 150 * 1.4 && gen._coarse > 1;
  report('budget/coarsening', ok, `tiles=${gen.tiles.length} coarse=${gen._coarse ? gen._coarse.toFixed(2) : 'n/a'}`);
}

console.log(`\n${total + 5} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);
