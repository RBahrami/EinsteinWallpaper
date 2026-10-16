/*
 * tests/test-layers.js — layer model: factories, protection, duplication,
 * reordering, v1 migration, sanitizer and export-loop planning.
 * Run: bun tests/test-layers.js
 */
const L = require('../js/layers.js');

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); }
}

/* ---------------- factories ---------------- */
const bg = L.createBackground();
ok(bg.type === 'background' && bg.name === 'Background' && bg.visible === true && bg.opacity === 100,
  'createBackground defaults', bg);
ok(bg.bg.source === 'solid' && bg.bg.color === '#0b1020', 'background default fill', bg.bg);
const bg2 = L.createBackground();
ok(bg.id !== bg2.id, 'background ids unique');
const bgCfg = L.createBackground({ bg: { source: 'gradient', gradientId: 'bi-abyss', color: '#ffffff' }, opacity: 70 });
ok(bgCfg.bg.source === 'gradient' && bgCfg.bg.gradientId === 'bi-abyss' && bgCfg.opacity === 70,
  'createBackground accepts config', bgCfg.bg);
ok(L.createBackground({ bg: { source: 'nonsense' } }).bg.source === 'solid', 'invalid bg source rejected');

const pat = L.createPattern({ name: '  Waves  ' });
ok(pat.type === 'pattern' && pat.name === 'Waves' && pat.opacity === 100, 'createPattern defaults', pat.name);
ok(pat.theme.mode === 'palette' && pat.theme.paletteRef.kind === 'builtin' && pat.animation === 'shimmer',
  'pattern default theme/animation', pat.theme);
ok(L.createPattern({ theme: { mode: 'bogus' } }).theme.mode === 'palette', 'invalid theme mode rejected');
ok(L.createPattern({ tileSize: 9999, rotation: -50, seed: 0 }).tileSize === 400 &&
   L.createPattern({ rotation: -50 }).rotation === 0 &&
   L.createPattern({ seed: 0 }).seed === 1, 'numeric clamping (seed 0 clamps into range)');
ok(L.createPattern({ opacity: -5 }).opacity === 0 && L.createPattern({ opacity: 300 }).opacity === 100,
  'opacity clamped to 0..100');
ok(L.createPattern({ effects: { glow: 500, vignetteMode: 'light' } }).effects.vignetteMode === 'light',
  'effects sanitized', L.createPattern({ effects: { glow: 500 } }).effects);

/* ---------------- default project ---------------- */
const proj = L.defaultProject();
ok(proj.version === 2 && proj.layers.length === 2, 'default project has 2 layers', proj.layers.length);
ok(proj.layers[0].type === 'background' && proj.layers[1].type === 'pattern',
  'background is at the bottom of the stack');
ok(proj.selected === proj.layers[1].id, 'a pattern layer is selected by default');

/* ---------------- duplication ---------------- */
const src = proj.layers[1];
src.theme.singleColor = '#123456';
src.tileSize = 55;
src.effects.glow = 40;
const dup = L.duplicateLayer(src);
ok(dup && dup.id !== src.id, 'duplicate assigns a new id');
ok(dup.tileSize === 55 && dup.theme.singleColor === '#123456' && dup.effects.glow === 40,
  'duplicate copies all settings');
dup.tileSize = 99; dup.theme.singleColor = '#abcdef';
ok(src.tileSize === 55 && src.theme.singleColor === '#123456', 'duplicate is a deep copy');
ok(dup.name.indexOf('copy') >= 0, 'duplicate name marked as copy', dup.name);
ok(L.duplicateLayer(proj.layers[0]) === null, 'background cannot be duplicated');

/* ---------------- delete / move protection ---------------- */
ok(L.deleteLayer(proj, proj.layers[0].id) === false, 'background cannot be deleted');
ok(L.deleteLayer(proj, src.id) === true && proj.layers.length === 1, 'pattern layer deleted');
proj.layers.push(dup);
ok(L.moveLayer(proj, proj.layers[0].id, 1) === false, 'background cannot be moved down');
ok(L.moveLayer(proj, proj.layers[0].id, -1) === false, 'background cannot be moved up');
// stack: [bg, dup]; move dup up -> no-op (nothing above)
ok(L.moveLayer(proj, dup.id, 1) === false, 'top layer cannot move up');
// add another and reorder
const p3 = L.createPattern({ name: 'Third' });
proj.layers.push(p3);
ok(L.moveLayer(proj, p3.id, -1) === true && proj.layers[1] === p3,
  'pattern layer moved down (swap with neighbour)');
