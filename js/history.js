/*
 * history.js — undo/redo history for EinsteinWallpaper.
 *
 * Snapshot-based: the app stores a deep-cloned snapshot of the full project
 * state (project + runtime drafts) after every committed change, keyed by a
 * change id. Rapid edits to the SAME control (slider drags, color pickers,
 * hex typing) are coalesced into one entry so one gesture = one undo step.
 *
 * The model stores the state AFTER each change:
 *   entries[i] = { key, label, time, snapshot }  (state after change i)
 *   index always points at the entry matching the CURRENT state.
 *   undo()  -> restores entries[index-1], reports the label of the change
 *              being undone (entries[index]); index--.
 *   redo()  -> restores entries[index+1] and reports its label; index++.
 * A new push after an undo truncates the redo tail (standard behavior).
 *
 * This module is dependency-free and loads in the browser and in Node/bun.
 */
(function (root) {
  'use strict';

  const COALESCE_MS = 900;   // same-key edits within this window merge
  const DEFAULT_LIMIT = 60;  // max entries (each is a full project snapshot)

  function createHistory(opts) {
    opts = opts || {};
    const LIMIT = Math.max(2, opts.limit || DEFAULT_LIMIT);
    let entries = [];
    let index = -1;

    function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

    /*
     * push(key, label, snapshot) — record the state AFTER a committed change.
     * Returns 'push' (new entry) or 'merge' (coalesced into the last entry).
     * Merging only happens while history is at the tip (no redo tail) and
     * the previous entry has the same key within COALESCE_MS.
     */
    function push(key, label, snapshot) {
      const now = Date.now();
      const last = entries[index];
      if (last && index === entries.length - 1 && last.key === key &&
          (now - last.time) < COALESCE_MS) {
        last.snapshot = clone(snapshot);
        last.time = now;
        return 'merge';
      }
      entries = entries.slice(0, index + 1); // drop the redo tail
      entries.push({ key: String(key), label: String(label || key),
        time: now, snapshot: clone(snapshot) });
      if (entries.length > LIMIT) entries.shift();
      index = entries.length - 1;
      return 'push';
    }

    function undo() {
      if (index <= 0) return null;
      const label = entries[index].label;
      index--;
      return { snapshot: clone(entries[index].snapshot), label };
    }
    function redo() {
      if (index >= entries.length - 1) return null;
      index++;
      return { snapshot: clone(entries[index].snapshot), label: entries[index].label };
    }

    function reset(snapshot) {
      entries = [{ key: 'init', label: 'Initial state',
        time: Date.now(), snapshot: clone(snapshot) }];
      index = 0;
    }

    function canUndo() { return index > 0; }
    function canRedo() { return index < entries.length - 1; }
    function undoLabel() { return canUndo() ? entries[index].label : ''; }
    function redoLabel() { return canRedo() ? entries[index + 1].label : ''; }
    function size() { return entries.length; }

    return { push, undo, redo, reset,
      canUndo, canRedo, undoLabel, redoLabel, size };
  }

  root.History = { createHistory, COALESCE_MS, DEFAULT_LIMIT };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.History;
})(typeof window !== 'undefined' ? window : globalThis);
