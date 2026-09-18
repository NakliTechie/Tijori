#!/usr/bin/env node
// Deterministic Tijori v2 test vault for transport benchmarks.
//
// Every byte is a pure function of SEED: salts, master secret, AES-GCM nonces,
// entry ids, timestamps. The KDF runs the same vendored hash-wasm Argon2id the
// app inlines, with the app's ARGON2_PARAMS, so the vault unlocks in Tijori
// with PASSWORD. The archive JSON written beside it is byte-identical to what
// showQrSend() serialises, so a benchmark row cites a fixed payload size.
//
//   node scripts/make-test-vault.mjs            write scripts/fixtures/qr-bench-vault/
//   node scripts/make-test-vault.mjs --check    regenerate in memory, diff against disk

import fs from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
const ROOT = new URL('..', import.meta.url);
const OUT = new URL('./fixtures/qr-bench-vault/', import.meta.url);
const PASSWORD = 'qr-bench-2026';
const SEED = 0x7a1b0c9d;
const ENTRY_COUNT = { login: 7, code: 4, card: 3, note: 6 };
const ARGON2_PARAMS = { memory_kib: 65536, iterations: 3, parallelism: 4, hash_length: 32 };

// ── vendored hash-wasm, straight out of index.html ──────────
const html = fs.readFileSync(new URL('index.html', ROOT), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const hashWasmSrc = scripts.find(s => s.includes('hashwasm') && s.includes('argon2id'));
if (!hashWasmSrc) throw new Error('vendored hash-wasm bundle not found in index.html');
const hashwasm = {};
new Function('exports', 'module', hashWasmSrc)(hashwasm, { exports: hashwasm });
const appParams = html.match(/const ARGON2_PARAMS = (\{[^}]+\})/)?.[1];
if (appParams !== JSON.stringify(ARGON2_PARAMS).replace(/"(\w+)":/g, '$1: ').replace(/,/g, ', ').replace(/\{/, '{ ').replace(/\}/, ' }')) {
  throw new Error(`ARGON2_PARAMS drifted from index.html: ${appParams}`);
}

// ── seeded PRNG (sfc32) — the only source of randomness ─────
function sfc32(a, b, c, d) {
  return () => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (a + b | 0) + d | 0;
    d = d + 1 | 0; a = b ^ b >>> 9; b = c + (c << 3) | 0;
    c = (c << 21 | c >>> 11) + t | 0;
    return (t >>> 0) / 4294967296;
  };
}
const rand = sfc32(SEED, SEED ^ 0x9e3779b9, SEED ^ 0x243f6a88, SEED ^ 0xb7e15162);
const randBytes = n => Uint8Array.from({ length: n }, () => Math.floor(rand() * 256));
const pick = arr => arr[Math.floor(rand() * arr.length)];
function uuid() {
  const b = randBytes(16); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ── the app's primitives, mirrored ──────────────────────────
const b64e = buf => Buffer.from(buf).toString('base64');
const utf8 = s => new TextEncoder().encode(s);
async function hkdf32(ikm, saltStr, infoStr) {
  const k = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: utf8(saltStr), info: utf8(infoStr) }, k, 256));
}
const importAesKey = raw => subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
async function aesGcm(key, plain) {
  const nonce = randBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain));
  return { ct: b64e(ct), nonce: b64e(nonce) };
}
const sha256b64 = async s => b64e(new Uint8Array(await subtle.digest('SHA-256', utf8(s))));

