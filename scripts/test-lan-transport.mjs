// LAN transport contract: the pure region of index.html (compact SDP ↔ full
// SDP, TL1 signal encoding, pairing input) against a real Chromium offer and
// answer, plus the host-only filter and the QR fit. The live WebRTC loop is
// exercised in the browser; this pins the parts that can be pinned headless.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const qr = html.slice(html.indexOf('// ── qr-transport:pure begin'), html.indexOf('// ── qr-transport:pure end'));
const lan = html.slice(html.indexOf('// ── lan-transport:pure begin'), html.indexOf('// ── lan-transport:pure end'));
const lib = html.slice(html.indexOf('var qrcodegen;'), html.indexOf('// ── qr-transport:pure begin'));
assert.ok(lan.length > 0, 'lan pure region present');
const t = new Function(lib + ';' + qr + ';' + lan + ';return { lanCompactSdp, lanExpandSdp, lanEncodeSignal, lanDecodeSignal, lanPairingInput, LAN_PROTO, qrcodegen };')();
const { QrCode, QrSegment } = t.qrcodegen;

// Captured from the preview Chromium on 2026-09-18 (data-only, no ICE servers).
const OFFER = 'v=0\r\no=- 5968217831431615050 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=candidate:3768970404 1 udp 2113937151 5b9bf245-8448-4dd3-81f4-da4b5507a158.local 59074 typ host generation 0 network-cost 999\r\na=candidate:521434669 1 udp 2113939711 2fab8253-dbf5-4ffd-bc25-f2d8b906e81a.local 52687 typ host generation 0 network-cost 999\r\na=ice-ufrag:x9p6\r\na=ice-pwd:fwfT1cQxRdlmfF9lLIj/smYA\r\na=ice-options:trickle\r\na=fingerprint:sha-256 AC:7F:E1:8A:41:F9:31:50:29:42:A1:09:A1:D1:29:DD:48:14:26:54:64:15:82:FA:7F:37:BA:9E:C8:8E:C2:CD\r\na=setup:actpass\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n';
const ANSWER = OFFER.replace('a=setup:actpass', 'a=setup:active').replace('x9p6', 'ea9p').replace('fwfT1cQxRdlmfF9lLIj/smYA', '+X3r7aFWpE7QG8iMsp3b1FU7')
  .replace('AC:7F:E1:8A:41:F9:31:50:29:42:A1:09:A1:D1:29:DD:48:14:26:54:64:15:82:FA:7F:37:BA:9E:C8:8E:C2:CD', '60:07:89:45:7B:AF:20:DB:D8:6B:94:44:36:4E:F7:1D:70:61:3F:04:DE:56:50:4A:C6:1A:79:B1:89:0B:10:D7');

// ── compact ↔ expand ──
const o = t.lanCompactSdp(OFFER);
assert.deepEqual(Object.keys(o).sort(), ['c', 'f', 'm', 'p', 's', 'sp', 'u', 'v']);
assert.equal(o.u, 'x9p6'); assert.equal(o.p, 'fwfT1cQxRdlmfF9lLIj/smYA'); assert.equal(o.s, 'actpass'); assert.equal(o.sp, 5000);
assert.match(o.f, /^[0-9A-F]{64}$/); assert.equal(o.f.slice(0, 6), 'AC7FE1');
assert.deepEqual(o.c, [['5b9bf245-8448-4dd3-81f4-da4b5507a158.local', 59074], ['2fab8253-dbf5-4ffd-bc25-f2d8b906e81a.local', 52687]]);
const full = t.lanExpandSdp(o);
assert.match(full, /^v=0\r\n/); assert.match(full, /m=application 9 UDP\/DTLS\/SCTP webrtc-datachannel/);
assert.match(full, /a=fingerprint:sha-256 AC:7F:E1:8A/); assert.match(full, /a=end-of-candidates\r\n$/);
assert.equal(full.match(/^a=candidate:/gm).length, 2);
assert.deepEqual(t.lanCompactSdp(full), o, 'compact(expand(compact(sdp))) is a fixed point');
const a = t.lanCompactSdp(ANSWER); assert.equal(a.s, 'active'); assert.equal(a.u, 'ea9p'); assert.equal(a.f.slice(0, 6), '600789');

