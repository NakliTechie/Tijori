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

assert.match(html, /connect-src 'none'/, 'Tijori must keep direct network access disabled');
assert.match(html, /frame-ancestors 'self'/, 'same-origin naklOS mirror must be iframeable');
assert.match(app, /const NAKLIOS_DIR = Object\.freeze/);
assert.match(app, /naklios\.fs\.read\(name\)/);
assert.match(app, /naklios\.fs\.write\(name, text\)/);
assert.match(app, /naklios\.fs\.append/);
assert.match(app, /naklios\.fs\.list\(''\)/);
assert.match(app, /window\.showDirectoryPicker/, 'standalone FSA path must remain available');
assert.match(app, /metaVersion\(meta\) === 2 && !metaPwWrapEnabled\(meta\)/,
  'origin-bound hardware-key-only vaults must be refused during import');

const importBody = app.slice(
  app.indexOf('async function importVaultToNaklios()'),
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
messageListener({ data: { type: 'naklios:capabilities', fs: true } });
assert.equal(observedFs, true);

const writePromise = childWindow.naklios.fs.write('vault.json', '{}');
const request = sent.at(-1);
assert.equal(request.type, 'naklios:fs:write');
assert.equal(request.path, 'vault.json');
messageListener({
  data: { type: 'naklios:fs:reply', requestId: request.requestId, result: null },
});
await writePromise;

console.log('Tijori naklOS storage contract: PASS');
