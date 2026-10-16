/* Color theme system tests: map modes (colorize), LUT builders, duotone,
   bands quantization, determinism. Uses real scenes from the render engine. */
globalThis.HatTiling = require('../js/hat-tiling.js'); // either/or UMD: wire the global manually
require('../js/palettes.js');
require('../js/gradients.js');
require('../js/tilings.js');
require('../js/render.js');
const R = globalThis.Renderer;
const GR = globalThis.Gradients;
const PAL = globalThis.Palettes;

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log('PASS ' + name + (detail ? '  ' + detail : '')); }
  else { failed++; console.log('FAIL ' + name + (detail ? '  ' + detail : '')); }
}

const BASE = { family: 'triangles', variant: 'equilateral', tileSize: 26, rotation: 0, seed: 7 };

function polyScene() {
  const sc = R.buildScene({ ...BASE, family: 'triangles' }, 640, 400, { budget: 60000 });
  if (!sc || sc.kind !== 'poly') throw new Error('poly scene failed');
  return sc;
}
function hatScene() {
  const sc = R.buildScene({ ...BASE, family: 'hat', variant: 'H', tileSize: 30 }, 640, 400, { budget: 100000 });
  if (!sc || sc.kind !== 'hat') throw new Error('hat scene failed');
  return sc;
}
const palRef = { kind: 'builtin', index: 0 };

/* ---- solid LUT ---- */
{
  const lut = R.buildSolidLut('#ff0000');
  check('solid LUT constant', lut.length === 256 && lut.every((c) => c === '#ff0000'));
  check('solid LUT rejects bad hex', R.buildSolidLut('nope')[0] === '#888888');
}

/* ---- single map: every tile t=0 ---- */
{
  const sc = polyScene();
  R.colorize(sc, { ...BASE, paletteRef: palRef, colorMap: 'single' });
  check('single map -> all indices 0', sc.lutIdx.every((v) => v === 0), `n=${sc.tiles.length}`);
}

/* ---- sweep: monotonic along the projection axis ---- */
{
  const sc = polyScene();
  R.colorize(sc, { ...BASE, paletteRef: palRef, colorMap: 'sweep', rotation: 0 });
  const th = 0, gx = Math.cos(th + Math.PI / 6), gy = Math.sin(th + Math.PI / 6);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of sc.tiles) {
    if (t.cx < x0) x0 = t.cx; if (t.cx > x1) x1 = t.cx;
    if (t.cy < y0) y0 = t.cy; if (t.cy > y1) y1 = t.cy;
  }
  const proj = sc.tiles.map((t) => (t.cx - x0) * gx + (t.cy - y0) * gy);
  const len = Math.abs((x1 - x0) * gx) + Math.abs((y1 - y0) * gy) || 1;
  const expect = sc.tiles.map((_, i) => Math.max(0, Math.min(255, Math.round(Math.min(1, Math.max(0, proj[i] / len)) * 255))));
  let eq = true;
  for (let i = 0; i < expect.length; i++) if (expect[i] !== sc.lutIdx[i]) { eq = false; break; }
  check('sweep matches projection formula', eq);
  const distinct = new Set(sc.lutIdx).size;
  check('sweep uses many levels', distinct > 32, distinct);
}

/* ---- bands: quantized subset of sweep ---- */
{
  const sc = polyScene();
  R.colorize(sc, { ...BASE, paletteRef: palRef, colorMap: 'sweep' });
  const sweepIdx = sc.lutIdx.slice();
  R.colorize(sc, { ...BASE, paletteRef: palRef, colorMap: 'bands', gradBands: 5 });
  const allowed = new Set([0, 1, 2, 3, 4].map((k) => Math.round(k / 4 * 255)));
  const inSet = sc.lutIdx.every((v) => allowed.has(v));
  check('bands indices in quantized set', inSet, [...new Set(sc.lutIdx)].sort((a, b) => a - b).join(','));
  check('bands uses exactly 5 levels', new Set(sc.lutIdx).size === 5, new Set(sc.lutIdx).size);
  // bands must be a staircase of sweep: ordering tiles by the true sweep
  // projection must give non-decreasing sweepIdx
  {
    const th = 0, gx = Math.cos(th + Math.PI / 6), gy = Math.sin(th + Math.PI / 6);
    let bx0 = Infinity, by0 = Infinity;
    for (const t of sc.tiles) { if (t.cx < bx0) bx0 = t.cx; if (t.cy < by0) by0 = t.cy; }
    const order = sc.tiles.map((t, i) => [(t.cx - bx0) * gx + (t.cy - by0) * gy, sweepIdx[i]])
      .sort((a, b) => a[0] - b[0]);
    let mono = true, last = -1;
    for (const [, v] of order) { if (v < last) { mono = false; break; } last = v; }
    check('sweep non-decreasing along projection axis', mono);
  }
}

