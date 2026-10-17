/*
 * effects.js — post-processing visual effects pipeline for EinsteinWallpaper.
 *
 * Pipeline (shared by live preview, PNG export and animated exports):
 *   1. paint background (solid color or gradient) onto the target canvas
 *      (compose() only — composeLayer() starts from transparency for per-layer
 *      compositing)
 *   2. composite the scene canvas once, with optional blur filter and/or
 *      drop shadow (ctx.shadow*) — the scene canvas has a transparent
 *      background so shadows follow tile silhouettes
 *   3. glow pass: re-composite the scene additively, blurred by glowRadius
 *   4. animation overlay (Gradient Flow / Glow Wave)
 *   5. SPECIAL EFFECTS (static light passes, see specialPasses below):
 *      ONE active special effect per layer (fx.special), picked in the UI
 *      from a dropdown: frozen Shimmer light wave, Sheen light sweep,
 *      Iridescence rainbow sheen, Chromatic aberration (RGB channel split),
 *      CRT Scanlines
 *   6. grain: pre-generated noise tile, 'overlay' composite
 *   7. vignette: cached radial gradient, darken or lighten
 *
 * All offscreen buffers are pooled and only resized when dimensions change.
 * Effect settings (0 = disabled/neutral):
 *   blur, glowRadius, shadowSoft, shadowOff — pixels
 *   glow, shadow, grain, vignette           — 0–100 percent, normalized
 *                                             here to a 0–1 alpha so slider
 *                                             position maps linearly to
 *                                             effect strength
 *   vignetteMode                            — 'dark' | 'light'
 * Special effect model — exactly ONE special effect runs per layer, selected
 * by fx.special ('none' | 'shimmer' | 'sheen' | 'irid' | 'aberration' |
 * 'scan'); all special keys are still stored in fx and only the active
 * mode's are used. Legacy blobs without `special` are inferred from the
 * first non-zero amount.
 *   special      — active special-effect mode (see above)
 *   shimmer      — 0–100 %, frozen version of the Shimmer (light wave)
 *                  animation: repeating light/dark bands at shimmerAngle;
 *                  drawn twice — crests with 'screen' (lifts dark
 *                  backgrounds), troughs with 'multiply' (reaches light
 *                  ones) so it reads on ANY background
 *   shimmerAngle — 0–345°, wave travel direction
 *   shimmerPhase — 0–100, shifts the wave along its direction (kept in the
 *                  data model; not exposed in the simplified UI)
 *   shimmerScale — 20–400 %, wavelength multiplier (100 = diagonal/3)
 *   sheen        — 0–100 %, ONE soft band of light across the layer
 *   sheenAngle   — 0–345°, sweep axis
 *   sheenPos     — 0–100, band position across the layer
 *   irid         — 0–100 %, iridescent rainbow sheen
 *   iridScale    — 20–400 %, rainbow cycle density
 *   iridAngle    — 0–345°, rainbow axis
 *   aberration   — 0–20 px, chromatic aberration (R/B channel split)
 *   scan         — 0–100 %, CRT scanlines strength
 *   scanGap      — 2–24 px, distance between scanlines
 */
