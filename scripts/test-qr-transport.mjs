// QR transport contract: the pure region of index.html (base45, the TJ3
// systematic LT fountain, legacy TJ2/TJ1 parsing) round-trips, every frame is
// QR-alphanumeric, every preset fits v40 / EC-L in the vendored qrcodegen, and
// the decoder recovers from missed frames without a carousel lap. Runs in CI next to the storage test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const region = html.slice(
  html.indexOf('// ── qr-transport:pure begin'),
  html.indexOf('// ── qr-transport:pure end'),
);
assert.ok(region.length > 0, 'pure region markers present');
const qrcodegenSrc = html.split('\n').find(l => l.startsWith('var qrcodegen='));
assert.ok(qrcodegenSrc, 'vendored qrcodegen present');

const t = new Function(qrcodegenSrc + ';' + region + `
  ;return { b45e, b45d, qrParseFrame, qrFountainIndices, qrFountainFrame, qrFountainNextSeq, QrFountainDecoder,
            QR_CHUNK_MAX, QR_HEADER_LEN, QR_ALNUM_MAX, QR_SEQ_MOD, qrcodegen };`)();
const { QrCode } = t.qrcodegen;

// ── base45: RFC 9285 vectors, then random round-trips ──
const enc = s => t.b45e(new TextEncoder().encode(s));
assert.equal(enc('AB'), 'BB8');
assert.equal(enc('Hello!!'), '%69 VD92EX0');
assert.equal(enc('base-45'), 'UJCLQE7W581');
assert.equal(new TextDecoder().decode(t.b45d('QED8WEX0')), 'ietf!');
let seed = 0x1234567;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 256;
for (let n = 0; n < 300; n++) {
  const bytes = Uint8Array.from({ length: n }, rnd);
  const s = t.b45e(bytes);
  assert.equal(s.length, Math.floor(n / 2) * 3 + (n % 2 ? 2 : 0), `base45 length for ${n} bytes`);
  assert.ok(/^[0-9A-Z $%*+\-./:]*$/.test(s), 'base45 output stays in the QR alphanumeric set');
  assert.deepEqual([...t.b45d(s)], [...bytes], `round-trip ${n} bytes`);
}
assert.throws(() => t.b45d('A'), /bad length/);
assert.throws(() => t.b45d('GGW'), /overflow/);   // 16 + 16*45 + 32*2025 > 0xffff
assert.throws(() => t.b45d('ab'), /bad char/);

// ── TJ3 fountain: the committed fixture, every preset ──
const archive = fs.readFileSync(new URL('./fixtures/qr-bench-vault/archive.json', import.meta.url));
const bytes = new Uint8Array(archive);
const tagFor = b => { const h = createHash('sha256').update(b).digest(); return t.b45e(h.subarray(0, 2)) + t.b45e(h.subarray(2, 4)).slice(0, 1); };
const TAG = tagFor(bytes);
assert.equal(TAG.length, 4);
const alnum = QrCode.Mode.ALPHANUMERIC;

// a decoder fed frames in `order` (array of seqs); returns frames consumed to finish
function run(chunk, order) {
  let dec = null, used = 0;
  for (const seq of order) {
    const f = t.qrFountainFrame(bytes, chunk, TAG, seq);
    const p = t.qrParseFrame(f);
    assert.ok(p && p.proto === 'TJ3', 'parses as TJ3');
    assert.equal(p.seq, seq % t.QR_SEQ_MOD); assert.equal(p.chunk, chunk); assert.equal(p.length, bytes.length); assert.equal(p.tag, TAG);
    dec ??= new t.QrFountainDecoder(p.chunk, p.length, p.tag);
    dec.accept(p.seq, p.bytes); used++;
    if (dec.done) break;
  }
  assert.ok(dec.done, `decoder finished (chunk ${chunk}, ${order.length} frames offered)`);
  assert.ok(Buffer.from(dec.bytes()).equals(archive), `reassembled archive is byte-identical (chunk ${chunk})`);
  return { used, K: dec.K };
}
seed = 0x2468;
const rndf = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const seqs = n => Array.from({ length: n }, (_, i) => i);

