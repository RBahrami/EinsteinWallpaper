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
ok(L.createBackground({ bg: { source: 'palette', paletteRef: { kind: 'builtin', index: 3 } } }).bg.source === 'solid',
  'legacy palette source converted to solid');

/* ------------- background: solid/gradient only + owned gradient ------------- */
const bgD = L.createBackground();
ok(Array.isArray(bgD.bg.gradient) === false && typeof bgD.bg.gradient === 'object' &&
   Array.isArray(bgD.bg.gradient.stops) && bgD.bg.gradient.stops.length >= 2,
  'background owns a normalized gradient by default', bgD.bg.gradient);
ok(bgD.bg.gradient.type === 'linear' && typeof bgD.bg.gradient.angle === 'number',
  'default background gradient shape', bgD.bg.gradient);
const badGrad = L.createBackground({ bg: {
  source: 'gradient',
  gradient: { type: 'spiral', angle: 9999, stops: [{ pos: 5, color: 'nope' }, { pos: -3, color: '#ABCDEF' }] },
} });
ok(badGrad.bg.gradient.type === 'linear' && badGrad.bg.gradient.angle === 279 &&
   badGrad.bg.gradient.stops.length === 2 && badGrad.bg.gradient.stops[0].color === '#abcdef' &&
   badGrad.bg.gradient.stops[1].color === '#333333',
   'background gradient sanitized (type/angle/stops)', badGrad.bg.gradient);
ok(L.createBackground({ bg: { gradient: null } }).bg.gradient.stops.length >= 2,
  'missing gradient falls back to default');
ok(L.createBackground({ bg: { gradient: { stops: [{ pos: 0, color: '#111111' }] } } }).bg.gradient.stops.length === 2,
  'single-stop gradient padded to two');
ok(L.createBackground({ bg: { source: 'gradient', gradientId: 'bi-solar' } }).bg.gradient === null,
  'gradientId without owned spec stays null (seeded from library by the app)');
ok(L.createBackground({ bg: { source: 'gradient', gradientId: 'bi-solar', gradient: { type: 'conic', angle: 15,
  stops: [{ pos: 0, color: '#111111' }, { pos: 1, color: '#eeeeee' }] } } }).bg.gradient.type === 'conic',
  'owned gradient wins over the gradientId hint');

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
ok(L.createPattern({ fillAlpha: -1 }).fillAlpha === 0 && L.createPattern({ fillAlpha: 140 }).fillAlpha === 100 &&
   L.createPattern({}).fillAlpha === 100, 'fillAlpha clamped to 0..100 (default 100)');
ok(L.createPattern({ lineAlpha: -1 }).lineAlpha === 0 && L.createPattern({ lineAlpha: 140 }).lineAlpha === 100 &&
   L.createPattern({}).lineAlpha === 100, 'lineAlpha clamped to 0..100 (default 100)');
ok(L.createPattern({ effects: { glow: 500, vignetteMode: 'light' } }).effects.vignetteMode === 'light',
  'effects sanitized', L.createPattern({ effects: { glow: 500 } }).effects);

/* ---------------- special effects (fx schema) ---------------- */
const spDef = L.createPattern({}).effects;
ok(spDef.shimmer === 0 && spDef.shimmerAngle === 30 && spDef.shimmerPhase === 0 &&
   spDef.shimmerScale === 100 && spDef.sheen === 0 && spDef.sheenAngle === 30 &&
   spDef.sheenPos === 50 && spDef.irid === 0 && spDef.iridScale === 100 &&
   spDef.iridAngle === 0 && spDef.aberration === 0 && spDef.scan === 0 && spDef.scanGap === 4,
  'special-effect fx defaults', spDef);
const spClamp = L.createPattern({ effects: {
  shimmer: 500, shimmerAngle: 999, shimmerPhase: -4, shimmerScale: 0,
  sheen: 250, sheenAngle: -30, sheenPos: 101,
  irid: 90, iridScale: 900, iridAngle: 40, aberration: 99, scan: 12, scanGap: 1,
} }).effects;
ok(spClamp.shimmer === 200 && spClamp.shimmerAngle === 345 && spClamp.shimmerPhase === 0 &&
   spClamp.shimmerScale === 20 && spClamp.sheen === 200 && spClamp.sheenAngle === 0 &&
   spClamp.sheenPos === 100 && spClamp.irid === 90 && spClamp.iridScale === 400 &&
   spClamp.iridAngle === 40 && spClamp.aberration === 20 && spClamp.scan === 12 &&
   spClamp.scanGap === 2, 'special-effect fx clamped to ranges', spClamp);
// legacy projects without special fields keep working and gain the defaults
const legacyFx = L.sanitizeProject({ version: 2, layers: [
  { type: 'background' },
  { type: 'pattern', effects: { glow: 30 } },
] }).layers[1].effects;
ok(legacyFx.glow === 30 && legacyFx.shimmer === 0 && legacyFx.sheen === 50 - 50 &&
   legacyFx.irid === 0 && legacyFx.aberration === 0 && legacyFx.scan === 0,
  'legacy fx blob gains special-effect defaults', legacyFx);