ok(proj.layers[0].type === 'background', 'background still first after reorder');
ok(L.moveLayer(proj, 'nonexistent', -1) === false, 'moving unknown id is a no-op');

/* ---------------- v1 migration ---------------- */
const v1 = {
  aspect: '16:10', orientation: 'landscape', resW: 1680, resH: 1050,
  family: 'hat', variant: 'P', tileSize: 40, rotation: 45, gap: 0.03, outlineWidth: 1.5,
  themeMode: 'palette', colorMap: 'supertile', gradMap: 'sweep', gradBands: 6, duoMap: 'checker',
  singleColor: '#111111', duoA: '#222222', duoB: '#333333',
  paletteRef: { kind: 'builtin', index: 3 }, gradientId: null,
  bgSource: 'theme', bgColor: '#0b1020', fgAlpha: 62,
  lineAuto: true, lineColor: '#101014',
  animation: 'flow', animSpeed: 1.5, flowAngle: 90,
  effects: { blur: 2, glow: 30, glowRadius: 20, shadow: 0, shadowSoft: 14, shadowOff: 8, grain: 10, vignette: 25, vignetteMode: 'dark' },
  seed: 42,
};
const m = L.migrateV1(v1);
ok(m.version === 2 && m.layers.length === 2, 'migration produces a v2 project');
ok(m.layers[0].type === 'background' && m.layers[1].type === 'pattern', 'migrated stack order');
ok(m.layers[0].bg.source === 'palette' &&
   m.layers[0].bg.paletteRef.index === 3, 'v1 theme background -> explicit bg palette ref', m.layers[0].bg);
ok(m.layers[1].opacity === 62, 'v1 fgAlpha -> pattern layer opacity', m.layers[1].opacity);
ok(m.layers[1].family === 'hat' && m.layers[1].variant === 'P' && m.layers[1].tileSize === 40 &&
   m.layers[1].rotation === 45 && m.layers[1].gap === 0.03 && m.layers[1].seed === 42,
  'tiling settings migrated', m.layers[1]);
ok(m.layers[1].theme.mode === 'palette' && m.layers[1].theme.paletteRef.index === 3 &&
   m.layers[1].theme.colorMap === 'supertile', 'color theme migrated', m.layers[1].theme);
ok(m.layers[1].animation === 'flow' && m.layers[1].animSpeed === 1.5 && m.layers[1].flowAngle === 90,
  'animation migrated');
ok(m.layers[1].effects.glow === 30 && m.layers[1].effects.grain === 10, 'effects migrated');
ok(m.aspect === '16:10' && m.resW === 1680 && m.resH === 1050, 'global canvas settings migrated');

// gradient background migration
const m2 = L.migrateV1(Object.assign({}, v1, { bgSource: 'gradient', gradientId: 'bi-solar' }));
ok(m2.layers[0].bg.source === 'gradient' && m2.layers[0].bg.gradientId === 'bi-solar',
  'v1 gradient background -> background layer gradient', m2.layers[0].bg);
// solid background migration (single mode)
const m3 = L.migrateV1(Object.assign({}, v1, {
  themeMode: 'single', bgSource: 'custom', bgColor: '#244824',
}));
ok(m3.layers[0].bg.source === 'solid' && m3.layers[0].bg.color === '#244824',
  'v1 solid background -> background layer color', m3.layers[0].bg);
// legacy numeric palette + missing fields
const m4 = L.migrateV1({ family: 'hexagons', palette: 5, colorMode: 'checker' });
ok(m4.layers[1].theme.paletteRef.index === 5, 'legacy numeric palette ref migrated');
ok(m4.layers[1].opacity === 100, 'missing fgAlpha migrates to 100');

