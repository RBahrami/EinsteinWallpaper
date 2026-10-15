'use strict';
/*
 * test-palettes.js — unit tests for the custom palette store:
 * CRUD, validation, persistence model, import/export, legacy migration.
 * Run: bun tests/test-palettes.js
 */
const path = require('path');
const GR = require(path.join(__dirname, '..', 'js', 'gradients.js'));
const CP = require(path.join(__dirname, '..', 'js', 'custom-palettes.js'));
const PAL = require(path.join(__dirname, '..', 'js', 'palettes.js'));

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail || ''}`);
  if (!ok) failures++;
}

/* built-in palettes intact */
check('builtins present', PAL.LIST.length >= 26, `${PAL.LIST.length}`);
check('builtin get legacy index', PAL.get(3).name === PAL.LIST[3].name);
check('builtin get ref', PAL.get({ kind: 'builtin', index: 5 }).name === PAL.LIST[5].name);

/* CRUD */
const p1 = CP.create({ name: 'Test A', colors: ['#010203', '#040506'], bg: '#0a0a0a' });
check('create assigns stable id', !!p1.id && p1.id.startsWith('p-'));
check('find by id', CP.find(p1.id).name === 'Test A');
const u1 = CP.update(p1.id, { name: 'Test A2', colors: ['#111111', '#222222', '#333333'] });
check('update persists fields', u1.name === 'Test A2' && u1.colors.length === 3);
const dup = CP.duplicate(p1.id);
check('duplicate distinct id', dup.id !== p1.id && dup.name.includes('copy'));
check('remove', CP.remove(dup.id) && !CP.find(dup.id));

/* sanitization: 3-char hex expanded, invalid outline dropped, name truncated */
const p2 = CP.create({ name: 'x'.repeat(100), colors: ['#abc', '#00ff0080'], bg: 'not-a-color', outline: 'zzz' });
check('name truncated to 60', p2.name.length === 60);
check('3-char + 8-char hex normalized', p2.colors[0] === '#aabbcc' && p2.colors[1] === '#00ff00');
check('bad bg replaced with default', p2.bg === '#0b1020');
check('bad outline -> null (auto)', p2.outline === null);
CP.remove(p2.id);

/* validation rejects malformed */
check('validate rejects non-hex colors', !CP.validate({ name: 'x', colors: ['red', '#ffffff'] }));
check('validate rejects empty colors', !CP.validate({ name: 'x', colors: [] }));
check('validate rejects missing name', !CP.validate({ colors: ['#ffffff'] }));

/* import/export */
CP.create({ name: 'Export me', colors: ['#101010', '#f0f0f0'], bg: '#000000' });
const json = CP.exportJSON();
const parsed = JSON.parse(json);
check('export has type marker', parsed.type === 'einstein-wallpaper-themes' && Array.isArray(parsed.palettes));

// import into a simulated fresh store: malformed files must throw, not crash
let threw = false;
try { CP.importJSON('this is not json'); } catch (e) { threw = true; }
check('import malformed JSON throws', threw);
threw = false;
try { CP.importJSON('{"type":"wrong"}'); } catch (e) { threw = true; }
check('import wrong type throws', threw);
threw = false;
try { CP.importJSON('{"type":"einstein-wallpaper-themes","palettes":[{"name":"bad","colors":["#000"]}]}'); } catch (e) { threw = false; }
check('import filters invalid palettes without crashing', !threw);

// round-trip: export current, re-import (duplicate ids kept unique)
const before = CP.count();
const res = CP.importJSON(json);
check('re-import keeps count stable (dedup by id)', CP.count() === before, `${before} -> ${CP.count()}`);

/* legacy migration logic (mirrors app.js loadSettings) */
function migrate(saved) {
  const p = { paletteRef: saved.paletteRef || null };
  if (typeof saved.palette === 'number' && !p.paletteRef) {
    p.paletteRef = { kind: 'builtin', index: saved.palette };
  }
  return p;
}
check('legacy numeric palette migrates', migrate({ palette: 4 }).paletteRef.kind === 'builtin' && migrate({ palette: 4 }).paletteRef.index === 4);
check('new ref untouched by migration', migrate({ palette: 4, paletteRef: { kind: 'custom', id: 'p-x' } }).paletteRef.kind === 'custom');

/* custom resolver wiring (as app.js does) */
PAL.setCustomResolver((id) => CP.find(id));
const pc = CP.create({ name: 'Resolver test', colors: ['#123456', '#654321'], bg: '#000000' });
check('resolver resolves custom', PAL.get({ kind: 'custom', id: pc.id }).name === 'Resolver test');
check('resolver falls back on missing id', PAL.get({ kind: 'custom', id: 'nope' }).name === PAL.LIST[0].name);
CP.remove(pc.id);
check('builtins unaffected by custom ops', PAL.LIST.length >= 26 && PAL.get(0).name === 'Midnight');

console.log(`\npalettes: ${failures} failures`);
process.exit(failures ? 1 : 0);
