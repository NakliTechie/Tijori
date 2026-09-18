// Optical contract: frames the sender would paint must decode with an
// independent QR reader (jsQR), at every preset, systematic and repair, and at
// a module scale a phone camera sees. This is the check that would have caught
// the 2026-04 → 2026-09 encoder (its applyMask erased every finder pattern):
// the byte-level tests passed for five months while no frame was scannable.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import jsQR from 'jsqr';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const region = html.slice(html.indexOf('// ── qr-transport:pure begin'), html.indexOf('// ── qr-transport:pure end'));
const lib = html.slice(html.indexOf('var qrcodegen;'), html.indexOf('// ── qr-transport:pure begin'));
const t = new Function(lib + ';' + region + ';return { b45e, qrFountainFrame, QR_CHUNK_MAX, qrcodegen };')();
const { QrCode } = t.qrcodegen;

// Same mapping _renderQrFrame uses: modules × scale, centred, white quiet zone.
function raster(qr, scale, quiet = 4) {
  const px = (qr.size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(px * px * 4).fill(255);
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.getModule(x, y))
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const i = (((y + quiet) * scale + dy) * px + (x + quiet) * scale + dx) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
  return { data, px };
}
const decode = (qr, scale) => { const r = raster(qr, scale); return jsQR(r.data, r.px, r.px, { inversionAttempts: 'dontInvert' }); };

const archive = new Uint8Array(fs.readFileSync(new URL('./fixtures/qr-bench-vault/archive.json', import.meta.url)));
const h = createHash('sha256').update(archive).digest();
const TAG = t.b45e(h.subarray(0, 2)) + t.b45e(h.subarray(2, 4)).slice(0, 1);

// control: a v1 code
{
  const d = decode(QrCode.encodeText('HELLO TIJORI', QrCode.Ecc.LOW), 4);
  assert.ok(d && d.data === 'HELLO TIJORI', 'v1 control decodes');
}
let checked = 0;
for (const chunk of [450, 900, 1800, 2840, t.QR_CHUNK_MAX]) {
  const K = Math.ceil(archive.length / chunk);
  for (const seq of [0, K - 1, K + 3]) {
    const text = t.qrFountainFrame(archive, chunk, TAG, seq);
    const qr = QrCode.encodeText(text, QrCode.Ecc.LOW);
    // 3 px/module is roughly a phone at 30 cm framing a laptop screen; 2 px is harsh
    for (const scale of [3, 2]) {
      const d = decode(qr, scale);
      assert.ok(d, `chunk ${chunk} seq ${seq} v${qr.version} decodes at ${scale} px/module`);
      assert.equal(d.data, text, `chunk ${chunk} seq ${seq}: decoded text is the frame verbatim`);
      checked++;
    }
  }
  console.log(`chunk ${String(chunk).padStart(4)} B · K=${String(K).padStart(2)} · v${QrCode.encodeText(t.qrFountainFrame(archive, chunk, TAG, 0), QrCode.Ecc.LOW).version} · 3 frames × 2 scales decode`);
}
console.log(`Tijori QR render contract: PASS (${checked} rendered frames decoded by jsQR)`);
