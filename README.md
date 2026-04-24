# Tijori

&#x26AB; **Try it now &rarr; https://tijori.naklitechie.com/**

**A password vault in one HTML file.**

No install, no account, no server, no sync service.
Your vault is a folder. Move the folder and your vault moves with it.

---

## What it does

- Stores **Login**, **Card**, **Note**, and **TOTP Code** entries
- Every entry is individually encrypted: AES-256-GCM with a random 12-byte nonce
- Key derived via PBKDF2-SHA-256, 600,000 iterations (OWASP 2023 level)
- Vault format is an **append-only event log** — one `.jsonl` file per device, SHA-256 hash-chained
- **Multi-device sync** by any transport: cloud folder, Syncthing, Git, USB, encrypted archive export, or **QR sequence** (animated QR, no cable or network required)
- Per-field last-writer-wins merge — deterministic, no conflicts, works with files arriving out of order
- Device revocation without re-encrypting the vault
- Built-in TOTP engine (RFC 6238): SHA-1/256/512, 6/7/8 digits, 30s/60s, countdown rings, next-code preview
- Import from Bitwarden, Chrome/Edge CSV, 1Password CSV, generic CSV, or `otpauth://` URIs
- Export as encrypted `.tijori` archive or plaintext JSON
- Clipboard auto-clears, idle lock, lock-on-tab-hide
- Password generator + entropy estimator

## What it deliberately isn't

- **No server.** Vault files never leave the folder you choose.
- **No account.** There is nothing to log in to.
- **No recovery.** Forget the master password and your vault is gone. Back up.
- **No telemetry, no analytics, no network requests of any kind after page load.**
- **No framework, no build step.** One HTML file. Open it in a text editor, read every line.
- **No sync built in.** Sync is your transport choice — Tijori just merges what it finds.

## How it works

| Concern | Solution |
|---|---|
| KDF | PBKDF2-SHA-256, 600,000 iterations |
| Per-event encryption | AES-256-GCM, random 12-byte nonce |
| Hash chain | SHA-256 over previous raw event-line string; `genesis` for first |
| Merge | Union all device streams, sort by `(ts, device_id)`, per-field last-writer-wins |
| TOTP | RFC 6238 — WebCrypto `HMAC-SHA-{1,256,512}`, base32 inline (~25 lines) |
| Storage | `FileSystemDirectoryHandle` (File System Access API) |
| Reconnect | Handle persisted in IndexedDB; permission re-requested on next visit |
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

1. Open `index.html` in Chrome or Edge (File System Access API required; Firefox: not yet).
2. **Create new vault** → pick an empty folder → set a device name and master password.
3. **＋ Add** → choose Login, Card, Note, or Code.
   - For TOTP codes: paste an `otpauth://` URI to auto-fill, or enter the Base32 secret manually.
4. Switch to the **Codes** tab to see rotating codes with countdown rings.
5. **Back up regularly.** Settings → Data → Export encrypted archive → store the `.tijori` file somewhere safe (a cloud folder is fine — it is AES-encrypted with your master password).
6. **Second device:** open the same vault folder from the new browser, enter the master password, and the device registers itself automatically.

## Sync

Each device writes only its own `.jsonl` file. Sync is whatever moves files between devices:

| Transport | Notes |
|---|---|
| Cloud folder (iCloud Drive / Dropbox / Google Drive) | Easiest. Each device's browser points at its local copy. |
| Syncthing | P2P, no cloud. |
| Git | Each device's log is a separate file — `git merge` never produces conflicts on event logs. |
| USB / manual | Export encrypted archive, import on other device. |
| **QR sequence** | Settings → Data → Send vault via QR. The archive is chunked into TJ1 frames and displayed as a looping QR animation. Scan with the receiving device's camera — no cable, no Wi-Fi, no account. |

## TOTP and Rotor

Tijori absorbs the scope of [Rotor](https://rotor.naklitechie.com), the standalone TOTP authenticator in this series. Rotor stays live at its URL, frozen, for users who want a single-purpose tool. Tijori is for users who want passwords and codes together under one master password. If you want strict separation, run both against different folders with different master passwords.

## Browser support

Chrome and Edge — the File System Access API is required to read and write vault files. Firefox and Safari do not support `showDirectoryPicker` yet.

## License

MIT. See [`LICENSE`](LICENSE).

---

Part of the [NakliTechie](https://naklitechie.github.io/) series — single-file, browser-native, no-backend tools.
