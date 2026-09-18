// QR transport contract: the pure region of index.html (base45, TJ2 frame
// build/parse) round-trips, every frame is QR-alphanumeric, and every preset
// fits v40 / EC-L in the vendored qrcodegen. Runs in CI next to the storage test.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const region = html.slice(
  html.indexOf('// ── qr-transport:pure begin'),
  html.indexOf('// ── qr-transport:pure end'),
);
assert.ok(region.length > 0, 'pure region markers present');
const qrcodegenSrc = html.split('\n').find(l => l.startsWith('var qrcodegen='));
assert.ok(qrcodegenSrc, 'vendored qrcodegen present');

const t = new Function(qrcodegenSrc + ';' + region + `
  ;return { b45e, b45d, qrBuildFrames, qrParseFrame, QR_CHUNK_MAX, QR_HEADER_LEN, QR_ALNUM_MAX, qrcodegen };`)();
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

// ── frames: the committed fixture, every preset ──
const archive = fs.readFileSync(new URL('./fixtures/qr-bench-vault/archive.json', import.meta.url));
const bytes = new Uint8Array(archive);
const alnum = QrCode.Mode.ALPHANUMERIC;
for (const chunk of [450, 900, 1800, 2850, t.QR_CHUNK_MAX]) {
  const frames = t.qrBuildFrames(bytes, chunk);
  assert.equal(frames.length, Math.ceil(bytes.length / chunk), `frame count at ${chunk}`);
  let maxVersion = 0;
  const got = [];
  for (const f of frames) {
    assert.match(f.slice(0, t.QR_HEADER_LEN), /^TJ2\d{4}\d{4}$/);
    assert.ok(f.length <= t.QR_ALNUM_MAX, `frame fits the alphanumeric ceiling at ${chunk}: ${f.length}`);
    const segs = QrCode.makeSegments(f);
    assert.equal(segs.length, 1); assert.equal(segs[0].mode, alnum, 'single alphanumeric segment');
    const qr = QrCode.encodeText(f, QrCode.Ecc.LOW);   // throws "Data too long" past v40
    maxVersion = Math.max(maxVersion, qr.version);
    const p = t.qrParseFrame(f);
    assert.ok(p && p.proto === 'TJ2' && p.total === frames.length, 'parses as TJ2');
    got[p.idx] = p.bytes;
  }
  const joined = Buffer.concat(got.map(b => Buffer.from(b)));
  assert.ok(joined.equals(archive), `reassembled archive is byte-identical at ${chunk}`);
  console.log(`chunk ${String(chunk).padStart(4)} B → ${String(frames.length).padStart(3)} frames · v${maxVersion}`);
}
// the largest preset must actually be the v40 ceiling, not something smaller
{
  const full = t.qrBuildFrames(new Uint8Array(t.QR_CHUNK_MAX).fill(255), t.QR_CHUNK_MAX);
  assert.equal(full.length, 1);
  assert.equal(QrCode.encodeText(full[0], QrCode.Ecc.LOW).version, 40);
  assert.throws(() => QrCode.encodeText(full[0] + 'AAA', QrCode.Ecc.LOW), /too long/);
}

// ── TJ1 (legacy sender) still parses ──
const tj1 = 'TJ1|3|1|' + Buffer.from('hello, legacy').toString('base64');
const p1 = t.qrParseFrame(tj1);
assert.ok(p1 && p1.proto === 'TJ1' && p1.total === 3 && p1.idx === 1);
assert.equal(Buffer.from(p1.bytes).toString(), 'hello, legacy');
for (const bad of ['', 'TJ2', 'TJ200010001', 'TJ200000000AB', 'TJ200010001A', 'TJ1|x|0|QQ==', 'TJ1|2|2|QQ==', 'otpauth://x', null, 42]) {
  assert.equal(t.qrParseFrame(bad), null, `rejects ${JSON.stringify(bad)}`);
}

console.log('Tijori QR transport contract: PASS');
