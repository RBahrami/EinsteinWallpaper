/*
 * gif.js — dependency-free animated GIF89a encoder for EinsteinWallpaper.
 *
 * Everything (palette quantization, Floyd-Steinberg dithering, LZW
 * compression, container assembly) is implemented here from the GIF89a
 * specification — no external libraries, works offline, browser + Node.
 *
 * Pipeline:
 *   1. Gif.buildPalette(sampleBuffers, maxColors)
 *        median-cut quantization over stride-sampled RGBA pixels of a few
 *        representative frames; ONE global palette is shared by all frames
 *        so colors stay stable across the animation (no palette flicker).
 *   2. Gif.createMapper(palette)
 *        returns mapFrame(rgba, w, h) -> Uint8Array of palette indices,
 *        with error-diffusion dithering to keep gradients smooth.
 *   3. new Gif.GifWriter(w, h, palette, { loop })  (.start / .addFrame /
 *      .finish) assembles GIF89a: header, logical screen descriptor, global
 *      color table, NETSCAPE2.0 infinite-loop extension, then per frame a
 *      graphic-control extension (delay in centiseconds, "do not dispose")
 *      and an LZW-compressed image, terminated by 0x3B.
 *
 * The LZW encoder follows the standard variable-width scheme (codes start at
 * minCodeSize+1 bits, widen as the dictionary grows, emit a clear code and
 * reset when the 4096-entry table is full) and packages output into
 * <=255-byte data sub-blocks.
 */
