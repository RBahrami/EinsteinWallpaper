/*
 * layers.js — layer model for the EinsteinWallpaper multi-layer system.
 *
 * A project = { version: 2, name, aspect, orientation, resW, resH,
 * selected, layers: [...] }
 * Only canvas dimensions / aspect / resolution are global (plus the free-form
 * project `name` shown in the UI and stored in saved files); every visual
 * setting lives on a layer:
 *
 *   Background layer (always layers[0], can never be deleted or reordered).
 *     Fill = solid color OR gradient; the gradient is an OWNED full-spec
 *     object (type linear/radial/conic, angle, sorted color stops) edited
 *     live in the Background layer section:
 *     { id, type:'background', name:'Background', visible, opacity,
 *       bg: { source:'solid'|'gradient', color, gradientId?, gradient } }
 *     gradientId is only a legacy/migration hint; rendering uses bg.gradient.
 *     A legacy 'palette' source is converted to solid (legacyPaletteRef is
 *     resolved to a concrete color by app.js, which owns the palette lib).
 *
 *   Pattern layers (up to MAX_PATTERN_LAYERS, stacked above the background):
 *     { id, type:'pattern', name, visible, opacity,
 *       family, variant, tileSize, rotation, panX, panY,
 *       gap, outlineWidth, fillAlpha, lineAlpha, lineAuto, lineColor, seed,
 *       theme: { mode, colorMap, gradMap, duoMap, gradBands, singleColor,
 *                duoA, duoB, paletteRef, gradientId },
 *       animation, animSpeed, flowAngle, effects: {...} }
 *     fillAlpha / lineAlpha (0..100) control the per-tile FILL and
 *     BORDER/STROKE transparency independently of the whole-layer opacity.
 *
 * migrateV1() converts the legacy flat einstein-wallpaper-v1 settings into a
 * v2 project without losing palettes/gradients/templates (those live in their
 * own stores): background source -> Background layer, fgAlpha -> pattern
 * layer opacity, everything else -> the first Pattern layer.
 * planLoop() computes a seamless combined export loop for layers whose
 * animation periods differ: the slowest layer defines the loop T; every
 * faster layer is given an integer number of cycles inside T (a per-layer
 * time warp that keeps its speed visually identical); very long loops are
 * uniformly time-compressed so exports stay practical.
 *
 * This module is dependency-free and loads in the browser and in Node/bun.
 */
