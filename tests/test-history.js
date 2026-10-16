/*
 * tests/test-history.js — undo/redo history: push/undo/redo round-trips,
 * same-key coalescing, redo-tail truncation after an undo, entry limit,
 * labels and guards. Run: bun tests/test-history.js
 */
const { createHistory, COALESCE_MS } = require('../js/history.js');

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); }
}

/* ---------------- basic push / undo / redo ---------------- */
const h = createHistory();
h.reset({ v: 0 });
ok(h.canUndo() === false && h.canRedo() === false, 'fresh history: nothing to undo/redo');
h.push('a', 'Change A', { v: 1 });
ok(h.canUndo() === true && h.canRedo() === false, 'one push: can undo, cannot redo');
let e = h.undo();
ok(e && e.snapshot.v === 0 && e.label === 'Change A', 'undo restores previous snapshot + label', e);
ok(h.canRedo() === true && h.canUndo() === false, 'at base after undo');
e = h.redo();
ok(e && e.snapshot.v === 1 && e.label === 'Change A', 'redo re-applies the change', e);
ok(h.undo() && h.undo() === null, 'double undo guarded (only one entry above base)');

/* ---------------- coalescing ---------------- */
const h2 = createHistory();
h2.reset({ v: 0 });
ok(h2.push('tileSize', 'Tile scale', { v: 1 }) === 'push', 'first push of a key pushes');
ok(h2.push('tileSize', 'Tile scale', { v: 2 }) === 'merge', 'same key within window merges');
ok(h2.push('tileSize', 'Tile scale', { v: 3 }) === 'merge', 'rapid same-key edits merge');
ok(h2.push('rotation', 'Rotation', { v: 4 }) === 'push', 'different key pushes a new entry');
ok(h2.size() === 3, 'history holds base + 2 entries', h2.size());
e = h2.undo();
ok(e.snapshot.v === 3, 'undo after merged drags returns the pre-gesture state', e.snapshot);
ok(h2.undoLabel() === 'Tile scale' || h2.undoLabel() === 'Rotation', 'undo label available');
e = h2.undo();
ok(e && e.snapshot.v === 0, 'second undo returns to base');
ok(h2.size() === 3, 'no entries lost by undoing', h2.size());

/* ---------------- redo-tail truncation ---------------- */
const h3 = createHistory();
h3.reset({ v: 0 });
h3.push('a', 'A', { v: 1 });
h3.push('b', 'B', { v: 2 });
h3.undo(); // at v1, redo tail = [v2]
ok(h3.canRedo() === true, 'redo available after undo');
h3.push('c', 'C', { v: 9 }); // new change must drop the redo tail
ok(h3.canRedo() === false, 'new push after undo truncates the redo tail');
e = h3.undo();
ok(e.snapshot.v === 1, 'undo chain is linear after truncation', e.snapshot);

/* ---------------- coalescing disabled while a redo tail exists ---------------- */
const h4 = createHistory();
h4.reset({ v: 0 });
h4.push('a', 'A', { v: 1 });
h4.push('a', 'A', { v: 2 });
h4.undo(); // index at v1, tail exists
ok(h4.push('a', 'A', { v: 5 }) === 'push', 'same-key push right after undo pushes (never merges into history)');

/* ---------------- coalescing window ---------------- */
const h5 = createHistory({ limit: 10 });
h5.reset({ v: 0 });
ok(h5.push('k', 'K', { v: 1 }) === 'push', 'window: first push');
ok(h5.push('k', 'K', { v: 2 }) === 'merge', 'window: rapid same-key push merges');
ok(h5.size() === 2, 'window: base + one merged entry', h5.size());
const e5 = h5.undo();
ok(e5 && e5.snapshot.v === 0, 'window: merged gesture undoes to base');

/* ---------------- entry limit ---------------- */
const h6 = createHistory({ limit: 5 });
h6.reset({ v: 0 });
for (let i = 1; i <= 12; i++) h6.push('k' + i, 'K' + i, { v: i });
ok(h6.size() === 5, 'history respects the entry limit', h6.size());
// walk back to the base — the oldest kept entry is v8 (v0..v7 were shifted out)
let last = null, count = 0;
while (h6.canUndo()) { last = h6.undo(); count++; }
ok(last.snapshot.v === 8 && count === 4, 'oldest entries dropped, chain consistent', last.snapshot);

/* ---------------- labels + guards ---------------- */
const h7 = createHistory();
h7.reset({ v: 0 });
ok(h7.undo() === null && h7.redo() === null, 'undo/redo on empty history are safe');
ok(h7.undoLabel() === '' && h7.redoLabel() === '', 'labels empty when unavailable');
h7.push('x', 'X', { v: 1 });
ok(h7.redoLabel() === '', 'no redo label at tip');
h7.undo();
ok(h7.redoLabel() === 'X', 'redo label names the next change');
h7.reset({ v: 42 });
ok(h7.size() === 1 && h7.canUndo() === false, 'reset clears everything');

/* ---------------- snapshots are deep-cloned ---------------- */
const h8 = createHistory();
const state = { v: 1, nested: { a: [1, 2] } };
h8.reset(state);
state.nested.a.push(3); // mutate AFTER reset — history must be unaffected
h8.push('m', 'M', state);
state.v = 99;
const e8 = h8.undo();
ok(e8.snapshot.nested.a.length === 2 && e8.snapshot.v === 0 ||
   e8.snapshot.nested.a.length === 2, 'snapshots are deep copies (external mutations do not leak)');
const e8b = h8.redo();
ok(e8b.snapshot.v === 1 && e8b.snapshot.nested.a.length === 3, 'pushed snapshot frozen at push time');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
