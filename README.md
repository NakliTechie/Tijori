# Tijori

&#x26AB; **Try it now &rarr; https://tijori.naklitechie.com/**
&#x1F4D6; **Guide &rarr; https://tijori.naklitechie.com/guide/** · **How it works &rarr; [ARCHITECTURE.md](ARCHITECTURE.md)**

**A password vault in one HTML file.** No install, no account, no server. Your vault is a folder on your disk — or, inside [NakliOS](https://naklios.dev), an app-scoped Folder or encrypted Crate.

## What it does

- **Logins, cards, notes, TOTP / HOTP codes**, and **file attachments** (recovery sheets, scanned IDs, keys)
- **Argon2id** key derivation; optional **hardware-key second factor** (any FIDO2 / WebAuthn authenticator)
- Vault is an **append-only, hash-chained event log** — one file per device, merged deterministically, never a conflict
- **Sync your way**: a cloud folder, Syncthing, Git, USB; **QR flash** between two screens with no network at all; or **directly over LAN / hotspot** with no server in between
- **Leave any time**: export to KeePass `.kdbx` (full fidelity, attachments included) or Bitwarden-style CSV; import from Bitwarden, Chrome, 1Password, CSV, `otpauth://`
- Multi-vault picker, local vault audit, clipboard auto-clear, idle lock, brute-force backoff, password generator

## What it isn't

- **No server, no account, no telemetry.** After page load it makes no network request of any kind — the browser enforces it (`connect-src 'none'`).
- **No recovery.** Forget the master password and the vault is gone. Back up.
- **No built-in sync service.** Sync is your transport; Tijori merges what it finds.
- **No biometric-only unlock.** A hardware key is always a *second* factor; the password is always required.

## Quick start

1. Open `index.html` in Chrome, Edge or Firefox (desktop) or Safari 16.4+ / Chrome (iOS). Desktop keeps the vault in a folder you pick; mobile keeps it in browser storage.
2. **Create new vault** → choose a folder → set a device name and master password.
3. **＋ Add** → Login, Card, Note or TOTP. Attach files from a saved entry.
4. **Back up**: Settings → Data → Export encrypted archive. On mobile this is essential — clearing site data wipes the vault.
5. **Second device**: share the folder, or Settings → Data → **Send vault via QR** / **Send over LAN**, then Import on the other device.

## Browser support

Desktop Chrome, Edge, Firefox (folder vault). Safari 16.4+ and Chrome on iOS (browser-storage vault). Hardware keys need Chrome / Edge 116+ or Safari 18+. QR and LAN sync need `BarcodeDetector` (Chrome, Safari 17+).

## Verifying what you run

Every release publishes the SHA-256 of `index.html`. `shasum -a 256 index.html` and compare. Open DevTools → Network, reload: nothing fetches after the document.

## License

MIT. See [`LICENSE`](LICENSE).

---

Part of the [NakliTechie](https://naklitechie.github.io/) series — single-file, browser-native, no-backend tools.