// ── host-only: srflx / prflx / relay / tcp candidates never survive ──
const dirty = OFFER.replace('a=ice-ufrag', [
  'a=candidate:1 1 udp 1686052607 203.0.113.9 61000 typ srflx raddr 192.168.1.5 rport 61000',
  'a=candidate:2 1 udp 41885439 198.51.100.2 3478 typ relay raddr 203.0.113.9 rport 61000',
  'a=candidate:3 1 udp 1853824767 192.168.1.7 5000 typ prflx',
  'a=candidate:4 1 tcp 1518214911 192.168.1.5 9 typ host tcptype active',
  'a=ice-ufrag'].join('\r\n'));
assert.deepEqual(t.lanCompactSdp(dirty).c, o.c, 'only udp host candidates are kept');
assert.deepEqual(t.lanCompactSdp(OFFER.replace(/\.local/g, '')).c.map(c => c[0]), ['5b9bf245-8448-4dd3-81f4-da4b5507a158', '2fab8253-dbf5-4ffd-bc25-f2d8b906e81a']);
assert.throws(() => t.lanCompactSdp(OFFER.replace(/a=candidate:[^\r]*\r\n/g, '')), /no host candidates/);
assert.throws(() => t.lanCompactSdp(OFFER.replace(/a=fingerprint:[^\r]*\r\n/, '')), /missing/);

// ── signal encoding: TL1 + base45, alphanumeric, one QR ──
const sig = { ...o, k: '123456' };
const enc = t.lanEncodeSignal(sig);
assert.ok(enc.startsWith(t.LAN_PROTO));
assert.ok(/^[0-9A-Z $%*+\-./:]+$/.test(enc), 'signal is QR-alphanumeric');
assert.deepEqual(t.lanDecodeSignal(enc), sig);
assert.deepEqual(t.lanDecodeSignal(enc + '\n '), sig, 'trailing whitespace from a paste is tolerated');
const segs = QrSegment.makeSegments(enc); assert.equal(segs.length, 1); assert.equal(segs[0].mode, QrSegment.Mode.ALPHANUMERIC);
const v = QrCode.encodeText(enc, QrCode.Ecc.MEDIUM).version;
console.log(`offer signal: ${enc.length} chars → one QR v${v} at EC-M (SDP was ${OFFER.length} bytes)`);
assert.ok(v <= 20, 'a LAN signal stays a comfortably scannable static code');
// a LAN IP instead of mDNS names (what a phone shows after a camera grant) is smaller still
const ipSig = { ...sig, c: [['192.168.43.17', 51234]] };
console.log(`same with one LAN IP: ${t.lanEncodeSignal(ipSig).length} chars → v${QrCode.encodeText(t.lanEncodeSignal(ipSig), QrCode.Ecc.MEDIUM).version}`);

// ── decode rejects anything that would not expand to a safe SDP ──
for (const bad of ['', 'TL1', 'TL1$$$$', 'TJ3' + enc.slice(3), 'otpauth://x', null, 7,
  t.lanEncodeSignal({ ...sig, f: 'ZZ' }),                                  // bad fingerprint
  t.lanEncodeSignal({ ...sig, c: [] }),                                    // no candidates
  t.lanEncodeSignal({ ...sig, c: [['192.168.1.5\r\na=evil', 5000]] }),     // CRLF injection into the SDP
  t.lanEncodeSignal({ ...sig, c: [['192.168.1.5', 70000]] }),              // bad port
  t.lanEncodeSignal({ ...sig, u: 'x9p6\r\na=evil' }),                    // CRLF via ufrag
  t.lanEncodeSignal({ ...sig, s: 'evil' }),
  t.lanEncodeSignal({ ...sig, k: '12' }),
  t.lanEncodeSignal({ ...sig, v: 2 })]) {
  assert.equal(t.lanDecodeSignal(bad), null, `rejects ${JSON.stringify(bad).slice(0, 40)}`);
}

// ── pairing input is fixed-order and session-specific ──
const pi = t.lanPairingInput(o.f, a.f);
assert.equal(new TextDecoder().decode(pi), `tijori-lan-v1|${o.f}|${a.f}`);
assert.notDeepEqual([...t.lanPairingInput(o.f, a.f)], [...t.lanPairingInput(a.f, o.f)]);

console.log('Tijori LAN transport contract: PASS');
