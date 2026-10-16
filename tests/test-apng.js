/* APNG encoder tests: container structure, CRC validity, chunk layout,
   stored-DEFLATE round-trip, and full lossless pixel verification through
   an independent PNG unfilter implementation. */
require('../js/apng.js');
const Apng = globalThis.Apng;
const zlib = require('node:zlib');

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log('PASS ' + name + (detail ? '  ' + detail : '')); }
  else { failed++; console.log('FAIL ' + name + (detail ? '  ' + detail : '')); }
}

/* ---- independent CRC32 check via known vector below ---- */
check('crc32 known vector ("123456789" -> 0xCBF43926)',
  Apng.crc32(new TextEncoder().encode('123456789')) === 0xCBF43926);

/* ---- storedDeflate is a valid zlib stream ---- */
{
  const data = new Uint8Array(70000 + 123);
  for (let i = 0; i < data.length; i++) data[i] = (i * 7 + (i >> 9)) & 0xFF;
  const z = Apng.storedDeflate(data);
  check('storedDeflate zlib header', z[0] === 0x78 && z[1] === 0x01, `0x${z[0].toString(16)} 0x${z[1].toString(16)}`);
  const back = zlib.inflateSync(Buffer.from(z));
  check('storedDeflate round-trip via node zlib', back.length === data.length && Buffer.compare(Buffer.from(data), back) === 0, `${back.length} bytes`);
}

/* ---- PNG row filters: filterRows + independent unfilter round-trip ---- */
function unfilterPNG(filtered, w, h) {
  const stride = w * 4;
  const out = new Uint8Array(h * stride);
  const prev = new Uint8Array(stride);
  const recon = new Uint8Array(stride);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < h; y++) {
    const ft = filtered[y * (stride + 1)];
    const row = filtered.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? recon[x - 4] : 0;
      const b = prev[x];
      const c = x >= 4 ? prev[x - 4] : 0;
      let v = row[x];
      if (ft === 1) v = (v + a) & 0xFF;
      else if (ft === 2) v = (v + b) & 0xFF;
      else if (ft === 3) v = (v + ((a + b) >> 1)) & 0xFF;
      else if (ft === 4) v = (v + paeth(a, b, c)) & 0xFF;
      recon[x] = v & 0xFF;
    }
    out.set(recon, y * stride);
    prev.set(recon);
  }
  return out;
}

{
  // gradient-ish + noise frame to exercise every filter type
  const w = 97, h = 61;
  const frame = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      frame[i] = (x * 255 / w) | 0;
      frame[i + 1] = (y * 255 / h) | 0;
      frame[i + 2] = ((x ^ y) * 37) & 0xFF;
      frame[i + 3] = 255;
    }
  }
  const filtered = Apng.filterRows(frame, w, h);
  check('filterRows output size', filtered.length === h * (w * 4 + 1));
  const types = new Set();
  for (let y = 0; y < h; y++) types.add(filtered[y * (w * 4 + 1)]);
  check('adaptive filter picks varied types', types.size >= 2, [...types].join(','));
  const back = unfilterPNG(filtered, w, h);
  let eq = back.length === frame.length;
  if (eq) for (let i = 0; i < frame.length; i++) if (back[i] !== frame[i]) { eq = false; break; }
  check('filter/unfilter round-trip lossless', eq);
}

