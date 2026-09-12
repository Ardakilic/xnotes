# Privacy Policy — xNotes

**Last updated:** 2026-09-12

xNotes is a browser extension. This policy describes what the extension does with data, and what the developer can see. Short version: nothing, and nothing.

## What the developer collects

Nothing. There is no telemetry, no analytics, no crash reports, no ads, no trackers, no third-party SDKs, and no developer-operated servers. The extension has no accounts and no sign-in. The developer has no access to your notes, your sync backend, or any data about you.

## Where your data is stored

On your device. Notes and settings live in the browser's local extension storage (`browser.storage.local`). They never leave your machine unless you configure sync.

## Network access

The only network requests xNotes can ever make go to a sync backend **you yourself configure** — your own WebDAV or S3-compatible server. No other network traffic exists.

With encryption enabled, your notes are encrypted on your device (AES-256-GCM, key derived from your passphrase) before upload; the backend only stores opaque ciphertext that neither the backend nor the developer can read.

## Credentials

Sync credentials are stored in local extension storage so sync can run unattended. Browser extension storage is not encrypted at rest — use scoped credentials (dedicated users, single-bucket application keys).

## Permissions

- `storage` — save your notes and settings locally.
- `alarms` — schedule the optional sync to your own backend.
- Site access to `x.com`/`twitter.com` — show the notes panel and avatar badges on profile pages; reads only the profile handle. Granted by you, revocable at any time; the extension works without it.
- Access to any other origin is requested only when you configure a sync backend, and only for that backend's origin.

## Contact

Questions about this policy: open an issue on the project repository (https://github.com/Ardakilic/xnotes).