(function (root) {
  'use strict';

  /* ---------------- pooled offscreen buffers ---------------- */
  const pool = new Map();
  function buffer(name, w, h) {
    let b = pool.get(name);
    if (!b) { b = { canvas: document.createElement('canvas'), ctx: null }; b.ctx = b.canvas.getContext('2d'); pool.set(name, b); }
    if (b.canvas.width !== w || b.canvas.height !== h) { b.canvas.width = w; b.canvas.height = h; }
    else b.ctx.clearRect(0, 0, w, h);
    return b;
  }

  /* ---------------- grain noise (generated once) ---------------- */
  let grainCanvas = null;
  function getGrain() {
    if (grainCanvas) return grainCanvas;
    const c = document.createElement('canvas');
    c.width = c.height = 160;
    const g = c.getContext('2d');
    const img = g.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 90 + Math.random() * 130;
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    grainCanvas = c;
    return c;
  }

  /* ---------------- background ---------------- */
  function paintBackground(ctx, W, H, look, effects) {
    if (look.bgPaint) {
      look.bgPaint(ctx, W, H);
      return;
    }
    ctx.fillStyle = look.bg || '#000';
    ctx.fillRect(0, 0, W, H);
  }

  /* ---------------- special effects (static light passes) ---------------- */
  const D2R = Math.PI / 180;

  // Fill the pooled buffer T with fn(T.ctx) (a gradient fill), clip the
  // result to the target's own alpha (so transparent regions stay
  // transparent in the multi-layer path) and blend it onto the target.
  function maskedPass(targetCtx, T, W, H, paint, blend, alpha) {
    const tg = T.ctx;
    tg.save();
    paint(tg);
    tg.globalCompositeOperation = 'destination-in';
    tg.drawImage(targetCtx.canvas, 0, 0, W, H);
    tg.restore();
    targetCtx.save();
    targetCtx.globalCompositeOperation = blend;
    targetCtx.globalAlpha = alpha;
    targetCtx.drawImage(T.canvas, 0, 0, W, H);
    targetCtx.restore();
  }

  // linear gradient along (dx,dy) through the canvas center, covering the
  // whole canvas plus `pad` on both sides (so phase shifts never show ends)
  function axisGradient(ctx, W, H, dx, dy, pad, stops) {
    const half = (Math.abs(W * dx) + Math.abs(H * dy)) / 2;
    const axis = half + pad;
    const g = ctx.createLinearGradient(
      W / 2 - dx * axis, H / 2 - dy * axis,
      W / 2 + dx * axis, H / 2 + dy * axis);
    for (const [t, c] of stops) g.addColorStop(Math.max(0, Math.min(1, t)), c);
    return g;
  }

  // repeating light/dark bands — the static Shimmer (light wave).
  // soft-light is a mathematical no-op on pure black/white and far too
  // timid on dark themes, so the wave buffer is drawn TWICE: the light
  // crests with 'screen' (visibly lift dark backgrounds) and the dark
  // troughs with 'multiply' (visible on light ones). On transparent layer
  // targets both draws become 'source-atop' so the layer's own alpha is
  // never boosted and nothing spills past its silhouette.
  function shimmerPass(targetCtx, W, H, fx, atop) {
    const amt = Math.min(1, (+fx.shimmer || 0) / 100);
    if (amt <= 0) return;
    const th = (+fx.shimmerAngle || 0) * D2R;
    const dx = Math.cos(th), dy = Math.sin(th);
    const wl = Math.max(40, (Math.hypot(W, H) / 3) * ((+fx.shimmerScale || 100) / 100));
    const phase = (Math.max(0, Math.min(100, +fx.shimmerPhase || 0)) / 100) * wl;
    const half = (Math.abs(W * dx) + Math.abs(H * dy)) / 2;
    const axis = half + wl;
    const L = 2 * axis;
    const stops = [];
    const segs = Math.ceil(L / wl) + 1;
    for (let k = 0; k <= segs; k++) {
      const s = (k * wl - phase) / L; // one wave period per segment
      // crest (light) -> calm -> trough (dark) -> calm, sine-ish shading
      stops.push([s, 'rgba(255,252,240,1)']);
      stops.push([s + 0.25 * wl / L, 'rgba(0,0,0,0)']);
      stops.push([s + 0.5 * wl / L, 'rgba(0,0,0,1)']);
      stops.push([s + 0.75 * wl / L, 'rgba(0,0,0,0)']);
    }
    const T = buffer('fxWave', W, H);
    const paint = (tg) => {
      tg.fillStyle = axisGradient(tg, W, H, dx, dy, wl, stops);
      tg.fillRect(0, 0, W, H);
    };
    // 'screen' with black pixels is a no-op and 'multiply' with white ones
    // is a no-op, so ONE buffer serves both draws: each pass shows only its
    // own half of the wave.
    maskedPass(targetCtx, T, W, H, paint, atop ? 'source-atop' : 'screen', amt * 0.5);
    maskedPass(targetCtx, T, W, H, paint, atop ? 'source-atop' : 'multiply', amt * 0.4);
  }

  // ONE soft band of light — a frozen light sweep. 'screen' (not
  // soft-light) so the band clearly lifts dark backgrounds too.
  function sheenPass(targetCtx, W, H, fx, atop) {
    const amt = Math.min(1, (+fx.sheen || 0) / 100);
    if (amt <= 0) return;
    const th = (+fx.sheenAngle || 0) * D2R;
    const dx = Math.cos(th), dy = Math.sin(th);
    const half = (Math.abs(W * dx) + Math.abs(H * dy)) / 2;
    const bw = Math.hypot(W, H) * 0.24; // band half-width
    const pos = (Math.max(0, Math.min(100, +fx.sheenPos || 50)) / 100) * 2 * half; // -half..+half
    const off = pos - half;
    const T = buffer('fxWave', W, H);
    maskedPass(targetCtx, T, W, H, (tg) => {
      const g = tg.createLinearGradient(
        W / 2 + dx * (off - bw), H / 2 + dy * (off - bw),
        W / 2 + dx * (off + bw), H / 2 + dy * (off + bw));
      g.addColorStop(0, 'rgba(255,251,238,0)');
      g.addColorStop(0.5, 'rgba(255,251,238,0.9)');
      g.addColorStop(1, 'rgba(255,251,238,0)');
      tg.fillStyle = g;
      tg.fillRect(0, 0, W, H);
    }, atop ? 'source-atop' : 'screen', amt * 0.7);
  }

  // iridescent rainbow sheen (oil-slick / holographic tint)
  function iridPass(targetCtx, W, H, fx, atop) {
    const amt = Math.min(1, (+fx.irid || 0) / 100);
    if (amt <= 0) return;
    const th = (+fx.iridAngle || 0) * D2R;
    const dx = Math.cos(th), dy = Math.sin(th);
    const scale = Math.max(0.2, (+fx.iridScale || 100) / 100);
    const cycles = Math.max(1, Math.round(2.5 * scale)); // rainbow cycles over the axis
    const stops = [];
    for (let k = 0; k <= cycles; k++) {
      stops.push([k / cycles, `hsl(${Math.round(k / cycles * 360)}, 95%, 55%)`]);
    }
    const T = buffer('fxWave', W, H);
    maskedPass(targetCtx, T, W, H, (tg) => {
      tg.fillStyle = axisGradient(tg, W, H, dx, dy, 10, stops);
      tg.fillRect(0, 0, W, H);
    }, atop ? 'source-atop' : 'soft-light', amt * 0.9);
  }

  // chromatic aberration: split R/B channels and offset them along a fixed
  // axis (20°); G stays put. Works identically on opaque and transparent
  // targets because each channel copy is re-clipped to the snapshot alpha.
  const ABERR_AXIS = 20 * D2R;
  function aberrationPass(targetCtx, W, H, fx) {
    const d = Math.min(20, Math.max(0, +fx.aberration || 0));
    if (d <= 0) return;
    const ox = Math.cos(ABERR_AXIS) * d, oy = Math.sin(ABERR_AXIS) * d;
    const S = buffer('fxSnap', W, H);
    S.ctx.drawImage(targetCtx.canvas, 0, 0, W, H);
    const C = buffer('fxCh', W, H);
    targetCtx.save();
    targetCtx.clearRect(0, 0, W, H);
    targetCtx.restore();
    const channels = [
      ['#00ff00', 0, 0],
      ['#ff0000', ox, oy],
      ['#0000ff', -ox, -oy],
    ];
    for (const [col, cx, cy] of channels) {
      C.ctx.save();
      C.ctx.drawImage(S.canvas, 0, 0, W, H);
      C.ctx.globalCompositeOperation = 'multiply';
      C.ctx.fillStyle = col;
      C.ctx.fillRect(0, 0, W, H);
      C.ctx.globalCompositeOperation = 'destination-in';
      C.ctx.drawImage(S.canvas, 0, 0, W, H);
      C.ctx.restore();
      targetCtx.save();
      targetCtx.globalCompositeOperation = 'lighter';
      targetCtx.drawImage(C.canvas, cx, cy, W, H);
      targetCtx.restore();
    }
    // 'lighter' unions the three channel alphas (α_out = 1-(1-α)^3), which
    // would boost translucent layers and spill past the silhouette — clip
    // the recombination back to the snapshot's exact alpha.
    targetCtx.save();
    targetCtx.globalCompositeOperation = 'destination-in';
    targetCtx.drawImage(S.canvas, 0, 0, W, H);
    targetCtx.restore();
  }

  // CRT scanlines: cached 1×period pattern of dark lines
  const scanPatterns = new Map();
  function getScanPattern(period) {
    let c = scanPatterns.get(period);
    if (!c) {
      c = document.createElement('canvas');
      c.width = 1; c.height = period;
      const g = c.getContext('2d');
      const band = Math.max(1, Math.round(period * 0.45));
      g.fillStyle = 'rgba(8,10,14,1)';
      g.fillRect(0, 0, 1, band);
      scanPatterns.set(period, c);
    }
    return c;
  }
  function scanPass(targetCtx, W, H, fx, atop) {
    const amt = Math.min(1, (+fx.scan || 0) / 100);
    if (amt <= 0) return;
    const gap = Math.max(2, Math.round(+fx.scanGap || 4));
    // density relative to canvas height (~240 lines) so every resolution
    // shows the same texture; slider adds a multiplier
    const period = Math.max(gap, Math.round(Math.max(2, H / 240) * gap));
    targetCtx.save();
    targetCtx.globalCompositeOperation = atop ? 'source-atop' : 'multiply';
    targetCtx.globalAlpha = amt * 0.75;
    targetCtx.fillStyle = targetCtx.createPattern(getScanPattern(period), 'repeat');
    targetCtx.fillRect(0, 0, W, H);
    targetCtx.restore();
  }

  // the ONE active special effect per layer; legacy blobs without the
  // `special` field are inferred from their first non-zero amount
  function specialMode(fx) {
    if (fx.special) return fx.special;
    if ((+fx.shimmer || 0) > 0) return 'shimmer';
    if ((+fx.sheen || 0) > 0) return 'sheen';
    if ((+fx.irid || 0) > 0) return 'irid';
    if ((+fx.aberration || 0) > 0) return 'aberration';
    if ((+fx.scan || 0) > 0) return 'scan';
    return 'none';
  }

  function specialPasses(targetCtx, W, H, fx, atop) {
    switch (specialMode(fx)) {
      case 'shimmer': shimmerPass(targetCtx, W, H, fx, atop); break;
      case 'sheen': sheenPass(targetCtx, W, H, fx, atop); break;
      case 'irid': iridPass(targetCtx, W, H, fx, atop); break;
      case 'aberration': aberrationPass(targetCtx, W, H, fx); break;
      case 'scan': scanPass(targetCtx, W, H, fx, atop); break;
    }
  }

  /* ---------------- main compose ---------------- */
  /*
   * compose(targetCtx, sceneCanvas, W, H, look, fx, overlayFn)
   *  sceneCanvas: transparent canvas with tiles already drawn (no background)
   *  look: { bg, bgPaint? }
   *  fx: effect settings (all optional)
   *  overlayFn: optional (ctx) => drawn after scene+glow, before grain/vignette
   *             (used by the Gradient Flow / Glow Wave animations)
   *
   * composeLayer(...): the same effect passes on a TRANSPARENT target — used
   * per layer in the multi-layer compositor (the layer result is later drawn
   * onto the shared output with its own opacity). On a transparent target the
   * grain and vignette passes use 'source-atop' so they only tint the layer's
   * own pixels and never paint haze into transparent regions.
   */
  function passes(targetCtx, sceneCanvas, W, H, fx, overlayFn, atopGrainVignette) {
    // Percent-scale settings arrive as 0–100 (slider units); normalize them to
    // 0–1 alphas so the sliders modulate strength continuously instead of
    // acting as on/off switches.
    const blur = +fx.blur || 0;
    const glow = Math.min(1, (+fx.glow || 0) / 100);
    const glowRadius = +fx.glowRadius || 12;
    const shadow = Math.min(0.9, (+fx.shadow || 0) / 100);
    const shadowSoft = +fx.shadowSoft || 14;
    const shadowOff = +fx.shadowOff || 8;
    const grain = Math.min(1, (+fx.grain || 0) / 100);
    const vignette = Math.min(1, (+fx.vignette || 0) / 100);

    // scene composite: optional blur + shadow in one pass
    targetCtx.save();
    if (blur > 0) targetCtx.filter = `blur(${blur}px)`;
    if (shadow > 0) {
      targetCtx.shadowColor = `rgba(0,0,0,${shadow})`;
      targetCtx.shadowBlur = shadowSoft;
      targetCtx.shadowOffsetX = shadowOff;
      targetCtx.shadowOffsetY = shadowOff;
    }
    targetCtx.drawImage(sceneCanvas, 0, 0, W, H);
    targetCtx.restore();

    // glow pass
    if (glow > 0) {
      targetCtx.save();
      targetCtx.globalCompositeOperation = 'lighter';
      targetCtx.globalAlpha = Math.min(1, glow);
      targetCtx.filter = `blur(${glowRadius}px)`;
      targetCtx.drawImage(sceneCanvas, 0, 0, W, H);
      targetCtx.restore();
    }

    // animation overlay (between scene and special effects/grain/vignette)
    if (overlayFn) overlayFn(targetCtx);

    // special effects (static light passes)
    specialPasses(targetCtx, W, H, fx, atopGrainVignette);

    // grain ('source-atop' on transparent layer targets: tint own pixels only)
    if (grain > 0) {
      targetCtx.save();
      targetCtx.globalCompositeOperation = atopGrainVignette ? 'source-atop' : 'overlay';
      targetCtx.globalAlpha = grain;
      const pat = targetCtx.createPattern(getGrain(), 'repeat');
      targetCtx.fillStyle = pat;
      targetCtx.fillRect(0, 0, W, H);
      targetCtx.restore();
    }

    // vignette
    if (vignette > 0) {
      targetCtx.save();
      if (atopGrainVignette) targetCtx.globalCompositeOperation = 'source-atop';
      const light = fx.vignetteMode === 'light';
      const inner = light ? 0.55 : 0.25;
      const grad = targetCtx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * inner, W / 2, H / 2, Math.hypot(W, H) / 2);
      const a = vignette;
      if (light) {
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(1, `rgba(255,244,220,${a * 0.75})`);
      } else {
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, `rgba(0,0,0,${a})`);
      }
      targetCtx.fillStyle = grad;
      targetCtx.fillRect(0, 0, W, H);
      targetCtx.restore();
    }
  }

  function compose(targetCtx, sceneCanvas, W, H, look, fx, overlayFn) {
    fx = fx || {};
    paintBackground(targetCtx, W, H, look, fx);
    passes(targetCtx, sceneCanvas, W, H, fx, overlayFn, false);
  }

  function composeLayer(targetCtx, sceneCanvas, W, H, look, fx, overlayFn) {
    // no background paint: the target stays transparent
    passes(targetCtx, sceneCanvas, W, H, fx || {}, overlayFn, true);
  }

  root.Effects = { compose, composeLayer, paintBackground };
})(typeof window !== 'undefined' ? window : globalThis);