for (const chunk of [450, 900, 1800, 2840, t.QR_CHUNK_MAX]) {
  const K = Math.ceil(bytes.length / chunk);
  // every frame: header shape, single alphanumeric segment, fits v40 / EC-L
  let maxVersion = 0;
  for (const seq of [0, 1, K - 1, K, K + 1, K + 7, 12345, t.QR_SEQ_MOD - 1]) {
    const f = t.qrFountainFrame(bytes, chunk, TAG, seq);
    assert.match(f.slice(0, t.QR_HEADER_LEN), /^TJ3\d{4}\d{7}\d{5}[0-9A-Z $%*+\-./:]{4}$/);
    assert.ok(f.length <= t.QR_ALNUM_MAX, `fits the alphanumeric ceiling at ${chunk}: ${f.length}`);
    const segs = QrCode.makeSegments(f);
    assert.equal(segs.length, 1); assert.equal(segs[0].mode, alnum, 'single alphanumeric segment');
    maxVersion = Math.max(maxVersion, QrCode.encodeText(f, QrCode.Ecc.LOW).version);
  }
  // systematic phase: a clean capture finishes in exactly K frames
  const clean = run(chunk, seqs(K));
  assert.equal(clean.used, K); assert.equal(clean.K, K);
  // repair indices are deterministic, distinct, in range, and not all degree-1
  const degs = [];
  for (let seq = K; seq < K + 200; seq++) {
    const a = t.qrFountainIndices(seq, K), b = t.qrFountainIndices(seq, K);
    assert.deepEqual(a, b, 'indices are a pure function of (seq, K)');
    assert.ok(a.length >= 1 && a.length <= K && new Set(a).size === a.length && a.every(i => i >= 0 && i < K));
    degs.push(a.length);
  }
  if (K > 1) assert.ok(degs.some(d => d > 1), 'repair frames mix blocks');
  console.log(`chunk ${String(chunk).padStart(4)} B → K=${String(K).padStart(2)} · v${maxVersion} · repair degree mean ${(degs.reduce((x, y) => x + y) / degs.length).toFixed(1)}`);
}

// ── the covered-camera case: miss 3 consecutive systematic frames, keep going ──
{
  const chunk = 450, K = Math.ceil(bytes.length / chunk);   // K = 47
  const order = seqs(K + 60).filter(s => s < 3 || s > 5);
  const r = run(chunk, order);
  const extra = r.used - (K - 3);
  console.log(`covered camera (3 of ${K} missed): finished after ${r.used} frames — ${extra} repair frames to recover 3 blocks (carousel would need ${K})`);
  assert.ok(extra < K, 'recovering 3 missed blocks costs less than a full lap');
}
// ── heavy loss: drop 50% of frames at random, including in the repair phase ──
{
  const chunk = 900, K = Math.ceil(bytes.length / chunk);
  const order = seqs(K * 12).filter(() => rndf() < 0.5);
  const r = run(chunk, order);
  console.log(`50% random loss (K=${K}): finished after ${r.used} frames offered (~${(r.used / K).toFixed(2)}× K)`);
  assert.ok(r.used < K * 6, 'completes well before the sender gives up');
}
// ── repair-only: the receiver never saw the systematic phase at all ──
{
  const chunk = 1800, K = Math.ceil(bytes.length / chunk);
  const r = run(chunk, Array.from({ length: K * 20 }, (_, i) => K + 100 + i));
  console.log(`repair frames only (K=${K}): finished after ${r.used} frames (~${(r.used / K).toFixed(2)}× K)`);
}
// ── seq wrap goes back to the repair region, never to a systematic frame ──
assert.equal(t.qrFountainNextSeq(t.QR_SEQ_MOD - 1, 7), 7);
assert.equal(t.qrFountainNextSeq(6, 7), 7);
// ── a frame from another archive (different tag) is not part of this sequence ──
{
  const dec = new t.QrFountainDecoder(450, bytes.length, TAG);
  const other = t.qrParseFrame(t.qrFountainFrame(bytes, 450, 'ZZZZ', 0));
  assert.equal(other.tag, 'ZZZZ');   // the receiver compares tags before accept(); here we just confirm it surfaces
  assert.equal(dec.accept(0, new Uint8Array(3)), false, 'wrong chunk size is rejected');
}
// the largest preset is the v40 ceiling
{
  const full = new Uint8Array(t.QR_CHUNK_MAX).fill(255);
  const f = t.qrFountainFrame(full, t.QR_CHUNK_MAX, TAG, 0);
  assert.equal(QrCode.encodeText(f, QrCode.Ecc.LOW).version, 40);
  assert.throws(() => QrCode.encodeText(f + 'AAA', QrCode.Ecc.LOW), /too long/);
}
// ── TJ2 (2026-09-18 carousel) still parses ──
{
  const p2 = t.qrParseFrame('TJ200030001' + t.b45e(new TextEncoder().encode('hello, TJ2')));
  assert.ok(p2 && p2.proto === 'TJ2' && p2.total === 3 && p2.idx === 1);
  assert.equal(Buffer.from(p2.bytes).toString(), 'hello, TJ2');
}

// ── TJ1 (legacy sender) still parses ──
const tj1 = 'TJ1|3|1|' + Buffer.from('hello, legacy').toString('base64');
const p1 = t.qrParseFrame(tj1);
assert.ok(p1 && p1.proto === 'TJ1' && p1.total === 3 && p1.idx === 1);
assert.equal(Buffer.from(p1.bytes).toString(), 'hello, legacy');
for (const bad of ['', 'TJ2', 'TJ3', 'TJ200010001', 'TJ200000000AB', 'TJ200010001A', 'TJ30450000000100000ABCD', 'TJ30002000000500000abcdBB8', 'TJ1|x|0|QQ==', 'TJ1|2|2|QQ==', 'otpauth://x', null, 42]) {
  assert.equal(t.qrParseFrame(bad), null, `rejects ${JSON.stringify(bad)}`);
}

console.log('Tijori QR transport contract: PASS');
