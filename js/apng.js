/*
 * apng.js — dependency-free animated APNG encoder for EinsteinWallpaper.
 *
 * APNG (Animated PNG) is a strict superset of PNG: ordinary decoders show
 * the first frame, APNG-aware ones (all modern browsers, macOS, most
 * viewers) play the animation. It stores truecolor RGBA with lossless
 * DEFLATE compression, so exports are PIXEL-PERFECT — no 256-color
 * quantization, no dithering, every decoded pixel is exactly what was
 * rendered. Implemented here from the PNG/APNG specification (W3C APNG
 * 1.0 / PNG 1.2): CRC32-chunked container, acTL/fcTL/fdAT ancillary
 * chunks, per-row adaptive PNG filtering and zlib DEFLATE.
 *
 * DEFLATE uses the browser's native CompressionStream when available and
 * falls back to zlib "stored" (uncompressed) blocks — still 100% lossless,
 * just larger. Both paths are pure browser APIs / hand-written bytes.
 *
 * Pipeline:
 *   const enc = new Apng.ApngEncoder(w, h, { totalFrames, delayNum, delayDen });
 *   enc.start();
 *   await enc.addFrame(rgbaUint8ClampedArray);   // per animation frame
 *   const bytes = enc.finish();                  // -> Uint8Array (.png file)
 */