(function (root) {
  'use strict';

  /* ---------------- median-cut quantization ---------------- */

  function buildPalette(samples, maxColors) {
    maxColors = Math.max(2, Math.min(256, maxColors || 256));
    // collect up to ~40k sample points (RGB) from the given RGBA buffers
    const rs = [], gs = [], bs = [];
    const perBuf = Math.max(500, Math.floor(40000 / Math.max(1, samples.length)));
    for (const buf of samples) {
      const px = buf.length >> 2;
      const stride = Math.max(1, Math.floor(px / perBuf));
      for (let i = 0; i < px; i += stride) {
        const b4 = i * 4;
        rs.push(buf[b4]); gs.push(buf[b4 + 1]); bs.push(buf[b4 + 2]);
      }
    }
    const n = rs.length;
    if (!n) return new Uint8Array([0, 0, 0, 255, 255, 255]);
    const order = new Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    const chans = [rs, gs, bs];

    // box = { start, end } slice into `order`; split widest-range box at median
    let boxes = [{ start: 0, end: n }];
    const rangeOf = (box) => {
      let bestC = 0, bestR = -1;
      for (let c = 0; c < 3; c++) {
        let mn = 255, mx = 0;
        const ch = chans[c];
        for (let i = box.start; i < box.end; i++) {
          const v = ch[order[i]];
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
        if (mx - mn > bestR) { bestR = mx - mn; bestC = c; }
      }
      return { range: bestR, channel: bestC };
    };
    const ranges = boxes.map(rangeOf);
    while (boxes.length < maxColors) {
      // pick the box with the widest channel range (needs >= 2 distinct points)
      let bi = -1, br = 0;
      for (let i = 0; i < boxes.length; i++) {
        if (boxes[i].end - boxes[i].start < 2) continue;
        if (ranges[i].range > br) { br = ranges[i].range; bi = i; }
      }
      if (bi < 0 || br === 0) break; // nothing splittable
      const box = boxes[bi], ch = chans[ranges[bi].channel];
      const slice = order.slice(box.start, box.end);
      slice.sort((a, b) => ch[a] - ch[b]);
      for (let i = 0; i < slice.length; i++) order[box.start + i] = slice[i];
      const mid = box.start + (slice.length >> 1);
      const b1 = { start: box.start, end: mid };
      const b2 = { start: mid, end: box.end };
      boxes.splice(bi, 1, b1, b2);
      ranges.splice(bi, 1, rangeOf(b1), rangeOf(b2));
    }

    const pal = new Uint8Array(boxes.length * 3);
    for (let b = 0; b < boxes.length; b++) {
      let sr = 0, sg = 0, sb = 0;
      for (let i = boxes[b].start; i < boxes[b].end; i++) {
        const p = order[i];
        sr += rs[p]; sg += gs[p]; sb += bs[p];
      }
      const m = boxes[b].end - boxes[b].start || 1;
      pal[b * 3] = Math.round(sr / m);
      pal[b * 3 + 1] = Math.round(sg / m);
      pal[b * 3 + 2] = Math.round(sb / m);
    }
    return pal;
  }

  /* ------------- mapping with Floyd-Steinberg dithering ------------- */

  function createMapper(pal) {
    const n = pal.length / 3;
    const cache = new Int16Array(32768).fill(-1);
    function nearest(r, g, b) {
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      const hit = cache[key];
      if (hit >= 0) return hit;
      let bd = Infinity, bi = 0;
      for (let i = 0; i < n; i++) {
        const dr = r - pal[i * 3], dg = g - pal[i * 3 + 1], db = b - pal[i * 3 + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; bi = i; }
      }
      cache[key] = bi;
      return bi;
    }
    let err = null, out = null, cap = 0;
    return function mapFrame(rgba, w, h) {
      const np = w * h;
      if (np > cap) { cap = np; err = new Float32Array(np * 3); out = new Uint8Array(np); }
      err.fill(0, 0, np * 3);
      for (let y = 0; y < h; y++) {
        const rowEnd = (y + 1) * w;
        for (let x = 0; x < w; x++) {
          const i = y * w + x, e3 = i * 3, b4 = i * 4;
          let r = rgba[b4] + err[e3];
          let g = rgba[b4 + 1] + err[e3 + 1];
          let b = rgba[b4 + 2] + err[e3 + 2];
          r = r < 0 ? 0 : r > 255 ? 255 : r;
          g = g < 0 ? 0 : g > 255 ? 255 : g;
          b = b < 0 ? 0 : b > 255 ? 255 : b;
          r |= 0; g |= 0; b |= 0;
          const idx = nearest(r, g, b);
          out[i] = idx;
          const er = r - pal[idx * 3], eg = g - pal[idx * 3 + 1], eb = b - pal[idx * 3 + 2];
          if (x + 1 < w) {
            const j = (i + 1) * 3;
            err[j] += er * (7 / 16); err[j + 1] += eg * (7 / 16); err[j + 2] += eb * (7 / 16);
          }
          if (y + 1 < h) {
            if (x > 0) {
              const j = (i + w - 1) * 3;
              err[j] += er * (3 / 16); err[j + 1] += eg * (3 / 16); err[j + 2] += eb * (3 / 16);
            }
            const j2 = (i + w) * 3;
            err[j2] += er * (5 / 16); err[j2 + 1] += eg * (5 / 16); err[j2 + 2] += eb * (5 / 16);
            if (x + 1 < w) {
              const j3 = (i + w + 1) * 3;
              err[j3] += er / 16; err[j3 + 1] += eg / 16; err[j3 + 2] += eb / 16;
            }
          }
          void rowEnd;
        }
      }
      return out;
    };
  }

  /* ---------------- LZW compression ---------------- */

  function lzwEncode(indices, minCodeSize, out) {
    const raw = [];
    const emitByte = (b) => raw.push(b & 0xff);
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let nextCode = eoiCode + 1;
    let dict = new Map();
    let bitBuf = 0, bitCnt = 0;
    const emitCode = (code) => {
      bitBuf |= code << bitCnt;
      bitCnt += codeSize;
      while (bitCnt >= 8) { emitByte(bitBuf); bitBuf >>>= 8; bitCnt -= 8; }
    };
    emitCode(clearCode);
    let cur = indices[0] || 0;
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const key = (cur << 8) | k;
      const found = dict.get(key);
      if (found !== undefined) { cur = found; continue; }
      emitCode(cur);
      if (nextCode >= 4096) {
        emitCode(clearCode);
        dict = new Map();
        nextCode = eoiCode + 1;
        codeSize = minCodeSize + 1;
      } else {
        if (nextCode >= (1 << codeSize) && codeSize < 12) codeSize++;
        dict.set(key, nextCode++);
      }
      cur = k;
    }
    emitCode(cur);
    emitCode(eoiCode);
    if (bitCnt > 0) emitByte(bitBuf);
    // package raw bytes into <=255-byte sub-blocks
    for (let i = 0; i < raw.length; i += 255) {
      const end = Math.min(raw.length, i + 255);
      out(end - i);
      for (let j = i; j < end; j++) out(raw[j]);
    }
  }

  /* ---------------- GIF89a container ---------------- */

  function GifWriter(w, h, pal, opts) {
    opts = opts || {};
    const loop = opts.loop === undefined ? 0 : opts.loop; // 0 = forever
    const nColors = Math.max(2, Math.min(256, pal.length / 3));
    let bits = 1;
    while ((1 << bits) < nColors) bits++;
    const gctEntries = 1 << bits;
    const minCodeSize = Math.max(2, bits);
    const out = [];
    const push = (b) => { out.push(b & 0xff); };
    const short = (v) => { push(v & 0xff); push((v >> 8) & 0xff); };
    const str = (s) => { for (let i = 0; i < s.length; i++) push(s.charCodeAt(i)); };

    this.start = function () {
      str('GIF89a');
      short(w); short(h);
      push(0x80 | ((bits - 1) & 7)); // GCT present, size = 2^bits
      push(0);                       // background color index
      push(0);                       // pixel aspect ratio
      for (let i = 0; i < gctEntries * 3; i++) push(i < pal.length ? pal[i] : 0);
      if (loop >= 0) {               // NETSCAPE2.0 looping application extension
        push(0x21); push(0xFF); push(11);
        str('NETSCAPE2.0');
        push(3); push(1); short(loop); push(0);
      }
    };

    this.addFrame = function (indices, delayCs) {
      if (indices.length !== w * h) throw new Error('gif: frame size mismatch');
      // graphic control extension: delay, "do not dispose", no transparency
      push(0x21); push(0xF9); push(4);
      push(0x04);
      short(Math.max(0, Math.min(65535, delayCs | 0)));
      push(0);   // transparent index (none)
      push(0);   // block terminator
      // image descriptor (no local color table, not interlaced)
      push(0x2C); short(0); short(0); short(w); short(h);
      push(0);
      push(minCodeSize);
      lzwEncode(indices, minCodeSize, push);
      push(0); // data sub-block terminator
    };

    this.finish = function () {
      push(0x3B); // trailer
      return Uint8Array.from(out);
    };
  }

  root.Gif = { buildPalette, createMapper, GifWriter, lzwEncode };
})(typeof window !== 'undefined' ? window : globalThis);