(function (root) {
  'use strict';

  const MAX_PATTERN_LAYERS = 8;
  const FX_DEFAULTS = {
    blur: 0, glow: 0, glowRadius: 14,
    shadow: 0, shadowSoft: 14, shadowOff: 8,
    grain: 0, vignette: 0, vignetteMode: 'dark',
    // ONE active special effect per layer (dropdown in the UI)
    special: 'none',
    shimmer: 0, shimmerAngle: 30, shimmerPhase: 0, shimmerScale: 100,
    sheen: 0, sheenAngle: 30, sheenPos: 50,
    irid: 0, iridScale: 100, iridAngle: 0,
    aberration: 0,
    scan: 0, scanGap: 4,
  };
  // valid values for fx.special — exactly one special effect runs per layer
  const SPECIAL_MODES = ['none', 'shimmer', 'sheen', 'irid', 'aberration', 'scan'];
  // [min, max] clamp for every numeric fx field (sliders may be narrower)
  const FX_RANGES = {
    blur: [0, 60], glow: [0, 200], glowRadius: [0, 120],
    shadow: [0, 200], shadowSoft: [0, 120], shadowOff: [0, 80],
    grain: [0, 200], vignette: [0, 200],
    shimmer: [0, 200], shimmerAngle: [0, 345], shimmerPhase: [0, 100], shimmerScale: [20, 400],
    sheen: [0, 200], sheenAngle: [0, 345], sheenPos: [0, 100],
    irid: [0, 200], iridScale: [20, 400], iridAngle: [0, 345],
    aberration: [0, 20],
    scan: [0, 200], scanGap: [2, 24],
  };
  const THEME_MODES = ['single', 'palette', 'gradient', 'duotone'];
  const ANIMS = ['none', 'shimmer', 'flow', 'glowwave'];
  const BG_SOURCES = ['solid', 'gradient'];
  const HEX_RE = /^#[0-9a-f]{6}$/i;
  const GRAD_TYPES = ['linear', 'radial', 'conic'];
  // Seed gradient for a Background layer that has none (Abyss-like)
  const DEFAULT_BG_GRADIENT = {
    type: 'linear', angle: 120,
    stops: [{ pos: 0, color: '#05060e' }, { pos: 0.6, color: '#232b52' }, { pos: 1, color: '#6d7fd0' }],
  };

  /* ---------------- small helpers ---------------- */
  function uid() {
    return 'u-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }
  function clampInt(v, lo, hi, dflt) {
    v = Math.round(+v);
    return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt;
  }
  function clampNum(v, lo, hi, dflt) {
    v = +v;
    return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt;
  }
  function hex(v, dflt) {
    return (typeof v === 'string' && HEX_RE.test(v)) ? v.toLowerCase() : dflt;
  }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

  function validPaletteRef(r) {
    if (!r || typeof r !== 'object') return { kind: 'builtin', index: 0 };
    if (r.kind === 'custom' && typeof r.id === 'string' && r.id) return { kind: 'custom', id: r.id };
    return { kind: 'builtin', index: clampInt(r.index, 0, 999, 0) };
  }
  // Full gradient-spec sanitizer (dependency-free twin of Gradients.normalize
  // so layers.js keeps loading in Node/bun without the browser libraries).
  function normGradient(g) {
    const src = (g && typeof g === 'object') ? g : {};
    const stops = (Array.isArray(src.stops) ? src.stops : [])
      .map((s) => ({ pos: clampNum(s && s.pos, 0, 1, 0), color: hex(s && s.color, '#333333') }))
      .sort((a, b) => a.pos - b.pos);
    if (!stops.length) stops.push({ pos: 0, color: '#333333' }, { pos: 1, color: '#cccccc' });
    if (stops.length === 1) stops.push({ pos: 1, color: stops[0].color });
    return {
      type: GRAD_TYPES.includes(src.type) ? src.type : 'linear',
      angle: ((Math.round(+src.angle) || 0) % 360 + 360) % 360,
      stops,
    };
  }
  function sanitizeFx(fx) {
    const out = Object.assign({}, FX_DEFAULTS);
    if (fx && typeof fx === 'object') {
      for (const k of Object.keys(FX_RANGES)) {
        if (fx[k] != null) {
          const [lo, hi] = FX_RANGES[k];
          out[k] = clampNum(fx[k], lo, hi, FX_DEFAULTS[k]);
        }
      }
      if (fx.vignetteMode === 'light' || fx.vignetteMode === 'dark') out.vignetteMode = fx.vignetteMode;
      if (SPECIAL_MODES.includes(fx.special)) out.special = fx.special;
      else {
        // legacy blob without `special`: infer the active mode from the
        // first non-zero amount so old projects keep their special effect
        if (out.shimmer > 0) out.special = 'shimmer';
        else if (out.sheen > 0) out.special = 'sheen';
        else if (out.irid > 0) out.special = 'irid';
        else if (out.aberration > 0) out.special = 'aberration';
        else if (out.scan > 0) out.special = 'scan';
      }
    }
    return out;
  }

  /* ---------------- layer factories ---------------- */
  function createBackground(cfg) {
    cfg = cfg || {};
    const bg = (cfg.bg && typeof cfg.bg === 'object') ? cfg.bg : {};
    // legacy 'palette' fill -> solid color (the referenced palette's bg color
    // is resolved by app.js fixProjectRefs, which owns the palette library)
    const legacyPalette = bg.source === 'palette' ? validPaletteRef(bg.paletteRef) : null;
    const source = BG_SOURCES.includes(bg.source) ? bg.source : 'solid';
    // An owned gradient is authored inline. When only a library gradientId is
    // given (v1/v2 migrations, agent files), gradient stays null and app.js
    // fixProjectRefs seeds the owned spec from that library template.
    const gradient = bg.gradient
      ? normGradient(bg.gradient)
      : (source === 'gradient' && bg.gradientId) ? null
      : normGradient(DEFAULT_BG_GRADIENT);
    return {
      id: (typeof cfg.id === 'string' && cfg.id) ? cfg.id : uid(),
      type: 'background',
      name: 'Background',
      visible: cfg.visible !== false,
      opacity: clampInt(cfg.opacity, 0, 100, 100),
      bg: {
        source,
        color: hex(bg.color, '#0b1020'),
        gradientId: (typeof bg.gradientId === 'string' && bg.gradientId) ? bg.gradientId : null,
        gradient,
        ...(legacyPalette ? { legacyPaletteRef: legacyPalette } : {}),
      },
    };
  }

  function createPattern(cfg) {
    cfg = cfg || {};
    const th = (cfg.theme && typeof cfg.theme === 'object') ? cfg.theme : {};
    return {
      id: (typeof cfg.id === 'string' && cfg.id) ? cfg.id : uid(),
      type: 'pattern',
      name: (typeof cfg.name === 'string' && cfg.name.trim())
        ? cfg.name.trim().slice(0, 40)
        : ('Pattern ' + clampInt(cfg._n, 1, 99, 1)),
      visible: cfg.visible !== false,
      opacity: clampInt(cfg.opacity, 0, 100, 100),
      family: (typeof cfg.family === 'string' && cfg.family) ? cfg.family : 'hat',
      variant: (typeof cfg.variant === 'string' && cfg.variant) ? cfg.variant : 'H',
      tileSize: clampNum(cfg.tileSize, 4, 400, 34),
      rotation: clampInt(cfg.rotation, 0, 345, 0),
      panX: clampNum(cfg.panX, -4000, 4000, 0),
      panY: clampNum(cfg.panY, -4000, 4000, 0),
      gap: clampNum(cfg.gap, 0, 0.4, 0.02),
      outlineWidth: clampNum(cfg.outlineWidth, 0, 20, 1.2),
      fillAlpha: clampInt(cfg.fillAlpha, 0, 100, 100),
      lineAlpha: clampInt(cfg.lineAlpha, 0, 100, 100),
      lineAuto: cfg.lineAuto !== false,
      lineColor: hex(cfg.lineColor, '#101014'),
      seed: clampInt(cfg.seed, 1, 99999, 7),
      theme: {
        mode: THEME_MODES.includes(th.mode) ? th.mode : 'palette',
        colorMap: (typeof th.colorMap === 'string' && th.colorMap) ? th.colorMap : 'supertile',
        gradMap: (typeof th.gradMap === 'string' && th.gradMap) ? th.gradMap : 'sweep',
        duoMap: (typeof th.duoMap === 'string' && th.duoMap) ? th.duoMap : 'checker',
        gradBands: clampInt(th.gradBands, 2, 12, 5),
        singleColor: hex(th.singleColor, '#5bc8ff'),
        duoA: hex(th.duoA, '#5bc8ff'),
        duoB: hex(th.duoB, '#f4777f'),
        paletteRef: validPaletteRef(th.paletteRef),
        gradientId: (typeof th.gradientId === 'string' && th.gradientId) ? th.gradientId : null,
      },
      animation: ANIMS.includes(cfg.animation) ? cfg.animation : 'shimmer',
      animSpeed: clampNum(cfg.animSpeed, 0.2, 3, 1),
      flowAngle: clampInt(cfg.flowAngle, 0, 345, 30),
      effects: sanitizeFx(cfg.effects),
    };
  }

  const PROJECT_NAME_DEFAULT = 'Untitled wallpaper';
  function projectName(v) {
    return (typeof v === 'string' && v.trim()) ? v.trim().slice(0, 60) : PROJECT_NAME_DEFAULT;
  }

  function defaultProject() {
    const proj = {
      version: 2,
      name: PROJECT_NAME_DEFAULT,
      aspect: '16:9', orientation: 'landscape', resW: 1920, resH: 1080,
      selected: null,
      layers: [createBackground(), createPattern({ name: 'Pattern 1', _n: 1 })],
    };
    proj.selected = proj.layers[1].id;
    return proj;
  }

  /* ---------------- project queries ---------------- */
  function bgLayer(proj) {
    return proj.layers.find((l) => l.type === 'background') || null;
  }
  function patternLayers(proj) {
    return proj.layers.filter((l) => l.type === 'pattern');
  }
  function findLayer(proj, id) {
    return proj.layers.find((l) => l.id === id) || null;
  }
  function selectedLayer(proj) {
    return findLayer(proj, proj.selected) || patternLayers(proj)[0] || bgLayer(proj);
  }

  /* ---------------- mutations (bg protected) ---------------- */
  function duplicateLayer(layer) {
    if (!layer || layer.type !== 'pattern') return null;
    const copy = JSON.parse(JSON.stringify(layer));
    copy.id = uid();
    copy.name = (layer.name + ' copy').slice(0, 40);
    return copy;
  }
  function deleteLayer(proj, id) {
    const i = proj.layers.findIndex((l) => l.id === id);
    if (i < 0 || proj.layers[i].type === 'background') return false;
    proj.layers.splice(i, 1);
    return true;
  }
  function moveLayer(proj, id, dir) {
    const i = proj.layers.findIndex((l) => l.id === id);
    if (i < 0 || proj.layers[i].type === 'background') return false;
    const j = dir < 0 ? i - 1 : i + 1; // patterns start at index 1
    if (j < 1 || j >= proj.layers.length) return false;
    const tmp = proj.layers[i];
    proj.layers[i] = proj.layers[j];
    proj.layers[j] = tmp;
    return true;
  }

  /* ---------------- v1 -> v2 migration ---------------- */
  function migrateV1(s) {
    s = (s && typeof s === 'object') ? s : {};
    const proj = defaultProject();
    proj.aspect = (typeof s.aspect === 'string' && s.aspect) ? s.aspect : proj.aspect;
    proj.orientation = s.orientation === 'portrait' ? 'portrait' : 'landscape';
    proj.resW = clampInt(s.resW, 64, 8192, 1920);
    proj.resH = clampInt(s.resH, 64, 8192, 1080);

    const bg = proj.layers[0];
    const src = s.bgSource;
    if (src === 'gradient') {
      bg.bg.source = 'gradient';
      bg.bg.gradientId = (typeof s.gradientId === 'string' && s.gradientId) ? s.gradientId : null;
      // drop the default owned spec: app.js fixProjectRefs seeds the real
      // gradient from the referenced library template
      bg.bg.gradient = null;
    } else if (src === 'theme') {
      // palette-derived background -> solid; the concrete color is resolved
      // from the referenced palette by app.js fixProjectRefs
      bg.bg.source = 'solid';
      bg.bg.color = hex(s.bgColor, '#0b1020');
      bg.bg.legacyPaletteRef = validPaletteRef(s.paletteRef);
    } else {
      bg.bg.source = 'solid';
      bg.bg.color = hex(s.bgColor, '#0b1020');
    }

    const palRef = s.paletteRef
      ? validPaletteRef(s.paletteRef)
      : (typeof s.palette === 'number' ? { kind: 'builtin', index: s.palette } : { kind: 'builtin', index: 0 });

    const pat = createPattern({
      name: 'Pattern 1', _n: 1,
      id: proj.layers[1].id,
      opacity: clampInt(s.fgAlpha, 0, 100, 100),
      family: (typeof s.family === 'string' && s.family) ? s.family : 'hat',
      variant: (typeof s.variant === 'string' && s.variant) ? s.variant : 'H',
      tileSize: s.tileSize, rotation: s.rotation, panX: s.panX, panY: s.panY,
      gap: s.gap, outlineWidth: s.outlineWidth,
      lineAuto: s.lineAuto !== false,
      lineColor: s.lineColor,
      seed: s.seed,
      theme: {
        mode: s.themeMode,
        colorMap: s.colorMap, gradMap: s.gradMap, duoMap: s.duoMap,
        gradBands: s.gradBands,
        singleColor: s.singleColor, duoA: s.duoA, duoB: s.duoB,
        paletteRef: palRef,
        gradientId: s.gradientId,
      },
      fillAlpha: s.fillAlpha, lineAlpha: s.lineAlpha,
      animation: s.animation, animSpeed: s.animSpeed, flowAngle: s.flowAngle,
      effects: s.effects,
    });
    // keep the id assigned by defaultProject (stable within this migration)
    pat.id = proj.layers[1].id;
    proj.layers[1] = pat;
    proj.selected = pat.id;
    return proj;
  }

  /* ---------------- defensive project sanitizer ---------------- */
  function sanitizeProject(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultProject();
    // v2 shape: explicit version, or a bare project object carrying a layers
    // array (agent-generated files may omit the version field)
    const looksV2 = raw.version === 2 ||
      (Array.isArray(raw.layers) && !raw.family && !raw.themeMode && !raw.colorMode);
    if (!looksV2) {
      // legacy flat settings (v1) or unknown shape
      if (typeof raw.family === 'string' || raw.themeMode || raw.colorMode) return migrateV1(raw);
      return defaultProject();
    }
    const proj = {
      version: 2,
      name: projectName(raw.name),
      aspect: (typeof raw.aspect === 'string' && raw.aspect) ? raw.aspect : '16:9',
      orientation: raw.orientation === 'portrait' ? 'portrait' : 'landscape',
      resW: clampInt(raw.resW, 64, 8192, 1920),
      resH: clampInt(raw.resH, 64, 8192, 1080),
      selected: null,
      layers: [],
    };
    let bg = null;
    const pats = [];
    const rawLayers = Array.isArray(raw.layers) ? raw.layers : [];
    for (const l of rawLayers) {
      if (!l || typeof l !== 'object') continue;
      if (l.type === 'background') {
        if (bg) continue; // exactly one background layer
        bg = createBackground(l);
      } else if (l.type === 'pattern') {
        if (pats.length >= MAX_PATTERN_LAYERS) continue;
        pats.push(createPattern(l));
      }
    }
    // the background layer is ALWAYS the bottom of the stack.
    // Zero pattern layers is a valid project (toolbar "New": background
    // only), so nothing is forced back in here.
    proj.layers = [bg || createBackground(), ...pats];

    // unique ids
    const seen = new Set();
    for (const l of proj.layers) {
      if (!l.id || seen.has(l.id)) l.id = uid();
      seen.add(l.id);
    }
    const sel = findLayer(proj, raw.selected);
    proj.selected = sel ? sel.id : (patternLayers(proj)[0] || bgLayer(proj)).id;
    return proj;
  }

  /* ---------------- export loop planning ---------------- */
  /*
   * planLoop(periods, opts) -> { frames, delayCs, warps, T, compressed }
   *  periods: per-layer animation period in ms (0 = static layer).
   *  The slowest period defines the loop T; every faster layer is assigned
   *  an integer number of cycles and a time warp (feed the animator
   *  t * warp[i]) so all layers realign exactly at t = T — a seamless loop
   *  at visually unchanged per-layer speed. Loops longer than capMs are
   *  uniformly compressed (compressed < 1) to keep exports practical.
   */
  function planLoop(periods, opts) {
    opts = opts || {};
    const CAP = opts.capMs || 15000;
    const ps = (periods || []).map((p) => (isFinite(+p) && +p > 0 ? +p : 0));
    if (!ps.some((p) => p > 0)) {
      return { frames: 1, delayCs: 0, warps: ps.map(() => 1), T: 0, compressed: 1 };
    }
    const Tmax = Math.max(...ps);
    const s = Tmax > CAP ? CAP / Tmax : 1;
    const T = Tmax * s;
    const warps = ps.map((p) => {
      if (!(p > 0)) return 1;
      const cycles = Math.max(1, Math.round(Tmax / p));
      return (p * cycles) / T;
    });
    let best = null;
    for (let d = 3; d <= 100; d++) {
      const f = Math.round(T / (d * 10));
      if (f < 2 || f > 200) continue;
      const err = Math.abs(f * d * 10 - T);
      if (!best || err < best.err) best = { d, f, err };
    }
    if (!best) {
      const d = Math.max(3, Math.min(100, Math.ceil(T / 2000)));
      best = { d, f: Math.max(2, Math.round(T / (d * 10))) };
    }
    return { frames: best.f, delayCs: best.d, warps, T, compressed: s };
  }

  root.Layers = {
    MAX_PATTERN_LAYERS, FX_DEFAULTS, SPECIAL_MODES, THEME_MODES, ANIMS,
    uid, clampInt, clampNum, hex, validPaletteRef, sanitizeFx, normGradient,
    DEFAULT_BG_GRADIENT, PROJECT_NAME_DEFAULT, projectName,
    createBackground, createPattern, defaultProject,
    bgLayer, patternLayers, findLayer, selectedLayer,
    duplicateLayer, deleteLayer, moveLayer,
    migrateV1, sanitizeProject, planLoop,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Layers;
})(typeof window !== 'undefined' ? window : globalThis);