(function (root) {
  'use strict';

  /* ---------------- CRC32 (PNG chunk checksums) ---------------- */

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes, start, end) {
    start = start || 0;
    end = end === undefined ? bytes.length : end;
    let c = 0xFFFFFFFF;
    for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------------- Adler-32 (zlib checksum) ---------------- */

  function adler32(bytes) {
    let a = 1, b = 0;
    for (let i = 0; i < bytes.length; i++) {
      a = (a + bytes[i]) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  }

  /* ---------------- zlib DEFLATE ---------------- */

  // zlib stream of uncompressed "stored" DEFLATE blocks — the lossless
  // fallback used when CompressionStream is unavailable.
  function storedDeflate(bytes) {
    const MAX = 65535;
    const nBlocks = Math.max(1, Math.ceil(bytes.length / MAX));
    const out = new Uint8Array(2 + bytes.length + nBlocks * 5 + 4);
    let o = 0;
    out[o++] = 0x78; out[o++] = 0x01; // zlib header (no compression, fast)
    for (let i = 0; i < bytes.length; i += MAX) {
      const len = Math.min(MAX, bytes.length - i);
      const final = i + MAX >= bytes.length ? 1 : 0;
      out[o++] = final;               // BFINAL + BTYPE=00
      out[o++] = len & 0xFF;
      out[o++] = (len >>> 8) & 0xFF;
      out[o++] = ~len & 0xFF;
      out[o++] = (~len >>> 8) & 0xFF;
      out.set(bytes.subarray(i, i + len), o);
      o += len;
    }
    if (!bytes.length) { out[o++] = 1; out[o++] = 0; out[o++] = 0; out[o++] = 0xFF; out[o++] = 0xFF; }
    const ad = adler32(bytes);
    out[o++] = (ad >>> 24) & 0xFF; out[o++] = (ad >>> 16) & 0xFF;
    out[o++] = (ad >>> 8) & 0xFF; out[o++] = ad & 0xFF;
    return out.subarray(0, o);
  }

  // deflate via native CompressionStream('deflate') (zlib format), with the
  // hand-written stored-blocks fallback. opts.mode: 'auto' | 'stored'.
  async function zlibDeflate(bytes, opts) {
    const mode = (opts && opts.mode) || 'auto';
    if (mode !== 'stored' && typeof CompressionStream !== 'undefined') {
      try {
        const cs = new CompressionStream('deflate');
        const stream = new Blob([bytes]).stream().pipeThrough(cs);
        const buf = await new Response(stream).arrayBuffer();
        return new Uint8Array(buf);
      } catch (e) { /* fall through to stored blocks */ }
    }
    return storedDeflate(bytes);
  }

  /* ---------------- adaptive PNG row filtering ---------------- */

  // Standard PNG filters (None/Sub/Up/Average/Paeth); the filter with the
  // smallest sum of absolute signed bytes wins per row (classic minimum-
  // entropy heuristic) which markedly improves DEFLATE ratios on smooth
  // gradients. Output: h rows of (1 filter byte + w*4 filtered bytes).
  function filterRows(rgba, w, h) {
    const stride = w * 4;
    const out = new Uint8Array(h * (stride + 1));
    const prev = new Uint8Array(stride);
    const cand = new Uint8Array(stride);
    for (let y = 0; y < h; y++) {
      const ro = y * stride;
      let bestSum = Infinity, bestType = 0;
      for (let ft = 0; ft < 5; ft++) {
        let sum = 0;
        for (let x = 0; x < stride; x++) {
          const raw = rgba[ro + x];
          const a = x >= 4 ? rgba[ro + x - 4] : 0;
          const b = prev[x];
          const c = x >= 4 ? prev[x - 4] : 0;
          let v;
          if (ft === 0) v = raw;
          else if (ft === 1) v = raw - a;
          else if (ft === 2) v = raw - b;
          else if (ft === 3) v = raw - ((a + b) >> 1);
          else {
            const p = a + b - c;
            const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
            v = raw - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          }
          cand[x] = v & 0xFF;
          sum += v < 0 ? -v : v;
        }
        if (sum < bestSum) { bestSum = sum; bestType = ft; out.set(cand, y * (stride + 1) + 1); }
      }
      out[y * (stride + 1)] = bestType;
      for (let x = 0; x < stride; x++) prev[x] = rgba[ro + x];
    }
    return out;
  }

  /* ---------------- APNG container ---------------- */

  function u32be(v) {
    return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  }

  function ApngEncoder(w, h, opts) {
    opts = opts || {};
    const totalFrames = Math.max(1, opts.totalFrames | 0);
    const delayNum = Math.max(0, opts.delayNum | 0); // per-frame delay = delayNum/delayDen s
    const delayDen = Math.max(1, opts.delayDen | 0 || 1000);
    const deflateOpts = { mode: opts.deflateMode || 'auto' };

    const chunks = [];
    let seq = 0, frameIdx = 0;

    function chunk(type, data) {
      const tb = [];
      for (let i = 0; i < type.length; i++) tb.push(type.charCodeAt(i));
      const crcInput = new Uint8Array(4 + data.length);
      crcInput.set(tb, 0);
      crcInput.set(data, 4);
      const head = new Uint8Array(8 + data.length + 4);
      head.set(u32be(data.length), 0);
      head.set(tb, 4);
      head.set(data, 8);
      head.set(u32be(crc32(crcInput)), 8 + data.length);
      chunks.push(head);
    }

    function fcTL(sn, fw, fh, dn, dd) {
      const d = new Uint8Array(26);
      d.set(u32be(sn), 0);
      d.set(u32be(fw), 4);
      d.set(u32be(fh), 8);
      d.set(u32be(0), 12);           // x offset
      d.set(u32be(0), 16);           // y offset
      d[20] = (dn >> 8) & 255; d[21] = dn & 255;
      d[22] = (dd >> 8) & 255; d[23] = dd & 255;
      d[24] = 0;                     // dispose: APNG_DISPOSE_OP_NONE
      d[25] = 0;                     // blend: APNG_BLEND_OP_SOURCE (opaque frames)
      return d;
    }

    this.start = function () {
      chunks.push(new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
      const ihdr = new Uint8Array(13);
      ihdr.set(u32be(w), 0);
      ihdr.set(u32be(h), 4);
      ihdr[8] = 8;   // bit depth
      ihdr[9] = 6;   // color type RGBA
      ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // deflate, adaptive filtering, no interlace
      chunk('IHDR', ihdr);
      const actl = new Uint8Array(8);
      actl.set(u32be(totalFrames), 0);
      actl.set(u32be(0), 4);         // num_plays 0 = loop forever
      chunk('acTL', actl);
    };

    this.addFrame = async function (rgba) {
      if (rgba.length !== w * h * 4) throw new Error('apng: frame size mismatch');
      const filtered = filterRows(rgba, w, h);
      const z = await zlibDeflate(filtered, deflateOpts);
      chunk('fcTL', fcTL(seq++, w, h, delayNum, delayDen));
      if (frameIdx === 0) {
        chunk('IDAT', z);
      } else {
        const fd = new Uint8Array(4 + z.length);
        fd.set(u32be(seq++), 0);
        fd.set(z, 4);
        chunk('fdAT', fd);
      }
      frameIdx++;
    };

    this.finish = function () {
      chunk('IEND', new Uint8Array(0));
      let total = 0;
      for (const c of chunks) total += c.length;
      const all = new Uint8Array(total);
      let o = 0;
      for (const c of chunks) { all.set(c, o); o += c.length; }
      return all;
    };
  }

  root.Apng = {
    ApngEncoder, crc32, adler32, storedDeflate, zlibDeflate, filterRows,
  };
})(typeof window !== 'undefined' ? window : globalThis);
