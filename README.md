# Tijori

&#x26AB; **Try it now &rarr; https://tijori.naklitechie.com/**
&#x1F4D6; **Guide &amp; trust notes &rarr; https://tijori.naklitechie.com/guide/**

**A password vault in one HTML file.**

No install, no account, no dedicated Tijori server.
Standalone, your vault is a folder. Inside NakliOS, it can use the app-scoped
Folder or encrypted Crate backend through `naklios.fs`.
Optional hardware-key second factor via WebAuthn PRF.

---

## What it does

- **Login, Card, Note, TOTP** entries; built-in RFC 6238/4226 engine (SHA-1/256/512, 6–8 digits, HOTP counters)
- **Attachments** (v1.4) — recovery sheets, scanned IDs, SSH keys on any entry; each file encrypted with its own derived key, previewed in memory, up to 50 MB
- **Argon2id** key derivation; **optional hardware-key second factor** (any FIDO2 / WebAuthn authenticator via PRF, multiple keys per vault)
- Vault is an **append-only, hash-chained event log**, one `.jsonl` per device; per-field last-writer-wins merge — deterministic, conflict-free, order-independent
- **Sync by any file transport** (cloud folder, Syncthing, Git, USB), by **QR flash** (fountain-coded, air-gapped), or **directly over LAN / hotspot** (WebRTC, host candidates only). Same archive bootstraps an empty device or updates an existing one
- **NakliOS storage** — the same vault format under an app-scoped Folder or encrypted Crate backend; standalone FSA / OPFS unchanged
- **Multi-vault picker**, **local vault audit** (reused / weak / aging / missing-2FA, no network), device revocation
- **Export** to KeePass `.kdbx` (full fidelity, attachments included) or Bitwarden-style CSV; **import** from Bitwarden, Chrome/Edge, 1Password, generic CSV, `otpauth://`
- Clipboard auto-clear, idle lock, lock-on-hide, brute-force backoff, password generator + entropy meter

## Hardware key support

