/*
 * tilings.js — geometric tiling families for Tessellate.
 *
 * Each family exposes:
 *   id, name, icon (inline SVG), variants [{id,name}],
 *   modes (color modes that make sense for this family),
 *   generate(variant, bounds, seed) -> { tiles, kindCount, orientCount }
 *
 * Tile representation (world units; 1 unit = tile edge / characteristic size):
 *   { poly: [[x,y],...], k, o, cx, cy }   filled polygon
 *   { line: [x1,y1,x2,y2], w, k, o, cx, cy }  line primitive (Lines family)
 *   k = kind index (tile class), o = orientation bucket.
 *
 * The Einstein hat family is handled by hat-tiling.js + render.js and only
 * declares its metadata here.
 *
 * Constructions implemented & verified (tests/verify-tilings.js):
 *   - herringbone: L-pair (chair) on translation lattice (4,1),(1,1)
 *   - cairo: dual of the snub square tiling (squares lattice t1,t2 = D@15°,105°,
 *     D=2cos15°, rotated squares at face centers; triangles on every square edge)
 *   - penrose: dual of a de Bruijn pentagrid (5 generic line families at 72°)
 *   - trihexagonal: rectified honeycomb (kagome)
 *   - octagon-square: truncated square tiling
 *   - trapezoids/kites: half-turn tessellation of a generic quad (BFS)
 */
