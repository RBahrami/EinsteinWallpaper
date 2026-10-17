/*
 * render.js — scene building, coloring, drawing, animation and export
 * for EinsteinWallpaper.
 *
 * Two scene kinds share one coloring/LUT/effects pipeline:
 *   kind 'hat'  — aperiodic Einstein hat (metatile substitution, unchanged math)
 *   kind 'poly' — periodic/composite tilings from Tilings.generate
 *   kind 'line' — line-based patterns (stripes / grids / crosshatch)
 *
 * Hat pipeline (preserved from the original implementation):
 *   1. pick an expansion level whose hat cluster covers the target canvas
 *      (canvas mapped into the largest inscribed rectangle of the cluster,
 *       measured on an eroded low-res raster — guarantees full coverage)
 *   2. build the pattern->screen view (rotation / scale / centering)
 *   3. assign colors per hat (mode-dependent)
 *   4. draw via matrix-transformed hat outlines
 *
 * Periodic pipeline: tiles are generated over the rotated viewport (with
 * margin), converted to screen space once per scene build, then filled.
 *
 * Animations: none | shimmer | flow (Gradient Flow) | glowwave (Glow Wave).
 * All of them run through Effects.compose so preview and every export
 * format render identically.
 */
(function (root) {
  'use strict';

  const HT = root.HatTiling;
  const PAL = root.Palettes;
  const GR = root.Gradients;
  const TL = root.Tilings;

  const rad = (d) => d * Math.PI / 180;
  const tilePos = (t) => [t.cx !== undefined ? t.cx : t.x, t.cy !== undefined ? t.cy : t.y];

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
  function gcd(a, b) { return b ? gcd(b, a % b) : a; }

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
  // generic polygon shrunk about its centroid
  function shrunkPoly(poly, gap) {
    if (!gap) return poly;
    const c = TL.centroid(poly);
    return poly.map((p) => [c[0] + (p[0] - c[0]) * (1 - gap), c[1] + (p[1] - c[1]) * (1 - gap)]);
  }

  /* -------------------------------------------------- hat mask fitting */

  // Rasterize hats into a W x H mask (scanline, no canvas — fast).
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
    return { x: best.x0 / W, y: best.y0 / H, w: rw / W, h: rh / H };
  }

  /* --------------------------------------------------- hat level choice */

  let LEVELS_CACHE = null;
  function getLevels(max) {
    if (!LEVELS_CACHE || LEVELS_CACHE.length < max + 1) LEVELS_CACHE = HT.buildLevels(max);
    return LEVELS_CACHE;
  }
  const MAX_LEVEL = 6;
  const MAX_LEVELS_BUILT = 6;

  function clusterBBox(hats) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const hb = hatLocalBBox();
    for (const hat of hats) {
      const M = hat.T;
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

  function buildHatScene(params, W, H, opts) {
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

      const polysBB = clusterBBox(gen.hats);
      const MW = 220, MH = Math.max(8, Math.round(220 / aspect));
      const s = Math.min(MW / polysBB.w, MH / polysBB.h);
      const view = [s, 0, MW / 2 - s * (polysBB.x0 + polysBB.w / 2),
                    0, s, MH / 2 - s * (polysBB.y0 + polysBB.h / 2)];
      const raw = hatMask(gen.hats, MW, MH, view, outlineForMask);
      const ero = erode(raw, MW, MH, 2);
      const rect = maskInscribedRect(ero, MW, MH, aspect);
      if (rect) {
        const rw = rect.w * polysBB.w, rh = rect.h * polysBB.h;
        if (rw >= uw && rh >= uh) {
          const rc = [polysBB.x0 + (rect.x + rect.w / 2) * polysBB.w,
                      polysBB.y0 + (rect.y + rect.h / 2) * polysBB.h];
          scene = {
            kind: 'hat', level: k, hats: gen.hats, hatEdge: gen.hatEdge,
            pxPerUnit, rect: { cx: rc[0], cy: rc[1], w: rw, h: rh },
            classes: gen.classes,
          };
          break;
        }
      }
      if (gen.aborted) break;
    }

    if (!scene) {
      const gen = lastGen;
      if (!gen || !gen.hats.length) return null;
      const pxPerUnit = params.tileSize / gen.hatEdge;
      const bb = clusterBBox(gen.hats);
      scene = {
        kind: 'hat', level: MAX_LEVEL, hats: gen.hats, hatEdge: gen.hatEdge, pxPerUnit,
        rect: { cx: bb.x0 + bb.w / 2, cy: bb.y0 + bb.h / 2, w: bb.w * 0.62, h: bb.h * 0.62 },
        classes: gen.classes, degraded: true,
      };
    }

    const cc = [W / 2 + (params.panX || 0), H / 2 + (params.panY || 0)];
    const ct = Math.cos(theta), st = Math.sin(theta);
    const s = scene.pxPerUnit;
    const V = [
      s * ct, -s * st, cc[0] - s * (ct * scene.rect.cx - st * scene.rect.cy),
      s * st, s * ct, cc[1] - s * (st * scene.rect.cx + ct * scene.rect.cy),
    ];
    scene.view = V;
    scene.W = W; scene.H = H;
    scene.family = 'hat';
    return scene;
  }

  /* ------------------------------------------- periodic scene builder */

  function buildPolyScene(params, W, H, opts) {
    const fam = TL.get(params.family);
    const theta = (params.rotation || 0) * Math.PI / 180;
    const cos = Math.abs(Math.cos(theta)), sin = Math.abs(Math.sin(theta));
    const effW = Math.abs(W) * cos + Math.abs(H) * sin;
    const effH = Math.abs(W) * sin + Math.abs(H) * cos;
    const pxPerUnit = Math.max(2, params.tileSize || 30);
    const budget = opts.budget || 60000;

    // world-space (unrotated) bounds to cover, centered on origin
    const bounds = { x0: -effW / (2 * pxPerUnit) - 1, x1: effW / (2 * pxPerUnit) + 1,
                     y0: -effH / (2 * pxPerUnit) - 1, y1: effH / (2 * pxPerUnit) + 1 };
    const gen = TL.generate(fam.id, params.variant, bounds, budget);

    const cc = [W / 2 + (params.panX || 0), H / 2 + (params.panY || 0)];
    const ct = Math.cos(theta), st = Math.sin(theta);
    const s = pxPerUnit;
    // world (0,0) maps to screen center
    const V = [s * ct, -s * st, cc[0], s * st, s * ct, cc[1]];

    const isLine = !!gen.lineBased;
    const tiles = gen.tiles;
    const screen = new Array(tiles.length);
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (isLine) {
        const [x1, y1, x2, y2] = t.line;
        screen[i] = new Float64Array([
          V[0] * x1 + V[1] * y1 + V[2], V[3] * x1 + V[4] * y1 + V[5],
          V[0] * x2 + V[1] * y2 + V[2], V[3] * x2 + V[4] * y2 + V[5],
        ]);
      } else {
        const poly = t.poly;
        const arr = new Float64Array(poly.length * 2);
        for (let j = 0; j < poly.length; j++) {
          arr[j * 2] = V[0] * poly[j][0] + V[1] * poly[j][1] + V[2];
          arr[j * 2 + 1] = V[3] * poly[j][0] + V[4] * poly[j][1] + V[5];
        }
        screen[i] = arr;
      }
    }

    return {
      kind: isLine ? 'line' : 'poly',
      family: fam.id, variant: params.variant,
      tiles, screen,
      kindCount: gen.kindCount, orientCount: gen.orientCount,
      coarse: gen._coarse || 1,
      lineWidth: isLine ? (tiles[0] ? tiles[0].w * s : 1) : 0,
      W, H, view: V, pxPerUnit: s,
      n: tiles.length,
    };
  }

  function buildScene(params, W, H, opts) {
    opts = opts || {};
    if (params.family && params.family !== 'hat') return buildPolyScene(params, W, H, opts);
    return buildHatScene(params, W, H, opts);
  }

  /* ------------------------------------------------------- coloring */

  /*
   * Assign each tile a LUT index (0..255). params.colorMap decides how the
   * per-tile position value t (0..1) is derived:
   *   single      — every tile t=0 (solid fill via a constant LUT)
   *   supertile   — hat patch classes (hat scenes)
   *   kind        — tile kind index (poly scenes)
   *   orientation — orientation bucket (hat + poly)
   *   mirror      — hat mirror split (hat scenes)
   *   checker     — checkerboard parity of world-space tile centres
   *   random      — seeded spatial hash
   *   sweep       — continuous projection onto the sweep axis
   *   bands       — sweep quantized into params.gradBands discrete steps
   * ('gradient' is kept as a legacy alias of 'sweep'.)
   */
  function colorize(scene, params) {
    const map = params.colorMap || 'supertile';
    const pal = PAL.get(params.paletteRef || 0);
    const nC = (pal && pal.colors && pal.colors.length) || 6;
    const theta = (params.rotation || 0) * Math.PI / 180;

    const stride = (() => {
      for (const c of [nC - 1, nC - 2, 3, 2, 1]) if (c > 1 && gcd(c, nC) === 1) return c;
      return 1;
    })();

    const isHat = scene.kind === 'hat';
    const n = isHat ? scene.hats.length : scene.tiles.length;
    const lutIdx = new Uint8Array(n);

    // bbox of tile centres for the positional maps
    const positional = map === 'sweep' || map === 'gradient' || map === 'bands' || map === 'checker';
    let bb = null;
    if (positional) {
      bb = isHat ? (scene._bb || (scene._bb = clusterBBox(scene.hats))) : centroidBBox(scene.tiles);
    }
    const gx = Math.cos(theta + Math.PI / 6), gy = Math.sin(theta + Math.PI / 6);
    const bands = Math.max(2, Math.min(24, params.gradBands || 5));
    // world-space cell for the checkerboard (hat edge ~ tile pitch)
    const cell = isHat ? (scene.hatEdge || 1) : 1;

    // Sweep normalization: project every tile onto the sweep axis and
    // normalize with the exact [min,max] range of the ACTUAL tiles. The naive
    // "proj / (w*|gx|+h*|gy|)" formula collapsed to t=0 whenever the axis had
    // negative components (rotation 150°..240°), rendering sweep AND bands as
    // a single color; bbox-corner normalization left the extremes empty
    // because the cluster bbox corners hold no tiles (hexagonal cluster).
    let sMin = 0, sSpan = 1;
    if (map === 'sweep' || map === 'gradient' || map === 'bands') {
      let pMin = Infinity, pMax = -Infinity;
      for (let i = 0; i < n; i++) {
        const [x, y] = isHat
          ? [scene.hats[i].x, scene.hats[i].y]
          : [scene.tiles[i].cx, scene.tiles[i].cy];
        const p = (x - bb.x0) * gx + (y - bb.y0) * gy;
        if (p < pMin) pMin = p;
        if (p > pMax) pMax = p;
      }
      sMin = pMin;
      sSpan = (pMax - pMin) || 1;
    }
    const sweepT = (x, y) => {
      const proj = (x - bb.x0) * gx + (y - bb.y0) * gy;
      return Math.min(1, Math.max(0, (proj - sMin) / sSpan));
    };
    const checkerT = (x, y) => {
      const kx = Math.floor((x - bb.x0) / cell), ky = Math.floor((y - bb.y0) / cell);
      return (((kx + ky) % 2) + 2) % 2 ? 0.85 : 0.08;
    };

    for (let i = 0; i < n; i++) {
      let t;
      if (isHat) {
        const hat = scene.hats[i];
        switch (map) {
          case 'single': t = 0; break;
          case 'supertile': t = (hat.cls * stride) % nC / nC; break;
          case 'orientation': {
            const ang = Math.atan2(hat.T[1], hat.T[0]);
            let bucket = Math.round(ang / (Math.PI / 6)) % 12; if (bucket < 0) bucket += 12;
            t = ((bucket + (hat.mirror ? 12 : 0)) * stride) % (nC * 2) / (nC * 2);
            break;
          }
          case 'mirror': t = hat.mirror ? 0.72 : 0.08; break;
          case 'sweep': case 'gradient': t = sweepT(hat.x, hat.y); break;
          case 'bands': t = Math.min(1, Math.floor(sweepT(hat.x, hat.y) * bands) / (bands - 1)); break;
          case 'checker': t = checkerT(hat.x, hat.y); break;
          case 'random': t = hash2(Math.round(hat.x * 8), Math.round(hat.y * 8), params.seed || 1); break;
          default: t = 0.16;
        }
      } else {
        const tile = scene.tiles[i];
        switch (map) {
          case 'single': t = 0; break;
          case 'kind': t = ((tile.k * stride) % nC) / nC; break;
          case 'orientation': t = ((tile.o * stride) % nC) / nC; break;
          case 'sweep': case 'gradient': t = sweepT(tile.cx, tile.cy); break;
          case 'bands': t = Math.min(1, Math.floor(sweepT(tile.cx, tile.cy) * bands) / (bands - 1)); break;
          case 'checker': t = checkerT(tile.cx, tile.cy); break;
          case 'random': t = hash2(Math.round(tile.cx * 8), Math.round(tile.cy * 8), params.seed || 1); break;
          default: t = 0.16;
        }
      }
      lutIdx[i] = Math.max(0, Math.min(255, Math.round(t * 255)));
    }

    // Degenerate-map guard: categorical arrangements (supertile patches, tile
    // kind, orientation) are meaningless on families where every visible tile
    // shares one class (e.g. hexagons have a single kind) and would render as
    // ONE flat color. Fall back to the checker parity so the arrangement can
    // never collapse to a single color.
    if ((map === 'supertile' || map === 'kind' || map === 'orientation') && n > 1) {
      const first = lutIdx[0];
      let same = true;
      for (let i = 1; i < n; i++) { if (lutIdx[i] !== first) { same = false; break; } }
      if (same) {
        // checkerT needs the positional bbox — compute it for non-positional maps
        if (!bb) bb = isHat ? (scene._bb || (scene._bb = clusterBBox(scene.hats))) : centroidBBox(scene.tiles);
        for (let i = 0; i < n; i++) {
          const [x, y] = isHat ? [scene.hats[i].x, scene.hats[i].y] : [scene.tiles[i].cx, scene.tiles[i].cy];
          lutIdx[i] = Math.round(checkerT(x, y) * 255);
        }
      }
    }
    scene.lutIdx = lutIdx;
    return lutIdx;
  }

  function centroidBBox(tiles) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of tiles) {
      if (t.cx < x0) x0 = t.cx; if (t.cx > x1) x1 = t.cx;
      if (t.cy < y0) y0 = t.cy; if (t.cy > y1) y1 = t.cy;
    }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  }

  // 256-entry constant LUT (Single color theme mode; shimmer shades it)
  function buildSolidLut(hex) {
    const col = (typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex)) ? hex : '#888888';
    return new Array(256).fill(col);
  }

  // 256-entry color LUT. source: palette ref -> cycling palette interpolation
  // (original behaviour); gradient object -> clamped continuous sampling.
  function buildLut(source) {
    if (source && source._isGradient) return GR.makeLut(source.gradient);
    const pal = PAL.get(source);
    return buildLutFromColors(pal.colors);
  }

  // cycling LUT from a raw hex color list (used by the live palette editor:
  // unsaved draft colors recolor the wallpaper without a palette object)
  function buildLutFromColors(colors) {
    const cols = colors.map((c) => PAL.hexToRgb(c));
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

  // Shaded LUT variants for shimmer
  const SHIM_STEPS = 9;
  function buildShimLuts(lut) {
    const out = [];
    for (let s = 0; s < SHIM_STEPS; s++) {
      const f = 0.75 + 0.5 * (s / (SHIM_STEPS - 1)); // 0.75 .. 1.25
      out.push(lut.map((c) => PAL.shade(c, f)));
    }
    return out;
  }

  /*
   * Frozen per-tile shimmer — the SPECIAL-EFFECT still frame of the animated
   * shimmer in makeAnimator (same cell-based model, not a raster overlay):
   * a quantized sine wave sampled at each tile center picks one of
   * SHIM_STEPS shade variants of that tile's own LUT color, so the pattern
   * reads as shade variants of every color, exactly like a paused frame of
   * the animation.
   *
   *   strength  — scales the shade amplitude around the animation's ±0.25:
   *               strength 50 = the animation look, 0 = flat, 100 = ±0.5
   *   angle     — travel direction of the wave (animation uses a fixed
   *               diagonal; here user-steerable)
   *   scale     — wavelength multiplier around the animation's wave number
   *               |(0.9,1.4)| = 1.6644 rad/px (100% = the animation's rhythm)
   *   phase     — where the frozen wave sits (0..100, hidden control;
   *               dice-randomized), maps to the animation's 2·phase offset
   *
   * Returns a paintTiles colorOverride (tile, i) -> css color, or null when
   * the effect is off. The layer's shimmer ANIMATION, when active, repaints
   * every tile per frame and therefore always wins over this static base —
   * the animation itself is never paused or altered.
   */
  function frozenShimmer(scene, look, fx) {
    const amt = Math.min(1, (+fx.shimmer || 0) / 100);
    if (!(amt > 0)) return null;
    const a = +fx.shimmerAngle;
    const th = rad(Number.isFinite(a) ? a : 30);
    const dx = Math.cos(th), dy = Math.sin(th);
    const sc = Math.max(20, Math.min(400, +fx.shimmerScale || 100)) / 100;
    const k = 1.6644 / sc; // wave number in rad/scene-px
    const phase = 2 * Math.PI * (Math.max(0, Math.min(100, +fx.shimmerPhase || 0)) / 100);
    const amp = 0.5 * amt; // strength 50 -> ±0.25 like the animation
    const luts = [];
    for (let s = 0; s < SHIM_STEPS; s++) {
      const f = 1 + amp * (s - (SHIM_STEPS - 1) / 2) / ((SHIM_STEPS - 1) / 2);
      luts.push(look.lut.map((c) => PAL.shade(c, f)));
    }
    const lutIdx = scene.lutIdx;
    return (tile, i) => {
      const [px, py] = tilePos(tile);
      const w = Math.sin(phase - (px * dx + py * dy) * k);
      const sIdx = Math.max(0, Math.min(SHIM_STEPS - 1, Math.round((w + 1) / 2 * (SHIM_STEPS - 1))));
      return luts[sIdx][lutIdx[i]];
    };
  }

  /* ------------------------------------------------------- drawing */

  // paint tiles only (transparent background) onto ctx
  // look.alpha (0..1, default 1) = legacy whole-foreground alpha.
  // look.fillAlpha / look.lineAlpha (0..1) override it SEPARATELY for tile
  // fills and tile borders/strokes, so fill and border transparency can be
  // controlled independently. Whole-layer opacity stays a composite-time op.
  function paintTiles(ctx, scene, look, colorOverride) {
    const W = scene.W, H = scene.H;
    const lw = look.outlineWidth || 0;
    const gap = look.gap || 0;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const base = (look && look.alpha != null) ? Math.max(0, Math.min(1, +look.alpha)) : 1;
    const fillA = (look && look.fillAlpha != null) ? Math.max(0, Math.min(1, +look.fillAlpha)) : base;
    const lineA = (look && look.lineAlpha != null) ? Math.max(0, Math.min(1, +look.lineAlpha)) : base;
    const drawFill = fillA > 0;
    const drawLine = lw > 0 && lineA > 0;
    if (!drawFill && !drawLine && scene.kind !== 'line') return;
    if (scene.kind === 'line' && lineA <= 0) return;
    ctx.globalAlpha = fillA;

    if (scene.kind === 'hat') {
      const outline = shrunkHatOutline(gap);
      const V = scene.view;
      if (drawLine) { ctx.strokeStyle = look.line; ctx.lineWidth = lw; }
      const n = scene.hats.length;
      const margin = 40;
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
        if (sx1 < -margin || sx0 > W + margin || sy1 < -margin || sy0 > H + margin) continue;
        ctx.beginPath();
        for (let j = 0; j < outline.length; j++) {
          const p = outline[j];
          const x = M[0] * p[0] + M[1] * p[1] + M[2];
          const y = M[3] * p[0] + M[4] * p[1] + M[5];
          if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        if (drawFill) {
          ctx.globalAlpha = fillA;
          ctx.fillStyle = colorOverride ? colorOverride(hat, i) : look.lut[scene.lutIdx[i]];
          ctx.fill();
        }
        if (drawLine) {
          ctx.globalAlpha = lineA;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      return;
    }

    // poly / line tiles: screen-space vertices precomputed at scene build
    const tiles = scene.tiles, screen = scene.screen;
    if (scene.kind === 'line') {
      ctx.lineCap = 'butt';
      ctx.lineWidth = scene.lineWidth || 1;
      ctx.globalAlpha = lineA;
      const n = tiles.length;
      for (let i = 0; i < n; i++) {
        const s = screen[i];
        if (s[0] < -50 && s[2] < -50) continue;
        if (s[0] > W + 50 && s[2] > W + 50) continue;
        if (s[1] < -50 && s[3] < -50) continue;
        if (s[1] > H + 50 && s[3] > H + 50) continue;
        ctx.strokeStyle = colorOverride ? colorOverride(tiles[i], i) : look.lut[scene.lutIdx[i]];
        ctx.beginPath();
        ctx.moveTo(s[0], s[1]);
        ctx.lineTo(s[2], s[3]);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      return;
    }

    // filled polygons (pre-shrunk per gap: shrink screen poly about its centroid)
    const n = tiles.length;
    for (let i = 0; i < n; i++) {
      const s = screen[i];
      let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
      for (let j = 0; j < s.length; j += 2) {
        if (s[j] < sx0) sx0 = s[j]; if (s[j] > sx1) sx1 = s[j];
        if (s[j + 1] < sy0) sy0 = s[j + 1]; if (s[j + 1] > sy1) sy1 = s[j + 1];
      }
      if (sx1 < -40 || sx0 > W + 40 || sy1 < -40 || sy0 > H + 40) continue;
      ctx.beginPath();
      if (gap > 0) {
        const cx = (sx0 + sx1) / 2, cy = (sy0 + sy1) / 2;
        for (let j = 0; j < s.length; j += 2) {
          const x = cx + (s[j] - cx) * (1 - gap);
          const y = cy + (s[j + 1] - cy) * (1 - gap);
          if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
      } else {
        ctx.moveTo(s[0], s[1]);
        for (let j = 2; j < s.length; j += 2) ctx.lineTo(s[j], s[j + 1]);
      }
      ctx.closePath();
      if (drawFill) {
        ctx.globalAlpha = fillA;
        ctx.fillStyle = colorOverride ? colorOverride(tiles[i], i) : look.lut[scene.lutIdx[i]];
        ctx.fill();
      }
      if (drawLine) {
        ctx.globalAlpha = lineA;
        ctx.strokeStyle = look.line;
        ctx.lineWidth = lw;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // full scene paint onto a target ctx (used by Effects pipeline).
  // colorOverride: optional per-tile fill replacement (frozen shimmer).
  function paintScene(targetCtx, scene, params, look, colorOverride) {
    targetCtx.clearRect(0, 0, scene.W, scene.H);
    paintTiles(targetCtx, scene, look, colorOverride);
  }

  /* ----------------------------------------------------- animation */

  function makeAnimator(scene, params, look) {
    const speed = params.animSpeed || 1;
    const anim = params.animation || 'none';
    if (anim === 'none') return null;

    if (anim === 'shimmer') {
      const shim = buildShimLuts(look.lut);
      return {
        perTile: true,
        // t -> sin(phase*2 - spatial); loops when phase*2 advances by 2*PI
        periodMs: (2 * Math.PI) / (0.0022 * speed),
        frame: (ctx, t) => {
          const phase = t * 0.0011 * speed;
          paintTiles(ctx, scene, look, (tile, i) => {
            const [px, py] = tilePos(tile);
            const w = Math.sin(phase * 2 - (px * 0.9 + py * 1.4));
            const sIdx = Math.max(0, Math.min(SHIM_STEPS - 1, Math.round((w + 1) / 2 * (SHIM_STEPS - 1))));
            return shim[sIdx][scene.lutIdx[i]];
          });
        },
      };
    }

    if (anim === 'flow') {
      // Gradient Flow: repeating band of palette/gradient colors drifting
      // along params.flowAngle; composite 'overlay' keeps the underlying
      // pattern visible. Seamless: pattern is periodic in the band offset.
      const colors = [10, 90, 170, 240].map((i) => look.lut[i]);
      return {
        overlay: true,
        periodMs: 1 / (0.00012 * speed), // phase wraps every 1 -> seamless
        overlayFn: (ctx, t) => {
          const W = scene.W, H = scene.H;
          const th = rad(params.flowAngle == null ? 30 : params.flowAngle);
          const dx = Math.cos(th), dy = Math.sin(th);
          const half = (Math.abs(W * dx) + Math.abs(H * dy)) / 2;
          const P = Math.max(180, half); // wavelength (one 4-color cycle)
          const phase = ((t * 0.00012 * speed) % 1) * P;
          const cx = W / 2, cy = H / 2;
          const axis = 2 * (half + P);
          const grad = ctx.createLinearGradient(
            cx - dx * (half + P) - dx * phase, cy - dy * (half + P) - dy * phase,
            cx + dx * (half + P) - dx * phase, cy + dy * (half + P) - dy * phase
          );
          const dStep = P / colors.length; // one color step; 4 steps = one period
          const nStops = Math.ceil(axis / dStep) + 1;
          for (let k = 0; k <= nStops; k++) {
            grad.addColorStop(Math.min(1, Math.max(0, (k * dStep) / axis)), colors[k % colors.length]);
          }
          ctx.save();
          ctx.globalCompositeOperation = 'overlay';
          ctx.globalAlpha = 0.65;
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, W, H);
          ctx.globalAlpha = 0.3;
          ctx.globalCompositeOperation = 'soft-light';
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, W, H);
          ctx.restore();
        },
      };
    }

    if (anim === 'glowwave') {
      // Glow Wave: soft band of light sweeping across; two bands half a
      // period apart keep the loop seamless.
      const bgLum = PAL.luminance(look.bg || '#000');
      const mode = bgLum > 0.5 ? 'soft-light' : 'lighter';
      return {
        overlay: true,
        periodMs: 1 / (0.00009 * speed), // band pattern repeats after travel
        overlayFn: (ctx, t) => {
          const W = scene.W, H = scene.H;
          const th = rad(params.flowAngle == null ? 30 : params.flowAngle);
          const dx = Math.cos(th), dy = Math.sin(th);
          const diag = Math.hypot(W, H);
          const bw = diag * 0.28;
          const travel = diag + 2 * bw;
          const phase = ((t * 0.00009 * speed) % 1) * travel;
          const cx = W / 2, cy = H / 2;
          const intensity = 0.5;
          ctx.save();
          ctx.globalCompositeOperation = mode;
          for (const off of [0, travel / 2]) {
            const c0 = cx - dx * (phase + off), c1 = cy - dy * (phase + off);
            const grad = ctx.createLinearGradient(
              c0 - dx * bw, c1 - dy * bw, c0 + dx * bw, c1 + dy * bw
            );
            grad.addColorStop(0, 'rgba(255,255,255,0)');
            grad.addColorStop(0.5, `rgba(255,250,235,${intensity})`);
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, W, H);
          }
          ctx.restore();
        },
      };
    }

    return null;
  }

  /* ----------------------------------------------------- export API */

  root.Renderer = {
    buildScene, colorize, buildLut, buildLutFromColors, buildSolidLut, buildShimLuts,
    paintTiles, paintScene, makeAnimator, frozenShimmer,
    rng, hash2, shrunkHatOutline, shrunkPoly, clusterBBox,
  };
})(typeof window !== 'undefined' ? window : globalThis);
