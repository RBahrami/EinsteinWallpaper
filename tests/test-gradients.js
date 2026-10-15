'use strict';
/*
 * test-gradients.js — unit tests for the gradient engine.
 * Run: bun tests/test-gradients.js
 */
const path = require('path');
const GR = require(path.join(__dirname, '..', 'js', 'gradients.js'));

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail || ''}`);
  if (!ok) failures++;
}

/* stop interpolation */
const g = GR.normalize({
  id: 't', name: 'T', type: 'linear', angle: 0,
  stops: [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }],
});
check('sample endpoints', GR.sample(g, 0) === '#000000' && GR.sample(g, 1) === '#ffffff');
check('sample midpoint', GR.sample(g, 0.5) === '#808080', GR.sample(g, 0.5));
check('sample clamps', GR.sample(g, -0.5) === '#000000' && GR.sample(g, 1.5) === '#ffffff');

const g3 = GR.normalize({
  stops: [{ pos: 0, color: '#000000' }, { pos: 0.5, color: '#ff0000' }, { pos: 1, color: '#000000' }],
});
check('3-stop midpoint', GR.sample(g3, 0.5) === '#ff0000', GR.sample(g3, 0.5));
check('3-stop quarter', GR.sample(g3, 0.25) === '#800000' || GR.sample(g3, 0.25) === '#7f0000', GR.sample(g3, 0.25));

/* unsorted stops get sorted; out-of-range positions clamped */
const gu = GR.normalize({
  stops: [{ pos: 0.8, color: '#000000' }, { pos: 0.2, color: '#ffffff' }, { pos: 5, color: '#123456' }, { pos: -3, color: '#654321' }],
});
check('stops sorted', gu.stops[0].pos === 0 && gu.stops[gu.stops.length - 1].pos === 1,
  JSON.stringify(gu.stops.map((s) => s.pos)));
check('clamped colors valid', gu.stops.every((s) => GR.isHexColor(s.color)));

/* malformed colors rejected by validate */
check('validate rejects bad hex', !GR.validate({ name: 'x', type: 'linear', stops: [{ pos: 0, color: 'nope' }, { pos: 1, color: '#ffffff' }] }));
check('validate rejects 1 stop', !GR.validate({ name: 'x', type: 'linear', stops: [{ pos: 0, color: '#ffffff' }] }));
check('validate accepts 3-char hex', GR.validate({ name: 'x', type: 'linear', stops: [{ pos: 0, color: '#fff' }, { pos: 1, color: '#000' }] }));

/* normalization: single stop duplicated, invalid type -> linear */
const g1 = GR.normalize({ stops: [{ pos: 0.3, color: '#123456' }], type: 'banana' });
check('single stop duplicated', g1.stops.length === 2 && g1.type === 'linear');

/* LUT: 256 entries, endpoints */
const lut = GR.makeLut(g);
check('lut length', lut.length === 256 && lut[0] === '#000000' && lut[255] === '#ffffff');

/* hex helpers */
check('hex roundtrip', GR.rgbToHex(...GR.hexToRgb('#AbCdEf')) === '#abcdef');
check('3-char hex expand', GR.normHex('#F0a') === '#ff00aa');
check('8-char hex alpha dropped', GR.normHex('#11223344') === '#112233');
check('isHexColor rejects rgb()', !GR.isHexColor('rgb(1,2,3)'));

/* custom save/find/remove (uses no localStorage in Node -> memory only) */
const saved = GR.save({ name: 'Test custom', type: 'radial', angle: 40, stops: [{ pos: 0, color: '#111111' }, { pos: 1, color: '#eeeeee' }] });
check('save assigns id', !!saved.id && saved.id.startsWith('g-'));
check('find custom', !!GR.find(saved.id));
const again = GR.save({ ...saved, name: 'Test custom 2' });
check('save updates same id', again.id === saved.id && GR.find(saved.id).name === 'Test custom 2');
check('remove custom', GR.remove(saved.id) && !GR.find(saved.id));
check('remove builtin rejected', !GR.remove(GR.BUILTINS[0].id));

/* builtins valid */
check('builtins valid', GR.BUILTINS.every((g) => GR.validate(g)), `${GR.BUILTINS.length} builtins`);

console.log(`\ngradients: ${failures} failures`);
process.exit(failures ? 1 : 0);