/* ---------------- sanitizer ---------------- */
ok(JSON.stringify(L.sanitizeProject(null)) === JSON.stringify(L.defaultProject()) ||
   L.sanitizeProject(null).layers.length === 2, 'sanitize(null) -> default project');
const v1copy = JSON.parse(JSON.stringify(v1));
const mv = L.sanitizeProject(v1copy);
ok(mv.version === 2 && mv.layers[1].opacity === 62, 'sanitizer routes v1 blobs through migration');

const broken = {
  version: 2, aspect: '1:1', orientation: 'portrait', resW: 99999, resH: 10,
  selected: 'missing-id',
  layers: [
    { type: 'pattern', name: 'A', opacity: -20, theme: { mode: 'nope' } }, // bg missing
    { type: 'background' },
    { type: 'background' },                      // duplicate bg dropped
    { type: 'pattern', name: 'B', id: 'same' },
    { type: 'pattern', name: 'C', id: 'same' },  // duplicate id fixed
    { type: 'unknown' },                          // dropped
  ],
};
const fixed = L.sanitizeProject(broken);
ok(fixed.version === 2 && fixed.resW === 8192 && fixed.resH === 64, 'global dims clamped', [fixed.resW, fixed.resH]);
ok(fixed.layers[0].type === 'background', 'background forced to the bottom');
const fBgs = fixed.layers.filter((l) => l.type === 'background');
ok(fBgs.length === 1, 'exactly one background layer');
const pats = fixed.layers.filter((l) => l.type === 'pattern');
ok(pats.length === 3, 'three valid pattern layers kept', pats.length);
ok(pats[0].opacity === 0, 'negative opacity clamped', pats[0].opacity);
ok(pats[0].theme.mode === 'palette', 'invalid theme mode repaired');
const ids = new Set(fixed.layers.map((l) => l.id));
ok(ids.size === fixed.layers.length, 'layer ids made unique');
ok(!!L.findLayer(fixed, fixed.selected) && L.findLayer(fixed, fixed.selected).type === 'pattern',
  'selection falls back to a pattern layer');
ok(fixed.orientation === 'portrait' && fixed.aspect === '1:1', 'valid globals preserved');

// MAX_PATTERN_LAYERS enforced
const many = { version: 2, layers: [{ type: 'background' }] };
for (let i = 0; i < 12; i++) many.layers.push({ type: 'pattern', name: 'P' + i });
const trimmed = L.sanitizeProject(many);
ok(trimmed.layers.length === 1 + L.MAX_PATTERN_LAYERS, 'pattern layer cap enforced', trimmed.layers.length);

/* ---------------- planLoop ---------------- */
const one = L.planLoop([8333]);
ok(one.frames > 1 && Math.abs(one.frames * one.delayCs * 10 - 8333) <= 15,
  'single period: loop lands on true period', one);
ok(one.warps[0] === 1, 'single period: warp is 1');
const multi = L.planLoop([2000, 8333, 0]);
ok(multi.T === 8333, 'slowest period defines the loop', multi.T);
// every animated layer completes an integer number of cycles within T
const multiP = [2000, 8333];
for (let i = 0; i < multiP.length; i++) {
  const tEnd = multi.warps[i] * multi.T;
  const cycles = tEnd / multiP[i];
  ok(Math.abs(cycles - Math.round(cycles)) < 1e-9, `layer ${i} loop-aligned (warp seamlessness)`, cycles);
}
ok(multi.warps[2] === 1, 'static layer warp irrelevant');
const slow = L.planLoop([40000, 20000]);
ok(slow.compressed < 1 && slow.T <= 15000, 'very long loop time-compressed', slow);
const tEnd = slow.warps[0] * slow.T;
ok(Math.abs(tEnd / 40000 - Math.round(tEnd / 40000)) < 1e-9, 'compressed loop stays seamless');
ok(L.planLoop([0, 0]).frames === 1, 'no animation -> single frame');
const fCap = L.planLoop([100]); // tiny period: frames capped in 2..200
ok(fCap.frames >= 2 && fCap.frames <= 200, 'frame count within caps', fCap);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