(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const rad = (d) => d * Math.PI / 180;
  const dir = (d) => [Math.cos(rad(d)), Math.sin(rad(d))];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const mul = (a, k) => [a[0] * k, a[1] * k];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const key2 = (p, q = 1e4) => Math.round(p[0] * q) + ',' + Math.round(p[1] * q);

  function centroid(poly) {
    let x = 0, y = 0;
    for (const p of poly) { x += p[0]; y += p[1]; }
    return [x / poly.length, y / poly.length];
  }
  function orientBucket(p, n) {
    const a = Math.atan2(p[1], p[0]);
    let b = Math.round(a / (TAU / n)) % n;
    if (b < 0) b += n;
    return b;
  }
  function mkTile(poly, k, o) {
    const c = centroid(poly);
    return { poly, k, o, cx: c[0], cy: c[1] };
  }
  function mkLine(x1, y1, x2, y2, w, k, o) {
    return { line: [x1, y1, x2, y2], w, k, o, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
  }
  // generate integer lattice cells covering bounds (with 1-cell margin)
  function latticeRange(bounds, e1, e2) {
    // world = i*e1 + j*e2 ; invert [e1 e2] to get i,j ranges
    const det = e1[0] * e2[1] - e1[1] * e2[0];
    const corners = [
      [bounds.x0, bounds.y0], [bounds.x1, bounds.y0],
      [bounds.x0, bounds.y1], [bounds.x1, bounds.y1],
    ];
    let iMin = Infinity, iMax = -Infinity, jMin = Infinity, jMax = -Infinity;
    for (const c of corners) {
      const i = (c[0] * e2[1] - c[1] * e2[0]) / det;
      const j = (e1[0] * c[1] - e1[1] * c[0]) / det;
      if (i < iMin) iMin = i; if (i > iMax) iMax = i;
      if (j < jMin) jMin = j; if (j > jMax) jMax = j;
    }
    return {
      i0: Math.floor(iMin) - 1, i1: Math.ceil(iMax) + 1,
      j0: Math.floor(jMin) - 1, j1: Math.ceil(jMax) + 1,
    };
  }
  // rotate generation frame by theta: bounds rotated by -theta, points rotated back
  function rotatedBounds(bounds, theta) {
    const c = Math.cos(-theta), s = Math.sin(-theta);
    const corners = [
      [bounds.x0, bounds.y0], [bounds.x1, bounds.y0],
      [bounds.x0, bounds.y1], [bounds.x1, bounds.y1],
    ].map(([x, y]) => [x * c - y * s, x * s + y * c]);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of corners) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { x0, y0, x1, y1 };
  }
  function rotPoints(pts, theta) {
    const c = Math.cos(theta), s = Math.sin(theta);
    return pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);
  }

  /* ------------------------------ generators ------------------------------ */

  function genLines(variant, bounds) {
    const tiles = [];
    const w = 0.34;
    const diag = Math.hypot(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0) + 2;
    const cxm = (bounds.x0 + bounds.x1) / 2, cym = (bounds.y0 + bounds.y1) / 2;
    function band(normalAng, kBase, kindCount) {
      const n = dir(normalAng), d = dir(normalAng + 90);
      // offsets t = p.n ; range
      const cs = [
        [bounds.x0, bounds.y0], [bounds.x1, bounds.y0],
        [bounds.x0, bounds.y1], [bounds.x1, bounds.y1],
      ].map((p) => p[0] * n[0] + p[1] * n[1]);
      const t0 = Math.floor(Math.min(...cs)) - 1, t1 = Math.ceil(Math.max(...cs)) + 1;
      for (let t = t0; t <= t1; t++) {
        const px = cxm * 0 + n[0] * t, py = n[1] * t; // point on line (origin-based)
        tiles.push(mkLine(px - d[0] * diag, py - d[1] * diag, px + d[0] * diag, py + d[1] * diag, w, kBase, 0));
      }
      return kindCount;
    }
    let kc = 1;
    if (variant === 'horizontal') band(90, 0, 1);
    else if (variant === 'vertical') band(0, 0, 1);
    else if (variant === 'diagonal') band(45, 0, 1);
    else if (variant === 'crosshatch') { band(45, 0, 2); band(135, 1, 2); kc = 2; }
    else if (variant === 'grid') { band(90, 0, 2); band(0, 1, 2); kc = 2; }
    return { tiles, kindCount: kc, orientCount: 1, lineBased: true };
  }

  function genTriangles(variant, bounds) {
    const tiles = [];
    if (variant === 'right') {
      const r = latticeRange(bounds, [1, 0], [0, 1]);
      for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) {
        const flip = ((i + j) % 2 + 2) % 2 === 1;
        if (!flip) {
          tiles.push(mkTile([[i, j], [i + 1, j], [i + 1, j + 1]], 0, orientBucket([1, 0], 4)));
          tiles.push(mkTile([[i, j], [i + 1, j + 1], [i, j + 1]], 1, orientBucket([0, 1], 4)));
        } else {
          tiles.push(mkTile([[i, j], [i + 1, j], [i, j + 1]], 1, orientBucket([0, 1], 4)));
          tiles.push(mkTile([[i + 1, j], [i + 1, j + 1], [i, j + 1]], 0, orientBucket([1, 0], 4)));
        }
      }
      return { tiles, kindCount: 2, orientCount: 4 };
    }
    // equilateral: alternate rows offset by half a side (edge-to-edge)
    const h = Math.sqrt(3) / 2;
    const r = latticeRange(bounds, [1, 0], [0.5, h]);
    for (let j = r.j0; j <= r.j1; j++) {
      const off = (((j % 2) + 2) % 2) * 0.5;
      for (let i = r.i0; i <= r.i1; i++) {
        const x = i + off;
        const y = j * h;
        tiles.push(mkTile([[x, y], [x + 1, y], [x + 0.5, y + h]], 0, 0));
        tiles.push(mkTile([[x + 0.5, y + h], [x + 1.5, y + h], [x + 1, y]], 1, 1));
      }
    }
    return { tiles, kindCount: 2, orientCount: 2 };
  }

  function genSquares(variant, bounds) {
    if (variant === 'diamond') {
      const th = rad(45);
      const rb = rotatedBounds(bounds, th);
      const r = latticeRange(rb, [1, 0], [0, 1]);
      const tiles = [];
      for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) {
        tiles.push(mkTile(rotPoints([[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]], th), 0, 0));
      }
      return { tiles, kindCount: 1, orientCount: 1 };
    }
    const r = latticeRange(bounds, [1, 0], [0, 1]);
    const tiles = [];
    const checker = variant === 'checker';
    for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) {
      const k = checker ? (((i + j) % 2) + 2) % 2 : 0;
      tiles.push(mkTile([[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]], k, 0));
    }
    return { tiles, kindCount: checker ? 2 : 1, orientCount: 1 };
  }

  function genRectangles(variant, bounds) {
    const tiles = [];
    if (variant === 'grid') {
      const r = latticeRange(bounds, [2, 0], [0, 1]);
      for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) {
        tiles.push(mkTile([[2 * i, j], [2 * i + 2, j], [2 * i + 2, j + 1], [2 * i, j + 1]], 0, 0));
      }
      return { tiles, kindCount: 1, orientCount: 1 };
    }
    if (variant === 'brick') {
      const r = latticeRange(bounds, [2, 0], [0, 1]);
      for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) {
        const off = ((j % 2) + 2) % 2;
        tiles.push(mkTile([[2 * i + off, j], [2 * i + off + 2, j], [2 * i + off + 2, j + 1], [2 * i + off, j + 1]], 0, off));
      }
      return { tiles, kindCount: 1, orientCount: 2 };
    }
    if (variant === 'basketweave') {
      const r = latticeRange(bounds, [4, 0], [0, 2]);
      for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) {
        const x = 4 * i, y = 2 * j;
        tiles.push(mkTile([[x, y], [x + 2, y], [x + 2, y + 1], [x, y + 1]], 0, 0));
        tiles.push(mkTile([[x, y + 1], [x + 2, y + 1], [x + 2, y + 2], [x, y + 2]], 0, 0));
        tiles.push(mkTile([[x + 2, y], [x + 3, y], [x + 3, y + 2], [x + 2, y + 2]], 1, 1));
        tiles.push(mkTile([[x + 3, y], [x + 4, y], [x + 4, y + 2], [x + 3, y + 2]], 1, 1));
      }
      return { tiles, kindCount: 2, orientCount: 2 };
    }
    // herringbone: verified chair H[0,2]x[0,1] + V[2,3]x[0,2], lattice (2,2),(1,-1)
    const r = latticeRange(bounds, [2, 2], [1, -1]);
    for (let b = r.j0; b <= r.j1; b++) for (let a = r.i0; a <= r.i1; a++) {
      const x = 2 * a + b, y = 2 * a - b;
      tiles.push(mkTile([[x, y], [x + 2, y], [x + 2, y + 1], [x, y + 1]], 0, 0));
      tiles.push(mkTile([[x + 2, y], [x + 3, y], [x + 3, y + 2], [x + 2, y + 2]], 1, 1));
    }
    return { tiles, kindCount: 2, orientCount: 2 };
  }

  function genRhombi(variant, bounds) {
    const theta = rad(parseFloat(variant));
    const u = [1, 0], v = [Math.cos(theta), Math.sin(theta)];
    const r = latticeRange(bounds, u, v);
    const tiles = [];
    for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) {
      const p = add(mul(u, i), mul(v, j));
      tiles.push(mkTile([p, add(p, u), add(p, add(u, v)), add(p, v)], 0, 0));
    }
    return { tiles, kindCount: 1, orientCount: 1 };
  }

  function genParallelograms(variant, bounds) {
    // variants: '30r','45r','30l' -> shear vector
    const slant = variant === '45r' ? 1 : variant === '30l' ? -Math.tan(rad(30)) : Math.tan(rad(30));
    const u = [1, 0], v = [slant, 1];
    const r = latticeRange(bounds, u, v);
    const tiles = [];
    for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) {
      const p = add(mul(u, i), mul(v, j));
      tiles.push(mkTile([p, add(p, u), add(p, add(u, v)), add(p, v)], 0, 0));
    }
    return { tiles, kindCount: 1, orientCount: 1 };
  }

  function genHexagons(variant, bounds) {
    const th = variant === 'pointy' ? rad(-90) : 0;
    const rb = rotatedBounds(bounds, th);
    // honeycomb: vertices at dir(60k), neighbour centres at distance sqrt(3)
    // along directions 30/90/150 deg -> lattice e1, e2 below (verified)
    const e1 = [1.5, Math.sqrt(3) / 2], e2 = [0, Math.sqrt(3)];
    const r = latticeRange(rb, e1, e2);
    const tiles = [];
    for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) {
      const cx = e1[0] * i + e2[0] * j, cy = e1[1] * i + e2[1] * j;
      const pts = [];
      for (let k = 0; k < 6; k++) {
        const d = dir(60 * k);
        pts.push([cx + d[0], cy + d[1]]);
      }
      tiles.push(mkTile(rotPoints(pts, th), 0, 0));
    }
    return { tiles, kindCount: 1, orientCount: 1 };
  }

  /* half-turn tessellation of a generic quad (BFS, verified hole/overlap free) */
  function halfTurn(quad, bounds, maxTiles) {
    const tiles = [];
    const seen = new Set();
    const queue = [quad.map((p) => [...p])];
    const kFor = (poly) => key2(centroid(poly), 1e4);
    seen.add(kFor(quad));
    while (queue.length && tiles.length < maxTiles) {
      const poly = queue.pop();
      tiles.push(poly);
      for (let i = 0; i < 4; i++) {
        const a = poly[i], b = poly[(i + 1) % 4];
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        const nb = poly.map(([x, y]) => [2 * mx - x, 2 * my - y]);
        const k = kFor(nb);
        if (seen.has(k)) continue;
        let nx0 = Infinity, nx1 = -Infinity, ny0 = Infinity, ny1 = -Infinity;
        for (const [x, y] of nb) {
          if (x < nx0) nx0 = x; if (x > nx1) nx1 = x;
          if (y < ny0) ny0 = y; if (y > ny1) ny1 = y;
        }
        if (nx1 < bounds.x0 || nx0 > bounds.x1 || ny1 < bounds.y0 || ny0 > bounds.y1) continue;
        seen.add(k);
        queue.push(nb);
      }
    }
    return tiles;
  }

  function genTrapezoids(variant, bounds) {
    const h = variant === 'flat' ? 0.55 : variant === 'steep' ? 1.35 : 0.9;
    const quads = halfTurn([[0, 0], [2, 0], [1.5, h], [0.5, h]], bounds, 60000);
    return { tiles: quads.map((p) => mkTile(p, 0, 0)), kindCount: 1, orientCount: 1 };
  }

  function genKites(variant, bounds) {
    const dims = variant === 'slim' ? [1.3, 0.35, 0.7] : variant === 'wide' ? [0.8, 0.7, 1.3] : [1.1, 0.5, 0.9];
    const quad = [[0, dims[0]], [dims[1], 0], [0, -dims[2]], [-dims[1], 0]];
    const quads = halfTurn(quad, bounds, 60000);
    return { tiles: quads.map((p) => mkTile(p, 0, 0)), kindCount: 1, orientCount: 1 };
  }

  /* trihexagonal (kagome): rectified honeycomb — derived & verified */
  function genTrihexagonal(variant, bounds) {
    const th = variant === 'rotated' ? rad(30) : 0;
    const rb = rotatedBounds(bounds, th);
    const a = 1, L = 2 * a / Math.sqrt(3);
    const e1 = [Math.sqrt(3) * a, a], e2 = [0, 2 * a];
    const r = latticeRange(rb, e1, e2);
    const tiles = [];
    const seenVoid = new Set();
    for (let jj = r.j0; jj <= r.j1; jj++) for (let ii = r.i0; ii <= r.i1; ii++) {
      const cx = e1[0] * ii + e2[0] * jj, cy = e1[1] * ii + e2[1] * jj;
      const hex = [];
      for (let k = 0; k < 6; k++) {
        const d = dir(30 + 60 * k);
        hex.push([cx + a * d[0], cy + a * d[1]]);
      }
      tiles.push(mkTile(rotPoints(hex, th), 0, 0));
      for (let k = 0; k < 6; k++) {
        const angle = 60 * k;
        const d = dir(angle);
        const v = [cx + L * d[0], cy + L * d[1]];
        const vk = key2(rotPoints([v], th)[0]);
        if (seenVoid.has(vk)) continue;
        seenVoid.add(vk);
        const tri = [];
        for (const off of [0, 120, 240]) {
          const dd = dir(angle + off);
          tri.push([v[0] + (L / 2) * dd[0], v[1] + (L / 2) * dd[1]]);
        }
        tiles.push(mkTile(rotPoints(tri, th), 1, orientBucket(d, 6)));
      }
    }
    return { tiles, kindCount: 2, orientCount: 6 };
  }

  /* octagon-square (truncated square tiling) — derived & verified */
  function genOctagonSquare(variant, bounds) {
    const a = 1, R = a * (1 + Math.SQRT2) / 2;
    const r = latticeRange(bounds, [2 * R, 0], [0, 2 * R]);
    const tiles = [];
    for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) {
      const cx = 2 * R * i, cy = 2 * R * j;
      const oct = [
        [cx - a / 2, cy - R], [cx + a / 2, cy - R], [cx + R, cy - a / 2], [cx + R, cy + a / 2],
        [cx + a / 2, cy + R], [cx - a / 2, cy + R], [cx - R, cy + a / 2], [cx - R, cy - a / 2],
      ];
      tiles.push(mkTile(oct, 0, 0));
      const d = a / Math.SQRT2;
      tiles.push(mkTile([[cx + R, cy + R - d], [cx + R + d, cy + R], [cx + R, cy + R + d], [cx + R - d, cy + R]], 1, orientBucket([1, 1], 8)));
    }
    return { tiles, kindCount: 2, orientCount: 8 };
  }

  /* Cairo pentagonal tiling: dual of the snub square tiling (verified) */
  function genCairo(variant, bounds) {
    const D = 2 * Math.cos(rad(15));
    const t1 = mul(dir(15), D), t2 = mul(dir(105), D);
    const Boff = mul(add(t1, t2), 0.5);
    const r = latticeRange(bounds, t1, t2);
    const squares = [];
    const c30 = Math.cos(rad(30)), s30 = Math.sin(rad(30));
    for (let jj = r.j0; jj <= r.j1; jj++) for (let ii = r.i0; ii <= r.i1; ii++) {
      const ox = t1[0] * ii + t2[0] * jj, oy = t1[1] * ii + t2[1] * jj;
      squares.push([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([x, y]) => [x + ox, y + oy]));
      squares.push(
        [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]
          .map(([x, y]) => [x * c30 - y * s30, x * s30 + y * c30])
          .map(([x, y]) => [x + ox + Boff[0], y + oy + Boff[1]])
      );
    }
    // triangles: equilateral on every square edge, outward, deduped
    const tris = new Map();
    for (const sq of squares) {
      const c = centroid(sq);
      for (let i = 0; i < 4; i++) {
        const a = sq[i], b = sq[(i + 1) % 4];
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        let nx = -(b[1] - a[1]), ny = b[0] - a[0];
        const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl;
        const sign = ((mx + nx * 0.05 - c[0]) ** 2 + (my + ny * 0.05 - c[1]) ** 2) >
          ((mx - nx * 0.05 - c[0]) ** 2 + (my - ny * 0.05 - c[1]) ** 2) ? 1 : -1;
        const h = Math.sqrt(3) / 2;
        const tri = [a, b, [mx + nx * h * sign, my + ny * h * sign]];
        tris.set(key2(centroid(tri), 1e3), tri);
      }
    }
    // vertex -> incident faces
    const vmap = new Map();
    const centers = [];
    const addFace = (poly) => {
      const ci = centers.length;
      centers.push(centroid(poly));
      for (const p of poly) {
        const k = key2(p, 1e5);
        let arr = vmap.get(k);
        if (!arr) { arr = []; vmap.set(k, arr); }
        arr.push(ci);
      }
    };
    for (const sq of squares) addFace(sq);
    for (const tri of tris.values()) addFace(tri);
    // pentagons around 5-valent vertices
    const tiles = [];
    const VK_Q = 1e5;
    for (const [vk, faces] of vmap) {
      if (faces.length !== 5) continue;
      const parts = vk.split(',');
      const vx = +parts[0] / VK_Q, vy = +parts[1] / VK_Q;
      if (vx < bounds.x0 - 0.5 || vx > bounds.x1 + 0.5 || vy < bounds.y0 - 0.5 || vy > bounds.y1 + 0.5) continue;
      const cs = faces.map((fi) => centers[fi]);
      cs.sort((a, b) => Math.atan2(a[1] - vy, a[0] - vx) - Math.atan2(b[1] - vy, b[0] - vx));
      const c = centroid(cs);
      tiles.push(mkTile(cs, 0, orientBucket(sub(c, [vx, vy]), 5)));
    }
    return { tiles, kindCount: 1, orientCount: 5 };
  }

  /* Penrose rhombs: dual of a de Bruijn pentagrid (theorem-backed, verified) */
  function genPenrose(variant, bounds) {
    const E = [0, 1, 2, 3, 4].map((j) => dir(72 * j));
    const GAMMA = variant === 'golden'
      ? [0.19, 0.618034, 0.41, 0.854102, 0.66] // generic (no exact triple points)
      : [0.11, 0.33, 0.52, 0.74, 0.95];
    const cellAt = (x) => E.map((e, j) => Math.floor(x[0] * e[0] + x[1] * e[1] - GAMMA[j]));
    const cells = new Map(); // cellKey -> vertex position (computed once)
    const cellPos = (k) => {
      const ck = k.join(',');
      let v = cells.get(ck);
      if (!v) {
        v = [0, 0];
        for (let l = 0; l < 5; l++) { v[0] += k[l] * E[l][0]; v[1] += k[l] * E[l][1]; }
        cells.set(ck, v);
      }
      return v;
    };
    const corners = [
      [bounds.x0, bounds.y0], [bounds.x1, bounds.y0],
      [bounds.x0, bounds.y1], [bounds.x1, bounds.y1],
    ];
    const tiles = [];
    const seen = new Set();
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) {
      const stripRange = (l) => {
        const ss = corners.map((c) => c[0] * E[l][0] + c[1] * E[l][1] - GAMMA[l]);
        return [Math.floor(Math.min(...ss)) - 1, Math.ceil(Math.max(...ss)) + 1];
      };
      const [m0, m1] = stripRange(i), [n0, n1] = stripRange(j);
      const a = E[i], b = E[j];
      const det = a[0] * b[1] - a[1] * b[0];
      for (let m = m0; m <= m1; m++) for (let n = n0; n <= n1; n++) {
        const r1 = m + GAMMA[i], r2 = n + GAMMA[j];
        const cx = (r1 * b[1] - r2 * a[1]) / det;
        const cy = (a[0] * r2 - b[0] * r1) / det;
        if (cx < bounds.x0 - 1 || cx > bounds.x1 + 1 || cy < bounds.y0 - 1 || cy > bounds.y1 + 1) continue;
        // epsilon distance to other families (avoid triple points)
        let eps = Infinity;
        for (let l = 0; l < 5; l++) {
          if (l === i || l === j) continue;
          const s = cx * E[l][0] + cy * E[l][1] - GAMMA[l];
          const d = Math.abs(s - Math.round(s));
          if (d < eps) eps = d;
        }
        eps = Math.min(eps, 0.25) * 0.5;
        if (eps < 1e-6) continue;
        const di = [-E[i][1], E[i][0]], dj = [-E[j][1], E[j][0]];
        const verts = [];
        for (const [si, sj] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const p = [cx + eps * (si * di[0] + sj * dj[0]), cy + eps * (si * di[1] + sj * dj[1])];
          verts.push(cellPos(cellAt(p)));
        }
        const ck = key2(verts[0], 1e3) + '|' + key2(verts[2], 1e3) + '|' + i + ',' + j;
        if (seen.has(ck)) continue;
        seen.add(ck);
        const type = ((j - i) % 5 === 1 || (j - i) % 5 === 4) ? 0 : 1; // 0 fat, 1 thin
        const c = centroid(verts);
        tiles.push(mkTile(verts, type, orientBucket(sub(verts[0], c), 10)));
      }
    }
    return { tiles, kindCount: 2, orientCount: 10 };
  }

  /* --------------------------------- icons --------------------------------- */
  // small crisp inline SVGs (24x24 viewBox, stroke = currentColor)
  const svgWrap = (inner, fillMode) =>
    `<svg viewBox="0 0 24 24" width="24" height="24" fill="${fillMode || 'none'}" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const ICONS = {
    hat: svgWrap('<path d="M4.5 15.5 L7 8.5 L12.5 6 L17 8.8 L19.5 12.5 L16.5 16.5 L11 18.5 L7.5 17.5 Z" fill="currentColor" fill-opacity="0.25"/><path d="M4.5 15.5 L7 8.5 L12.5 6 L17 8.8 L19.5 12.5 L16.5 16.5 L11 18.5 L7.5 17.5 Z"/>'),
    lines: svgWrap('<path d="M4 18 L18 4 M8 20 L20 8 M4 10 L10 4"/>'),
    triangles: svgWrap('<path d="M4 18 L9 9 L14 18 Z M12 18 L16.5 10.5 L21 18 Z M7 8.5 L9.5 4 L12 8.5 Z"/>'),
    squares: svgWrap('<rect x="4" y="4" width="7.5" height="7.5"/><rect x="12.5" y="4" width="7.5" height="7.5"/><rect x="4" y="12.5" width="7.5" height="7.5"/><rect x="12.5" y="12.5" width="7.5" height="7.5"/>'),
    rectangles: svgWrap('<rect x="3.5" y="4.5" width="10" height="5"/><rect x="14.5" y="4.5" width="6.5" height="5"/><rect x="3.5" y="10.5" width="6.5" height="5"/><rect x="11" y="10.5" width="10" height="5"/><rect x="3.5" y="16.5" width="17" height="3.5"/>'),
    rhombi: svgWrap('<path d="M8 3.5 L14 10 L8 16.5 L2 10 Z M16 7.5 L22 14 L16 20.5 L10 14"/>'),
    parallelograms: svgWrap('<path d="M7 4.5 L19 4.5 L16.5 10.5 L4.5 10.5 Z M9.5 13.5 L21.5 13.5 L19 19.5 L7 19.5 Z"/>'),
    hexagons: svgWrap('<path d="M9 3.2 L14 6 L14 11.5 L9 14.3 L4 11.5 L4 6 Z M15 10 L20 12.8 L20 18.3 L15 21.1 L10 18.3 L10 12.8 Z"/>'),
    trapezoids: svgWrap('<path d="M6 4.5 L18 4.5 L20.5 11 L3.5 11 Z M5 13 L19 13 L16.5 19.5 L7.5 19.5 Z"/>'),
    kites: svgWrap('<path d="M12 2.5 L17 9 L12 12.5 L7 9 Z M12 13 L17 17 L12 21.5 L7 17 Z"/>'),
    trihexagonal: svgWrap('<path d="M12 5.5 L15.5 7.5 L15.5 11.5 L12 13.5 L8.5 11.5 L8.5 7.5 Z M4 13.5 L7 15.2 L7 18.6 L4 20.3 L1.8 19 M20 12.8 L22.5 14.2 M17 15.2 L20 17 L20 20.4 L17 22.2 L14 20.4 L14 17 Z"/>'),
    octagons: svgWrap('<path d="M9 3.5 L14.5 3.5 L19 8 L19 13.5 L14.5 18 L9 18 L4.5 13.5 L4.5 8 Z"/><rect x="15" y="15" width="6" height="6"/>'),
    cairo: svgWrap('<path d="M5 5 L11.5 6.5 L10 13 L4.5 14.5 Z M13 10.5 L19.5 12 L18 18.5 L12.5 20 Z M14 3.5 L20 5 L18.5 9.5"/>'),
    penrose: svgWrap('<path d="M4 12 L10 5.5 L16 12 L10 18.5 Z" fill="currentColor" fill-opacity="0.25"/><path d="M13.5 9 L20.5 7 L21.5 13.5 L14.5 15 Z"/>'),
  };

  /* -------------------------------- catalog -------------------------------- */

  const MODES_HAT = ['supertile', 'orientation', 'mirror', 'gradient', 'random', 'solid'];
  const MODES_PERIODIC = ['kind', 'orientation', 'gradient', 'random', 'solid'];
  const MODES_LINES = ['kind', 'gradient', 'random', 'solid'];

  const FAMILIES = [
    {
      id: 'hat', name: 'Einstein hat', icon: ICONS.hat,
      modes: MODES_HAT, defaultVariant: 'H',
      variants: [{ id: 'H', name: 'Variant A' }, { id: 'P', name: 'Variant B' }, { id: 'F', name: 'Variant C' }],
    },
    {
      id: 'lines', name: 'Lines', icon: ICONS.lines,
      modes: MODES_LINES, defaultVariant: 'diagonal', lineBased: true,
      variants: [
        { id: 'horizontal', name: 'Horizontal stripes' },
        { id: 'vertical', name: 'Vertical stripes' },
        { id: 'diagonal', name: 'Diagonal 45°' },
        { id: 'crosshatch', name: 'Crosshatch' },
        { id: 'grid', name: 'Grid' },
      ],
    },
    {
      id: 'triangles', name: 'Triangles', icon: ICONS.triangles,
      modes: MODES_PERIODIC, defaultVariant: 'equilateral',
      variants: [{ id: 'equilateral', name: 'Equilateral grid' }, { id: 'right', name: 'Right-triangle grid' }],
    },
    {
      id: 'squares', name: 'Squares', icon: ICONS.squares,
      modes: MODES_PERIODIC, defaultVariant: 'grid',
      variants: [{ id: 'grid', name: 'Aligned grid' }, { id: 'diamond', name: 'Diamond (45°)' }, { id: 'checker', name: 'Checkerboard' }],
    },
    {
      id: 'rectangles', name: 'Rectangles', icon: ICONS.rectangles,
      modes: MODES_PERIODIC, defaultVariant: 'brick',
      variants: [
        { id: 'grid', name: 'Aligned grid (2:1)' },
        { id: 'brick', name: 'Running bond' },
        { id: 'herringbone', name: 'Herringbone 90°' },
        { id: 'basketweave', name: 'Basketweave' },
      ],
    },
    {
      id: 'rhombi', name: 'Rhombi', icon: ICONS.rhombi,
      modes: MODES_PERIODIC, defaultVariant: '60',
      variants: [{ id: '60', name: '60° / 120°' }, { id: '45', name: '45° / 135°' }, { id: '30', name: '30° / 150°' }],
    },
    {
      id: 'parallelograms', name: 'Parallelograms', icon: ICONS.parallelograms,
      modes: MODES_PERIODIC, defaultVariant: '30r',
      variants: [{ id: '30r', name: 'Slant 30° right' }, { id: '45r', name: 'Slant 45° right' }, { id: '30l', name: 'Slant 30° left' }],
    },
    {
      id: 'hexagons', name: 'Hexagons', icon: ICONS.hexagons,
      modes: MODES_PERIODIC, defaultVariant: 'flat',
      variants: [{ id: 'flat', name: 'Flat-top honeycomb' }, { id: 'pointy', name: 'Pointy-top honeycomb' }],
    },
    {
      id: 'trapezoids', name: 'Trapezoids', icon: ICONS.trapezoids,
      modes: MODES_PERIODIC, defaultVariant: 'standard',
      variants: [{ id: 'flat', name: 'Flat rows' }, { id: 'standard', name: 'Standard' }, { id: 'steep', name: 'Steep' }],
    },
    {
      id: 'kites', name: 'Kites', icon: ICONS.kites,
      modes: MODES_PERIODIC, defaultVariant: 'classic',
      variants: [{ id: 'slim', name: 'Slim' }, { id: 'classic', name: 'Classic' }, { id: 'wide', name: 'Wide' }],
    },
    {
      id: 'trihexagonal', name: 'Trihexagonal', icon: ICONS.trihexagonal,
      modes: MODES_PERIODIC, defaultVariant: 'classic',
      variants: [{ id: 'classic', name: 'Kagome' }, { id: 'rotated', name: 'Rotated 30°' }],
    },
    {
      id: 'octagons', name: 'Octagon–square', icon: ICONS.octagons,
      modes: MODES_PERIODIC, defaultVariant: 'classic',
      variants: [{ id: 'classic', name: 'Truncated square' }],
    },
    {
      id: 'cairo', name: 'Cairo pentagons', icon: ICONS.cairo,
      modes: MODES_PERIODIC, defaultVariant: 'classic',
      variants: [{ id: 'classic', name: 'Cairo (dual of snub square)' }],
    },
    {
      id: 'penrose', name: 'Penrose rhombs', icon: ICONS.penrose,
      modes: MODES_PERIODIC, defaultVariant: 'standard',
      variants: [{ id: 'standard', name: 'P3 standard' }, { id: 'golden', name: 'P3 golden shifts' }],
    },
  ];

  const GENERATORS = {
    lines: genLines,
    triangles: genTriangles,
    squares: genSquares,
    rectangles: genRectangles,
    rhombi: genRhombi,
    parallelograms: genParallelograms,
    hexagons: genHexagons,
    trapezoids: genTrapezoids,
    kites: genKites,
    trihexagonal: genTrihexagonal,
    octagons: genOctagonSquare,
    cairo: genCairo,
    penrose: genPenrose,
  };

  function get(id) {
    return FAMILIES.find((f) => f.id === id) || FAMILIES[0];
  }
  function isFamily(id) {
    return FAMILIES.some((f) => f.id === id);
  }
  /*
   * generate(familyId, variant, bounds, budget) -> {tiles, kindCount, orientCount, lineBased}
   * bounds: world-space (rotated) rectangle to cover, in units.
   */
  function generate(familyId, variant, bounds, budget) {
    const fam = get(familyId);
    if (fam.id === 'hat') throw new Error('hat family is generated by the hat engine');
    let gen = GENERATORS[fam.id](variant, bounds);
    let scale = 1;
    let guard = 0;
    while (gen.tiles.length > budget && guard++ < 6) {
      // coarsen: shrink world bounds (equivalent to larger tiles)
      scale *= Math.sqrt(gen.tiles.length / budget) * 1.08;
      const sb = {
        x0: bounds.x0 / scale, x1: bounds.x1 / scale,
        y0: bounds.y0 / scale, y1: bounds.y1 / scale,
      };
      gen = GENERATORS[fam.id](variant, sb);
      gen._coarse = scale;
    }
    if (scale !== 1) {
      // scale tiles back to world units
      for (const t of gen.tiles) {
        if (t.poly) { t.poly = t.poly.map(([x, y]) => [x * scale, y * scale]); t.cx *= scale; t.cy *= scale; }
        if (t.line) { t.line = t.line.map((v) => v * scale); t.w *= scale; t.cx *= scale; t.cy *= scale; }
      }
      gen._coarse = scale;
    }
    return gen;
  }

  root.Tilings = { FAMILIES, get, isFamily, generate, dir, rad, centroid };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Tilings;
})(typeof window !== 'undefined' ? window : globalThis);
