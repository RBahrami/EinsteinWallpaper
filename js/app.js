/*
 * app.js — UI wiring for EinsteinWallpaper.
 */
(function () {
  'use strict';

  const HT = window.HatTiling, R = window.Renderer, PAL = window.Palettes;

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
    ['cascade', 'Cascade (tiles appear)'],
    ['drift', 'Drift (slow pan)'],
    ['hue', 'Hue cycle'],
    ['pulse', 'Pulse (breathing)'],
  ];

  const MODES = [
    ['supertile', 'Supertiles (patches)'],
    ['orientation', 'By orientation'],
    ['mirror', 'Mirror split'],
    ['gradient', 'Gradient sweep'],
    ['random', 'Random mix'],
    ['solid', 'Solid color'],
  ];

  const DEFAULTS = {
    aspect: '16:9', orientation: 'landscape',
    resW: 1920, resH: 1080,
    tileSize: 34, variant: 'H', rotation: 0, panX: 0, panY: 0,
    gap: 0.02, outlineWidth: 1.2,
    colorMode: 'supertile', palette: 0,
    lineAuto: true, lineColor: '#101014',
    animation: 'shimmer', animSpeed: 1,
    seed: 7,
  };

  let P = Object.assign({}, DEFAULTS);
  try {
    const saved = localStorage.getItem('einstein-wallpaper-v1');
    if (saved) P = Object.assign({}, DEFAULTS, JSON.parse(saved));
  } catch (e) { /* ignore */ }

  function save() {
    try { localStorage.setItem('einstein-wallpaper-v1', JSON.stringify(P)); } catch (e) { /* ignore */ }
  }

  function naturalOrientation(a) { return a.r >= 1 ? 'landscape' : 'portrait'; }

  function currentAspect() {
    const a = ASPECTS.find((x) => x.id === P.aspect) || ASPECTS[0];
    const nat = naturalOrientation(a);
    if (P.orientation === nat) return a.r;
    return 1 / a.r;
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
        syncControls(); refresh();
        save();
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

  function buildPaletteGrid() {
    const grid = $('paletteGrid');
    grid.innerHTML = '';
    const nameEl = $('palName');
    if (nameEl) nameEl.textContent = PAL.LIST[P.palette].name;
    PAL.LIST.forEach((pal, i) => {
      const b = document.createElement('button');
      b.className = 'swatch' + (P.palette === i ? ' on' : '');
      b.title = pal.name;
      b.style.background = `linear-gradient(135deg, ${pal.colors.join(',')})`;
      b.style.borderColor = P.palette === i ? '#fff' : 'rgba(255,255,255,.15)';
      b.onclick = () => { P.palette = i; buildPaletteGrid(); refresh(); save(); };
      grid.appendChild(b);
    });
  }

  function setSlider(id, valId, v, fmt) {
    $(id).value = v;
    $(valId).textContent = fmt(v);
  }

  /* --------------------------------------------------- rendering */

  let scene = null, look = null, animator = null;
  let renderPending = false, animRaf = 0, recording = false;

  function previewSize() {
    // fit current aspect into the preview viewport, capped resolution
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
    const pal = PAL.get(P.palette);
    const lut = R.buildLut(P.palette);
    const line = P.lineAuto ? PAL.autoLineColor(pal.bg) : P.lineColor;
    return { lut, line, bg: pal.bg, gap: P.gap, outlineWidth: P.outlineWidth };
  }

  function regenerate(fitOnly) {
    const ps = previewSize();
    canvas.width = ps.w; canvas.height = ps.h;
    canvas.style.width = ps.cssW + 'px';
    canvas.style.height = ps.cssH + 'px';

    const t0 = performance.now();
    // preview scale: same visual scale as the target resolution
    const scaleToTarget = ps.w / P.resW;
    const p = Object.assign({}, P, { tileSize: P.tileSize * scaleToTarget });
    const budget = p.animation === 'none' ? 450000 : 120000;
    scene = R.buildScene(p, ps.w, ps.h, { budget });
    if (!scene) { statusEl.textContent = 'failed to build tiling'; return; }
    R.colorize(scene, p);
    look = makeLook();
    animator = R.makeAnimator(scene, p, look);
    const ms = (performance.now() - t0).toFixed(0);
    statusEl.textContent =
      `level ${scene.level} · ${scene.hats.length.toLocaleString()} tiles · ${ms} ms` +
      (scene.degraded ? ' · (best effort fit)' : '');

    if (animator.drift) prepareDrift();
    renderFrame(0);
  }

  let driftCanvas = null, driftMeta = null;
  function prepareDrift() {
    // render an oversized static pattern for drifting
    const ps = previewSize();
    const m = 0.18;
    const p = Object.assign({}, P, { tileSize: P.tileSize * (ps.w / P.resW) });
    const sc = R.buildScene(p, Math.round(ps.w * (1 + 2 * m)), Math.round(ps.h * (1 + 2 * m)), { budget: 200000 });
    if (!sc) return;
    R.colorize(sc, p);
    const lk = makeLook();
    driftCanvas = document.createElement('canvas');
    driftCanvas.width = sc.W; driftCanvas.height = sc.H;
    R.drawScene(driftCanvas.getContext('2d'), sc, p, lk);
    driftMeta = { m, w: ps.w, h: ps.h };
  }

  function renderFrame(t) {
    if (!scene) return;
    const ctx = canvas.getContext('2d');
    if (P.animation === 'drift' && driftCanvas) {
      const { m, w, h } = driftMeta;
      const amp = m * 0.5;
      const dx = Math.sin(t * 0.00021 * P.animSpeed) * w * amp * 2;
      const dy = Math.cos(t * 0.00016 * P.animSpeed) * h * amp * 2;
      ctx.fillStyle = look.bg;
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(driftCanvas, -dx - (driftCanvas.width - w) / 2 + w * m, -dy - (driftCanvas.height - h) / 2 + h * m);
    } else if (animator && animator.frame) {
      animator.frame(ctx, t);
    } else {
      R.drawScene(ctx, scene, P, look);
    }
  }

  function loop(t) {
    animRaf = requestAnimationFrame(loop);
    if (P.animation === 'none') return;
    renderFrame(t);
  }

  let refreshTimer = 0;
  function refresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      cancelAnimationFrame(animRaf);
      regenerate();
      if (P.animation !== 'none') animRaf = requestAnimationFrame(loop);
    }, 120);
  }

  /* ------------------------------------------------------- export */

  async function exportPNG() {
    statusEl.textContent = 'rendering full resolution…';
    await new Promise((r) => setTimeout(r, 30));
    const t0 = performance.now();
    const off = document.createElement('canvas');
    off.width = P.resW; off.height = P.resH;
    const p = Object.assign({}, P, { animation: 'none' });
    const sc = R.buildScene(p, P.resW, P.resH, { budget: 500000 });
    if (!sc) { statusEl.textContent = 'export failed'; return; }
    R.colorize(sc, p);
    const lk = makeLook();
    R.drawScene(off.getContext('2d'), sc, p, lk);
    off.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `einstein-${P.resW}x${P.resH}-${PAL.LIST[P.palette].name.toLowerCase().replace(/[^a-z]+/g, '-')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      statusEl.textContent = `PNG saved · ${sc.hats.length.toLocaleString()} tiles · ${(performance.now() - t0).toFixed(0)} ms`;
    }, 'image/png');
  }

  function recordWebM(seconds) {
    if (recording) return;
    recording = true;
    const btn = $('recordBtn');
    const orig = btn.textContent;
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      .find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
    if (!mime) { statusEl.textContent = 'MediaRecorder not supported in this browser'; recording = false; return; }
    const stream = canvas.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `einstein-live-${P.animation}-${seconds}s.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      btn.textContent = orig; recording = false;
      statusEl.textContent = `WebM saved (${(blob.size / 1048576).toFixed(1)} MB)`;
    };
    btn.textContent = `● recording ${seconds}s…`;
    if (P.animation === 'none') { P.animation = 'shimmer'; fillSelect($('animSelect'), ANIMS, P.animation); }
    rec.start();
    let elapsed = 0;
    const iv = setInterval(() => {
      elapsed += 1;
      btn.textContent = `● recording ${seconds - elapsed}s…`;
      if (elapsed >= seconds) { clearInterval(iv); rec.stop(); }
    }, 1000);
  }

  function randomize() {
    const rr = Math.random;
    P.palette = Math.floor(rr() * PAL.LIST.length);
    const modes = MODES.map((m) => m[0]);
    P.colorMode = modes[Math.floor(rr() * modes.length)];
    const anims = ['none', 'shimmer', 'cascade', 'drift', 'hue', 'pulse'];
    P.animation = anims[Math.floor(rr() * anims.length)];
    P.variant = ['H', 'P', 'F'][Math.floor(rr() * 3)];
    P.rotation = Math.floor(rr() * 24) * 15;
    P.tileSize = Math.round(16 + rr() * 60);
    P.gap = rr() < 0.5 ? 0 : +(rr() * 0.05).toFixed(3);
    P.seed = Math.floor(rr() * 99999);
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

  function syncControls() {
    buildAspectChips();
    buildResSelect();
    buildPaletteGrid();
    fillSelect($('modeSelect'), MODES, P.colorMode);
    fillSelect($('animSelect'), ANIMS, P.animation);
    fillSelect($('variantSelect'), [['H', 'Variant A'], ['P', 'Variant B'], ['F', 'Variant C']], P.variant);
    setSlider('tileSize', 'tileSizeVal', P.tileSize, (v) => v + ' px');
    setSlider('rotation', 'rotationVal', P.rotation, (v) => v + '°');
    setSlider('gap', 'gapVal', Math.round(P.gap * 100), (v) => v + '%');
    setSlider('outlineWidth', 'outlineWidthVal', P.outlineWidth, (v) => (+v).toFixed(1) + ' px');
    setSlider('animSpeed', 'animSpeedVal', P.animSpeed, (v) => (+v).toFixed(1) + '×');
    setSlider('seed', 'seedVal', P.seed, (v) => '#' + v);
    $('resW').value = P.resW; $('resH').value = P.resH;
    $('lineAuto').checked = P.lineAuto;
    $('lineColor').value = P.lineColor;
    $('lineColor').disabled = P.lineAuto;
    const orBtns = document.querySelectorAll('[data-orient]');
    orBtns.forEach((b) => b.classList.toggle('on', b.dataset.orient === P.orientation));
  }

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
        // swap resolution if it matches a preset of the other orientation
        applyResForAspect();
        syncControls(); refresh(); save();
      };
    });
    $('tileSize').oninput = (e) => { P.tileSize = +e.target.value; $('tileSizeVal').textContent = P.tileSize + ' px'; refresh(); save(); };
    $('rotation').oninput = (e) => { P.rotation = +e.target.value; $('rotationVal').textContent = P.rotation + '°'; refresh(); save(); };
    $('gap').oninput = (e) => { P.gap = e.target.value / 100; $('gapVal').textContent = e.target.value + '%'; refresh(); save(); };
    $('outlineWidth').oninput = (e) => { P.outlineWidth = +e.target.value; $('outlineWidthVal').textContent = (+e.target.value).toFixed(1) + ' px'; refresh(); save(); };
    $('animSpeed').oninput = (e) => { P.animSpeed = +e.target.value; $('animSpeedVal').textContent = (+e.target.value).toFixed(1) + '×'; save(); };
    $('seed').oninput = (e) => { P.seed = +e.target.value || 1; $('seedVal').textContent = '#' + P.seed; refresh(); save(); };
    $('modeSelect').onchange = (e) => { P.colorMode = e.target.value; refresh(); save(); };
    $('animSelect').onchange = (e) => { P.animation = e.target.value; refresh(); save(); };
    $('variantSelect').onchange = (e) => { P.variant = e.target.value; refresh(); save(); };
    $('lineAuto').onchange = (e) => { P.lineAuto = e.target.checked; $('lineColor').disabled = P.lineAuto; refresh(); save(); };
    $('lineColor').oninput = (e) => { P.lineColor = e.target.value; refresh(); save(); };
    $('randomBtn').onclick = randomize;
    $('pngBtn').onclick = exportPNG;
    $('recordBtn').onclick = () => recordWebM(+$('recDuration').value || 10);
    $('fsBtn').onclick = fullscreen;
    $('resetBtn').onclick = () => {
      P = Object.assign({}, DEFAULTS);
      save(); syncControls(); refresh();
    };
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.key === 'r') randomize();
      if (e.key === 'f') fullscreen();
    });
    window.addEventListener('resize', () => { refresh(); });
    document.addEventListener('fullscreenchange', () => { setTimeout(refresh, 60); });
  }

  bind();
  syncControls();
  regenerate();
  if (P.animation !== 'none') animRaf = requestAnimationFrame(loop);
})();
