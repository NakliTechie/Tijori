# v1.1 Smoke-Test Notes

Transient — delete after the manual matrix is run and v1.1 is signed off.

## Pre-flight

1. **Inline the Argon2id WASM blob.** Until you do, the build creates v1 vaults and disables hardware-key binding (with a clear status message in Settings → Security). Edit `index.html`:
   - Find `const ARGON2_WASM_B64 = '';` (one occurrence)
   - Paste the base64-encoded bytes of `hash-wasm`'s argon2 build (or equivalent)
   - The loader expects an export named `argon2id(pw, salt, m, t, p, hashLen) → Uint8Array(32)`. If the build exposes a different shape (e.g. `hash`, or a wrapped Module), adapt the `_hash = …` assignment in the `argon2` IIFE — there are two branches there as a starting point.
   - Re-test that derivation takes 300–800 ms on M4 Pro. If > 1.5 s, drop `memory_kib` to 32768 in `ARGON2_PARAMS`.

2. **Serve over localhost.** WebAuthn PRF requires a secure context. `file://` does not qualify and the UI surfaces that explicitly.
   ```
   cd /path/to/Tijori
   python3 -m http.server 8000
   # http://localhost:8000
   ```

3. **Use a Chrome 116+ profile with a YubiKey 5 (or Touch ID on Safari 18+).**

## Smoke tests that work without Argon2id WASM

Run these first to confirm v1 paths aren't regressed:

- [ ] Open an existing v1 vault, unlock with password → works
- [ ] Add a new entry → appended to log, search/filter still works
- [ ] Lock + unlock → entries reappear
- [ ] DevTools → Network panel after page load → empty
- [ ] Settings → Security → status panel shows "Argon2id WASM is not inlined in this build (WASM blob not inlined)" and bind button is disabled
- [ ] Verify log integrity → passes

## Smoke tests that need the WASM blob

### v1 → v2 upgrade (standalone, no hardware key)

- [ ] Open the v1 vault from above
- [ ] Settings → Security → "Upgrade KDF to Argon2id" button is visible
- [ ] Click → confirm modal → enter password when prompted (current implementation uses `window.prompt`; spec calls for a modal — see below)
- [ ] Toast "Vault upgraded to v2"
- [ ] On disk: `tijori-meta.json` now has `vault_format_version: 2`, `kdf.algorithm: 'argon2id'`, `kdf_legacy` block preserved
- [ ] Own `tijori-events-<id>.jsonl` is rewritten with `event_format_version: 2` and a final `vault_format_upgraded` event
- [ ] Lock + unlock with password → works
- [ ] Add a new entry → also v2-encrypted

### Fresh v2 vault

- [ ] Welcome → Create new vault → check meta has `vault_format_version: 2` and `pw_wrap.enabled: true`
- [ ] Add entries, lock, unlock with password → works

### Hardware-key bind

- [ ] On unlocked v2 vault, Settings → Security → Bind a hardware key
- [ ] Modal asks for label + master password re-entry
- [ ] Touch key when prompted
- [ ] Toast confirms bind, key appears in the list
- [ ] `tijori-meta.json` now has one entry in `bound_keys`
- [ ] Event log has a `key_bound` event
- [ ] Backup-key banner appears (single key + pw_wrap enabled means *no* banner unless you disable pw_wrap — recheck this logic with the user)

### Unlock with hardware key

- [ ] Lock
- [ ] Unlock screen now shows password input + "🔑 Unlock with hardware key" button
- [ ] Enter password, click hardware-key button → touch key → vault unlocks
- [ ] Wrong password + correct key → "Master password or hardware key incorrect"
- [ ] Correct password + wrong key (different YubiKey) → same generic error

### Backup-key flow

- [ ] With one key bound, disable password-only fallback (toggle) → confirm modal → banner appears
- [ ] Try to remove the last key → blocked with "Enable password-only fallback before removing your last key…"
- [ ] Bind a second key → banner disappears
- [ ] Remove the first key → second key still unlocks

### Change master password

- [ ] Settings → Security → Change master password
- [ ] Enter current + new + new again
- [ ] Touch every bound key in sequence as prompted
- [ ] Toast confirms
- [ ] Lock + unlock with new password (and key if required) → works
- [ ] Lock + unlock with old password → fails