/* ---- checker: two distinct values by cell parity ---- */
{
  const sc = polyScene();
  R.colorize(sc, { ...BASE, paletteRef: palRef, colorMap: 'checker' });
  const vals = new Set(sc.lutIdx);
  check('checker has 2 values', vals.size === 2, [...vals].join(','));
  check('checker values are parity pair', vals.has(Math.round(0.08 * 255)) && vals.has(Math.round(0.85 * 255)));
}

/* ---- random: deterministic per seed, varies across seeds ---- */
{
  const sc = polyScene();
  R.colorize(sc, { ...BASE, paletteRef: palRef, colorMap: 'random', seed: 42 });
  const a = sc.lutIdx.slice();
  R.colorize(sc, { ...BASE, paletteRef: palRef, colorMap: 'random', seed: 42 });
  let same = a.length === sc.lutIdx.length;
  if (same) for (let i = 0; i < a.length; i++) if (a[i] !== sc.lutIdx[i]) { same = false; break; }
  check('random deterministic per seed', same);
  R.colorize(sc, { ...BASE, paletteRef: palRef, colorMap: 'random', seed: 43 });
  let diff = false;
  for (let i = 0; i < a.length; i++) if (a[i] !== sc.lutIdx[i]) { diff = true; break; }
  check('random differs across seeds', diff);
}

/* ---- kind / orientation on poly scenes ---- */
{
  const sc = polyScene();
  R.colorize(sc, { ...BASE, paletteRef: palRef, colorMap: 'kind' });
  const kindVals = new Set(sc.tiles.map((t) => t.k));
  check('kind map present', kindVals.size >= 1, `${kindVals.size} kinds`);
  R.colorize(sc, { ...BASE, paletteRef: palRef, colorMap: 'orientation' });
  check('orientation map ok', sc.lutIdx instanceof Uint8Array && sc.lutIdx.length === sc.tiles.length);
}

/* ---- hat maps ---- */
{
  const sc = hatScene();
  R.colorize(sc, { ...BASE, family: 'hat', paletteRef: palRef, colorMap: 'supertile' });
  const nClasses = new Set(sc.hats.map((h) => h.cls)).size;
  const nVals = new Set(sc.lutIdx).size;
  check('hat supertile classes visible', nVals >= Math.min(nClasses, 2) && nVals <= 6, `${nVals} vals, ${nClasses} classes`);
  R.colorize(sc, { ...BASE, family: 'hat', paletteRef: palRef, colorMap: 'mirror' });
  const mv = new Set(sc.lutIdx);
  check('hat mirror split = 2 values', mv.size === 2, [...mv].join(','));
  R.colorize(sc, { ...BASE, family: 'hat', paletteRef: palRef, colorMap: 'sweep' });
  check('hat sweep ok', new Set(sc.lutIdx).size > 16);
  R.colorize(sc, { ...BASE, family: 'hat', paletteRef: palRef, colorMap: 'checker' });
  check('hat checker ok', new Set(sc.lutIdx).size === 2);
  // legacy alias
  R.colorize(sc, { ...BASE, family: 'hat', paletteRef: palRef, colorMap: 'gradient' });
  check('legacy gradient alias = sweep', new Set(sc.lutIdx).size > 16);
}

/* ---- LUT builders ---- */
{
  const lut = R.buildLut(palRef);
  check('palette LUT 256 entries', lut.length === 256 && lut.every((c) => /^#[0-9a-f]{6}$/i.test(c)));
  const g = GR.normalize(GR.BUILTINS[0]);
  const glut = R.buildLut({ _isGradient: true, gradient: g });
  check('gradient LUT endpoints = first/last stop', glut[0] === g.stops[0].color && glut[255] === g.stops[g.stops.length - 1].color);
  const dlut = R.buildLut({ _isGradient: true, gradient: GR.normalize({ type: 'linear', angle: 0, stops: [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }] }) });
  check('duotone LUT endpoints A/B', dlut[0] === '#000000' && dlut[255] === '#ffffff');
  check('duotone LUT midpoint ~ 50% grey', dlut[128] === '#808080' || dlut[127] === '#7f7f7f' || dlut[128] === '#7f7f7f', dlut[128]);
}

/* ---- palette cycling still works (regression) ---- */
{
  const pal = PAL.get(palRef);
  const lut = R.buildLut(palRef);
  check('palette LUT starts near first color', lut[0] === pal.colors[0].toLowerCase());
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
