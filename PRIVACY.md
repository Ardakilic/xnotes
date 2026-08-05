# Privacy Policy — xNotes

**Last updated:** 2026-08-04

## What we collect

Nothing. xNotes has no analytics, no telemetry, no crash reporting, no third-party SDKs, and no servers of our own.

## Where your data goes

- **By default, nowhere.** All notes are stored locally in your browser's extension storage (`browser.storage.local`) on your device.
- **Only if you configure sync**, your notes are uploaded to a storage backend that **you** provide and control (a WebDAV server or an S3-compatible bucket). We never operate, see, or have access to that backend.
- **If you enable encryption**, notes are encrypted on your device (AES-256-GCM with a key derived from your passphrase) before upload. The backend only ever stores opaque ciphertext.

## Permissions

- `storage` — to save your notes locally.
- `alarms` — to schedule sync cycles.
- Site access to `x.com`/`twitter.com` — to show the note panel on profile pages. Granted by you, revocable at any time; the extension works without it (the all-notes page remains fully functional).
- Access to other sites is requested **only** when you configure a sync backend, and only for that backend's origin.

## Credentials

Backend credentials are stored in local extension storage so sync can run unattended. Browser extension storage is not encrypted at rest — use scoped credentials (dedicated users, single-bucket application keys).

## Contact

For questions about this policy, open an issue on the project repository.