// ── deterministic content ───────────────────────────────────
const T0 = Date.UTC(2026, 8, 18, 9, 0, 0); // 2026-09-18T09:00:00Z
let tick = 0;
const nextTs = () => new Date(T0 + (tick++) * 61_000).toISOString();
const WORDS = ['amber', 'basalt', 'cobalt', 'dune', 'ember', 'fjord', 'granite', 'harbor', 'iris', 'juniper', 'kestrel', 'lumen', 'moss', 'nectar', 'ochre', 'pumice', 'quartz', 'reed', 'saffron', 'tundra'];
const SITES = ['github.com', 'fastmail.com', 'bank.example', 'cloud.example', 'forum.example', 'shop.example', 'work.example', 'uni.example'];
const pw = () => `${pick(WORDS)}-${pick(WORDS)}-${Math.floor(rand() * 9000 + 1000)}!`;
const b32 = () => Array.from({ length: 32 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[Math.floor(rand() * 32)]).join('');
const F = (v, ts) => ({ v, ts });

function makeEntry(type, i) {
  const ts = nextTs();
  if (type === 'login') {
    const site = pick(SITES);
    return { type, fields: { title: F(`${site} #${i + 1}`, ts), url: F(`https://${site}/`, ts), username: F(`${pick(WORDS)}.${i}@${site}`, ts), password: F(pw(), ts), notes: F(i % 3 ? '' : 'benchmark fixture — not a real account', ts) } };
  }
  if (type === 'code') {
    const hotp = i % 4 === 3;
    return { type, fields: { label: F(`${pick(SITES)} 2FA #${i + 1}`, ts), secret: F(b32(), ts), account: F(`${pick(WORDS)}@${pick(SITES)}`, ts), issuer: F(pick(SITES), ts), algorithm: F('SHA-1', ts), digits: F('6', ts), period: F('30', ts), kind: F(hotp ? 'hotp' : 'totp', ts), counter: F(hotp ? String(i) : '0', ts), recovery_codes: F(i % 2 ? '' : Array.from({ length: 8 }, () => Math.floor(rand() * 1e8).toString().padStart(8, '0')).join('\n'), ts), notes: F('', ts) } };
  }
  if (type === 'card') {
    const num = '4' + Array.from({ length: 15 }, () => Math.floor(rand() * 10)).join('');
    return { type, fields: { label: F(`${pick(WORDS)} card #${i + 1}`, ts), cardholder: F('BENCH FIXTURE', ts), number: F(num, ts), expiry: F(`0${1 + i % 9}/3${i % 10}`, ts), cvv: F(String(100 + Math.floor(rand() * 900)), ts), notes: F('', ts) } };
  }
  const body = Array.from({ length: 3 + (i % 5) }, () => Array.from({ length: 12 }, () => pick(WORDS)).join(' ')).join('\n');
  return { type, fields: { title: F(`Note ${i + 1}: ${pick(WORDS)}`, ts), body: F(body, ts) } };
}

// ── build ───────────────────────────────────────────────────
async function build() {
  const deviceId = uuid();
  const kdf_salt = randBytes(32);
  const master_secret = randBytes(32);
  const pw_key = await hashwasm.argon2id({
    password: PASSWORD, salt: kdf_salt,
    iterations: ARGON2_PARAMS.iterations, parallelism: ARGON2_PARAMS.parallelism,
    memorySize: ARGON2_PARAMS.memory_kib, hashLength: ARGON2_PARAMS.hash_length, outputType: 'binary',
  });
  const vault_key = await importAesKey(await hkdf32(master_secret, 'tijori-v2', 'vault-key'));
  const pwWrapKey = await importAesKey(await hkdf32(pw_key, 'tijori-v2', 'pw-wrap-key'));
  const wrap = await aesGcm(pwWrapKey, master_secret);

  const registered_at = nextTs();
  const meta = {
    format: 'tijori-v2',
    vault_format_version: 2,
    kdf: { algorithm: 'argon2id', memory_kib: ARGON2_PARAMS.memory_kib, iterations: ARGON2_PARAMS.iterations, parallelism: ARGON2_PARAMS.parallelism, salt_kdf: b64e(kdf_salt) },
    device_roster: [{ id: deviceId, label: 'qr-bench', registered_at }],
    bound_keys: [],
    pw_wrap: { enabled: true, wrapped_master: wrap.ct, wrap_nonce: wrap.nonce },
  };

  const payloads = [['device_registered', { device_id: deviceId, label: 'qr-bench' }, registered_at]];
  for (const [type, n] of Object.entries(ENTRY_COUNT)) {
    for (let i = 0; i < n; i++) {
      const e = makeEntry(type, i);
      payloads.push(['entry_created', { id: uuid(), type, fields: e.fields }, e.fields[Object.keys(e.fields)[0]].ts]);
    }
  }

  const lines = [];
  for (const [event_type, payload, ts] of payloads) {
    const { ct, nonce } = await aesGcm(vault_key, utf8(JSON.stringify(payload)));
    const prev_hash = lines.length ? await sha256b64(lines.at(-1)) : 'genesis';
    lines.push(JSON.stringify({ seq: lines.length + 1, prev_hash, ts, device_id: deviceId, event_type, payload_ct: ct, nonce, event_format_version: 2 }));
  }

  const streamName = `tijori-events-${deviceId}.jsonl`;
  const files = {
    'tijori-meta.json': JSON.stringify(meta, null, 2),
    [streamName]: lines.join('\n') + '\n',
  };
  // Exactly what showQrSend() serialises: streams joined by '\n' without a trailing newline.
  const archive = JSON.stringify({ format: 'tijori-archive-v1', created_at: registered_at, meta, streams: { [deviceId]: lines.join('\n') } });
  files['archive.json'] = archive;
  files.__events = lines.length;
  files['README.md'] = [
    '# qr-bench-vault',
    '',
    `Deterministic Tijori v2 vault, generated by \`scripts/make-test-vault.mjs\` (seed \`0x${SEED.toString(16)}\`).`,
    `Password: \`${PASSWORD}\`. ${lines.length} events (${lines.length - 1} entries: ${Object.entries(ENTRY_COUNT).map(([k, v]) => `${v} ${k}`).join(', ')}).`,
    `Archive as the QR sender serialises it: \`archive.json\`, ${archive.length} bytes (${(archive.length / 1024).toFixed(1)} KB).`,
    '',
    'Fixed payload for the transport benchmarks in `plan/qr-benchmarks.md`. Regenerate with the script; `--check` diffs.',
    '',
  ].join('\n');
  return files;
}

const files = await build();
const eventCount = files.__events; delete files.__events;
const check = process.argv.includes('--check');
let drift = 0;
for (const [name, content] of Object.entries(files)) {
  const p = new URL(name, OUT);
  if (check) {
    const onDisk = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    if (onDisk !== content) { drift++; console.error(`drift: ${name} (${onDisk === null ? 'missing' : 'differs'})`); }
  } else {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(p, content);
  }
}
const archiveBytes = Buffer.byteLength(files['archive.json']);
console.log(`${check ? 'checked' : 'wrote'} ${Object.keys(files).length} files in ${path.relative(process.cwd(), OUT.pathname)} · archive ${archiveBytes} B (${(archiveBytes / 1024).toFixed(1)} KB) · ${eventCount} events`);
if (drift) { console.error(`${drift} file(s) drifted from the generator`); process.exit(1); }
