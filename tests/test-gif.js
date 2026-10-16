/* GIF encoder tests: structure + LZW round-trip via an independent decoder. */
require('../js/gif.js');
const Gif = globalThis.Gif;

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log('PASS ' + name + (detail ? '  ' + detail : '')); }
  else { failed++; console.log('FAIL ' + name + (detail ? '  ' + detail : '')); }
}

/* unwrap GIF sub-block packaging (each chunk: length byte + data) */
function unwrapSubBlocks(bytes) {
  const out = [];
  let p = 0;
  while (p < bytes.length) {
    const len = bytes[p++];
    for (let i = 0; i < len; i++) out.push(bytes[p + i]);
    p += len;
  }
  return out;
}

/* ---- independent GIF LZW decoder (written from the spec, mirrors the
   decoder side: widen code size when the table grows, handle KwKwK) ---- */
function lzwDecode(minCodeSize, data, expectedLen) {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let codeSize = minCodeSize + 1, next = eoi + 1, prev = -1;
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4096);
  const outp = [];
  let bitPos = 0;
  for (;;) {
    if ((bitPos >> 3) >= data.length) break;
    const b0 = data[bitPos >> 3];
    const b1 = data[(bitPos >> 3) + 1] || 0;
    const b2 = data[(bitPos >> 3) + 2] || 0;
    let code = (b0 | (b1 << 8) | (b2 << 16)) >> (bitPos & 7);
    code &= (1 << codeSize) - 1;
    bitPos += codeSize;
    if (code === eoi) break;
    if (code === clear) { codeSize = minCodeSize + 1; next = eoi + 1; prev = -1; continue; }
    let firstChar, cur = code;
    if (code >= next) {           // KwKwK: code not yet defined
      if (prev < 0) throw new Error('bad LZW: undefined first code');
      stack[0] = firstCharOf(prev);
      let sp = 1, c = prev;
      while (c >= clear) { stack[sp++] = suffix[c]; c = prefix[c]; }
      stack[sp++] = c;
      firstChar = c;
      for (let s = sp - 1; s >= 0; s--) outp.push(stack[s]);
    } else {
      let sp = 0, c = cur;
      while (c >= clear) { stack[sp++] = suffix[c]; c = prefix[c]; }
      stack[sp++] = c;
      firstChar = c;
      for (let s = sp - 1; s >= 0; s--) outp.push(stack[s]);
    }
    if (prev >= 0 && next < 4096) {
      prefix[next] = prev; suffix[next] = firstChar;
      next++;
      if (next >= (1 << codeSize) && codeSize < 12) codeSize++;
    }
    prev = cur;
  }
  function firstCharOf(c) { while (c >= clear) c = prefix[c]; return c; }
  return outp;
}

/* walk a GIF buffer: returns { frames: [{delay, data, minCodeSize}], hasNetscape, loop } */
function parseGif(bytes) {
  const magic = String.fromCharCode(...bytes.slice(0, 6));
  const w = bytes[6] | (bytes[7] << 8), h = bytes[8] | (bytes[9] << 8);
  const gctFlag = (bytes[10] & 0x80) !== 0;
  const gctSize = 2 << (bytes[10] & 7);
  let p = 13 + (gctFlag ? gctSize * 3 : 0);
  let hasNetscape = false, loop = null;
  const frames = [];
  const skipSubBlocks = () => { // generic extension data
    while (p < bytes.length && bytes[p] !== 0) p += bytes[p] + 1;
    p++;
  };
  while (p < bytes.length) {
    const b = bytes[p++];
    if (b === 0x3B) break; // trailer
    if (b === 0x21) {      // extension
      const label = bytes[p++];
      if (label === 0xF9) { // GCE
        const size = bytes[p++];
        const delay = bytes[p + 1] | (bytes[p + 2] << 8);
        p += size;
        p++; // block terminator
        frames.push({ delay, data: null, minCodeSize: 0 });
      } else if (label === 0xFF) {
        const size = bytes[p++];
        const app = String.fromCharCode(...bytes.slice(p, p + size));
        p += size;
        if (app === 'NETSCAPE2.0') {
          hasNetscape = true;
          const sub = bytes[p++];
          loop = bytes[p + 2] | (bytes[p + 3] << 8);
          p += sub;
          p++; // sub-block terminator
        } else {
          skipSubBlocks();
        }
      } else {
        skipSubBlocks();
      }
    } else if (b === 0x2C) { // image descriptor
      p += 9;
      const packed = bytes[p - 1];
      if (packed & 0x80) p += (2 << (packed & 7)) * 3;
      const minCodeSize = bytes[p++];
      const data = [];
      while (p < bytes.length && bytes[p] !== 0) {
        const s = bytes[p++];
        for (let i = 0; i < s; i++) data.push(bytes[p + i]);
        p += s;
      }
      p++; // terminator
      if (!frames.length) throw new Error('image before GCE');
      const f = frames[frames.length - 1];
      f.minCodeSize = minCodeSize;
      f.data = data;
    } else {
      throw new Error('unknown block 0x' + b.toString(16) + ' at ' + (p - 1));
    }
  }
  return { magic, w, h, frames, hasNetscape, loop };
}

/* ---- deterministic pseudo-random ---- */
function lcg(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }

