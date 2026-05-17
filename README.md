# Tijori

&#x26AB; **Try it now &rarr; https://tijori.naklitechie.com/**
&#x1F4D6; **Guide &amp; trust notes &rarr; https://tijori.naklitechie.com/guide/**

**A password vault in one HTML file.**

No install, no account, no server, no sync service.
Your vault is a folder. Move the folder and your vault moves with it.
Optional hardware-key second factor via WebAuthn PRF.

---

## What it does

- Stores **Login**, **Card**, **Note**, and **TOTP Code** entries
- **Optional hardware-key second factor** — bind any FIDO2 / WebAuthn authenticator (YubiKey, Titan, Solo, Touch ID, iCloud passkey, Android passkey) via the PRF extension. Hardware-derived secret mixed into the key derivation; **both** master password and key required to unlock. Multiple keys per vault for backup-key safety.
- **Argon2id key derivation** for new vaults (memory-hard, GPU-resistant). Existing PBKDF2 vaults migrate on next save; both formats remain readable.
- Every entry is individually encrypted: AES-256-GCM with a random 12-byte nonce
- Key derived via PBKDF2-SHA-256, 600,000 iterations (OWASP 2023 level)
- Vault format is an **append-only event log** — one `.jsonl` file per device, SHA-256 hash-chained
- **Air-gapped sync via QR flash** — beam the encrypted vault to another device as a stream of animated QR codes. No cable, no Wi-Fi, no cloud, no account. Works for both **first-time bootstrap** (empty receiving vault) and **ongoing updates** (existing vault merges new events only — dedupes by `device_id:seq`)
- **Multi-device sync** by any file transport: cloud folder, Syncthing, Git, USB, encrypted archive, or QR flash — same deterministic merge, same file format
- Per-field last-writer-wins merge — deterministic, no conflicts, works with events arriving out of order
- Device revocation (soft — skips future events from the revoked device on merge)
- Built-in TOTP engine (RFC 6238): SHA-1/256/512, 6/7/8 digits, 30s/60s, countdown rings, next-code preview
- Import from Bitwarden, Chrome/Edge CSV, 1Password CSV, generic CSV, or `otpauth://` URIs
- Export as encrypted `.tijori` archive or plaintext JSON
- Clipboard auto-clears, idle lock, lock-on-tab-hide
- Password generator + entropy estimator

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

## What it deliberately isn't

- **No server.** Vault files never leave the folder you choose.
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
| Storage | `FileSystemDirectoryHandle` — File System Access API on desktop, Origin Private File System (OPFS) fallback on iOS / mobile |
| Reconnect | FSA handle persisted in IndexedDB (permission re-requested on next visit); OPFS vault name persisted (reconnects silently) |
| QR flash | Archive chunked into `TJ1|total|index|b64` frames, Nayuki qrcodegen inlined, receiver via `BarcodeDetector` API. Out-of-order and duplicate frames are fine; receiver waits for all indices. |
| Dependencies | **Zero** |
| Build step | **None** |

## Vault format

```
vault-folder/
  tijori-meta.json                   — plaintext: KDF params, device roster
  tijori-events-<deviceId>.jsonl     — one per device, append-only, hash-chained
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

Event types: `device_registered`, `device_revoked`, `entry_created`, `entry_updated`, `entry_deleted`.

## Usage

1. Open `index.html` in Chrome, Edge, Firefox (desktop) or Safari 16.4+ / iOS. Desktop uses the File System Access API; mobile falls back to Origin Private File System (OPFS).
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

### Air-gapped sync — QR flash

The transport worth calling out: **Settings → Data → Send vault via QR**. Tijori builds the full encrypted archive in memory, chunks it into `TJ1|total|index|b64` frames, and loops an animated QR animation on screen. On the receiving device (Import → QR sequence), the camera picks up frames with `BarcodeDetector`, and a grid of dots fills in as each chunk arrives. Out-of-order and duplicate frames are normal — the receiver waits for all indices, reassembles, decrypts, and merges.

Use it for:

- **First-time bootstrap** — pair a fresh device with no other infrastructure. Two phones in airplane mode can sync.
- **Periodic updates** — after changes on device A, re-send. Device B's existing events are deduped; only the new ones are appended.
- **Air-gapped environments** — no cloud vendor, no P2P software, no cables. Just two screens and a camera.

Supported where `BarcodeDetector` is available (Chrome, Safari 17+).

### Other transports

| Transport | Notes |
|---|---|
| Cloud folder (iCloud Drive / Dropbox / Google Drive) | Easiest for continuous multi-device use. Each device's browser points at its local copy. |
| Syncthing | P2P, no cloud vendor. |
| Git | Each device's log is a separate file — `git merge` never produces conflicts on event logs. |
| USB / manual | Export encrypted archive, import on other device. Same `.tijori` file, same dedup-on-import semantics as QR. |

## Tijori and Rotor

Tijori and [Rotor](https://rotor.naklitechie.com) share the same engine — same event-log format, same crypto, same five sync transports. They differ only in scope: Tijori holds logins, cards, notes, and TOTP codes under one master password; Rotor holds only TOTP codes, ever.

Why both exist: TOTP is a second factor. Combining it with passwords under one master password is convenient, but a breach of that password loses both factors at once. Rotor is the option for users who want strict separation. **Do not point both tools at the same folder** — format is compatible by accident, separation is deliberate by design (Rotor uses `rotor-events-*.jsonl`, Tijori uses `tijori-events-*.jsonl`).

## Browser support

- **Desktop** — Chrome, Edge, Firefox for the full folder-vault experience (File System Access API).
- **Mobile / iOS** — Safari 16.4+, Chrome on iOS. Vault lives in the browser's Origin Private File System (OPFS) instead of a user-visible folder. Export regularly to a desktop vault or via QR flash.

## Verifying what you're running

[#verifying-what-youre-running](#verifying-what-youre-running)

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
