/*
 * app.js — UI wiring for EinsteinWallpaper (Geometric Wallpaper Studio).
 *
 * Color theme: one section, four modes (Single / Palette / Gradient /
 * Duotone). Each mode owns dedicated settings — arrangement, template
 * library, inline editor — shown only while that mode is active. Every
 * control recolors the wallpaper live; templates can be customized and
 * saved/loaded per mode. Foreground opacity fades tiles+outlines over the
 * background in the preview and in every export format.
 */
(function () {
  'use strict';

  const HT = window.HatTiling, R = window.Renderer, PAL = window.Palettes,
    TL = window.Tilings, GR = window.Gradients, CP = window.CustomPalettes,
    FX = window.Effects, AP = window.Apng;

  /* ------------------------------------------------------- presets */

  const ASPECTS = [
    { id: '16:9',   r: 16 / 9 },
    { id: '16:10',  r: 16 / 10 },
    { id: '4:3',    r: 4 / 3 },
    { id: '5:4',    r: 5 / 4 },
    { id: '3:2',    r: 3 / 2 },
    { id: '21:9',   r: 21 / 9 },
    { id: '32:9',   r: 32 / 9 },
    { id: '1:1',    r: 1 },
    { id: '9:16',   r: 9 / 16 },
    { id: '9:19.5', r: 9 / 19.5 },
    { id: '9:20',   r: 9 / 20 },
  ];

  const RES_PRESETS = {
    '16:9':  [[1280, 720], [1600, 900], [1920, 1080], [2560, 1440], [3840, 2160]],
    '16:10': [[1280, 800], [1440, 900], [1680, 1050], [1920, 1200], [2560, 1600]],
    '4:3':   [[1024, 768], [1400, 1050], [1600, 1200], [2048, 1536]],
    '5:4':   [[1280, 1024], [1600, 1280], [2560, 2048]],
    '3:2':   [[1356, 904], [1620, 1080], [2160, 1440], [3000, 2000]],
    '21:9':  [[2560, 1080], [3440, 1440], [5120, 2160]],
    '32:9':  [[3840, 1080], [5120, 1440]],
    '1:1':   [[1080, 1080], [2048, 2048], [3000, 3000]],
    '9:16':  [[1080, 1920], [1440, 2560], [2160, 3840]],
    '9:19.5': [[1080, 2340], [1170, 2532], [1440, 3120]],
    '9:20':  [[1080, 2400], [1440, 3200]],
  };

  const ANIMS = [
    ['none', 'None (static)'],
    ['shimmer', 'Shimmer (light wave)'],
    ['flow', 'Gradient Flow'],
    ['glowwave', 'Glow Wave'],
  ];

  const THEME_MODES = [
    ['single', 'Single'], ['palette', 'Palette'],
    ['gradient', 'Gradient'], ['duotone', 'Duotone'],
  ];
  const THEME_MODE_IDS = THEME_MODES.map((m) => m[0]);
  const MAP_LABELS = {
    supertile: 'Supertiles (patches)',
    kind: 'By tile kind',
    orientation: 'By orientation',
    mirror: 'Mirror split',
    checker: 'Checkerboard',
    random: 'Random mix',
    sweep: 'Sweep',
    bands: 'Bands',
    single: 'Uniform',
  };

  // built-in single-color templates
  const SINGLE_TPLS = [
    '#5bc8ff', '#8f7bff', '#ff8bd2', '#ffe14d', '#6be3a2', '#ff8a5b',
    '#f4777f', '#4dffb8', '#e8e8e8', '#9aa0b0', '#4a5a78', '#222639',
  ];
  // built-in duotone templates [A, B]
  const DUO_TPLS = [
    ['#5bc8ff', '#f4777f'], ['#ffe14d', '#b07bff'], ['#6be3a2', '#ff8a5b'],
    ['#ff8bd2', '#4dffb8'], ['#f4f1ea', '#54718f'], ['#ffd9a0', '#4a1c3d'],
  ];

  const FX_DEFAULTS = {
    blur: 0, glow: 0, glowRadius: 14,
    shadow: 0, shadowSoft: 14, shadowOff: 8,
    grain: 0, vignette: 0, vignetteMode: 'dark',
  };

  const DEFAULTS = {
    aspect: '16:9', orientation: 'landscape',
    resW: 1920, resH: 1080,
    family: 'hat', tileSize: 34, variant: 'H', rotation: 0, panX: 0, panY: 0,
    gap: 0.02, outlineWidth: 1.2,
    themeMode: 'palette',
    colorMap: 'supertile', gradMap: 'sweep', gradBands: 5, duoMap: 'checker',
    singleColor: '#5bc8ff', duoA: '#5bc8ff', duoB: '#f4777f',
    paletteRef: { kind: 'builtin', index: 0 },
    gradientId: null, bgSource: 'theme', bgColor: '#0b1020',
    fgAlpha: 100,
    lineAuto: true, lineColor: '#101014',
    animation: 'shimmer', animSpeed: 1, flowAngle: 30,
    effects: { ...FX_DEFAULTS },
    seed: 7,
  };

  /* -------------------------------------- settings load + migration */

  let P = loadSettings();

  function loadSettings() {
    const p = JSON.parse(JSON.stringify(DEFAULTS));
    try {
      const saved = localStorage.getItem('einstein-wallpaper-v1');
      if (saved) {
        const s = JSON.parse(saved);
        // migration: pre-theme settings -> unified color theme
        if (!s.themeMode) {
          const cm = s.colorMode || 'supertile';
          if (cm === 'solid') {
            p.themeMode = 'single';
          } else {
            p.themeMode = s.colorSource === 'gradient' ? 'gradient' : 'palette';
            if (cm !== 'gradient') p.colorMap = cm;
            p.gradMap = cm === 'gradient' ? 'sweep' : 'random';
          }
          if (s.bgSource === 'gradient') p.bgSource = 'gradient';
        }
        Object.assign(p, s);
        // migration: legacy numeric palette -> builtin ref
        if (typeof s.palette === 'number' && !s.paletteRef) {
          p.paletteRef = { kind: 'builtin', index: s.palette };
        }
        delete p.colorMode; delete p.colorSource;
        if (!THEME_MODE_IDS.includes(p.themeMode)) p.themeMode = 'palette';
        if (!['theme', 'gradient', 'custom'].includes(p.bgSource)) p.bgSource = 'theme';
        if (!GR.isHexColor(p.singleColor)) p.singleColor = DEFAULTS.singleColor;
        if (!GR.isHexColor(p.duoA)) p.duoA = DEFAULTS.duoA;
        if (!GR.isHexColor(p.duoB)) p.duoB = DEFAULTS.duoB;
        if (!GR.isHexColor(p.bgColor)) p.bgColor = DEFAULTS.bgColor;
        p.gradBands = Math.max(2, Math.min(12, +p.gradBands || 5));
        p.fgAlpha = (s.fgAlpha == null || isNaN(+s.fgAlpha))
          ? 100 : Math.max(0, Math.min(100, Math.round(+s.fgAlpha)));
        if (!TL.isFamily(p.family)) p.family = 'hat';
        if (p.family === 'hat' && !['H', 'P', 'F'].includes(p.variant)) p.variant = 'H';
        p.effects = Object.assign({}, FX_DEFAULTS, s.effects || {});
        for (const k of Object.keys(FX_DEFAULTS)) {
          if (typeof p.effects[k] !== typeof FX_DEFAULTS[k]) p.effects[k] = FX_DEFAULTS[k];
        }
        if (!ANIMS.some((a) => a[0] === p.animation)) p.animation = 'shimmer';
      }
    } catch (e) { /* defensive: malformed storage -> defaults */ }
    return p;
  }

  function save() {
    try { localStorage.setItem('einstein-wallpaper-v1', JSON.stringify(P)); } catch (e) { /* ignore */ }
  }

  // custom palette resolver for Palettes.get
  PAL.setCustomResolver((id) => CP.find(id));

  // generic template store (Single colors, Duotone pairs) — localStorage
  function tplStore(key) {
    let items = [];
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data)) items = data;
      }
    } catch (e) { /* ignore */ }
    const persist = () => {
      try { localStorage.setItem(key, JSON.stringify(items)); } catch (e) { /* ignore */ }
    };
    return {
      list: () => items.slice(),
      add(tpl) { items.push(tpl); persist(); },
      remove(i) { if (i >= 0 && i < items.length) { items.splice(i, 1); persist(); } },
    };
  }
  const singleStore = tplStore('ew-single-templates-v1');
  const duoStore = tplStore('ew-duo-templates-v1');

  function naturalOrientation(a) { return a.r >= 1 ? 'landscape' : 'portrait'; }
  function currentAspect() {
    const a = ASPECTS.find((x) => x.id === P.aspect) || ASPECTS[0];
    const nat = naturalOrientation(a);
    if (P.orientation === nat) return a.r;
    return 1 / a.r;
  }
  function currentFamily() { return TL.get(P.family); }
  function currentGradient() {
    return GR.find(P.gradientId) || GR.BUILTINS[0];
  }
  function sameRef(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.kind === 'builtin' && b.kind === 'builtin') return a.index === b.index;
    if (a.kind === 'custom' && b.kind === 'custom') return a.id === b.id;
    return false;
  }

  /* ------------------------------------------- color theme helpers */

  // arrangement options available for a theme mode + family. Options that
  // would be mathematically constant on the current family (By tile kind /
  // By orientation on families with a single kind/orientation) are hidden —
  // the engine's degenerate-map guard covers any stale-scene race.
  function arrOptions(mode) {
    const fam = currentFamily();
    const kind = fam.id === 'hat' ? 'hat' : (fam.id === 'lines' ? 'line' : 'poly');
    const counts = (scene && scene.kind === 'poly' && scene.family === P.family) ? scene : null;
    const m = mode || P.themeMode;
    if (m === 'palette') {
      if (kind === 'hat') return ['supertile', 'orientation', 'mirror', 'checker', 'random'];
      if (kind === 'poly') {
        const opts = [];
        if (!counts || counts.kindCount >= 2) opts.push('kind');
        if (!counts || counts.orientCount >= 2) opts.push('orientation');
        opts.push('checker', 'random');
        return opts;
      }
      return ['orientation', 'random'];
    }
    if (m === 'gradient') return ['sweep', 'bands', 'random'];
    if (m === 'duotone') return ['checker', 'sweep', 'random'];
    return ['single'];
  }
  function mapKeyFor(mode) {
    return mode === 'palette' ? 'colorMap'
      : mode === 'gradient' ? 'gradMap' : 'duoMap';
  }
  // the colorMap value colorize() should use for the active theme mode
  function currentMap() {
    if (P.themeMode === 'single') return 'single';
    if (P.themeMode === 'gradient') return P.gradMap;
    if (P.themeMode === 'duotone') return P.duoMap;
    return P.colorMap;
  }
  function ensureMapValid() {
    if (P.themeMode === 'single') return;
    const key = mapKeyFor(P.themeMode);
    const opts = arrOptions(P.themeMode);
    if (!opts.includes(P[key])) P[key] = opts[0];
  }
  function setThemeMode(mode) {
    if (!THEME_MODE_IDS.includes(mode)) mode = 'palette';
    P.themeMode = mode;
    if (mode === 'gradient' && P.bgSource === 'theme') P.bgSource = 'gradient';
    ensureMapValid();
    syncControls(); recolor(true); save();
  }

  /* ----------------------------------------------------------- dom */

  const $ = (id) => document.getElementById(id);
  const canvas = $('preview');
  const statusEl = $('status');

  function buildAspectChips() {
    const box = $('aspectChips');
    box.innerHTML = '';
    for (const a of ASPECTS) {
      const b = document.createElement('button');
      b.className = 'chip' + (P.aspect === a.id ? ' on' : '');
      b.textContent = a.id;
      b.title = a.r >= 1 ? 'landscape' : 'portrait';
      b.onclick = () => {
        P.aspect = a.id;
        P.orientation = naturalOrientation(a);
        applyResForAspect();
        syncControls(); refresh(); save();
      };
      box.appendChild(b);
    }
  }

  function applyResForAspect() {
    const a = ASPECTS.find((x) => x.id === P.aspect) || ASPECTS[0];
    const list = RES_PRESETS[P.aspect] || [[1920, 1080]];
    const nat = naturalOrientation(a);
    const swapped = P.orientation !== nat;
    const eff = swapped ? list.map((r) => [r[1], r[0]]) : list;
    if (!eff.some((r) => r[0] === P.resW && r[1] === P.resH)) { P.resW = eff[0][0]; P.resH = eff[0][1]; }
  }

  function buildResSelect() {
    const sel = $('resSelect');
    const a = ASPECTS.find((x) => x.id === P.aspect) || ASPECTS[0];
    const list0 = RES_PRESETS[P.aspect] || [[1920, 1080]];
    const list = P.orientation !== naturalOrientation(a) ? list0.map((r) => [r[1], r[0]]) : list0;
    sel.innerHTML = '';
    for (const [w, h] of list) {
      const o = document.createElement('option');
      o.value = w + 'x' + h;
      o.textContent = `${w} × ${h}`;
      if (P.resW === w && P.resH === h) o.selected = true;
      sel.appendChild(o);
    }
    const o = document.createElement('option');
    o.value = 'custom';
    o.textContent = 'Custom…';
    if (!list.some(([w, h]) => w === P.resW && h === P.resH)) o.selected = true;
    sel.appendChild(o);
  }

  function fillSelect(sel, pairs, value) {
    sel.innerHTML = '';
    for (const [v, label] of pairs) {
      const o = document.createElement('option');
      o.value = v; o.textContent = label;
      if (v === value) o.selected = true;
      sel.appendChild(o);
    }
  }

  /* ------------------------------------------- family grid */

  function buildFamilyGrid() {
    const grid = $('familyGrid');
    grid.innerHTML = '';
    for (const fam of TL.FAMILIES) {
      const b = document.createElement('button');
      b.className = 'fam' + (P.family === fam.id ? ' on' : '');
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', P.family === fam.id ? 'true' : 'false');
      b.title = fam.name;
      b.innerHTML = fam.icon + `<span>${fam.name}</span>`;
      b.onclick = () => {
        if (P.family === fam.id) return;
        P.family = fam.id;
        P.variant = fam.defaultVariant;
        ensureMapValid();
        syncControls(); refresh(); save();
      };
      grid.appendChild(b);
    }
  }

  /* --------------------------------------- palette templates grid */

  function currentPaletteSource() {
    // the palette the mode panel works on: the live draft, or the selected ref
    if (palDraftActive) return palDraft;
    return PAL.get(P.paletteRef);
  }

  function buildPaletteGrid() {
    const grid = $('paletteGrid');
    grid.innerHTML = '';
    const nameEl = $('palName');
    const pal = PAL.get(P.paletteRef);
    if (nameEl) nameEl.textContent = (palDraftActive ? 'edited · ' : '') + pal.name;
    PAL.LIST.forEach((palB, i) => {
      grid.appendChild(makeSwatch(palB, { kind: 'builtin', index: i }));
    });
    const customs = CP.list();
    if (customs.length) {
      const sep = document.createElement('div');
      sep.className = 'swatch-sep';
      sep.title = 'Custom palettes';
      grid.appendChild(sep);
      for (const p of customs) grid.appendChild(makeSwatch(p, { kind: 'custom', id: p.id }));
    }
  }
  function makeSwatch(pal, ref) {
    const b = document.createElement('button');
    const on = sameRef(P.paletteRef, ref);
    b.className = 'swatch' + (on ? ' on' : '');
    b.title = pal.name + (ref.kind === 'custom' ? ' (custom)' : '');
    b.style.background = `linear-gradient(135deg, ${pal.colors.join(',')})`;
    b.style.borderColor = on ? '#fff' : 'rgba(255,255,255,.15)';
    b.onclick = () => applyPaletteRef(ref);
    return b;
  }
  function applyPaletteRef(ref) {
    P.paletteRef = ref;
    palDraftActive = false;
    loadPalDraft();
    buildPaletteGrid();
    renderPalEditor();
    recolor(false); save();
  }

  /* -------------------------------------- palette editor (inline) */

  let palDraftActive = false;         // true while unsaved edits are applied
  let palDraft = null;                // {name, colors[], bg, outline}

  function loadPalDraft() {
    let src;
    if (P.paletteRef.kind === 'custom') src = CP.find(P.paletteRef.id) || PAL.LIST[0];
    else src = PAL.LIST[P.paletteRef.index] || PAL.LIST[0];
    palDraft = {
      name: src.name,
      colors: [...src.colors],
      bg: src.bg || '#0b1020',
      outline: ('outline' in src && src.outline != null) ? src.outline : null,
    };
  }
  function renderPalEditor() {
    const list = $('palStops');
    list.innerHTML = '';
    palDraft.colors.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'stoprow';
      const col = document.createElement('input');
      col.type = 'color'; col.value = c;
      col.oninput = () => {
        palDraft.colors[i] = col.value; palDraftActive = true;
        $('palEditState').textContent = 'edited · live';
        buildPaletteGrid(); renderPalPreviewStrip(); recolor(false); save();
      };
      const hex = document.createElement('input');
      hex.type = 'text'; hex.value = c; hex.className = 'hextext'; hex.spellcheck = false;
      hex.onchange = () => {
        if (GR.isHexColor(hex.value)) {
          palDraft.colors[i] = GR.normHex(hex.value); palDraftActive = true;
          $('palEditState').textContent = 'edited · live';
          buildPaletteGrid(); renderPalEditor(); recolor(false); save();
        } else hex.value = palDraft.colors[i];
      };
      const up = document.createElement('button');
      up.className = 'mini-btn'; up.textContent = '↑'; up.title = 'Move up';
      up.onclick = () => {
        if (i > 0) {
          [palDraft.colors[i - 1], palDraft.colors[i]] = [palDraft.colors[i], palDraft.colors[i - 1]];
          palDraftActive = true; buildPaletteGrid(); renderPalEditor(); recolor(false); save();
        }
      };
      const down = document.createElement('button');
      down.className = 'mini-btn'; down.textContent = '↓'; down.title = 'Move down';
      down.onclick = () => {
        if (i < palDraft.colors.length - 1) {
          [palDraft.colors[i + 1], palDraft.colors[i]] = [palDraft.colors[i], palDraft.colors[i + 1]];
          palDraftActive = true; buildPaletteGrid(); renderPalEditor(); recolor(false); save();
        }
      };
      const del = document.createElement('button');
      del.className = 'mini-btn'; del.textContent = '×'; del.title = 'Remove color';
      del.onclick = () => {
        if (palDraft.colors.length > 1) {
          palDraft.colors.splice(i, 1);
          palDraftActive = true; buildPaletteGrid(); renderPalEditor(); recolor(false); save();
        }
      };
      row.append(col, hex, up, down, del);
      list.appendChild(row);
    });
    $('palBg').value = palDraft.bg;
    $('palOutline').value = palDraft.outline || PAL.autoLineColor(palDraft.bg);
    $('palOutline').disabled = palDraft.outline == null;
    renderPalPreviewStrip();
  }
  function renderPalPreviewStrip() {
    // no separate preview canvas: the wallpaper IS the preview
  }

  /* ------------------------------------- gradient editor (inline) */

  let gradDraftActive = false;   // true while unsaved gradient edits apply
  let gradDraft = null;          // working normalized copy
  let gradEditId = null;         // template the draft started from

  function loadGradDraft() {
    const src = GR.find(P.gradientId) || GR.BUILTINS[0];
    gradDraft = GR.normalize(JSON.parse(JSON.stringify(src)));
    gradEditId = src.id;
  }
  function buildGradPick() {
    const sel = $('gradPick');
    sel.innerHTML = '';
    const g1 = document.createElement('optgroup');
    g1.label = 'Built-in';
    GR.BUILTINS.forEach((g) => {
      const o = document.createElement('option');
      o.value = g.id; o.textContent = g.name;
      if (P.gradientId === g.id) o.selected = true;
      g1.appendChild(o);
    });
    sel.appendChild(g1);
    const customs = GR.list();
    if (customs.length) {
      const g2 = document.createElement('optgroup');
      g2.label = 'Custom';
      for (const g of customs) {
        const o = document.createElement('option');
        o.value = g.id; o.textContent = g.name;
        if (P.gradientId === g.id) o.selected = true;
        g2.appendChild(o);
      }
      sel.appendChild(g2);
    }
  }
  function applyGradientId(id) {
    P.gradientId = id;
    gradDraftActive = false;
    loadGradDraft();
    buildGradPick();
    renderGradEditor();
    syncGradEditState();
    recolor(false); save();
  }
  function gradSource() {
    return gradDraftActive ? gradDraft : GR.normalize(currentGradient());
  }
  function syncGradEditState() {
    $('gradEditState').textContent = gradDraftActive ? 'edited · live' : '';
  }
  function renderGradEditor() {
    fillSelect($('gradType'), [['linear', 'Linear'], ['radial', 'Radial'], ['conic', 'Conic']], gradDraft.type);
    $('gradAngle').value = gradDraft.angle;
    $('gradAngleVal').textContent = gradDraft.angle + '°';
    $('gradStopCount').textContent = gradDraft.stops.length + ' stops';
    const list = $('gradStops');
    list.innerHTML = '';
    gradDraft.stops.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'stoprow';
      const col = document.createElement('input');
      col.type = 'color'; col.value = s.color;
      col.oninput = () => {
        gradDraft.stops[i].color = col.value;
        gradDraftActive = true; syncGradEditState();
        renderGradPreview(); recolor(false); save();
      };
      const pos = document.createElement('input');
      pos.type = 'number'; pos.min = 0; pos.max = 100; pos.step = 1;
      pos.value = Math.round(s.pos * 100);
      pos.className = 'postext';
      pos.onchange = () => {
        gradDraft.stops[i].pos = Math.max(0, Math.min(100, +pos.value || 0)) / 100;
        gradDraft.stops.sort((a, b) => a.pos - b.pos);
        gradDraftActive = true; syncGradEditState();
        renderGradEditor(); recolor(false); save();
      };
      const del = document.createElement('button');
      del.className = 'mini-btn'; del.textContent = '×'; del.title = 'Remove stop';
      del.onclick = () => {
        if (gradDraft.stops.length > 2) {
          gradDraft.stops.splice(i, 1);
          gradDraftActive = true; syncGradEditState();
          renderGradEditor(); recolor(false); save();
        }
      };
      row.append(col, pos, del);
      list.appendChild(row);
    });
    $('gradDelete').disabled = !gradEditId || GR.BUILTINS.some((g) => g.id === gradEditId);
    renderGradPreview();
  }
  function renderGradPreview() {
    const cv = $('gradPreview');
    const w = cv.parentElement ? (cv.parentElement.clientWidth || 260) : 260;
    cv.width = w; cv.height = 26;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    const g = GR.toCanvas(ctx, gradDraft, cv.width, cv.height, 0);
    if (g && g.conic) GR.fillConic(ctx, gradDraft, cv.width, cv.height);
    else { ctx.fillStyle = g; ctx.fillRect(0, 0, cv.width, cv.height); }
  }

  /* ------------------------------- single / duotone templates */

  function buildSingleTpls() {
    const box = $('singleTpls');
    box.innerHTML = '';
    SINGLE_TPLS.forEach((c) => {
      box.appendChild(makeTplSwatch(c, c === P.singleColor, () => {
        P.singleColor = c; $('singleColor').value = c;
        buildSingleTpls(); recolor(false); save();
      }));
    });
    const customs = singleStore.list();
    if (customs.length) {
      const sep = document.createElement('div');
      sep.className = 'tpl-sep';
      box.appendChild(sep);
      customs.forEach((c, i) => {
        box.appendChild(makeTplSwatch(c, c === P.singleColor, () => {
          P.singleColor = c; $('singleColor').value = c;
          buildSingleTpls(); recolor(false); save();
        }, i));
      });
    }
  }
  function makeTplSwatch(bg, on, onclick, customIdx) {
    const b = document.createElement('button');
    b.className = 'tpl' + (on ? ' on' : '');
    b.style.background = bg;
    b.title = customIdx != null ? 'Custom template' : bg;
    b.onclick = onclick;
    return b;
  }
  function buildDuoTpls() {
    const box = $('duoTpls');
    box.innerHTML = '';
    const pairOn = (a, b) => a === P.duoA && b === P.duoB;
    DUO_TPLS.forEach(([a, b]) => {
      box.appendChild(makeTplSwatch(`linear-gradient(135deg, ${a} 50%, ${b} 50%)`, pairOn(a, b), () => {
        P.duoA = a; P.duoB = b;
        $('duoA').value = a; $('duoB').value = b;
        buildDuoTpls(); recolor(false); save();
      }));
    });
    const customs = duoStore.list();
    if (customs.length) {
      const sep = document.createElement('div');
      sep.className = 'tpl-sep';
      box.appendChild(sep);
      customs.forEach((p, i) => {
        box.appendChild(makeTplSwatch(`linear-gradient(135deg, ${p.a} 50%, ${p.b} 50%)`, pairOn(p.a, p.b), () => {
          P.duoA = p.a; P.duoB = p.b;
          $('duoA').value = p.a; $('duoB').value = p.b;
          buildDuoTpls(); recolor(false); save();
        }, i));
      });
    }
  }

  /* --------------------------------------------------- rendering */

  const sceneCanvas = document.createElement('canvas');
  const sceneCtx = sceneCanvas.getContext('2d');

  let scene = null, look = null, animator = null;
  let animRaf = 0;

  function previewSize() {
    const box = $('canvasWrap').getBoundingClientRect();
    const ar = currentAspect();
    let w = box.width - 24, h = box.height - 24;
    if (w / h > ar) w = h * ar; else h = w / ar;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const cap = 1920;
    let scale = dpr;
    if (w * scale > cap) scale = cap / w;
    return { w: Math.round(w * scale), h: Math.round(h * scale), cssW: Math.round(w), cssH: Math.round(h) };
  }

  function makeLook() {
    const mode = P.themeMode;
    let lut, pal = null, grad = null;
    if (mode === 'single') {
      lut = R.buildSolidLut(P.singleColor);
    } else if (mode === 'gradient') {
      grad = gradSource();
      lut = R.buildLut({ _isGradient: true, gradient: grad });
    } else if (mode === 'duotone') {
      lut = R.buildLut({
        _isGradient: true,
        gradient: GR.normalize({
          type: 'linear', angle: 0,
          stops: [{ pos: 0, color: P.duoA }, { pos: 1, color: P.duoB }],
        }),
      });
    } else {
      pal = palDraftActive ? palDraft : PAL.get(P.paletteRef);
      lut = palDraftActive ? R.buildLutFromColors(pal.colors) : R.buildLut(P.paletteRef);
    }
    // background is mode-scoped: palette -> its bg color (or custom),
    // gradient -> the gradient itself (or a solid color), single/duotone -> custom color
    let bg, bgPaint = null;
    const bgSrc = (mode === 'palette' || mode === 'gradient') ? P.bgSource : 'custom';
    if (mode === 'gradient' && bgSrc === 'gradient') {
      bg = GR.sample(grad, 0.5);
      bgPaint = (ctx, W, H) => {
        const g = GR.toCanvas(ctx, grad, W, H, 0);
        if (g && g.conic) GR.fillConic(ctx, grad, W, H);
        else { ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
      };
    } else if (mode === 'palette' && bgSrc === 'theme') {
      bg = pal.bg;
    } else {
      bg = P.bgColor;
    }
    // outline: palette's own outline (when lineAuto) -> auto -> manual
    const palOutline = pal && pal.outline != null ? pal.outline : null;
    const line = P.lineAuto ? (palOutline || PAL.autoLineColor(bg)) : P.lineColor;
    const look = {
      lut, line, bg, gap: P.gap, outlineWidth: P.outlineWidth,
      alpha: Math.max(0, Math.min(1, (P.fgAlpha == null ? 100 : +P.fgAlpha) / 100)),
    };
    if (bgPaint) look.bgPaint = bgPaint;
    return look;
  }

  function fxParams() {
    return { ...P.effects };
  }

  function regenerate() {
    const ps = previewSize();
    canvas.width = ps.w; canvas.height = ps.h;
    canvas.style.width = ps.cssW + 'px';
    canvas.style.height = ps.cssH + 'px';
    sceneCanvas.width = ps.w; sceneCanvas.height = ps.h;

    const t0 = performance.now();
    const scaleToTarget = ps.w / P.resW;
    const p = Object.assign({}, P, { tileSize: P.tileSize * scaleToTarget });
    const budget = (P.animation === 'none' ? 450000 : 120000);
    scene = R.buildScene(p, ps.w, ps.h, { budget });
    if (!scene) { statusEl.textContent = 'failed to build tiling'; return; }
    p.colorMap = currentMap();
    R.colorize(scene, p);
    look = makeLook();
    animator = R.makeAnimator(scene, p, look);
    const ms = (performance.now() - t0).toFixed(0);

    let status = '';
    if (scene.kind === 'hat') {
      status = `level ${scene.level} · ${scene.hats.length.toLocaleString()} tiles · ${ms} ms` + (scene.degraded ? ' · (best effort fit)' : '');
    } else {
      status = `${scene.tiles.length.toLocaleString()} tiles · ${ms} ms`;
      if (scene.coarse > 1.01) status += ` · scale ×${scene.coarse.toFixed(1)} (budget)`;
    }
    statusEl.textContent = status;

    // the scene is ready: refresh family-aware arrangement options
    syncMapSelects();

    // paint the static scene once (transparent bg; background comes from Effects)
    R.paintScene(sceneCtx, scene, p, look);
    composeFrame(0);
    if (P.animation !== 'none') {
      cancelAnimationFrame(animRaf);
      animRaf = requestAnimationFrame(loop);
    }
  }

  function composeFrame(t) {
    const ctx = canvas.getContext('2d');
    FX.compose(ctx, sceneCanvas, scene.W, scene.H, look, fxParams(),
      animator && animator.overlayFn ? (c) => animator.overlayFn(c, t) : null);
  }

  // live re-color: recompute the tile map and/or the color LUT and repaint
  // the scene canvas without rebuilding tiling geometry (cheap enough to
  // run on every color-input event)
  function recolor(rebuildMap) {
    if (!scene) return;
    if (rebuildMap) R.colorize(scene, Object.assign({}, P, { colorMap: currentMap() }));
    look = makeLook();
    animator = R.makeAnimator(scene, P, look);
    R.paintScene(sceneCtx, scene, P, look);
    composeFrame(performance.now());
  }

  function loop(t) {
    animRaf = requestAnimationFrame(loop);
    if (P.animation === 'none') return;
    if (animator && animator.perTile) {
      sceneCtx.clearRect(0, 0, scene.W, scene.H);
      animator.frame(sceneCtx, t);
    }
    composeFrame(t);
  }

  let refreshTimer = 0;
  function refresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      cancelAnimationFrame(animRaf);
      regenerate();
    }, 120);
  }

  /* ------------------------------------------------------- export */

  async function exportPNG() {
    statusEl.textContent = 'rendering full resolution…';
    await new Promise((r) => setTimeout(r, 30));
    const t0 = performance.now();
    const off = document.createElement('canvas');
    off.width = P.resW; off.height = P.resH;
    const offScene = document.createElement('canvas');
    offScene.width = P.resW; offScene.height = P.resH;
    const p = Object.assign({}, P, { animation: 'none' });
    p.colorMap = currentMap();
    const sc = R.buildScene(p, P.resW, P.resH, { budget: 500000 });
    if (!sc) { statusEl.textContent = 'export failed'; return; }
    R.colorize(sc, p);
    const lk = makeLook();
    const sctx = offScene.getContext('2d');
    R.paintScene(sctx, sc, p, lk);
    FX.compose(off.getContext('2d'), offScene, P.resW, P.resH, lk, fxParams());
    off.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${famTag()}-${P.resW}x${P.resH}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      const n = sc.kind === 'hat' ? sc.hats.length : sc.tiles.length;
      statusEl.textContent = `PNG saved · ${n.toLocaleString()} tiles · ${(performance.now() - t0).toFixed(0)} ms`;
    }, 'image/png');
  }

  /* ------------------------------------------- animated exports */

  const tickAsync = () => new Promise((r) => setTimeout(r, 0));
  function famTag() { return P.family === 'hat' ? 'einstein' : P.family; }
  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // Shared animated-export pipeline: the scene is rebuilt at the EXACT
  // canvas resolution chosen by the user (same geometry math as PNG export
  // and the preview — scale factor 1:1), then frames are rendered by
  // stepping the animation deterministically through one seamless loop.
  function buildLoopExport() {
    const W = P.resW, H = P.resH;
    const p = Object.assign({}, P);
    p.colorMap = currentMap();
    const sc = R.buildScene(p, W, H, { budget: P.animation === 'none' ? 500000 : 200000 });
    if (!sc) return null;
    R.colorize(sc, p);
    const lk = makeLook();
    const animator = R.makeAnimator(sc, p, lk);
    const sceneC = document.createElement('canvas');
    sceneC.width = W; sceneC.height = H;
    const sctx = sceneC.getContext('2d');
    const outC = document.createElement('canvas');
    outC.width = W; outC.height = H;
    const octx = outC.getContext('2d');
    // paint the static scene ONCE into the scene canvas: per-tile
    // animations repaint it every frame, overlay animations (flow /
    // glow wave) and static exports composite this painted base
    R.paintScene(sctx, sc, p, lk);
    const renderAt = (t) => {
      const overlay = animator && animator.overlayFn ? (c) => animator.overlayFn(c, t) : null;
      if (animator && animator.perTile) {
        sctx.clearRect(0, 0, W, H);
        animator.frame(sctx, t);
      }
      FX.compose(octx, sceneC, W, H, lk, fxParams(), overlay);
    };
    return { W, H, sc, octx, renderAt, animator };
  }

  // pick frame count x delay (whole centiseconds) so that
  // frames x delay x 10ms lands closest to the true loop period
  function solveLoopTiming(periodMs) {
    let best = null;
    for (let d = 3; d <= 15; d++) {
      const f = Math.round(periodMs / (d * 10));
      if (f < 2 || f > 200) continue;
      const err = Math.abs(f * d * 10 - periodMs);
      if (!best || err < best.err) best = { d, f, err };
    }
    if (!best) best = { d: 6, f: Math.max(2, Math.min(200, Math.round(periodMs / 60))) };
    return { frames: best.f, delayCs: best.d };
  }

  let gifBusy = false;
  async function exportGIF() {
    if (gifBusy) return;
    gifBusy = true;
    const btn = $('gifBtn');
    const orig = btn.textContent;
    try {
      statusEl.textContent = 'rendering GIF frames…';
      await tickAsync();
      const prep = buildLoopExport();
      if (!prep) { statusEl.textContent = 'GIF export failed'; return; }
      const { W, H, octx, renderAt, animator } = prep;
      const period = animator && animator.periodMs ? animator.periodMs : 0;
      let frames = 1, delayCs = 0;
      if (period > 0) ({ frames, delayCs } = solveLoopTiming(period));

      // one global palette from a spread of sample frames keeps colors
      // stable across the animation (no per-frame palette flicker)
      const nS = Math.min(frames, 12);
      const samples = [];
      for (let s = 0; s < nS; s++) {
        renderAt(Math.round((s * frames) / nS) * delayCs * 10);
        samples.push(new Uint8ClampedArray(octx.getImageData(0, 0, W, H).data));
        btn.textContent = `palette ${Math.round(((s + 1) / nS) * 100)}%`;
        await tickAsync();
      }
      const pal = Gif.buildPalette(samples, 256);
      const map = Gif.createMapper(pal);
      const writer = new Gif.GifWriter(W, H, pal, { loop: 0 });
      writer.start();
      for (let i = 0; i < frames; i++) {
        renderAt(i * delayCs * 10);
        writer.addFrame(map(octx.getImageData(0, 0, W, H).data, W, H), delayCs);
        btn.textContent = `${Math.round(((i + 1) / frames) * 100)}%`;
        if ((i & 1) === 1) await tickAsync();
      }
      const bytes = writer.finish();
      downloadBlob(new Blob([bytes], { type: 'image/gif' }),
        `${famTag()}-live-${frames}f-${W}x${H}.gif`);
      statusEl.textContent = `GIF saved · ${frames} frame${frames > 1 ? 's' : ''} · ${W}x${H} · ${(bytes.length / 1048576).toFixed(1)} MB`;
    } finally {
      btn.textContent = orig;
      gifBusy = false;
    }
  }

  let apngBusy = false;
  async function exportAPNG() {
    if (apngBusy) return;
    apngBusy = true;
    const btn = $('apngBtn');
    const orig = btn.textContent;
    try {
      statusEl.textContent = 'rendering APNG frames…';
      await tickAsync();
      const prep = buildLoopExport();
      if (!prep) { statusEl.textContent = 'APNG export failed'; return; }
      const { W, H, octx, renderAt, animator } = prep;
      const period = animator && animator.periodMs ? animator.periodMs : 0;
      let frames = 1, delayCs = 0;
      if (period > 0) ({ frames, delayCs } = solveLoopTiming(period));
      const enc = new AP.ApngEncoder(W, H, { totalFrames: frames, delayNum: delayCs * 10, delayDen: 1000 });
      enc.start();
      for (let i = 0; i < frames; i++) {
        renderAt(i * delayCs * 10);
        await enc.addFrame(octx.getImageData(0, 0, W, H).data);
        btn.textContent = `${Math.round(((i + 1) / frames) * 100)}%`;
        await tickAsync();
      }
      const bytes = enc.finish();
      downloadBlob(new Blob([bytes], { type: 'image/apng' }),
        `${famTag()}-live-${frames}f-${W}x${H}.png`);
      statusEl.textContent = `APNG saved · ${frames} frame${frames > 1 ? 's' : ''} · ${W}x${H} · ${(bytes.length / 1048576).toFixed(1)} MB (lossless)`;
    } finally {
      btn.textContent = orig;
      apngBusy = false;
    }
  }

  /* ------------------------------------------------ randomize */

  function randomize() {
    const rr = Math.random;
    // family: keep hat prominent
    P.family = rr() < 0.35 ? 'hat' : TL.FAMILIES[1 + Math.floor(rr() * (TL.FAMILIES.length - 1))].id;
    const fam = currentFamily();
    P.variant = fam.variants[Math.floor(rr() * fam.variants.length)].id;
    const vivid = ['#5bc8ff', '#ff8bd2', '#ffe14d', '#6be3a2', '#b07bff', '#ff8a5b', '#4dffb8', '#f4777f'];
    const tm = rr();
    P.themeMode = tm < 0.45 ? 'palette' : tm < 0.72 ? 'gradient' : tm < 0.9 ? 'duotone' : 'single';
    // drop unsaved edits — randomize starts from templates
    palDraftActive = false; gradDraftActive = false;
    if (P.themeMode === 'palette') {
      const nB = PAL.LIST.length, nC = CP.count();
      P.paletteRef = (nC && rr() < 0.25)
        ? { kind: 'custom', id: CP.list()[Math.floor(rr() * nC)].id }
        : { kind: 'builtin', index: Math.floor(rr() * nB) };
      const pOpts = arrOptions('palette');
      P.colorMap = pOpts[Math.floor(rr() * pOpts.length)];
      P.bgSource = rr() < 0.85 ? 'theme' : 'custom';
    } else if (P.themeMode === 'gradient') {
      const all = GR.all();
      P.gradientId = all[Math.floor(rr() * all.length)].id;
      const gm = rr();
      P.gradMap = gm < 0.55 ? 'sweep' : gm < 0.8 ? 'bands' : 'random';
      P.gradBands = 3 + Math.floor(rr() * 6);
      P.bgSource = rr() < 0.4 ? 'gradient' : 'custom';
    } else if (P.themeMode === 'duotone') {
      P.duoA = vivid[Math.floor(rr() * vivid.length)];
      P.duoB = PAL.hslRotate(P.duoA, 110 + rr() * 140);
      P.duoMap = ['checker', 'sweep', 'random'][Math.floor(rr() * 3)];
      P.bgColor = PAL.shade(P.duoA, 0.22);
    } else {
      P.singleColor = vivid[Math.floor(rr() * vivid.length)];
      P.bgColor = PAL.shade(P.singleColor, 0.2);
    }
    // reload drafts so the editors show the freshly applied templates
    palDraftActive = false; gradDraftActive = false;
    loadPalDraft(); loadGradDraft();
    P.fgAlpha = rr() < 0.8 ? 100 : 55 + Math.round(rr() * 40);
    P.animation = ['none', 'shimmer', 'flow', 'glowwave'][Math.floor(rr() * 4)];
    P.flowAngle = Math.floor(rr() * 24) * 15;
    P.rotation = Math.floor(rr() * 24) * 15;
    P.tileSize = Math.round(16 + rr() * 60);
    P.gap = rr() < 0.6 ? 0 : +(rr() * 0.05).toFixed(3);
    P.seed = Math.floor(rr() * 99999);
    P.effects = { ...FX_DEFAULTS };
    if (rr() < 0.4) {
      const pick = ['glow', 'vignette', 'grain', 'shadow'][Math.floor(rr() * 4)];
      P.effects[pick] = pick === 'glow' ? 20 + rr() * 25 : pick === 'grain' ? 8 + rr() * 12 : 25 + rr() * 25;
    }
    syncControls();
    refresh();
    save();
  }

  function fullscreen() {
    const el = $('canvasWrap');
    if (!document.fullscreenElement) el.requestFullscreen && el.requestFullscreen();
    else document.exitFullscreen();
  }

  /* ------------------------------------------------- control sync */

  function syncAnimVisibility() {
    const showAngle = P.animation === 'flow' || P.animation === 'glowwave';
    $('flowAngleRow').style.display = showAngle ? '' : 'none';
  }

  /* --------------------------------- color theme control building */

  function buildThemeControls() {
    const box = $('themeModeChips');
    box.innerHTML = '';
    for (const [m, label] of THEME_MODES) {
      const b = document.createElement('button');
      b.className = 'chip' + (P.themeMode === m ? ' on' : '');
      b.textContent = label;
      b.onclick = () => setThemeMode(m);
      box.appendChild(b);
    }
    ensureMapValid();
    syncMapSelects();
    $('gradBands').value = P.gradBands;
    $('gradBandsVal').textContent = P.gradBands;
    $('singleColor').value = P.singleColor;
    $('duoA').value = P.duoA;
    $('duoB').value = P.duoB;
    buildGradPick();
    buildSingleTpls();
    buildDuoTpls();
    const bgSel = $('bgSource');
    if (P.themeMode === 'palette') {
      fillSelect(bgSel, [['theme', 'From palette'], ['custom', 'Custom color']],
        P.bgSource === 'gradient' ? 'theme' : P.bgSource);
    } else if (P.themeMode === 'gradient') {
      fillSelect(bgSel, [['custom', 'Solid color'], ['gradient', 'Gradient']],
        P.bgSource === 'theme' ? 'custom' : P.bgSource);
    }
    $('bgColor').value = P.bgColor;
    $('fgAlpha').value = P.fgAlpha;
    $('fgAlphaVal').textContent = P.fgAlpha + '%';
    syncThemeVisibility();
  }

  // fill the per-mode arrangement selects from the family-aware option lists
  function syncMapSelects() {
    fillSelect($('palMap'), arrOptions('palette').map((m) => [m, MAP_LABELS[m] || m]), P.colorMap);
    fillSelect($('gradMapSel'), arrOptions('gradient').map((m) => [m, MAP_LABELS[m] || m]), P.gradMap);
    fillSelect($('duoMapSel'), arrOptions('duotone').map((m) => [m, MAP_LABELS[m] || m]), P.duoMap);
  }

  // show only the panel (and rows) that belong to the active theme mode
  function syncThemeVisibility() {
    const mode = P.themeMode;
    const show = (id, on) => { $(id).style.display = on ? '' : 'none'; };
    show('panel-single', mode === 'single');
    show('panel-palette', mode === 'palette');
    show('panel-gradient', mode === 'gradient');
    show('panel-duotone', mode === 'duotone');
    show('gradBandsRow', mode === 'gradient' && P.gradMap === 'bands');
    show('bgSourceWrap', mode === 'palette' || mode === 'gradient');
    show('bgColorWrap', mode === 'single' || mode === 'duotone' || P.bgSource === 'custom');
    show('bgRow', !(mode === 'palette' && P.bgSource === 'theme'));
  }
  function syncFamilyVisibility() {
    const isLine = P.family === 'lines';
    $('gapRow').style.display = isLine ? 'none' : '';
    $('outlineRow').style.display = isLine ? 'none' : '';
  }

  function setSlider(id, valId, v, fmt) {
    $(id).value = v;
    $(valId).textContent = fmt(v);
  }

  function syncControls() {
    buildAspectChips();
    buildResSelect();
    buildFamilyGrid();
    buildPaletteGrid();
    const fam = currentFamily();
    fillSelect($('variantSelect'), fam.variants.map((v) => [v.id, v.name]), P.variant);
    fillSelect($('animSelect'), ANIMS, P.animation);
    buildThemeControls();
    setSlider('tileSize', 'tileSizeVal', P.tileSize, (v) => v + ' px');
    setSlider('rotation', 'rotationVal', P.rotation, (v) => v + '°');
    setSlider('gap', 'gapVal', Math.round(P.gap * 100), (v) => v + '%');
    setSlider('outlineWidth', 'outlineWidthVal', P.outlineWidth, (v) => (+v).toFixed(1) + ' px');
    setSlider('animSpeed', 'animSpeedVal', P.animSpeed, (v) => (+v).toFixed(1) + '×');
    setSlider('flowAngle', 'flowAngleVal', P.flowAngle, (v) => v + '°');
    setSlider('seed', 'seedVal', P.seed, (v) => '#' + v);
    const fx = P.effects;
    setSlider('fxBlur', 'fxBlurVal', fx.blur, (v) => (+v) + ' px');
    setSlider('fxGlow', 'fxGlowVal', fx.glow, (v) => Math.round(v) + '%');
    setSlider('fxGlowRadius', 'fxGlowRadiusVal', fx.glowRadius, (v) => v + ' px');
    setSlider('fxShadow', 'fxShadowVal', fx.shadow, (v) => Math.round(v) + '%');
    setSlider('fxShadowSoft', 'fxShadowSoftVal', fx.shadowSoft, (v) => v + ' px');
    setSlider('fxShadowOff', 'fxShadowOffVal', fx.shadowOff, (v) => v + ' px');
    setSlider('fxGrain', 'fxGrainVal', fx.grain, (v) => Math.round(v) + '%');
    setSlider('fxVignette', 'fxVignetteVal', fx.vignette, (v) => Math.round(v) + '%');
    $('fxVignetteMode').value = fx.vignetteMode;
    $('resW').value = P.resW; $('resH').value = P.resH;
    $('lineAuto').checked = P.lineAuto;
    $('lineColor').value = P.lineColor;
    $('lineColor').disabled = P.lineAuto;
    const orBtns = document.querySelectorAll('[data-orient]');
    orBtns.forEach((b) => b.classList.toggle('on', b.dataset.orient === P.orientation));
    syncAnimVisibility();
    syncFamilyVisibility();
    renderPalEditor();
    renderGradEditor();
    syncGradEditState();
    $('palEditState').textContent = palDraftActive ? 'edited · live' : '';
  }

  /* ------------------------------------------------------- bind */

  function bind() {
    $('resSelect').onchange = (e) => {
      if (e.target.value === 'custom') { $('resW').focus(); return; }
      const [w, h] = e.target.value.split('x').map(Number);
      P.resW = w; P.resH = h;
      $('resW').value = w; $('resH').value = h;
      refresh(); save();
    };
    const resChanged = () => {
      P.resW = Math.max(64, Math.min(8192, +$('resW').value || P.resW));
      P.resH = Math.max(64, Math.min(8192, +$('resH').value || P.resH));
      refresh(); save();
    };
    $('resW').onchange = resChanged;
    $('resH').onchange = resChanged;
    document.querySelectorAll('[data-orient]').forEach((b) => {
      b.onclick = () => {
        P.orientation = b.dataset.orient;
        applyResForAspect();
        syncControls(); refresh(); save();
      };
    });
    $('tileSize').oninput = (e) => { P.tileSize = +e.target.value; $('tileSizeVal').textContent = P.tileSize + ' px'; refresh(); save(); };
    $('rotation').oninput = (e) => { P.rotation = +e.target.value; $('rotationVal').textContent = P.rotation + '°'; refresh(); save(); };
    $('gap').oninput = (e) => { P.gap = e.target.value / 100; $('gapVal').textContent = e.target.value + '%'; refresh(); save(); };
    $('outlineWidth').oninput = (e) => { P.outlineWidth = +e.target.value; $('outlineWidthVal').textContent = (+e.target.value).toFixed(1) + ' px'; refresh(); save(); };
    $('animSpeed').oninput = (e) => { P.animSpeed = +e.target.value; $('animSpeedVal').textContent = (+e.target.value).toFixed(1) + '×'; save(); };
    $('flowAngle').oninput = (e) => { P.flowAngle = +e.target.value; $('flowAngleVal').textContent = P.flowAngle + '°'; save(); };
    $('seed').oninput = (e) => { P.seed = +e.target.value || 1; $('seedVal').textContent = '#' + P.seed; refresh(); save(); };
    $('animSelect').onchange = (e) => { P.animation = e.target.value; syncAnimVisibility(); refresh(); save(); };
    $('variantSelect').onchange = (e) => { P.variant = e.target.value; refresh(); save(); };

    // ---- color theme: per-mode arrangements ----
    $('palMap').onchange = (e) => { P.colorMap = e.target.value; recolor(true); save(); };
    $('gradMapSel').onchange = (e) => { P.gradMap = e.target.value; syncThemeVisibility(); recolor(true); save(); };
    $('duoMapSel').onchange = (e) => { P.duoMap = e.target.value; recolor(true); save(); };
    $('gradBands').oninput = (e) => { P.gradBands = Math.max(2, Math.min(12, +e.target.value || 5)); $('gradBandsVal').textContent = P.gradBands; recolor(true); save(); };
    $('singleColor').oninput = (e) => { P.singleColor = e.target.value; buildSingleTpls(); recolor(false); save(); };
    $('duoA').oninput = (e) => { P.duoA = e.target.value; buildDuoTpls(); recolor(false); save(); };
    $('duoB').oninput = (e) => { P.duoB = e.target.value; buildDuoTpls(); recolor(false); save(); };
    $('gradPick').onchange = (e) => applyGradientId(e.target.value);
    $('bgSource').onchange = (e) => { P.bgSource = e.target.value; syncThemeVisibility(); recolor(false); save(); };
    $('bgColor').oninput = (e) => { P.bgColor = e.target.value; recolor(false); save(); };
    $('fgAlpha').oninput = (e) => {
      P.fgAlpha = Math.max(0, Math.min(100, +e.target.value || 0));
      $('fgAlphaVal').textContent = P.fgAlpha + '%';
      recolor(false); save();
    };
    $('lineAuto').onchange = (e) => { P.lineAuto = e.target.checked; $('lineColor').disabled = P.lineAuto; recolor(false); save(); };
    $('lineColor').oninput = (e) => { P.lineColor = e.target.value; recolor(false); save(); };

    // ---- single / duotone template save/delete ----
    $('singleTplSave').onclick = () => {
      if (!singleStore.list().includes(P.singleColor)) {
        singleStore.add(P.singleColor);
        buildSingleTpls();
        statusEl.textContent = 'single-color template saved';
      } else statusEl.textContent = 'already saved';
    };
    $('singleTplDelete').onclick = () => {
      const i = singleStore.list().indexOf(P.singleColor);
      if (i >= 0) { singleStore.remove(i); buildSingleTpls(); statusEl.textContent = 'template deleted'; }
      else statusEl.textContent = 'select a custom template first';
    };
    $('duoTplSave').onclick = () => {
      const list = duoStore.list();
      if (!list.some((p) => p.a === P.duoA && p.b === P.duoB)) {
        duoStore.add({ a: P.duoA, b: P.duoB });
        buildDuoTpls();
        statusEl.textContent = 'duotone template saved';
      } else statusEl.textContent = 'already saved';
    };
    $('duoTplDelete').onclick = () => {
      const list = duoStore.list();
      const i = list.findIndex((p) => p.a === P.duoA && p.b === P.duoB);
      if (i >= 0) { duoStore.remove(i); buildDuoTpls(); statusEl.textContent = 'template deleted'; }
      else statusEl.textContent = 'select a custom template first';
    };

    // ---- palette editor (inline in Palette mode) ----
    $('palAddColor').onclick = () => {
      if (palDraft.colors.length < CP.MAX_COLORS) {
        palDraft.colors.push('#88aacc');
        palDraftActive = true;
        $('palEditState').textContent = 'edited · live';
        buildPaletteGrid(); renderPalEditor(); recolor(false); save();
      }
    };
    $('palDraftReset').onclick = () => {
      palDraftActive = false;
      loadPalDraft();
      $('palEditState').textContent = '';
      buildPaletteGrid(); renderPalEditor(); recolor(false); save();
    };
    $('palBg').oninput = (e) => { palDraft.bg = e.target.value; palDraftActive = true; $('palEditState').textContent = 'edited · live'; recolor(false); save(); };
    $('palOutline').oninput = (e) => { palDraft.outline = e.target.value; palDraftActive = true; $('palEditState').textContent = 'edited · live'; recolor(false); save(); };
    $('palOutlineAuto').onclick = () => {
      palDraft.outline = null; palDraftActive = true;
      $('palEditState').textContent = 'edited · live';
      renderPalEditor(); recolor(false); save();
    };
    $('palSave').onclick = () => {
      const draft = JSON.parse(JSON.stringify(palDraft));
      if (P.paletteRef.kind === 'custom' && palDraftActive) {
        CP.update(P.paletteRef.id, draft);
        statusEl.textContent = 'custom palette updated';
      } else {
        const created = CP.create({ ...draft, name: draft.name + ' (custom)' });
        if (created) P.paletteRef = { kind: 'custom', id: created.id };
        statusEl.textContent = 'palette saved as custom';
      }
      palDraftActive = false;
      loadPalDraft();
      save(); syncControls(); recolor(false);
    };
    $('palDuplicate').onclick = () => {
      const src = P.paletteRef.kind === 'custom' ? P.paletteRef.id : null;
      const created = src ? CP.duplicate(src) : CP.create(JSON.parse(JSON.stringify(palDraft)));
      if (created) {
        P.paletteRef = { kind: 'custom', id: created.id };
        palDraftActive = false; loadPalDraft();
        buildPaletteGrid(); renderPalEditor();
      }
      statusEl.textContent = 'palette duplicated';
      save(); recolor(false);
    };
    $('palDelete').onclick = () => {
      if (P.paletteRef.kind !== 'custom') { statusEl.textContent = 'built-in palettes cannot be deleted'; return; }
      CP.remove(P.paletteRef.id);
      P.paletteRef = { kind: 'builtin', index: 0 };
      palDraftActive = false; loadPalDraft();
      syncControls(); refresh(); save();
      statusEl.textContent = 'palette deleted';
    };

    // ---- gradient editor (inline in Gradient mode) ----
    $('gradType').onchange = (e) => {
      gradDraft.type = e.target.value;
      gradDraftActive = true; syncGradEditState();
      renderGradPreview(); recolor(false); save();
    };
    $('gradAngle').oninput = (e) => {
      gradDraft.angle = +e.target.value;
      $('gradAngleVal').textContent = gradDraft.angle + '°';
      gradDraftActive = true; syncGradEditState();
      renderGradPreview(); recolor(false); save();
    };
    $('gradAddStop').onclick = () => {
      if (gradDraft.stops.length < 16) {
        gradDraft.stops.push({ pos: 1, color: '#88aacc' });
        gradDraft.stops.sort((a, b) => a.pos - b.pos);
        gradDraftActive = true; syncGradEditState();
        renderGradEditor(); recolor(false); save();
      }
    };
    $('gradDraftReset').onclick = () => {
      gradDraftActive = false;
      loadGradDraft();
      syncGradEditState();
      renderGradEditor(); recolor(false); save();
    };
    $('gradSave').onclick = () => {
      const g = JSON.parse(JSON.stringify(gradDraft));
      const editingCustom = gradDraftActive && gradEditId && !GR.BUILTINS.some((x) => x.id === gradEditId);
      const saved = GR.save(editingCustom ? { ...g, id: gradEditId } : g);
      P.gradientId = saved.id;
      gradEditId = saved.id;
      gradDraftActive = false;
      loadGradDraft();
      save(); syncControls(); recolor(false);
      statusEl.textContent = editingCustom ? 'custom gradient updated' : 'gradient saved as custom';
    };
    $('gradDelete').onclick = () => {
      if (!gradEditId || GR.BUILTINS.some((g) => g.id === gradEditId)) {
        statusEl.textContent = 'built-in gradients cannot be deleted';
        return;
      }
      GR.remove(gradEditId);
      P.gradientId = GR.BUILTINS[0].id;
      gradDraftActive = false; loadGradDraft();
      syncControls(); recolor(false); save();
      statusEl.textContent = 'gradient deleted';
    };

    // ---- theme export/import (all template kinds) ----
    $('themeExport').onclick = () => {
      const json = CP.exportJSON(CP.list(), GR.list(), {
        single: singleStore.list(),
        duo: duoStore.list(),
      });
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'einstein-wallpaper-themes.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      statusEl.textContent = 'themes exported';
    };
    $('themeImport').onclick = () => $('themeFile').click();
    $('themeFile').onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const res = CP.importJSON(String(reader.result));
          if (res.extras) {
            if (Array.isArray(res.extras.single)) res.extras.single.forEach((c) => { if (GR.isHexColor(c) && !singleStore.list().includes(c)) singleStore.add(c); });
            if (Array.isArray(res.extras.duo)) res.extras.duo.forEach((p) => { if (p && GR.isHexColor(p.a) && GR.isHexColor(p.b) && !duoStore.list().some((q) => q.a === p.a && q.b === p.b)) duoStore.add(p); });
            buildSingleTpls(); buildDuoTpls();
          }
          syncControls(); refresh(); save();
          statusEl.textContent = `imported ${res.palettes} palettes, ${res.gradients} gradients` +
            (res.extras ? `, ${res.extras.single.length || 0} single + ${res.extras.duo.length || 0} duotone templates` : '');
        } catch (err) {
          statusEl.textContent = 'import failed: ' + err.message;
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    };

    // ---- effects ----
    const fxBind = (id, key, valId, fmt, immediate) => {
      $(id).oninput = (e) => {
        P.effects[key] = +e.target.value;
        $(valId).textContent = fmt(+e.target.value);
        if (immediate) composeFrame(performance.now());
        save();
      };
    };
    // `true` = recompose immediately on input (post-processing only, the
    // painted scene canvas is reused, so this is cheap and gives live feedback)
    fxBind('fxBlur', 'blur', 'fxBlurVal', (v) => v + ' px', true);
    fxBind('fxGlow', 'glow', 'fxGlowVal', (v) => Math.round(v) + '%', true);
    fxBind('fxGlowRadius', 'glowRadius', 'fxGlowRadiusVal', (v) => v + ' px', true);
    fxBind('fxShadow', 'shadow', 'fxShadowVal', (v) => Math.round(v) + '%', true);
    fxBind('fxShadowSoft', 'shadowSoft', 'fxShadowSoftVal', (v) => v + ' px', true);
    fxBind('fxShadowOff', 'shadowOff', 'fxShadowOffVal', (v) => v + ' px', true);
    fxBind('fxGrain', 'grain', 'fxGrainVal', (v) => Math.round(v) + '%', true);
    fxBind('fxVignette', 'vignette', 'fxVignetteVal', (v) => Math.round(v) + '%', true);
    $('fxVignetteMode').onchange = (e) => { P.effects.vignetteMode = e.target.value; composeFrame(performance.now()); save(); };

    $('randomBtn').onclick = randomize;
    $('pngBtn').onclick = exportPNG;
    $('gifBtn').onclick = exportGIF;
    $('apngBtn').onclick = exportAPNG;
    $('fsBtn').onclick = fullscreen;
    $('resetBtn').onclick = () => {
      P = JSON.parse(JSON.stringify(DEFAULTS));
      palDraftActive = false; gradDraftActive = false;
      loadPalDraft(); loadGradDraft();
      save(); syncControls(); refresh();
    };
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'r') randomize();
      if (e.key === 'f') fullscreen();
    });
    window.addEventListener('resize', () => { refresh(); });
    document.addEventListener('fullscreenchange', () => { setTimeout(refresh, 60); });
  }

  bind();
  // default gradient selection
  if (!P.gradientId || !GR.find(P.gradientId)) P.gradientId = GR.BUILTINS[0].id;
  loadPalDraft();
  loadGradDraft();
  syncControls();
  regenerate();
})();