/* ================= 1. LZW stress round-trip ================= */
{
  // random 64-symbol data, 9000 symbols -> >4096 dictionary entries -> clear codes
  const rnd = lcg(42);
  const idx = new Uint8Array(9000);
  for (let i = 0; i < idx.length; i++) idx[i] = Math.floor(rnd() * 64);
  const outBytes = [];
  Gif.lzwEncode(idx, 6, (b) => outBytes.push(b));
  const dec = lzwDecode(6, unwrapSubBlocks(outBytes), idx.length);
  check('LZW round-trip (random 64-symbol, dictionary reset)',
    dec.length === idx.length && dec.every((v, i) => v === idx[i]),
    `${idx.length} symbols -> ${outBytes.length} bytes -> ${dec.length} decoded`);
}

{
  // long runs + uniform frame (max compression, code growth path)
  const idx = new Uint8Array(5000).fill(3);
  idx[2500] = 7;
  const outBytes = [];
  Gif.lzwEncode(idx, 3, (b) => outBytes.push(b));
  const dec = lzwDecode(3, unwrapSubBlocks(outBytes), idx.length);
  check('LZW round-trip (uniform + runs)',
    dec.length === idx.length && dec.every((v, i) => v === idx[i]),
    `${outBytes.length} bytes for 5000 symbols`);
}

/* ================= 2. full container ================= */
{
  const w = 64, h = 64;
  const mk = (shift) => {
    const buf = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      buf[i] = 40 + Math.floor((x / (w - 1)) * 215);
      buf[i + 1] = 30 + Math.floor((y / (h - 1)) * 195);
      buf[i + 2] = 200 - Math.floor(((x + y + shift) / (2 * w)) * 160);
      buf[i + 3] = 255;
    }
    return buf;
  };
  const fA = mk(0), fB = mk(9), fC = mk(18);
  const pal = Gif.buildPalette([fA, fB, fC], 64);
  check('palette built within budget', pal.length / 3 <= 64 && pal.length >= 24, `${pal.length / 3} colors`);
  const map = Gif.createMapper(pal);
  const writer = new Gif.GifWriter(w, h, pal, { loop: 0 });
  writer.start();
  const iA = map(fA, w, h), iB = map(fB, w, h), iC = map(fC, w, h);
  writer.addFrame(iA, 5);
  writer.addFrame(iB, 10);
  writer.addFrame(iC, 3);
  const bytes = writer.finish();

  const gif = parseGif(bytes);
  check('GIF magic', gif.magic === 'GIF89a', gif.magic);
  check('LSD dimensions', gif.w === w && gif.h === h, `${gif.w}x${gif.h}`);
  check('global color table present', (bytes[10] & 0x80) !== 0);
  check('NETSCAPE loop extension, loop=forever', gif.hasNetscape && gif.loop === 0);
  check('frame count', gif.frames.length === 3, `${gif.frames.length}`);
  check('frame delays (cs)', gif.frames.map(f => f.delay).join(',') === '5,10,3',
    gif.frames.map(f => f.delay).join(','));
  check('trailer 0x3B at end', bytes[bytes.length - 1] === 0x3B);
  check('min code size sane (6+ bits palette)', gif.frames.every(f => f.minCodeSize >= 6),
    gif.frames.map(f => f.minCodeSize).join(','));

  // round-trip each frame through the independent decoder
  let allOk = true;
  const decoderOut = [];
  const expects = [iA, iB, iC];
  gif.frames.forEach((f, fi) => {
    const dec = lzwDecode(f.minCodeSize, f.data, w * h);
    const expect = expects[fi];
    if (dec.length !== w * h || !dec.every((v, i) => v === expect[i])) allOk = false;
    decoderOut.push(dec.length);
  });
  check('LZW round-trip of all mapped frames', allOk && decoderOut.length === 3, decoderOut.join('/'));
}

/* ================= 3. determinism ================= */
{
  const w = 32, h = 32;
  const buf = new Uint8ClampedArray(w * h * 4);
  const rnd = lcg(7);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(rnd() * 256);
  const enc = () => {
    const pal = Gif.buildPalette([buf], 32);
    const map = Gif.createMapper(pal);
    const wr = new Gif.GifWriter(w, h, pal, { loop: 0 });
    wr.start();
    wr.addFrame(map(buf, w, h), 4);
    return wr.finish().join(',');
  };
  check('deterministic output', enc() === enc());
}

/* ================= 4. tiny palette (2 colors) ================= */
{
  const w = 16, h = 16;
  const buf = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < buf.length; i += 4) { const on = (i / 4) % 2 ? 255 : 0; buf[i] = buf[i + 1] = buf[i + 2] = on; buf[i + 3] = 255; }
  const pal = Gif.buildPalette([buf], 256);
  check('2-color input yields <=4 palette colors', pal.length / 3 <= 4, `${pal.length / 3}`);
  const map = Gif.createMapper(pal);
  const wr = new Gif.GifWriter(w, h, pal, { loop: 0 });
  wr.start();
  const idx = map(buf, w, h);
  wr.addFrame(idx, 2);
  const bytes = wr.finish();
  const gif = parseGif(bytes);
  check('tiny GIF structurally valid', gif.frames.length === 1 && gif.frames[0].delay === 2);
  const dec = lzwDecode(gif.frames[0].minCodeSize, gif.frames[0].data, w * h);
  check('tiny GIF LZW round-trip (min code size 2)',
    dec.length === w * h && dec.every((v, i) => v === idx[i]), `minCodeSize=${gif.frames[0].minCodeSize}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
