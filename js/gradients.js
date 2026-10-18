/*
 * gradients.js — multi-stop gradient engine + persistence for Tessellate.
 *
 * A gradient: { id, name, type: 'linear'|'radial'|'conic', angle: deg,
 *               stops: [{ pos: 0..1, color: '#rrggbb' }] }
 * Stops are kept sorted by pos. sample(t) does piecewise-linear sRGB interpolation
 * between neighbouring stops (clamped at the ends).
 *
 * Persistence: localStorage 'ew-gradients-v1'. Import/export/validation live in
 * custom-palettes.js (combined theme files).
 */
(function (root) {
  'use strict';

  const STORE_KEY = 'ew-gradients-v1';

  /* ---------- color parsing ---------- */
  const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  function isHexColor(c) {
    return typeof c === 'string' && HEX_RE.test(c.trim());
  }
  function normHex(c) {
    let h = c.trim().slice(1);
    if (h.length === 3 || h.length === 4) h = h.split('').map((ch) => ch + ch).join('');
    if (h.length === 8) h = h.slice(0, 6); // drop alpha for palette use
    return '#' + h.toLowerCase();
  }
  function hexToRgb(hex) {
    const h = normHex(hex).slice(1);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rgbToHex(r, g, b) {
    const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return '#' + c(r) + c(g) + c(b);
  }

  /* ---------- gradient math ---------- */
  function normalize(g) {
    const stops = (g.stops || [])
      .map((s) => ({ pos: Math.max(0, Math.min(1, +s.pos || 0)), color: normHex(s.color) }))
      .sort((a, b) => a.pos - b.pos);
    if (!stops.length) { stops.push({ pos: 0, color: '#333333' }, { pos: 1, color: '#cccccc' }); }
    if (stops.length === 1) stops.push({ pos: 1, color: stops[0].color });
    return { ...g, stops, type: ['linear', 'radial', 'conic'].includes(g.type) ? g.type : 'linear', angle: (+g.angle || 0) % 360 };
  }
  function sample(g, t) {
    const stops = g.stops;
    if (t <= stops[0].pos) return stops[0].color;
    if (t >= stops[stops.length - 1].pos) return stops[stops.length - 1].color;
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i], b = stops[i + 1];
      if (t >= a.pos && t <= b.pos) {
        const f = b.pos - a.pos < 1e-9 ? 0 : (t - a.pos) / (b.pos - a.pos);
        const ca = hexToRgb(a.color), cb = hexToRgb(b.color);
        return rgbToHex(ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f);
      }
    }
    return stops[stops.length - 1].color;
  }
  function makeLut(g) {
    const lut = new Array(256);
    for (let i = 0; i < 256; i++) lut[i] = sample(g, i / 255);
    return lut;
  }
  // build a canvas gradient covering a WxH rect; offset shifts phase along the
  // gradient axis in [0,1) of the axis length (for animation)
  function toCanvas(ctx, g, W, H, phase) {
    const th = (g.angle || 0) * Math.PI / 180;
    let grad;
    const cx = W / 2, cy = H / 2;
    if (g.type === 'radial') {
      const R = Math.hypot(W, H) / 2;
      grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      for (const s of g.stops) grad.addColorStop(Math.max(0, Math.min(1, s.pos)), s.color);
      return grad;
    }
    if (g.type === 'conic') {
      // canvas has no conic gradient: approximate with 180 thin sectors
      grad = null;
      return { conic: true, cx, cy, angle: th };
    }
    // linear: gradient line through center at angle th, extended by phase
    const dx = Math.cos(th), dy = Math.sin(th);
    const half = (Math.abs(W * dx) + Math.abs(H * dy)) / 2;
    const off = (phase || 0) * 2 * half;
    grad = ctx.createLinearGradient(cx - dx * (half + off), cy - dy * (half + off), cx + dx * (half - off), cy + dy * (half - off));
    for (const s of g.stops) grad.addColorStop(Math.max(0, Math.min(1, s.pos)), s.color);
    return grad;
  }
  // draw a conic gradient (sector approximation) filling the current ctx rect
  function fillConic(ctx, g, W, H) {
    const cx = W / 2, cy = H / 2;
    const R = Math.hypot(W, H);
    const steps = 240;
    const a0 = (g.angle || 0) * Math.PI / 180;
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps, t1 = (i + 1) / steps;
      const c = sample(g, (t0 + t1) / 2);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, a0 + t0 * Math.PI * 2, a0 + t1 * Math.PI * 2 + 0.012);
      ctx.closePath();
      ctx.fillStyle = c;
      ctx.fill();
    }
  }

  /* ---------- built-in gradients ---------- */
  const BUILTINS = [
    {
      id: 'bi-ember-dawn', name: 'Ember Dawn', type: 'linear', angle: 30,
      stops: [{ pos: 0, color: '#1a0e14' }, { pos: 0.45, color: '#b13a5e' }, { pos: 0.75, color: '#f4854e' }, { pos: 1, color: '#ffd9a0' }],
    },
    {
      id: 'bi-abyss', name: 'Abyss', type: 'linear', angle: 120,
      stops: [{ pos: 0, color: '#05060e' }, { pos: 0.6, color: '#232b52' }, { pos: 1, color: '#6d7fd0' }],
    },
    {
      id: 'bi-aurora', name: 'Aurora Sweep', type: 'linear', angle: 60,
      stops: [{ pos: 0, color: '#0f3d33' }, { pos: 0.5, color: '#1fa886' }, { pos: 0.8, color: '#7ee8c7' }, { pos: 1, color: '#9d7bea' }],
    },
    {
      id: 'bi-solar', name: 'Solar', type: 'radial', angle: 0,
      stops: [{ pos: 0, color: '#ffe14d' }, { pos: 0.55, color: '#f4854e' }, { pos: 1, color: '#4a1c3d' }],
    },
    {
      id: 'bi-iris', name: 'Iris Wheel', type: 'conic', angle: 0,
      stops: [
        { pos: 0, color: '#5bc8ff' }, { pos: 0.25, color: '#8f7bff' }, { pos: 0.5, color: '#ff8bd2' },
        { pos: 0.75, color: '#ffe14d' }, { pos: 1, color: '#5bc8ff' },
      ],
    },
    {
      id: 'bi-porcelain', name: 'Porcelain', type: 'linear', angle: 90,
      stops: [{ pos: 0, color: '#f4f1ea' }, { pos: 1, color: '#54718f' }],
    },
  ];

  /* ---------- persistence ---------- */
  let customs = [];
  const HAS_LS = typeof localStorage !== 'undefined';
  try {
    if (HAS_LS) {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.gradients)) customs = data.gradients.filter(validate).map((g) => normalize(g));
      }
    }
  } catch (e) { /* ignore */ }

  function validate(g) {
    return g && typeof g === 'object' && typeof g.name === 'string' &&
      Array.isArray(g.stops) && g.stops.length >= 2 &&
      g.stops.every((s) => s && isHexColor(s.color) && isFinite(+s.pos)) &&
      ['linear', 'radial', 'conic'].includes(g.type);
  }
  function persist() {
    if (!HAS_LS) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, gradients: customs })); } catch (e) { /* ignore */ }
  }
  function uid() {
    return 'g-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  /* ---------- public API ---------- */
  const API = {
    BUILTINS,
    isHexColor, normHex, hexToRgb, rgbToHex,
    normalize, sample, makeLut, toCanvas, fillConic,
    list: () => customs.slice(),
    all: () => [...BUILTINS, ...customs],
    get(ref) {
      // ref: {kind:'builtin', index} | {kind:'custom', id} | string id
      if (ref && typeof ref === 'object') {
        if (ref.kind === 'custom') return customs.find((g) => g.id === ref.id) || BUILTINS[0];
        return BUILTINS[ref.index] || BUILTINS[0];
      }
      const id = typeof ref === 'string' ? ref : (ref && ref.id);
      return BUILTINS.find((g) => g.id === id) || customs.find((g) => g.id === id) || BUILTINS[0];
    },
    find(id) {
      return BUILTINS.find((g) => g.id === id) || customs.find((g) => g.id === id) || null;
    },
    save(g) {
      g = normalize(g);
      if (g.id && this.find(g.id) && !g.id.startsWith('bi-')) {
        const i = customs.findIndex((x) => x.id === g.id);
        customs[i] = g;
      } else {
        g = { ...g, id: uid() };
        customs.push(g);
      }
      persist();
      return g;
    },
    remove(id) {
      const i = customs.findIndex((g) => g.id === id);
      if (i >= 0) { customs.splice(i, 1); persist(); return true; }
      return false;
    },
    replaceAll(list) {
      customs = list.filter(validate).map((g) => normalize({ ...g, id: (g.id && !this.find(g.id)) ? g.id : uid() }));
      persist();
      return customs.length;
    },
    validate,
  };

  root.Gradients = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