### file:// origin guard

- [ ] Open `index.html` directly from disk (file://…)
- [ ] Settings → Security → status panel says hardware-key binding requires HTTPS/localhost; bind button disabled

### Cross-device migration

- [ ] On Device A (v1.1 + WASM): create a vault, add entries
- [ ] Sync the folder to Device B (also v1.1 + WASM) via filesystem copy
- [ ] On Device A: bind a key, vault becomes v2, A's log re-encrypted
- [ ] Re-sync to B
- [ ] On B: unlock — meta is v2, B's log still v1, both should be readable (legacy_key handles v1 events)
- [ ] On B: add a new entry → triggers `upgradeOwnStreamIfNeeded()`, B's log gets re-encrypted on the spot
- [ ] On both devices: all events visible

## Things I'm least confident in (look harder here)

1. **Argon2id loader export shape.** The loader IIFE assumes one of two export names (`argon2id` or `hash`). `hash-wasm`'s actual API may differ; the call signature `_hash(pw, salt, m, t, p, len)` is a best guess. Verify by reading the hash-wasm docs / the actual `.wasm` exports.

2. **`window.prompt` in `confirmUpgradeKdfStandalone`.** That's a placeholder — `prompt()` is blocked by some browsers and looks awful. Replace with a proper modal before shipping. Suggested fix: add a small password-prompt modal next to `modal-bind-key`.

3. **Backup-key banner trigger condition.** The handoff says "After first bind, persistent banner: 'Register a backup key.'" with dismissal allowed only after a second key or explicit pw_wrap toggle. My implementation shows the banner only when `bound_keys.length === 1 && !pw_wrap.enabled`. Since fresh v2 vaults default to `pw_wrap.enabled: true`, the banner stays hidden until the user explicitly disables fallback after binding the first key. Re-read the handoff to confirm this is the intended UX — alternative reading is "show as soon as one key bound, until two bound OR fallback explicitly enabled (which is already the default)." Both readings have merit; ask before changing.

4. **Cross-device incremental upgrade.** The hash chain on Device B's stream gets fully rebuilt when `upgradeOwnStreamIfNeeded()` runs (same logic as the initial migration). Verify the `seq` field is preserved — `loadAndMerge` doesn't care about `seq`, but external tooling might.

5. **Atomic write.** FSA has no atomic rename. `atomicReplaceStream` writes `.tmp` then writes real then deletes `.tmp`. If a crash hits between the .tmp write and the real-file write, the next unlock cleans up the leftover .tmp (good). If a crash hits between real-file write and removeEntry, the .tmp lingers (cleaned up next unlock too). Verify by killing the tab during a migration.

6. **PRF output type.** `assertion.getClientExtensionResults().prf.results.first` is documented as `ArrayBuffer` but some Safari builds return `Uint8Array` directly. I wrap with `new Uint8Array(prfRes)` which handles both. Confirm with the YubiKey on Safari 18.

7. **`metaDevices()` / `metaSetDevices()` divergence.** v1 uses `meta.devices`, v2 uses `meta.device_roster`. `registerDevice` for v2 pushes into `meta.device_roster` directly (not via `metaSetDevices`). Audit once that all device-list reads use `metaDevices(meta)` and all writes go to the right key.

## Known scope gaps (call out before shipping or defer to v1.2)

- **Register-new-device on a hw-key-only v2 vault** (i.e. `pw_wrap.enabled === false`) is currently impossible from the register screen — the user must enable fallback from an already-unlocked device first, then register the new device, then disable fallback again. Spec doesn't explicitly cover this. Add a "Register with hardware key" path on the register screen if needed.

- **Partial rewrap with stale keys on Change Password** — deferred per spec.

- **CSP divergence from handoff** — handoff prescribes `script-src 'self' 'wasm-unsafe-eval'`, but `'self'` does not allow inline scripts (CSP spec) and there's no build step. Shipping with `'unsafe-inline' 'wasm-unsafe-eval'`. Spec author should re-read CSP semantics and amend the spec.

## After all green

- Update `<meta name="version" content="1.1.0">` if needed (already done in commit 1)
- Tag the release on GitHub with the SHA-256 of `index.html`
- Delete this file: `git rm TESTING-NOTES-v1.1.md && git commit -m "remove v1.1 testing notes"`
