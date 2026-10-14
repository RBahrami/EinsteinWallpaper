/*
 * hat-tiling.js — aperiodic "hat" tile (Einstein tile) tiling engine.
 *
 * Implements the metatile substitution construction published in:
 *   D. Smith, J. S. Myers, C. S. Kaplan, C. Goodman-Strauss,
 *   "An Aperiodic Monotile", arXiv:2303.10798 (2023).
 *
 * Four auxiliary metatiles — H (hexagon), T (triangle), P (parallelogram)
 * and F (pentagon) — are repeatedly expanded through a fixed 29-tile patch.
 * The hat-shaped leaves at the bottom of the expansion form an exact,
 * non-periodic tiling of the plane.
 *
 * Original implementation for the EinsteinWallpaper project.
 * Runs in the browser (window.HatTiling) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------ affine */

  // Transform [a,b,c,d,e,f]: (x,y) -> (a*x + b*y + c, d*x + e*y + f)
  const IDENT = [1, 0, 0, 0, 1, 0];

  function mmul(A, B) {
    return [
      A[0] * B[0] + A[1] * B[3],
      A[0] * B[1] + A[1] * B[4],
      A[0] * B[2] + A[1] * B[5] + A[2],
      A[3] * B[0] + A[4] * B[3],
      A[3] * B[1] + A[4] * B[4],
      A[3] * B[2] + A[4] * B[5] + A[5],
    ];
  }
  function mapply(M, p) {
    return [M[0] * p[0] + M[1] * p[1] + M[2], M[3] * p[0] + M[4] * p[1] + M[5]];
  }
  function mdet(M) { return M[0] * M[4] - M[1] * M[3]; }
  function minv(M) {
    const d = mdet(M);
    return [
      M[4] / d, -M[1] / d, (M[1] * M[5] - M[2] * M[4]) / d,
      -M[3] / d, M[0] / d, (M[2] * M[3] - M[0] * M[5]) / d,
    ];
  }
  function mtrans(tx, ty) { return [1, 0, tx, 0, 1, ty]; }
  function mrot(a) { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0]; }
  function rotAbout(p, a) { return mmul(mtrans(p[0], p[1]), mmul(mrot(a), mtrans(-p[0], -p[1]))); }

  // Orientation-preserving similarity mapping segment p1->q1 onto p2->q2.
  function segmap(p1, q1, p2, q2) {
    const frame = (p, q) => {
      const dx = q[0] - p[0], dy = q[1] - p[1];
      return [dx, -dy, p[0], dy, dx, p[1]];
    };
    return mmul(frame(p2, q2), minv(frame(p1, q1)));
  }

  function lineIntersect(p1, q1, p2, q2) {
    const d = (q2[1] - p2[1]) * (q1[0] - p1[0]) - (q2[0] - p2[0]) * (q1[1] - p1[1]);
    const u = ((q2[0] - p2[0]) * (p1[1] - p2[1]) - (q2[1] - p2[1]) * (p1[0] - p2[0])) / d;
    return [p1[0] + u * (q1[0] - p1[0]), p1[1] + u * (q1[1] - p1[1])];
  }

  const padd = (p, q) => [p[0] + q[0], p[1] + q[1]];
  const psub = (p, q) => [p[0] - q[0], p[1] - q[1]];

  function bboxOf(polys) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const poly of polys) {
      for (const p of poly) {
        if (p[0] < x0) x0 = p[0];
        if (p[0] > x1) x1 = p[0];
        if (p[1] < y0) y0 = p[1];
        if (p[1] > y1) y1 = p[1];
      }
    }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  }

  function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  /* ------------------------------------------------- the hat (13-gon) */

  // Hat = polykite on the hex (kite) lattice; axial -> cartesian.
  const HR3 = Math.sqrt(3) / 2;
  const hexPt = (x, y) => [x + y / 2, HR3 * y];
  const HAT_OUTLINE = [
    [0, 0], [-1, -1], [0, -2], [2, -2], [2, -1], [4, -2], [5, -1],
    [4, 0], [3, 0], [2, 2], [0, 3], [0, 2], [-1, 2],
  ].map((c) => hexPt(c[0], c[1]));

  /* ------------------------------------------- base metatiles (L0) */

  function baseMetatiles() {
    const Hout = [[0, 0], [4, 0], [4.5, HR3], [2.5, 5 * HR3], [1.5, 5 * HR3], [-0.5, HR3]];
    const Tout = [[0, 0], [3, 0], [1.5, 3 * HR3]];
    const Pout = [[0, 0], [4, 0], [3, 2 * HR3], [-1, 2 * HR3]];
    const Fout = [[0, 0], [3, 0], [3.5, HR3], [3, 2 * HR3], [-1, 2 * HR3]];

    const Hhats = [
      segmap(HAT_OUTLINE[5], HAT_OUTLINE[7], Hout[5], Hout[0]),
      segmap(HAT_OUTLINE[9], HAT_OUTLINE[11], Hout[1], Hout[2]),
      segmap(HAT_OUTLINE[5], HAT_OUTLINE[7], Hout[3], Hout[4]),
      mmul(mtrans(2.5, HR3), mmul([-0.5, -HR3, 0, HR3, -0.5, 0], [0.5, 0, 0, 0, -0.5, 0])),
    ];
    const That = [[0.5, 0, 0.5, 0, 0.5, HR3]];
    const pf1 = [0.5, 0, 1.5, 0, 0.5, HR3];
    const pf2 = mmul(mtrans(0, 2 * HR3), mmul([0.5, HR3, 0, -HR3, 0.5, 0], [0.5, 0, 0, 0, 0.5, 0]));

    return {
      H: { outline: Hout, hats: Hhats },
      T: { outline: Tout, hats: That },
      P: { outline: Pout, hats: [pf1, pf2] },
      F: { outline: Fout, hats: [pf1, pf2] },
    };
  }

  /* ------------------------------------------------ 29-tile patch */

  // Placement sequence for one substitution step:
  //   [t]                  -> metatile t at identity
  //   [i, j, t, k]         -> t with its edge (k,k+1) matched to edge (j+1,j) of child i
  //   [i, j, i2, j2, t, k] -> t with edge (k,k+1) matched to the segment
  //                           from vertex j2 of child i2 to vertex j of child i
  const PATCH_RULES = [
    ['H'],
    [0, 0, 'P', 2],
    [1, 0, 'H', 2],
    [2, 0, 'P', 2],
    [3, 0, 'H', 2],
    [4, 4, 'P', 2],
    [0, 4, 'F', 3],
    [2, 4, 'F', 3],
    [4, 1, 3, 2, 'F', 0],
    [8, 3, 'H', 0],
    [9, 2, 'P', 0],
    [10, 2, 'H', 0],
    [11, 4, 'P', 2],
    [12, 0, 'H', 2],
    [13, 0, 'F', 3],
    [14, 2, 'F', 1],
    [15, 3, 'H', 4],
    [8, 2, 'F', 1],
    [17, 3, 'H', 0],
    [18, 2, 'P', 0],
    [19, 2, 'H', 2],
    [20, 4, 'F', 3],
    [20, 0, 'P', 2],
    [22, 0, 'H', 2],
    [23, 4, 'F', 3],
    [23, 0, 'F', 3],
    [16, 0, 'P', 2],
    [9, 4, 0, 2, 'T', 2],
    [4, 0, 'F', 3],
  ];

  // Patch children regrouped into the four next-level metatiles.
  const GROUPS = {
    H: [0, 9, 16, 27, 26, 6, 1, 8, 10, 15],
    T: [11],
    P: [7, 2, 3, 4, 28],
    F: [21, 20, 22, 23, 24, 25],
  };

  function buildPatch(met) {
    const kids = [];
    for (const r of PATCH_RULES) {
      if (r.length === 1) {
        kids.push({ type: r[0], T: IDENT.slice() });
      } else if (r.length === 4) {
        const i = r[0], j = r[1], type = r[2], k = r[3];
        const poly = met[kids[i].type].outline;
        const P1 = mapply(kids[i].T, poly[(j + 1) % poly.length]);
        const Q1 = mapply(kids[i].T, poly[j]);
        const np = met[type].outline;
        kids.push({ type, T: segmap(np[k], np[(k + 1) % np.length], P1, Q1) });
      } else {
        const i = r[0], j = r[1], i2 = r[2], j2 = r[3], type = r[4], k = r[5];
        const chP = kids[i], chQ = kids[i2];
        const P2 = mapply(chQ.T, met[chQ.type].outline[j2]);
        const Q2 = mapply(chP.T, met[chP.type].outline[j]);
        const np = met[type].outline;
        kids.push({ type, T: segmap(np[k], np[(k + 1) % np.length], P2, Q2) });
      }
    }
    return kids;
  }

  function buildMetatiles(kids, met) {
    const V = (n, i) => mapply(kids[n].T, met[kids[n].type].outline[i]);

    const bps1 = V(8, 2);
    const bps2 = V(21, 2);
    const rbps = mapply(rotAbout(bps1, -2 * Math.PI / 3), bps2);
    const p72 = V(7, 2);
    const p252 = V(25, 2);

    const llc = lineIntersect(bps1, rbps, V(6, 2), p72);
    let w = psub(V(6, 2), llc);

    const Hout = [llc, bps1];
    w = mapply(mrot(-Math.PI / 3), w);
    Hout.push(padd(Hout[1], w));
    Hout.push(V(14, 2));
    w = mapply(mrot(-Math.PI / 3), w);
    Hout.push(psub(Hout[3], w));
    Hout.push(V(6, 2));

    const Pout = [p72, padd(p72, psub(bps1, llc)), bps1, llc];
    const Fout = [bps2, V(24, 2), V(25, 0), p252, padd(p252, psub(llc, bps1))];

    const AAA = Hout[2];
    const BBB = padd(Hout[1], psub(Hout[4], Hout[5]));
    const CCC = mapply(rotAbout(BBB, -Math.PI / 3), AAA);
    const Tout = [BBB, CCC, AAA];

    const pick = (idx) => idx.map((i) => ({ type: kids[i].type, T: kids[i].T }));
    return {
      H: { outline: Hout, kids: pick(GROUPS.H) },
      T: { outline: Tout, kids: pick(GROUPS.T) },
      P: { outline: Pout, kids: pick(GROUPS.P) },
      F: { outline: Fout, kids: pick(GROUPS.F) },
    };
  }

  /* ------------------------------------------- level hierarchy */

  // levels[0] = base metatiles (hat leaves); levels[k].X.kids reference levels[k-1].
  function buildLevels(maxLevel) {
    const levels = [baseMetatiles()];
    for (let k = 1; k <= maxLevel; k++) {
      levels.push(buildMetatiles(buildPatch(levels[k - 1]), levels[k - 1]));
    }
    return levels;
  }

  /**
   * Expand ONE root metatile of `level` down to its hat leaves.
   * The subtree of any single metatile is a gap-free, overlap-free patch of
   * the aperiodic tiling (verified geometrically for H/T/P/F at L3).
   * root: 'H' | 'T' | 'P' | 'F'
   * Returns { hats: [{T, cls, mirror, x, y}], hatEdge, aborted } where cls is
   * the index of the root's first-level child (ancestry class, for coloring).
   */
  function hatsForLevel(levels, level, opts) {
    opts = opts || {};
    const rootType = opts.root || 'H';
    const budget = opts.budget || Infinity;
    const hats = [];
    let aborted = false;
    let hatEdge = 0;

    const edgeLen = Math.hypot(HAT_OUTLINE[1][0] - HAT_OUTLINE[0][0], HAT_OUTLINE[1][1] - HAT_OUTLINE[0][1]);

    function rec(node, T, depth, cls) {
      if (aborted) return;
      if (node.hats) {                       // base metatile: emit hat leaves
        for (const L of node.hats) {
          const M = mmul(T, L);
          const c = mapply(M, [1.5, 0.5 * HR3]);
          if (!hatEdge) hatEdge = edgeLen * Math.sqrt(Math.abs(mdet(M)));
          hats.push({ T: M, cls, mirror: mdet(M) < 0, x: c[0], y: c[1] });
        }
        return;
      }
      if (depth === 0) return;
      const next = levels[depth - 1];
      for (const kid of node.kids) rec(next[kid.type], mmul(T, kid.T), depth - 1, cls);
    }

    const lv = levels[level][rootType];
    if (lv.hats) {
      rec(lv, IDENT, 0, 0);
    } else {
      for (let i = 0; i < lv.kids.length; i++) {
        rec(levels[level - 1][lv.kids[i].type], lv.kids[i].T, level - 1, i);
        if (hats.length > budget) { aborted = true; break; }
      }
    }
    return { hats, hatEdge, aborted, classes: lv.hats ? 1 : lv.kids.length };
  }

  /* --------------------------------------------- canvas fitting */

  // Largest axis-aligned rectangle with the given aspect (w/h) that lies
  // entirely inside the union of `polys`. Returns {cx, cy, w, h} or null.
  function inscribedRect(polys, aspect, res) {
    res = res || 220;
    const bb = bboxOf(polys);
    const W = res, H = Math.max(8, Math.round(res / aspect));
    const mask = new Uint8Array(W * H);
    const toX = (x) => (x - bb.x0) / bb.w * (W - 1);
    const toY = (y) => (y - bb.y0) / bb.h * (H - 1);

    for (const poly of polys) {
      const pts = poly.map((p) => [toX(p[0]), toY(p[1])]);
      let ymin = Math.max(0, Math.floor(Math.min.apply(null, pts.map((p) => p[1]))));
      let ymax = Math.min(H - 1, Math.ceil(Math.max.apply(null, pts.map((p) => p[1]))));
      for (let y = ymin; y <= ymax; y++) {
        const xs = [];
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
            xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
          }
        }
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const xa = Math.max(0, Math.ceil(xs[k])), xb = Math.min(W - 1, Math.floor(xs[k + 1]));
          for (let x = xa; x <= xb; x++) mask[y * W + x] = 1;
        }
      }
    }

    // For each row span, find the widest run of fully-covered columns,
    // keeping the best rectangle whose w/h is closest to (and >= ) the target aspect.
    let best = null;
    const fullyCovered = new Uint8Array(W);
    for (let y0 = 0; y0 < H; y0++) {
      fullyCovered.fill(1);
      for (let y1 = y0; y1 < H; y1++) {
        const row = y1 * W;
        for (let x = 0; x < W; x++) if (!mask[row + x]) fullyCovered[x] = 0;
        // longest run
        let runStart = -1;
        for (let x = 0; x <= W; x++) {
          if (x < W && fullyCovered[x]) {
            if (runStart < 0) runStart = x;
          } else if (runStart >= 0) {
            const w = x - runStart, h = y1 - y0 + 1;
            const rectAspect = w / h;
            if (rectAspect >= aspect - 1e-6) {
              const area = w * h;
              if (!best || area > best.area) {
                best = { x0: runStart, y0, x1: x - 1, y1, area };
              }
            }
            runStart = -1;
          }
        }
      }
    }
    if (!best) return null;
    // shrink to exact target aspect, anchored at left/bottom of the found rect
    const rx0 = bb.x0 + best.x0 / (W - 1) * bb.w;
    const rx1 = bb.x0 + best.x1 / (W - 1) * bb.w;
    const ry0 = bb.y0 + best.y0 / (H - 1) * bb.h;
    const ry1 = bb.y0 + best.y1 / (H - 1) * bb.h;
    let rw = rx1 - rx0, rh = ry1 - ry0;
    if (rw / rh > aspect) rw = rh * aspect; else rh = rw / aspect;
    return { x: rx0, y: ry0, w: rw, h: rh };
  }

  const API = {
    HR3, IDENT,
    HAT_OUTLINE,
    mmul, mapply, mdet, minv, mtrans, mrot, rotAbout, segmap,
    lineIntersect, padd, psub, bboxOf, pointInPoly,
    buildLevels, hatsForLevel, inscribedRect,
    baseMetatiles, buildPatch, buildMetatiles,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.HatTiling = API;
})(typeof window !== 'undefined' ? window : globalThis);