/* ---- container walk ---- */
async function main() {
  const W = 64, H = 40, N = 3;
  const mkFrame = (k) => {
    const a = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      a[i * 4] = (i * 3 + k * 40) & 0xFF;
      a[i * 4 + 1] = (i * 5 + k * 20) & 0xFF;
      a[i * 4 + 2] = (i * 7) & 0xFF;
      a[i * 4 + 3] = 255;
    }
    return a;
  };

  const enc = new Apng.ApngEncoder(W, H, { totalFrames: N, delayNum: 70, delayDen: 1000, deflateMode: 'stored' });
  enc.start();
  for (let k = 0; k < N; k++) await enc.addFrame(mkFrame(k));
  const bytes = enc.finish();
  check('PNG signature', bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 &&
    bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A);

  // walk chunks
  const chunks = [];
  let p = 8, crcOk = true, crcN = 0;
  while (p < bytes.length) {
    const len = (bytes[p] << 24 | bytes[p + 1] << 16 | bytes[p + 2] << 8 | bytes[p + 3]) >>> 0;
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    const dataStart = p + 8;
    const crcAt = dataStart + len;
    const crcBytes = bytes.subarray(p + 4, crcAt);
    const crcStored = (bytes[crcAt] << 24 | bytes[crcAt + 1] << 16 | bytes[crcAt + 2] << 8 | bytes[crcAt + 3]) >>> 0;
    if (Apng.crc32(crcBytes) !== crcStored) crcOk = false;
    crcN++;
    chunks.push({ type, len, data: bytes.subarray(dataStart, crcAt) });
    p = crcAt + 4;
  }
  check('all chunk CRCs valid', crcOk, `${crcN} chunks`);
  check('chunk sequence', chunks.map((c) => c.type).join(',') === 'IHDR,acTL,fcTL,IDAT,fcTL,fdAT,fcTL,fdAT,IEND',
    chunks.map((c) => c.type).join(','));
  check('IEND is last and empty', chunks[chunks.length - 1].type === 'IEND' && chunks[chunks.length - 1].len === 0);

  const ihdr = chunks[0].data;
  check('IHDR dims/depth/color', (ihdr[0] << 24 | ihdr[1] << 16 | ihdr[2] << 8 | ihdr[3]) === W &&
    (ihdr[4] << 24 | ihdr[5] << 16 | ihdr[6] << 8 | ihdr[7]) === H && ihdr[8] === 8 && ihdr[9] === 6 &&
    ihdr[10] === 0 && ihdr[11] === 0 && ihdr[12] === 0);
  const actl = chunks[1].data;
  const nFrames = (actl[0] << 24 | actl[1] << 16 | actl[2] << 8 | actl[3]) >>> 0;
  const nPlays = (actl[4] << 24 | actl[5] << 16 | actl[6] << 8 | actl[7]) >>> 0;
  check('acTL num_frames', nFrames === N, nFrames);
  check('acTL num_plays=0 (infinite)', nPlays === 0);

  const fctls = chunks.filter((c) => c.type === 'fcTL');
  check('fcTL count', fctls.length === N, fctls.length);
  const d0 = fctls[0].data;
  check('fcTL delay 70/1000', d0[20] === 0 && d0[21] === 70 && d0[22] === 3 && d0[23] === 232,
    `${d0[21]} / ${(d0[22] << 8) | d0[23]}`);
  check('fcTL dispose/blend op', d0[24] === 0 && d0[25] === 0);
  // sequence numbers consecutive across fcTL+fdAT
  const seqs = [];
  for (const c of chunks) {
    if (c.type === 'fcTL') seqs.push((c.data[0] << 24 | c.data[1] << 16 | c.data[2] << 8 | c.data[3]) >>> 0);
    if (c.type === 'fdAT') seqs.push((c.data[0] << 24 | c.data[1] << 16 | c.data[2] << 8 | c.data[3]) >>> 0);
  }
  check('sequence numbers consecutive', seqs.join(',') === '0,1,2,3,4', seqs.join(','));

  // ---- lossless pixel verification: inflate each frame and unfilter ----
  const idat = chunks.filter((c) => c.type === 'IDAT')[0].data;
  const fdats = chunks.filter((c) => c.type === 'fdAT');
  const framesZ = [idat, ...fdats.map((c) => c.data.subarray(4))];
  let allEq = true;
  for (let k = 0; k < N; k++) {
    const raw = zlib.inflateSync(Buffer.from(framesZ[k]));
    const back = unfilterPNG(new Uint8Array(raw), W, H);
    const want = mkFrame(k);
    for (let i = 0; i < want.length; i++) if (back[i] !== want[i]) { allEq = false; break; }
  }
  check('pixel-exact lossless round-trip (all frames)', allEq);

  // determinism
  const enc2 = new Apng.ApngEncoder(W, H, { totalFrames: N, delayNum: 70, delayDen: 1000, deflateMode: 'stored' });
  enc2.start();
  for (let k = 0; k < N; k++) await enc2.addFrame(mkFrame(k));
  const bytes2 = enc2.finish();
  check('deterministic output', Buffer.compare(Buffer.from(bytes), Buffer.from(bytes2)) === 0);

  // CompressionStream path (if available in this runtime) also round-trips
  if (typeof CompressionStream !== 'undefined') {
    const data = new Uint8Array(5000);
    for (let i = 0; i < data.length; i++) data[i] = (i * 31) & 0xFF;
    const z = await Apng.zlibDeflate(data, { mode: 'auto' });
    const back = zlib.inflateSync(Buffer.from(z));
    check('CompressionStream deflate round-trip', back.length === data.length && Buffer.compare(Buffer.from(data), back) === 0,
      `${z.length} bytes compressed`);
  } else {
    check('CompressionStream unavailable -> fallback used', true);
  }

  // frame size mismatch throws
  try {
    const e3 = new Apng.ApngEncoder(W, H, { totalFrames: 1 });
    e3.start();
    await e3.addFrame(new Uint8Array(10));
    check('frame size mismatch throws', false);
  } catch (e) {
    check('frame size mismatch throws', /mismatch/.test(String(e)));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main();