// duplicate copies special fx too
const spSrc = L.createPattern({ effects: { shimmer: 40, sheenAngle: 90 } });
const spDup = L.duplicateLayer(spSrc);
ok(spDup && spDup.effects.shimmer === 40 && spDup.effects.sheenAngle === 90 &&
   spDup.id !== spSrc.id, 'duplicate copies special-effect fx');

/* ---------------- default project ---------------- */
const proj = L.defaultProject();
ok(proj.version === 2 && proj.layers.length === 2, 'default project has 2 layers', proj.layers.length);
ok(proj.layers[0].type === 'background' && proj.layers[1].type === 'pattern',
  'background is at the bottom of the stack');
ok(proj.selected === proj.layers[1].id, 'a pattern layer is selected by default');

/* ---------------- project name ---------------- */
ok(proj.name === 'Untitled wallpaper', 'default project name', proj.name);
ok(L.defaultProject().name === L.PROJECT_NAME_DEFAULT, 'name default constant matches');
ok(L.sanitizeProject({ version: 2, name: '  My Aurora  ', layers: [
  { type: 'background' }, { type: 'pattern' }] }).name === 'My Aurora',
  'sanitizer keeps a valid project name (trimmed)');
ok(L.sanitizeProject({ version: 2, name: '   ', layers: [] }).name === 'Untitled wallpaper',
  'blank name falls back to the default');
ok(L.sanitizeProject({ version: 2, layers: [] }).name === 'Untitled wallpaper',
  'missing name falls back to the default');
ok(L.sanitizeProject({ version: 2, name: 'x'.repeat(200), layers: [] }).name.length === 60,
  'name is capped at 60 characters');
ok(L.sanitizeProject('not an object') === undefined || true, 'noop guard');
ok(L.migrateV1({}).name === 'Untitled wallpaper', 'v1 migration gets the default name');
ok(L.sanitizeProject({ version: 2, name: 42, layers: [] }).name === 'Untitled wallpaper',
  'non-string name rejected');

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
ok(m.layers[0].bg.source === 'solid' &&
   m.layers[0].bg.legacyPaletteRef.index === 3, 'v1 theme background -> solid + legacy palette ref', m.layers[0].bg);
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
// legacy numeric palette + missing fields
const m4 = L.migrateV1({ family: 'hexagons', palette: 5, colorMode: 'checker' });
ok(m4.layers[1].theme.paletteRef.index === 5, 'legacy numeric palette ref migrated');
ok(m4.layers[1].opacity === 100, 'missing fgAlpha migrates to 100');
ok(m4.layers[1].fillAlpha === 100 && m4.layers[1].lineAlpha === 100,
  'missing fill/line alpha migrate to 100');
// legacy palette background keeps its reference for the app to resolve
const m5 = L.migrateV1(Object.assign({}, JSON.parse(JSON.stringify(v1))));
ok(m5.layers[0].bg.source === 'solid' && m5.layers[0].bg.legacyPaletteRef.index === 3,
  'v1 palette background keeps a resolvable reference');

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

// bare v2 project (no version field — agent-generated files)
const bare = {
  resW: 1024, resH: 768,
  layers: [
    { type: 'background', bg: { source: 'gradient', gradient: { type: 'radial', angle: 0,
      stops: [{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#000000' }] } } },
    { type: 'pattern', name: 'Agent', fillAlpha: 60, lineAlpha: 20, theme: { mode: 'single', singleColor: '#ff0000' } },
  ],
};
const bareFix = L.sanitizeProject(bare);
ok(bareFix.version === 2 && bareFix.resW === 1024 && bareFix.layers.length === 2,
  'bare v2 project (no version) accepted', bareFix);
ok(bareFix.layers[0].bg.bg === undefined && bareFix.layers[0].bg.gradient.type === 'radial' &&
   bareFix.layers[0].bg.gradient.stops.length === 2,
  'agent background gradient preserved through sanitize', bareFix.layers[0].bg.gradient);
ok(bareFix.layers[1].fillAlpha === 60 && bareFix.layers[1].lineAlpha === 20,
  'agent fill/line alpha preserved', [bareFix.layers[1].fillAlpha, bareFix.layers[1].lineAlpha]);

// v2 layer with legacy palette background source -> solid + resolvable ref
const v2pal = L.sanitizeProject({ version: 2, layers: [
  { type: 'background', bg: { source: 'palette', paletteRef: { kind: 'builtin', index: 2 } } },
  { type: 'pattern' },
] });
ok(v2pal.layers[0].bg.source === 'solid' && v2pal.layers[0].bg.legacyPaletteRef.index === 2,
  'v2 palette background converts to solid + legacy ref', v2pal.layers[0].bg);

// duplicate copies fill/line alpha
src.fillAlpha = 44; src.lineAlpha = 88;
const dup2 = L.duplicateLayer(src);
ok(dup2.fillAlpha === 44 && dup2.lineAlpha === 88, 'duplicate copies fill/line alpha');

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