[#hardware-key-support](#hardware-key-support)

Tijori supports any WebAuthn authenticator that implements the PRF extension as a **second factor** alongside the master password. The hardware-derived secret is mixed into the vault key — neither factor alone unlocks anything.

Tested authenticators:

- YubiKey 5 series (USB, NFC) on Chrome, Edge, Safari
- Touch ID on macOS Safari 18+
- iCloud-synced passkeys on iOS 18+ / Safari 18+
- Android passkeys synced via Google Password Manager
- Hardware-bound Windows Hello platform credentials

**Bind two keys.** A single bound key with no fallback is a single point of failure. Tijori nags you until you either register a second key or explicitly enable the password-only fallback. Don't lock yourself out.

**Requirements:** Chrome 116+, Edge 116+, or Safari 18+. Firefox does not yet ship PRF in stable. Tijori falls back to password-only on browsers without PRF support. Hardware-key binding also requires Tijori served over HTTPS or localhost — the "Save Page As" deployment mode loses this feature (vault still works, just no hardware-key option).

Hardware credentials are origin-bound. A key registered at
`tijori.naklitechie.com` cannot unlock the mirrored app at `naklios.dev`.
Tijori therefore refuses to import a hardware-key-only vault into NakliOS
storage. Enable password-only fallback in the standalone app first, import,
unlock with the password at `naklios.dev`, and bind a new key there.

## NakliOS storage

When Tijori is hosted at `naklios.dev/apps/tijori/` and a NakliOS Folder or
Crate backend is connected, `Create new vault` and `Open NakliOS vault` use the
app-scoped `naklios.fs` namespace. The host limits Tijori to
`apps/tijori/`; Tijori cannot read another app's data.

From an unlock or device-registration screen, **Different folder or Crate**
opens a location picker. A connected Crate appears by name as **Mounted
Crate**; a NakliOS Folder and a directly opened local folder remain distinct
locations. NakliOS confirms any backend rebind. Switching alone never copies
or deletes vault data, and Tijori remembers hosted vaults separately per
backend.

Import copies only `tijori-meta.json` and the encrypted
`tijori-events-*.jsonl` streams. It leaves the source folder untouched,
writes metadata last as a commit marker, and cleans up files if a copy fails.
The vault format is unchanged.

Tijori's own Content Security Policy still uses `connect-src 'none'`.
When Crate is selected, NakliOS performs the storage transport outside the
Tijori iframe; Tijori communicates with its same-origin host using
`postMessage`.

## The vault outlives the tool

Your vault is yours. Three ways to leave Tijori without losing data:

- **KeePass (`.kdbx`)** — full-fidelity snapshot in KDBX4 (ChaCha20 + Argon2id). Readable by KeePassXC (desktop), KeePassium (iOS), KeePassDX (Android), Strongbox (iOS/Mac), KeeWeb, MacPass, and any other KeePass-compatible client. *Settings → Data → Export to KeePass.* Recommended pattern: Tijori as the canonical desktop editor, KeePass apps as read-only mobile clients.
- **CSV (Bitwarden-compatible)** — for migrating into Bitwarden, 1Password, Apple Passwords, Dashlane, NordPass, etc. Plaintext, lossy on cards / notes (flattened into the Notes column), but importable everywhere. *Settings → Data → Export as CSV.*
- **Encrypted archive (`.tijori`)** — Tijori's own format, for moving between Tijori instances. *Settings → Data → Export encrypted archive.*

## What it deliberately isn't

- **No dedicated Tijori server.** Standalone vault files never leave the
  folder you choose. In hosted mode, storage goes only to the NakliOS backend
  you explicitly grant to Tijori.
- **No account.** There is nothing to log in to.
- **No recovery.** Forget the master password and your vault is gone. Back up.
- **No telemetry, no analytics, no network requests of any kind after page load.**
- **No framework, no build step.** One HTML file. Open it in a text editor, read every line.
- **No sync built in.** Sync is your transport choice — Tijori just merges what it finds.
- **No biometric-only unlock.** Touch ID and Windows Hello can be bound as hardware factors, but the master password is always also required.
- **No passkey-as-the-only-credential.** WebAuthn is a second factor. A lost key with no backup and no password-only fallback means a lost vault — by design, no recovery service exists.
- **No telemetry from WebAuthn flows.** Browser API calls into your authenticator are not network requests. We don't and can't log them.

## How it works

| Concern | Solution |
|---|---|
| KDF (v2 vaults) | Argon2id, m=64MB, t=3, p=4 (inlined WASM, no CDN) |
| KDF (v1 vaults) | PBKDF2-SHA-256, 600,000 iterations (legacy; still readable forever) |
| Per-event encryption | AES-256-GCM, random 12-byte nonce |
| Hardware-key binding | WebAuthn PRF extension (HKDF-mix into wrap key). Multiple keys per vault. Synced platform passkeys supported (with caveats — see guide). |
| Key combiner | HKDF-SHA-256 over `(pw_key XOR prf_secret)`, domain-separated info strings, master_secret wrapped per bound key |
| Hash chain | SHA-256 over previous raw event-line string; `genesis` for first |
| Merge | Union all device streams, sort by `(ts, device_id)`, per-field last-writer-wins |
| TOTP | RFC 6238 — WebCrypto `HMAC-SHA-{1,256,512}`, base32 inline (~25 lines) |
| Attachments | One opaque file per attachment: `tijori-attachments/<id>.bin` = nonce ‖ AES-256-GCM, key `HKDF(master_secret, "tijori-v2", "attachment-key:<id>")`, AAD = id. Name / type / size / ciphertext SHA-256 live only in the encrypted `attachment_added` event; removal is a tombstone. A missing blob is a normal *pending* state. User-run GC deletes only tombstoned or deleted-entry blobs. v2 vaults only. |
| Storage | Standalone: `FileSystemDirectoryHandle` on desktop, OPFS fallback on iOS/mobile. Hosted: app-scoped `naklios.fs` over a user-selected NakliOS Folder or encrypted Crate backend. |
| Reconnect | FSA handle persisted in IndexedDB (permission re-requested on next visit); OPFS vault name persisted (reconnects silently) |
| QR flash | `TJ3` frames: a systematic LT fountain code — the K blocks in order, then endless PRNG-mixed repair frames, so a missed frame costs one frame, not a lap. Header + base45 payload (RFC 9285) = one alphanumeric segment at EC-L; frame size selectable up to v40. Blobs up to 64 KB ride along; larger ones are withheld and named. Nayuki qrcodegen inlined; receiver decodes in a worker via `BarcodeDetector`. `TJ2` / `TJ1` senders still accepted. |
| LAN / hotspot | WebRTC DataChannel, `iceServers: []`, host candidates only — no STUN, TURN, relay or signaling server. Offer and answer each travel as one static QR (`TL1`); the DTLS fingerprint in it authenticates the peer, a 6-digit code is HMAC-checked over both fingerprints before any data. After connect `getStats()` must show host↔host or both sides refuse. Carries every blob. Fails closed to QR, never to a third party. |
| Dependencies | **Zero** at runtime. `jsqr` is dev-only, for the CI render check. |
| Build step | **None** |

## Vault format

```
vault-folder/
  tijori-meta.json                   — plaintext: KDF params, device roster
  tijori-events-<deviceId>.jsonl     — one per device, append-only, hash-chained
  tijori-attachments/<id>.bin        — v1.4: one opaque encrypted file per attachment
```

Each event line:

```json
{
  "seq": 3,
  "prev_hash": "<sha256-of-previous-line>",
  "ts": "2026-04-24T10:22:31.000Z",
  "device_id": "abc123…",
  "event_type": "entry_created",
  "payload_ct": "<base64-aes-gcm-ciphertext>",
  "nonce": "<base64-12-byte-nonce>"
}
```

`payload_ct` is AES-256-GCM ciphertext of the entry payload (JSON). `prev_hash` is SHA-256 of the preceding raw line string. Tampering any byte breaks the chain — verifiable from **Settings → Vault → Verify log integrity**.

Event types: `device_registered`, `device_revoked`, `entry_created`, `entry_updated`, `entry_deleted`, `attachment_added`, `attachment_removed`, plus key-binding and format-upgrade events. A build that meets an event type it does not know skips it and says how many it skipped.

## Usage

1. Open `index.html` in Chrome, Edge, Firefox (desktop) or Safari 16.4+ / iOS. Desktop uses the File System Access API; mobile falls back to Origin Private File System (OPFS). When opened inside NakliOS, **Different folder or Crate** can switch between a connected hosted backend and a directly opened local folder.
2. **Create new vault** → pick an empty folder (desktop) or name a browser vault (mobile) → set a device name and master password.
3. **＋ Add** → choose Login, Card, Note, or Code.
   - For TOTP codes: paste an `otpauth://` URI to auto-fill, or enter the Base32 secret manually.
4. Switch to the **Codes** tab to see rotating codes with countdown rings.
5. **Back up regularly.** Settings → Data → Export encrypted archive → store the `.tijori` file somewhere safe (a cloud folder is fine — it is AES-encrypted with your master password). On mobile (OPFS) this is critical: clearing site data wipes the vault.
6. **Add a second device** — two ways:
   - **Share the folder** (desktop only). Open the same vault folder from the new browser, enter the master password, device registers itself.
   - **QR flash** (any device, including iPhone). On the source: Settings → Data → Send vault via QR. On the receiver: Import → QR sequence → point the camera at the screen. Works for both first-time setup and periodic updates.

## Sync

Each device writes only its own `.jsonl` file. Sync is whatever moves files between devices — Tijori never implements a sync protocol, it just merges what it finds. On import, events are deduped by `(device_id, seq)` and appended, so **the same archive is both a full bootstrap and an incremental update**: an empty vault receives everything, an existing vault receives only what it's missing.

### QR flash — air-gapped

**Settings → Data → Send vault via QR** on the source, **Import → QR sequence** on the receiver. The sender streams fountain-coded frames (pick a frame size: bigger moves more per flash, smaller suits a shaky camera); the receiver can start at any point and never waits for a loop. Two phones in airplane mode can bootstrap or update each other. Files up to 64 KB ride along; larger ones arrive as *not on this device* until a file-carrying transport runs. Needs `BarcodeDetector` (Chrome, Safari 17+).

### LAN / hotspot — direct

**Settings → Data → Send vault over LAN / hotspot**, **Import → LAN / hotspot**. Same wifi, or one device on the other's hotspot. One static QR each way to exchange the handshake, then the archive — attachments included — moves over a WebRTC DataChannel at LAN speed. No STUN, TURN, relay or signaling server; the live path must be host↔host or the transfer is refused; if the devices cannot reach each other it says so and points at QR.

### Other transports

| Transport | Notes |
|---|---|
| Cloud folder (iCloud Drive / Dropbox / Google Drive) | Easiest for continuous multi-device use. Each device's browser points at its local copy. |
| Syncthing | P2P, no cloud vendor. |
| Git | Each device's log is a separate file — `git merge` never produces conflicts on event logs. |
| USB / manual | Export the encrypted `.tijori` archive (attachments included), import on the other device. Same dedup-on-import semantics as QR and LAN. |

## Vault folder — what's safe to do

The vault folder is a **bag of append-only files**. `tijori-meta.json` is plaintext (KDF params, device roster — no secrets). Each device writes only to its own `tijori-events-<deviceId>.jsonl`. On unlock, Tijori reads every `.jsonl` it finds and merges deterministically.

**Mental model:** anything that **adds or duplicates** files is safe. Anything that **shrinks, truncates, edits in place, or replaces a file with an older copy** loses data.

### Safe

- **Sync the folder across devices** via Dropbox, iCloud Drive, Google Drive, Syncthing, or Git. Each device only writes its own log file → no file-level conflicts.
- **Copy the folder to a new device.** On first open, Tijori sees this device isn't in the roster and routes you through device registration. The old device's log keeps merging.
- **Move or rename the folder.** Just re-grant browser permission via "Open vault" → pick the new location.
- **Zip the folder as a backup.** Restoring rewinds you to that point in time.
- **Sync `tijori-attachments/` with the logs, or not.** A blob that arrives before or after its event is fine either way: the entry shows the file as *not on this device* until the bytes land, and a blob nobody references yet is left alone by garbage collection.

### Risky

- **Restoring an old backup over a newer folder** — you lose every event after the snapshot. Restore onto an empty location instead.
- **Using the vault on two devices without sync** — they diverge. Manually copying one over the other loses half the work. Pick one sync transport.
- **Editing a `.jsonl` file by hand** — breaks the SHA-256 hash chain. Tijori excludes that device's events on next unlock with a "Chain integrity failure" toast. Restore the file to recover.
- **Clearing browser data / using a different browser** — the device ID lives in `localStorage`, not the folder. Cleared localStorage → next open registers as a new device. The old log still merges fine, you just get an orphan in the roster (revoke it from Settings → Vault).
- **Hand-copying log files between folders** — works (the merge ingests every `tijori-events-*.jsonl` regardless of roster), but the device roster will lag until a registration event for that device gets merged in.

**One sync mechanism at a time.** Mixing transports (cloud sync *and* USB *and* manual copies) is the most common way users lose data. Pick one and trust it.

See the [in-app guide](https://tijori.naklitechie.com/guide/#living-with-your-vault-folder) for the same content with cards/diagrams.

## Tijori and Rotor

Tijori and [Rotor](https://rotor.naklitechie.com) share the same engine — same event-log format, same crypto, same five sync transports. They differ only in scope: Tijori holds logins, cards, notes, and TOTP codes under one master password; Rotor holds only TOTP codes, ever.

Why both exist: TOTP is a second factor. Combining it with passwords under one master password is convenient, but a breach of that password loses both factors at once. Rotor is the option for users who want strict separation. **Do not point both tools at the same folder** — format is compatible by accident, separation is deliberate by design (Rotor uses `rotor-events-*.jsonl`, Tijori uses `tijori-events-*.jsonl`).

## Browser support

- **Desktop** — Chrome, Edge, Firefox for the full folder-vault experience (File System Access API).
- **Mobile / iOS** — Safari 16.4+, Chrome on iOS. Vault lives in the browser's Origin Private File System (OPFS) instead of a user-visible folder. Export regularly to a desktop vault or via QR flash.

## Verifying what you're running

Every release publishes:

- SHA-256 of `index.html` (on the GitHub Releases page)
- Total line count (in the release notes)
- CSP enforcement is visible in the `<meta http-equiv="Content-Security-Policy">` tag at the top of the file

To verify you're running what the source says you're running:

```
shasum -a 256 path/to/index.html
```

Compare to the published hash for that release. If they don't match, you're running something else.

Network posture (`connect-src 'none'`) is enforceable by the browser. Open DevTools → Network panel, reload Tijori, and observe: nothing fetches after the initial document. Any attempted XHR, fetch, or WebSocket would be blocked and visible in the console.

## License

MIT. See [`LICENSE`](LICENSE).

---

Part of the [NakliTechie](https://naklitechie.github.io/) series — single-file, browser-native, no-backend tools.
