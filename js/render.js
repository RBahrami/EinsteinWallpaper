/*
 * render.js — scene building, coloring, drawing, animation and export
 * for EinsteinWallpaper.
 *
 * Pipeline:
 *   1. pick an expansion level whose hat cluster covers the target canvas
 *      (canvas mapped into the largest inscribed rectangle of the cluster,
 *       measured on an eroded low-res raster — guarantees full coverage)
 *   2. build the pattern->screen view (rotation / scale / centering)
 *   3. assign colors per hat (mode-dependent)
 *   4. draw (static) or animate (cascade / shimmer / drift / hue / pulse)
 */
(function (root) {
  'use strict';

  const HT = root.HatTiling;
  const PAL = root.Palettes;

  /* -------------------------------------------------------- utilities */

  // Seeded PRNG (mulberry32)
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash2(x, y, seed) {
    let h = (seed | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // Hat outline shrunk about its own centroid (for the gap effect)
  const HAT_C = (() => {
    let x = 0, y = 0;
    for (const p of HT.HAT_OUTLINE) { x += p[0]; y += p[1]; }
    return [x / HT.HAT_OUTLINE.length, y / HT.HAT_OUTLINE.length];
  })();
  function shrunkHatOutline(gap) {
    if (!gap) return HT.HAT_OUTLINE;
    return HT.HAT_OUTLINE.map((p) => [
      HAT_C[0] + (p[0] - HAT_C[0]) * (1 - gap),
      HAT_C[1] + (p[1] - HAT_C[1]) * (1 - gap),
    ]);
  }

  /* -------------------------------------------------- mask fitting */

  // Rasterize hats into a W x H mask (scanline, no canvas — fast).
  // view: pattern->mask-space transform.
  function hatMask(hats, W, H, view, hatOutline) {
    const mask = new Uint8Array(W * H);
    const pts = new Float64Array(hatOutline.length * 2);
    for (const hat of hats) {
      const M = HT.mmul(view, hat.T);
      let ymin = Infinity, ymax = -Infinity;
      for (let j = 0; j < hatOutline.length; j++) {
        const p = hatOutline[j];
        const x = M[0] * p[0] + M[1] * p[1] + M[2];
        const y = M[3] * p[0] + M[4] * p[1] + M[5];
        pts[j * 2] = x; pts[j * 2 + 1] = y;
        if (y < ymin) ymin = y;
        if (y > ymax) ymax = y;
      }
      const y0 = Math.max(0, Math.ceil(ymin));
      const y1 = Math.min(H - 1, Math.floor(ymax));
      const n = hatOutline.length;
      for (let y = y0; y <= y1; y++) {
        // collect x crossings
        let count = 0;
        const xs = [];
        for (let i = 0; i < n; i++) {
          const ax = pts[i * 2], ay = pts[i * 2 + 1];
          const bx = pts[((i + 1) % n) * 2], by = pts[((i + 1) % n) * 2 + 1];
          if ((ay <= y && by > y) || (by <= y && ay > y)) {
            xs.push(ax + (y - ay) / (by - ay) * (bx - ax));
            count++;
          }
        }
        if (count < 2) continue;
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const xa = Math.max(0, Math.ceil(xs[k]));
          const xb = Math.min(W - 1, Math.floor(xs[k + 1]));
          const row = y * W;
          for (let x = xa; x <= xb; x++) mask[row + x] = 1;
        }
      }
    }
    return mask;
  }

  function erode(mask, W, H, times) {
    let m = mask;
    for (let t = 0; t < times; t++) {
      const out = new Uint8Array(W * H);
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          out[i] = m[i] && m[i - 1] && m[i + 1] && m[i - W] && m[i + W] ? 1 : 0;
        }
      }
      m = out;
    }
    return m;
  }

  // Largest axis-aligned rect of given aspect fully inside the mask.
  function maskInscribedRect(mask, W, H, aspect) {
    let best = null;
    const cols = new Uint8Array(W);
    for (let y0 = 0; y0 < H; y0++) {
      cols.fill(1);
      for (let y1 = y0; y1 < H; y1++) {
        const row = y1 * W;
        for (let x = 0; x < W; x++) if (!mask[row + x]) cols[x] = 0;
        let runStart = -1;
        for (let x = 0; x <= W; x++) {
          if (x < W && cols[x]) { if (runStart < 0) runStart = x; }
          else if (runStart >= 0) {
            const w = x - runStart, h = y1 - y0 + 1;
            if (w / h >= aspect - 1e-6) {
              const area = w * h;
              if (!best || area > best.area) best = { x0: runStart, y0, x1: x - 1, y1, area };
            }
            runStart = -1;
          }
        }
      }
    }
    if (!best) return null;
    let rw = best.x1 - best.x0 + 1, rh = best.y1 - best.y0 + 1;
    if (rw / rh > aspect) rw = rh * aspect; else rh = rw / aspect;
    return {
      x: best.x0 / W, y: best.y0 / H, w: rw / W, h: rh / H, // normalized to mask
    };
  }

  /* --------------------------------------------------- level choice */

  let LEVELS_CACHE = null;
  function getLevels(max) {
    if (!LEVELS_CACHE || LEVELS_CACHE.length < max + 1) LEVELS_CACHE = HT.buildLevels(max);
    return LEVELS_CACHE;
  }
  const MAX_LEVEL = 6;
  const MAX_LEVELS_BUILT = 6;

  /*
   * Build a scene covering a W x H px canvas.
   * params: { tileSize (hat edge px), variant 'H'|'T'|'P'|'F', rotation deg,
   *           panX, panY, seed }
   * opts:   { budget (max hats), driftMargin (extra coverage factor) }
   */
  function buildScene(params, W, H, opts) {
    opts = opts || {};
    const budget = opts.budget || 120000;
    const levels = getLevels(MAX_LEVELS_BUILT);
    const theta = (params.rotation || 0) * Math.PI / 180;
    const cos = Math.abs(Math.cos(theta)), sin = Math.abs(Math.sin(theta));
    const margin = opts.driftMargin || 1.0;
    const effW = (Math.abs(W) * cos + Math.abs(H) * sin) * margin;
    const effH = (Math.abs(W) * sin + Math.abs(H) * cos) * margin;
    const aspect = effW / effH;
    const outlineForMask = shrunkHatOutline(0);

    let scene = null;
    let lastGen = null;
    for (let k = 3; k <= MAX_LEVEL; k++) {
      const gen = HT.hatsForLevel(levels, k, { root: params.variant || 'H', budget });
      lastGen = gen;
      const pxPerUnit = params.tileSize / gen.hatEdge;
      const uw = effW / pxPerUnit, uh = effH / pxPerUnit;

      // rasterize cluster at low res, fit inscribed rect of `aspect`
      const polysBB = clusterBBox(gen.hats);
      const MW = 220, MH = Math.max(8, Math.round(220 / aspect));
      const s = Math.min(MW / polysBB.w, MH / polysBB.h);
      const view = [s, 0, MW / 2 - s * (polysBB.x0 + polysBB.w / 2),
                    0, s, MH / 2 - s * (polysBB.y0 + polysBB.h / 2)];
      const raw = hatMask(gen.hats, MW, MH, view, outlineForMask);
      const ero = erode(raw, MW, MH, 2);
      const rect = maskInscribedRect(ero, MW, MH, aspect);
      if (rect) {
        // normalized rect -> pattern units
        const rw = rect.w * polysBB.w, rh = rect.h * polysBB.h;
        if (rw >= uw && rh >= uh) {
          const rc = [polysBB.x0 + (rect.x + rect.w / 2) * polysBB.w,
                      polysBB.y0 + (rect.y + rect.h / 2) * polysBB.h];
          scene = {
            level: k, hats: gen.hats, hatEdge: gen.hatEdge,
            pxPerUnit, rect: { cx: rc[0], cy: rc[1], w: rw, h: rh },
            classes: gen.classes,
          };
          break;
        }
      }
      if (gen.aborted) break;
    }
    if (root && root.console && root.__FIT_LOG) {
      root.console.log(`[fit] level ${scene ? scene.level : 'n/a'} hats=${lastGen ? lastGen.hats.length : 0}`);
    }

    if (!scene) {
      // best effort: use last generated level, scale up to cover
      const gen = lastGen;
      if (!gen || !gen.hats.length) return null;
      const pxPerUnit = params.tileSize / gen.hatEdge;
      const bb = clusterBBox(gen.hats);
      scene = {
        level: MAX_LEVEL, hats: gen.hats, hatEdge: gen.hatEdge, pxPerUnit,
        rect: { cx: bb.x0 + bb.w / 2, cy: bb.y0 + bb.h / 2, w: bb.w * 0.62, h: bb.h * 0.62 },
        classes: gen.classes, degraded: true,
      };
    }

    // view: pattern -> screen
    const cc = [W / 2 + (params.panX || 0), H / 2 + (params.panY || 0)];
    const ct = Math.cos(theta), st = Math.sin(theta);
    const s = scene.pxPerUnit;
    // screen = cc + R(theta) * ( s * (p - rectC) )
    const V = [
      s * ct, -s * st, cc[0] - s * (ct * scene.rect.cx - st * scene.rect.cy),
      s * st, s * ct, cc[1] - s * (st * scene.rect.cx + ct * scene.rect.cy),
    ];
    scene.view = V;
    scene.W = W; scene.H = H;
    return scene;
  }

  function clusterBBox(hats) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const hb = hatLocalBBox();
    for (const hat of hats) {
      const M = hat.T;
      // transform the 4 corners of the hat's local bbox
      for (const c of hb) {
        const x = M[0] * c[0] + M[1] * c[1] + M[2];
        const y = M[3] * c[0] + M[4] * c[1] + M[5];
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  }
  let _HAT_LOCAL_BB = null;
  function hatLocalBBox() {
    if (!_HAT_LOCAL_BB) {
      _HAT_LOCAL_BB = HT.bboxOf([HT.HAT_OUTLINE]);
      _HAT_LOCAL_BB = [
        [_HAT_LOCAL_BB.x0, _HAT_LOCAL_BB.y0], [_HAT_LOCAL_BB.x1, _HAT_LOCAL_BB.y0],
        [_HAT_LOCAL_BB.x0, _HAT_LOCAL_BB.y1], [_HAT_LOCAL_BB.x1, _HAT_LOCAL_BB.y1],
      ];
    }
    return _HAT_LOCAL_BB;
  }

  /* ------------------------------------------------------- coloring */

  /*
   * Assign each hat a LUT index (0..255). The LUT is built from the active
   * palette. Modes: supertile | orientation | mirror | gradient | random | solid
   */
  function colorize(scene, params) {
    const n = scene.hats.length;
    const lutIdx = new Uint8Array(n);
    const mode = params.colorMode;
    const pal = PAL.get(params.palette);
    const nC = pal.colors.length;
    const rr = rng(params.seed || 1);
    const theta = (params.rotation || 0) * Math.PI / 180;

    // palette color cycle order for discrete modes: spread colors so that
    // neighbours rarely match (fixed coprime stride)
    const stride = (() => {
      for (const c of [nC - 1, nC - 2, 3, 2, 1]) if (c > 1 && gcd(c, nC) === 1) return c;
      return 1;
    })();

    for (let i = 0; i < n; i++) {
      const hat = scene.hats[i];
      let t;
      switch (mode) {
        case 'supertile':
          t = (hat.cls * stride) % nC / nC; break;
        case 'orientation': {
          const ang = Math.atan2(hat.T[1], hat.T[0]);
          let bucket = Math.round(ang / (Math.PI / 6)) % 12; if (bucket < 0) bucket += 12;
          t = ((bucket + (hat.mirror ? 12 : 0)) * stride) % (nC * 2) / (nC * 2);
          break;
        }
        case 'mirror':
          t = hat.mirror ? 0.72 : 0.08; break;
        case 'gradient': {
          const bb = scene._bb || (scene._bb = clusterBBox(scene.hats));
          const gx = Math.cos(theta + Math.PI / 6), gy = Math.sin(theta + Math.PI / 6);
          const proj = (hat.x - bb.x0) * gx + (hat.y - bb.y0) * gy;
          const len = Math.abs(bb.w * gx) + Math.abs(bb.h * gy) || 1;
          t = Math.min(1, Math.max(0, proj / len));
          break;
        }
        case 'random':
          t = hash2(Math.round(hat.x * 8), Math.round(hat.y * 8), params.seed || 1); break;
        default: // solid
          t = 0.16;
      }
      lutIdx[i] = Math.max(0, Math.min(255, Math.round(t * 255)));
    }
    scene.lutIdx = lutIdx;
    return lutIdx;
  }

  function gcd(a, b) { return b ? gcd(b, a % b) : a; }

  // Build a 256-entry color LUT from palette colors (linear RGB interp).
  function buildLut(palIndex) {
    const pal = PAL.get(palIndex);
    const cols = pal.colors.map((c) => PAL.hexToRgb(c));
    const lut = new Array(256);
    for (let i = 0; i < 256; i++) {
      const t = i / 255 * cols.length;
      const a = cols[Math.floor(t) % cols.length];
      const b = cols[(Math.floor(t) + 1) % cols.length];
      const f = t - Math.floor(t);
      lut[i] = PAL.rgbToHex(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
    }
    return lut;
  }

  // Shaded LUT variants for shimmer: indices 0..SHIM_N-1 map to brightness deltas
  const SHIM_STEPS = 9;
  function buildShimLuts(lut) {
    const out = [];
    for (let s = 0; s < SHIM_STEPS; s++) {
      const f = 0.75 + 0.5 * (s / (SHIM_STEPS - 1)); // 0.75 .. 1.25
      out.push(lut.map((c) => PAL.shade(c, f)));
    }
    return out;
  }

  // Hue-rotated LUT variants for the hue animation (full 360 sweep)
  const HUE_STEPS = 36;
  function buildHueLuts(lut) {
    const out = [];
    for (let s = 0; s < HUE_STEPS; s++) {
      const deg = s / HUE_STEPS * 360;
      out.push(lut.map((c) => PAL.hslRotate(c, deg)));
    }
    return out;
  }

  /* ------------------------------------------------------- drawing */

  function drawScene(ctx, scene, params, look) {
    // look: { lut, line, bg, gap, outlineWidth, alphaOverride?, lutVariant? }
    const W = scene.W, H = scene.H;
    ctx.fillStyle = look.bg;
    ctx.fillRect(0, 0, W, H);

    const outline = shrunkHatOutline(look.gap || 0);
    const lw = look.outlineWidth || 0;
    const n = scene.hats.length;
    const margin = 40;
    const V = scene.view;

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (lw > 0) { ctx.strokeStyle = look.line; ctx.lineWidth = lw; }

    for (let i = 0; i < n; i++) {
      const hat = scene.hats[i];
      const M = HT.mmul(V, hat.T);
      // cull: transform hat local bbox corners
      let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
      for (const c of hatLocalBBox()) {
        const x = M[0] * c[0] + M[1] * c[1] + M[2];
        const y = M[3] * c[0] + M[4] * c[1] + M[5];
        if (x < sx0) sx0 = x; if (x > sx1) sx1 = x;
        if (y < sy0) sy0 = y; if (y > sy1) sy1 = y;
      }
      if (sx1 < -margin || sx0 > W + margin || sy1 < -margin || sy0 > H + margin) continue;

      ctx.beginPath();
      for (let j = 0; j < outline.length; j++) {
        const p = outline[j];
        const x = M[0] * p[0] + M[1] * p[1] + M[2];
        const y = M[3] * p[0] + M[4] * p[1] + M[5];
        if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = look.lut[scene.lutIdx[i]];
      ctx.fill();
      if (lw > 0) ctx.stroke();
    }
  }

  /* ----------------------------------------------------- animation */

  function makeAnimator(scene, params, look) {
    const W = scene.W, H = scene.H;
    const speed = params.animSpeed || 1;
    const anim = params.animation || 'none';

    if (anim === 'none') return { frame: null };

    if (anim === 'shimmer') {
      const shim = buildShimLuts(look.lut);
      return {
        frame: (ctx, t) => {
          const phase = t * 0.0011 * speed;
          drawFrameCustom(ctx, scene, params, look, (hat, i) => {
            const w = Math.sin(phase * 2 - (hat.x * 0.9 + hat.y * 1.4));
            const sIdx = Math.max(0, Math.min(SHIM_STEPS - 1, Math.round((w + 1) / 2 * (SHIM_STEPS - 1))));
            return shim[sIdx][scene.lutIdx[i]];
          });
        },
      };
    }

    if (anim === 'hue') {
      const hues = buildHueLuts(look.lut);
      return {
        frame: (ctx, t) => {
          const idx = Math.floor(t * 0.001 * speed) % HUE_STEPS;
          drawFrameCustom(ctx, scene, params, look, (hat, i) => hues[idx][scene.lutIdx[i]]);
        },
      };
    }

    if (anim === 'cascade') {
      const rr = rng(params.seed || 1);
      const phases = new Float32Array(scene.hats.length);
      for (let i = 0; i < phases.length; i++) phases[i] = rr();
      return {
        frame: (ctx, t) => {
          const period = 6000 / speed;
          const ph = (t % period) / period; // 0..1
          drawFrameCustom(ctx, scene, params, look, (hat, i) => {
            const start = (hat.x + hat.y) * 0.5;
            const local = (ph * 1.6 - start * 0.12 - phases[i] * 0.18);
            const a = Math.max(0, Math.min(1, local * 5));
            return null; // color via lut; alpha handled below via globalAlpha trick
          }, (hat, i) => {
            const start = (hat.x + hat.y) * 0.5;
            const local = (ph * 1.6 - start * 0.12 - phases[i] * 0.18);
            return Math.max(0, Math.min(1, local * 5));
          });
        },
      };
    }

    if (anim === 'pulse') {
      return {
        frame: (ctx, t) => {
          const phase = t * 0.0016 * speed;
          drawFrameScaled(ctx, scene, params, look, (hat) => {
            const w = Math.sin(phase - (hat.x * 0.7 + hat.y * 1.1));
            return 1 + 0.045 * w;
          });
        },
      };
    }

    if (anim === 'drift') {
      return { drift: true, frame: null };
    }
    return { frame: null };
  }

  // draw with per-tile fill color callback (cb returns css color or null to use LUT)
  // optional alphaCb returns per-tile alpha
  function drawFrameCustom(ctx, scene, params, look, colorCb, alphaCb) {
    const W = scene.W, H = scene.H;
    ctx.fillStyle = look.bg;
    ctx.fillRect(0, 0, W, H);
    const outline = shrunkHatOutline(look.gap || 0);
    const lw = look.outlineWidth || 0;
    const V = scene.view;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (lw > 0) { ctx.strokeStyle = look.line; ctx.lineWidth = lw; }

    const n = scene.hats.length;
    for (let i = 0; i < n; i++) {
      const hat = scene.hats[i];
      const M = HT.mmul(V, hat.T);
      let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
      for (const c of hatLocalBBox()) {
        const x = M[0] * c[0] + M[1] * c[1] + M[2];
        const y = M[3] * c[0] + M[4] * c[1] + M[5];
        if (x < sx0) sx0 = x; if (x > sx1) sx1 = x;
        if (y < sy0) sy0 = y; if (y > sy1) sy1 = y;
      }
      if (sx1 < 0 || sx0 > W || sy1 < 0 || sy0 > H) continue;
      ctx.beginPath();
      for (let j = 0; j < outline.length; j++) {
        const p = outline[j];
        const x = M[0] * p[0] + M[1] * p[1] + M[2];
        const y = M[3] * p[0] + M[4] * p[1] + M[5];
        if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      const c = colorCb(hat, i);
      ctx.fillStyle = c || look.lut[scene.lutIdx[i]];
      if (alphaCb) ctx.globalAlpha = alphaCb(hat, i); else if (ctx.globalAlpha !== 1) ctx.globalAlpha = 1;
      ctx.fill();
      if (lw > 0) ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // draw with per-tile scale callback (pulse)
  function drawFrameScaled(ctx, scene, params, look, scaleCb) {
    const W = scene.W, H = scene.H;
    ctx.fillStyle = look.bg;
    ctx.fillRect(0, 0, W, H);
    const lw = look.outlineWidth || 0;
    const V = scene.view;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (lw > 0) { ctx.strokeStyle = look.line; ctx.lineWidth = lw; }

    const n = scene.hats.length;
    for (let i = 0; i < n; i++) {
      const hat = scene.hats[i];
      const M = HT.mmul(V, hat.T);
      let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
      for (const c of hatLocalBBox()) {
        const x = M[0] * c[0] + M[1] * c[1] + M[2];
        const y = M[3] * c[0] + M[4] * c[1] + M[5];
        if (x < sx0) sx0 = x; if (x > sx1) sx1 = x;
        if (y < sy0) sy0 = y; if (y > sy1) sy1 = y;
      }
      if (sx1 < 0 || sx0 > W || sy1 < 0 || sy0 > H) continue;
      // centroid in screen space
      const cx = M[0] * HAT_C[0] + M[1] * HAT_C[1] + M[2];
      const cy = M[3] * HAT_C[0] + M[4] * HAT_C[1] + M[5];
      const s = scaleCb(hat);
      ctx.beginPath();
      for (let j = 0; j < HT.HAT_OUTLINE.length; j++) {
        const p = HT.HAT_OUTLINE[j];
        const x = cx + (M[0] * p[0] + M[1] * p[1] + M[2] - cx) * s;
        const y = cy + (M[3] * p[0] + M[4] * p[1] + M[5] - cy) * s;
        if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = look.lut[scene.lutIdx[i]];
      ctx.fill();
      if (lw > 0) ctx.stroke();
    }
  }

  root.Renderer = {
    buildScene, colorize, buildLut, buildShimLuts, buildHueLuts,
    drawScene, makeAnimator, rng, hash2, shrunkHatOutline, clusterBBox,
  };
})(typeof window !== 'undefined' ? window : globalThis);
