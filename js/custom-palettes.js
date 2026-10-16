/*
 * custom-palettes.js — user-defined palette store for EinsteinWallpaper.
 *
 * Custom palette: { id, name, colors: ['#hex', ...], bg: '#hex', outline: '#hex'|null }
 *   outline === null -> automatic outline color (existing behaviour).
 * Built-in palettes stay in palettes.js and are referenced by index:
 *   { kind: 'builtin', index: N }. Custom palettes by stable id:
 *   { kind: 'custom', id: 'p-...' }.
 *
 * Persistence: localStorage 'ew-custom-palettes-v1'.
 * Import/export: JSON files shared with the gradient store (theme files).
 */
(function (root) {
  'use strict';

  const STORE_KEY = 'ew-custom-palettes-v1';
  const GR = root.Gradients;
  const MAX_PALETTES = 200;
  const MAX_COLORS = 64;

  let customs = [];
  const HAS_LS = typeof localStorage !== 'undefined';
  try {
    if (HAS_LS) {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.palettes)) customs = data.palettes.filter(validate).map(sanitize);
      }
    }
  } catch (e) { /* ignore */ }

  function validate(p) {
    return p && typeof p === 'object' && typeof p.name === 'string' && p.name.length <= 60 &&
      Array.isArray(p.colors) && p.colors.length >= 1 && p.colors.length <= MAX_COLORS &&
      p.colors.every((c) => GR.isHexColor(c)) &&
      (!p.bg || GR.isHexColor(p.bg));
  }
  function sanitize(p) {
    return {
      id: String(p.id || uid()).slice(0, 64),
      name: String(p.name).slice(0, 60),
      colors: p.colors.map((c) => GR.normHex(c)),
      bg: p.bg && GR.isHexColor(p.bg) ? GR.normHex(p.bg) : '#0b1020',
      outline: p.outline && GR.isHexColor(p.outline) ? GR.normHex(p.outline) : null,
    };
  }
  function uid() {
    return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }
  function persist() {
    if (!HAS_LS) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, palettes: customs })); } catch (e) { /* ignore */ }
  }

  const API = {
    list: () => customs.map((p) => ({ ...p })),
    count: () => customs.length,
    find(id) { return customs.find((p) => p.id === id) || null; },
    create(data) {
      if (customs.length >= MAX_PALETTES) return null;
      const p = sanitize({
        id: uid(),
        name: data && data.name ? data.name : 'Custom palette',
        colors: (data && data.colors && data.colors.length ? data.colors : ['#223355', '#4466aa', '#88aadd']),
        bg: data && data.bg ? data.bg : '#0b1020',
        outline: data && 'outline' in data ? data.outline : null,
      });
      customs.push(p);
      persist();
      return { ...p };
    },
    update(id, patch) {
      const p = this.find(id);
      if (!p) return null;
      const merged = { ...p, ...patch };
      const s = sanitize(merged);
      const i = customs.findIndex((x) => x.id === id);
      customs[i] = s;
      persist();
      return { ...s };
    },
    duplicate(id) {
      const p = this.find(id);
      if (!p || customs.length >= MAX_PALETTES) return null;
      const copy = sanitize({ ...p, id: uid(), name: p.name + ' (copy)' });
      customs.push(copy);
      persist();
      return { ...copy };
    },
    remove(id) {
      const i = customs.findIndex((p) => p.id === id);
      if (i < 0) return false;
      customs.splice(i, 1);
      persist();
      return true;
    },
    replaceAll(list) {
      const incoming = (list || []).filter(validate).map(sanitize);
      const merged = [...customs];
      for (const p of incoming) {
        const i = merged.findIndex((x) => x.id === p.id);
        if (i >= 0) merged[i] = p; // keep stable ids when unique
        else if (merged.length < MAX_PALETTES) merged.push(p);
      }
      customs = merged;
      persist();
      return customs.length;
    },
    validate,
    /* export combined theme file (palettes + gradients + extra template kinds) */
    exportJSON(palettes, gradients, extras) {
      const out = {
        type: 'einstein-wallpaper-themes',
        version: 1,
        exported: new Date().toISOString(),
        palettes: palettes || this.list(),
        gradients: gradients || (root.Gradients ? root.Gradients.list() : []),
      };
      if (extras) out.extras = extras; // { single: ['#hex'], duo: [{a,b}] }
      return JSON.stringify(out, null, 2);
    },
    /* import + validate; returns {palettes, gradients, extras?}, throws on malformed file */
    importJSON(text) {
      let data;
      try { data = JSON.parse(text); } catch (e) { throw new Error('Not a valid JSON file'); }
      if (!data || typeof data !== 'object' || data.type !== 'einstein-wallpaper-themes') {
        throw new Error('Unrecognized theme file (missing type marker)');
      }
      const palettes = Array.isArray(data.palettes) ? data.palettes : [];
      const gradients = Array.isArray(data.gradients) ? data.gradients : [];
      const extras = (data.extras && typeof data.extras === 'object') ? {
        single: Array.isArray(data.extras.single) ? data.extras.single : [],
        duo: Array.isArray(data.extras.duo) ? data.extras.duo : [],
      } : null;
      const okP = palettes.filter(validate);
      const okG = gradients.filter((g) => GR.validate(g));
      if (!okP.length && !okG.length && !(extras && (extras.single.length || extras.duo.length))) {
        throw new Error('No valid palettes, gradients or templates in file');
      }
      const nP = okP.length ? this.replaceAll(okP) : 0;
      const nG = okG.length ? GR.replaceAll(okG) : 0;
      return { palettes: nP, gradients: nG, extras };
    },
    MAX_COLORS,
  };

  root.CustomPalettes = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
