// Attachments contract (v1.4): the pure reducer over attachment events, the
// blob framing, and the real crypto path (HKDF per-attachment key, AES-GCM
// with the id as AAD) lifted from index.html and run on Node's WebCrypto.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const slice = (from, to) => { const a = html.indexOf(from), b = html.indexOf(to, a); assert.ok(a > 0 && b > a, `region ${from}`); return html.slice(a, b); };
const pure = slice('// ── attachments:pure begin', '// ── attachments:pure end');
const hkdf = slice('async function hkdf32(', '// Constant-time XOR');
const aes = slice('async function importAesKey(', '// Wrap (encrypt)');
const crypt = slice('async function attKey(', 'function attNewId(');
const t = new Function('crypto', 'S', hkdf + aes + pure + crypt + ';return { attApplyEvent, attFrame, attUnframe, attIsId, attPath, attKeyInfo, attFmtSize, attEncrypt, attDecrypt, attSha256Hex, ATT_SOFT_CAP, ATT_HARD_CAP };')(webcrypto, { master_secret: new Uint8Array(32).fill(7) });

// ── reducer ──
const ID = 'a'.repeat(32), ID2 = 'b'.repeat(32);
const add = (map, id, ts, entry = 'e1') => t.attApplyEvent(map, 'attachment_added', { entry_id: entry, attachment_id: id, filename: 'f.txt', mime: 'text/plain', size: 3, sha256_ct: 'x' }, ts);
const rem = (map, id, ts, entry = 'e1') => t.attApplyEvent(map, 'attachment_removed', { entry_id: entry, attachment_id: id, removed_at: ts }, ts);
{
  const m = new Map();
  add(m, ID, 't1'); assert.equal(m.get(ID).added_at, 't1'); assert.equal(m.get(ID).removed_at, null);
  add(m, ID, 't0'); assert.equal(m.get(ID).added_at, 't1', 'a second add does not rewrite the record');
  rem(m, ID, 't3'); assert.equal(m.get(ID).removed_at, 't3');
  rem(m, ID, 't2'); assert.equal(m.get(ID).removed_at, 't2', 'earliest tombstone wins');
  add(m, ID, 't9'); assert.equal(m.get(ID).removed_at, 't2', 'removed is never re-added');
}
{
  const m = new Map();
  rem(m, ID2, 't1'); assert.equal(m.get(ID2).removed_at, 't1', 'a tombstone before its add still tombstones');
  add(m, ID2, 't2'); assert.equal(m.get(ID2).removed_at, 't1'); assert.equal(m.get(ID2).filename, '');
}
{
  const m = new Map();
  t.attApplyEvent(m, 'attachment_added', { entry_id: 'e', attachment_id: 'short', filename: 'f', size: 1, sha256_ct: 'x' }, 't');
  t.attApplyEvent(m, 'attachment_added', { entry_id: 'e', attachment_id: ID, filename: 'f', size: -1, sha256_ct: 'x' }, 't');
  t.attApplyEvent(m, 'attachment_added', { entry_id: 7, attachment_id: ID, filename: 'f', size: 1, sha256_ct: 'x' }, 't');
  t.attApplyEvent(m, 'attachment_added', null, 't');
  assert.equal(m.size, 0, 'malformed payloads are ignored');
}
assert.ok(t.attIsId(ID)); assert.ok(!t.attIsId(ID.toUpperCase())); assert.ok(!t.attIsId(ID + 'a'));
assert.equal(t.attPath(ID), `tijori-attachments/${ID}.bin`);
assert.equal(t.attKeyInfo(ID), 'attachment-key:' + ID);
assert.equal(t.attFmtSize(999), '999 B'); assert.equal(t.attFmtSize(1536), '1.5 KB'); assert.equal(t.attFmtSize(3 * 1048576), '3.0 MB');
assert.ok(t.ATT_SOFT_CAP < t.ATT_HARD_CAP);

// ── framing ──
{
  const f = t.attFrame(new Uint8Array(12).fill(1), new Uint8Array(20).fill(2));
  assert.equal(f.length, 32); const u = t.attUnframe(f); assert.equal(u.nonce.length, 12); assert.equal(u.ct.length, 20);
  assert.throws(() => t.attUnframe(new Uint8Array(28)), /too short/);
}

// ── crypto: round trip, AAD binds the id, tamper and wrong key fail ──
{
  const plain = new TextEncoder().encode('SSH key material, not really');
  const framed = await t.attEncrypt(ID, plain);
  assert.equal(framed.length, 12 + plain.length + 16);
  assert.deepEqual([...await t.attDecrypt(ID, framed)], [...plain]);
  await assert.rejects(t.attDecrypt(ID2, framed), 'a blob under another id does not open');
  const tampered = framed.slice(); tampered[20] ^= 1;
  await assert.rejects(t.attDecrypt(ID, tampered), 'a flipped ciphertext byte fails the tag');
  const other = new Function('crypto', 'S', hkdf + aes + pure + crypt + ';return { attDecrypt };')(webcrypto, { master_secret: new Uint8Array(32).fill(8) });
  await assert.rejects(other.attDecrypt(ID, framed), 'another vault\'s master secret does not open it');
  const f2 = await t.attEncrypt(ID, plain);
  assert.notDeepEqual([...f2.subarray(0, 12)], [...framed.subarray(0, 12)], 'fresh nonce per encryption');
  assert.match(await t.attSha256Hex(framed), /^[0-9a-f]{64}$/);
}
console.log('Tijori attachments contract: PASS');
