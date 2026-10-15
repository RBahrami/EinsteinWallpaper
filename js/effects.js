/*
 * effects.js — post-processing visual effects pipeline for EinsteinWallpaper.
 *
 * Pipeline (shared by live preview, PNG export and WebM recording):
 *   1. paint background (solid color or gradient) onto the target canvas
 *   2. composite the scene canvas once, with optional blur filter and/or
 *      drop shadow (ctx.shadow*) — the scene canvas has a transparent
 *      background so shadows follow tile silhouettes
 *   3. glow pass: re-composite the scene additively, blurred by glowRadius
 *   4. grain: pre-generated noise tile, 'overlay' composite
 *   5. vignette: cached radial gradient, darken or lighten
 *
 * All offscreen buffers are pooled and only resized when dimensions change.
 * Effect settings: { blur, glow, glowRadius, shadow, shadowSoft, shadowOff,
 *                    grain, vignette, vignetteMode }  (0 = disabled/neutral)
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

  /* ---------------- main compose ---------------- */
  /*
   * compose(targetCtx, sceneCanvas, W, H, look, fx, overlayFn)
   *  sceneCanvas: transparent canvas with tiles already drawn (no background)
   *  look: { bg, bgPaint? }
   *  fx: effect settings (all optional)
   *  overlayFn: optional (ctx) => drawn after scene+glow, before grain/vignette
   *             (used by the Gradient Flow / Glow Wave animations)
   */
  function compose(targetCtx, sceneCanvas, W, H, look, fx, overlayFn) {
    fx = fx || {};
    const blur = +fx.blur || 0;
    const glow = +fx.glow || 0;
    const glowRadius = +fx.glowRadius || 12;
    const shadow = +fx.shadow || 0;
    const shadowSoft = +fx.shadowSoft || 14;
    const shadowOff = +fx.shadowOff || 8;

    paintBackground(targetCtx, W, H, look, fx);

    // scene composite: optional blur + shadow in one pass
    targetCtx.save();
    if (blur > 0) targetCtx.filter = `blur(${blur}px)`;
    if (shadow > 0) {
      targetCtx.shadowColor = `rgba(0,0,0,${Math.min(0.9, shadow)})`;
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

    // animation overlay (between scene and grain/vignette)
    if (overlayFn) overlayFn(targetCtx);

    // grain
    if (fx.grain > 0) {
      targetCtx.save();
      targetCtx.globalCompositeOperation = 'overlay';
      targetCtx.globalAlpha = Math.min(1, fx.grain);
      const pat = targetCtx.createPattern(getGrain(), 'repeat');
      targetCtx.fillStyle = pat;
      targetCtx.fillRect(0, 0, W, H);
      targetCtx.restore();
    }

    // vignette
    if (fx.vignette > 0) {
      targetCtx.save();
      const light = fx.vignetteMode === 'light';
      const inner = light ? 0.55 : 0.25;
      const grad = targetCtx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * inner, W / 2, H / 2, Math.hypot(W, H) / 2);
      const a = Math.min(1, fx.vignette);
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

  root.Effects = { compose, paintBackground };
})(typeof window !== 'undefined' ? window : globalThis);
