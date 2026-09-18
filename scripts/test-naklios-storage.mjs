import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]);
assert.equal(scripts.length, 4, 'expected the four vendored inline scripts');

const sdk = scripts[0];
const app = scripts.at(-1);
new Function(sdk);
new Function(app);

// The vendored SDK between the naklios-sdk markers is canonical upstream text
// (its header spells the repo `nakliOS`); the splicer rewrites it on every
// refresh, so only Tijori's own text is held to the product spelling.
const ownHtml = html.replace(/\/\* naklios-sdk:begin[\s\S]*?\/\* naklios-sdk:end \*\//, '');
assert.doesNotMatch(
  ownHtml,
  /\b(?:naklOS|nakliOS|Naklios)\b/,
  'Tijori must use the NakliOS product spelling',
);
assert.match(html, /connect-src 'none'/, 'Tijori must keep direct network access disabled');
assert.match(html, /frame-ancestors 'self'/, 'same-origin NakliOS mirror must be iframeable');
assert.match(app, /const NAKLIOS_DIR = Object\.freeze/);
assert.match(app, /naklios\.fs\.read\(name\)/);
assert.match(app, /naklios\.fs\.write\(name, text\)/);
assert.match(app, /naklios\.fs\.append/);
assert.match(app, /naklios\.fs\.list\(''\)/);
assert.match(app, /Different folder or Crate/);
assert.match(app, /function showStorageLocationPicker\(\)/);
assert.match(app, /title\.textContent = backend\.id === 'crate' \? 'Mounted Crate'/);
assert.match(app, /await importVaultToNakliOS\(currentLocalDir\)/,
  'switching an open local vault to an empty Crate should reuse that folder as the copy source');
assert.match(app, /nakliosBackend\?: 'fsa'\|'crate'/,
  'known hosted vaults must remain distinct per NakliOS backend');
assert.match(app, /window\.showDirectoryPicker/, 'standalone FSA path must remain available');
assert.match(app, /metaVersion\(meta\) === 2 && !metaPwWrapEnabled\(meta\)/,
  'origin-bound hardware-key-only vaults must be refused during import');

const importBody = app.slice(
  app.indexOf('async function importVaultToNakliOS('),
  app.indexOf('async function _openOpfsVault')
);
assert.ok(
  importBody.indexOf("naklios.fs.write('tijori-meta.json'") >
    importBody.indexOf('for (const name of streamNames)'),
  'metadata must be written after event streams as the import commit marker'
);
assert.match(importBody, /for \(const name of copied\.reverse\(\)\)/,
  'partial imports must be cleaned up');

let messageListener;
const sent = [];
const HOST_ORIGIN = 'https://naklios.dev';
// SDK v2 drops any message whose source is not window.parent and pins the
// origin on first contact, so every synthetic host message carries both.
const fromHost = data => messageListener({ data, source: childWindow.parent, origin: HOST_ORIGIN });
const childWindow = {
  parent: { postMessage(message) { sent.push(message); } },
  addEventListener(type, callback) {
    if (type === 'message') messageListener = callback;
  },
};
vm.runInNewContext(sdk, {
  window: childWindow,
  Set,
  Map,
  Promise,
  Object,
  Error,
  Date,
  setTimeout: () => 0,
  clearTimeout: () => {},
});

assert.equal(childWindow.naklios.capabilities.hosted, true);
childWindow.naklios.requestCapabilities();
assert.equal(sent.at(-1).type, 'naklios:capabilities-request');

let observedFs = false;
childWindow.naklios.onCapabilitiesChange(caps => { observedFs = caps.fs; });
fromHost({
    type: 'naklios:capabilities',
    fs: true,
    fsBackends: [{ id: 'crate', label: 'Crate', name: 'vault-bucket' }],
    fsBackend: null,
  });
assert.equal(observedFs, true);
messageListener({ data: { type: 'naklios:capabilities', fs: false }, source: {}, origin: HOST_ORIGIN });
assert.equal(childWindow.naklios.capabilities.fs, true, 'a message not from window.parent must be ignored');
messageListener({ data: { type: 'naklios:capabilities', fs: false }, source: childWindow.parent, origin: 'https://evil.example' });
assert.equal(childWindow.naklios.capabilities.fs, true, 'a message from an unpinned origin must be ignored');
assert.equal(childWindow.naklios.capabilities.fsBackends[0].id, 'crate');
assert.equal(childWindow.naklios.capabilities.fsBackend, null);

const selectPromise = childWindow.naklios.fs.useBackend('crate');
const selectRequest = sent.at(-1);
assert.equal(selectRequest.type, 'naklios:fs:selectBackend');
assert.equal(selectRequest.backend, 'crate');
fromHost({ type: 'naklios:fs:reply', requestId: selectRequest.requestId, result: true });
assert.equal(await selectPromise, true);

const writePromise = childWindow.naklios.fs.write('vault.json', '{}');
const request = sent.at(-1);
assert.equal(request.type, 'naklios:fs:write');
assert.equal(request.path, 'vault.json');
fromHost({ type: 'naklios:fs:reply', requestId: request.requestId, result: null });
await writePromise;

// ── attachment bytes IO on the hosted backend: sub-paths pass through verbatim,
// binary is binary, missing reads are null, existence and delete route to the host ──
{
  const slice = (from, to) => { const a = app.indexOf(from), b = app.indexOf(to, a); assert.ok(a > 0 && b > a, `region ${from}`); return app.slice(a, b); };
  const io = slice('async function _subDir(', 'async function attKey(');
  const isDir = slice('function isNakliOSDir(', 'function storageDisplayName(');
  const calls = []; const store = new Map();
  const naklios = { fs: {
    readBinary: async p => { calls.push(['readBinary', p]); if (!store.has(p)) throw new Error('not found: ' + p); return store.get(p); },
    write: async (p, d) => { calls.push(['write', p, d instanceof Uint8Array ? 'Uint8Array' : typeof d]); store.set(p, d); },
    exists: async p => { calls.push(['exists', p]); return store.has(p); },
    delete: async p => { calls.push(['delete', p]); store.delete(p); },
  } };
  const t = new Function('naklios', isDir + io + ';return { readFileBytes, writeFileBytes, fileExists, deleteFile };')(naklios);
  const dir = { __nakliosFs: true };
  const path = 'tijori-attachments/' + 'ab'.repeat(16) + '.bin';
  assert.equal(await t.readFileBytes(dir, path), null, 'a missing blob reads as null, not a throw');
  const bytes = new Uint8Array([0, 1, 2, 255, 254]);
  await t.writeFileBytes(dir, path, bytes);
  assert.deepEqual(calls.at(-1), ['write', path, 'Uint8Array'], 'the host receives the sub-path and raw bytes');
  assert.equal(await t.fileExists(dir, path), true);
  assert.deepEqual([...await t.readFileBytes(dir, path)], [...bytes]);
  await t.deleteFile(dir, path);
  assert.equal(await t.fileExists(dir, path), false);
  assert.ok(calls.every(c => c[1] === path), 'no path is rewritten on the way to the host');
  console.log('Tijori NakliOS attachment bytes IO: PASS');
}

console.log('Tijori NakliOS storage contract: PASS');
