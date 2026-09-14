# xNotes

Private notes for X/Twitter profiles. Local-first, with optional end-to-end encrypted sync to your own WebDAV or S3-compatible storage.

**Install:** [Chrome Web Store](https://chromewebstore.google.com/detail/xnotes/nlenfommikpdnafaahmbpnkljokjobdj) · Firefox version under review.

- Notes are keyed by profile handle and shown right on X profile pages, with 11 color labels and avatar badges.
- Everything works offline. Sync is an opt-in upgrade to a backend **you** control (dumb storage + client-side merge, floccus-style). No server-side code of ours exists anywhere.
- One codebase builds both Chromium MV3 (`background.service_worker`) and Firefox/Gecko MV3 (`background.scripts` event page).
- No telemetry. Notes never leave your machine unless you configure a backend. See [privacy_policy.md](privacy_policy.md).

## Features

- **Panel on profiles** — add/view/edit a note directly under the profile header on `x.com`/`twitter.com`; survives SPA navigation; adapts to X's light/dark theme.
- **Color labels** — 11 palette colors (stored as keys, rendered from CSS) shown as panel accent and avatar badge.
- **Avatar badges + hover cards** — noted users get a colored dot on their avatar; hovering shows the note excerpt.
- **All-notes manager** — search, multi-color filter, table/card views, inline edit, delete-with-confirm, JSON export/import (imports merge through the same algorithm as sync).
- **Sync** — WebDAV and S3-compatible backends, optimistic concurrency with conflict retry, periodic + on-edit + manual triggers.
- **End-to-end encryption** — AES-256-GCM envelope with PBKDF2-SHA-256 (600,000 iterations); the backend only ever sees opaque bytes.

## Getting started

### Prerequisites

- `make` and Docker. Nothing else — no Node.js, no npm on your machine. Every workflow runs inside a pinned `node:22-bookworm-slim` container.

### 1. Build the extension

```sh
git clone <this repo> && cd xnotes
make setup   # install pinned dependencies (in Docker)
make build   # produces .output/chrome-mv3/ and .output/firefox-mv3/
```

### 2. Load it in your browser

**Chrome / Brave / Edge / any Chromium:**

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `.output/chrome-mv3` folder.

**Firefox / Zen / LibreWolf / Floorp:**

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `.output/firefox-mv3/manifest.json`.

(For permanent installs use the store zips from `make zip` — see [Store packaging](#store-packaging).)

### 3. Grant site access (both engines)

MV3 host permissions can be withheld by default on **both** engines. If notes don't appear on profiles, xNotes shows an onboarding banner (in the popup and the all-notes page) with a **Grant access** button — click it and approve. The manager and sync settings work regardless of this grant; only on-profile injection needs it.

### 4. Use it

- Open any X profile (e.g. `https://x.com/jack`) — the panel appears under the name header. **Add note**, type, pick a color, **Save** (Enter saves, Shift+Enter adds a newline).
- Toolbar icon → **All notes** opens the manager page (search, filter, edit, export/import).
- Deleting a note writes a tombstone, so sync never resurrects it.

## Sync setup

xNotes syncs one opaque blob (`notes.json`) with optimistic concurrency; the client does pull → merge → push. Configure it on the options page under **Sync settings**. The extension is fully usable without any backend.

### WebDAV — dufs (reference server)

[dufs](https://github.com/sigoden/dufs) ≥ 0.42.0:

```sh
dufs -a 'myuser:mypassword@/:rw' --allow-all -p 5244 ~/xnotes-dav
```

Enter the endpoint (HTTPS required — HTTP endpoints are rejected because credentials and notes would travel in plain text; reverse-proxy your LAN dufs with TLS), username, and password. The folder is created on first sync. Use **Test connection** before saving.

### S3-compatible

Endpoint, region, bucket, key prefix, access/secret keys, plus:

- **Path-style URLs** — enable for self-hosted endpoints.
- **Provider lacks conditional writes** — enable for Backblaze B2 (uses the HEAD-compare fallback).

Use **scoped credentials** (single-bucket application keys).

### Encryption

Toggle encryption and choose a passphrase before the first sync when the backend is hosted anywhere you do not fully trust. The blob is wrapped in an envelope (AES-256-GCM, PBKDF2-SHA-256, 600,000 iterations, fresh salt+IV per upload) — the backend only ever sees opaque bytes.

**Passphrase handling:** the passphrase is never persisted. It is held in the background's memory only, so after a browser restart you must re-enter it in the popup before encrypted sync resumes (the sync status tells you when this is needed). Changing the passphrase just means entering a new one and saving — the local store is the plaintext source of truth and the next sync re-encrypts.

**Mode mismatch is loud, not silent:** if the remote blob is encrypted while local encryption is off (or vice versa), sync stops with an explicit error and asks you to resolve it, rather than overwriting anything.

## Development — Docker only

The host needs **only `make` + Docker**. One pinned image runs every workflow; npm downloads are cached in a Docker volume. On Linux hosts containers run as your UID/GID, so generated files stay yours.

```sh
make setup        # install dependencies (npm ci)
make typecheck    # tsc --noEmit
make lint         # eslint + prettier --check
make test         # unit tests (vitest)
make integration  # dockerized integration tests (real dufs + S3 mock via compose)
make build        # chrome + firefox production builds
make zip          # store-ready zips (the firefox zip gets a sources zip automatically)
make dev          # chromium dev build with reload; load .output/chrome-mv3 as unpacked
make dev-firefox  # firefox dev build; load .output/firefox-mv3
```

CI (GitHub Actions, `ubuntu-latest`) runs the exact same Makefile targets — a green CI implies a green local `make`. See [AGENTS.md](AGENTS.md) for the conventions LLM agents must follow in this repo.

### Layout

```
entrypoints/   background (sync scheduler), content (panel/badges), options (manager+settings), popup
src/core/      types, storage (single write path), profile parser, colors, filters, import/export
src/sync/      merge, scheduler, adapters (webdav, s3), sigv4, crypto, settings validation
src/ui/        panel, badges, SPA-nav, theme detection
tests/integration/   run against real servers via docker/compose.integration.yml
demo/          standalone Vite page (storage shim over localStorage) for UI iteration
```

## Security caveats (read these)

- **Credentials at rest:** backend credentials live in `browser.storage.local`, which is **not encrypted at rest**. Mitigate with scoped credentials (dedicated WebDAV user, single-bucket app keys). Encrypting the blob itself is independent of this.
- **Tombstone GC:** deletes are tombstoned and tombstones are garbage-collected after **90 days**. A device offline for more than 90 days could resurrect a deleted note when it rejoins.
- **Handle renames:** notes are keyed by handle. If a user renames their handle, the note orphans (documented limitation; schema-v3 user-ID keying is the escape hatch).
- **HEAD→PUT race:** servers without conditional-write support (Backblaze B2, dufs on the write path, adobe/s3mock) are guarded by a HEAD-compare precheck. A tiny HEAD→PUT race window remains; worst case is one extra merge cycle — the merge is commutative, idempotent and lossless, so no data loss.
- **Mode mismatch:** if remote data is encrypted and local encryption is off (or vice versa), sync stops with an explicit error instead of silently overwriting anything.

## Backend compatibility

| Backend       | Status                      | Mechanism                                                                                                                                                                                                                                                                     |
| ------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dufs ≥ 0.42.0 | ✅ integration-tested       | ETag/`If-None-Match` on GET; HEAD-compare precheck guards writes (dufs ignores `If-Match` on PUT — verified empirically against v0.46.0; PUT responses also carry no ETag, so the adapter fetches it via HEAD). Concurrent multi-device sync NOT safe (HEAD-compare fallback) |
| Nextcloud     | ✅ verified 2026-09-12      | `If-Match` on PUT empirically verified honored (stale etag → 412) — conditional writes work natively                                                                                                                                                                          |
| Cloudflare R2 | ✅ verified 2026-09-12      | conditional writes supported natively; conflict resolution verified (two devices pushing concurrently)                                                                                                                                                                        |
| Backblaze B2  | ✅ verified 2026-09-12      | no documented conditional writes → HEAD-compare fallback (set "provider lacks conditional writes"); concurrent multi-device sync NOT supported — single-device or sequential multi-device use only                                                                            |
| adobe/s3mock  | ✅ integration test fixture | ignores `If-Match` on PUT like B2 — exercises the fallback path                                                                                                                                                                                                               |

## Testing

Unit tests (vitest) cover the merge algorithm, storage validation, profile parser, adapters, SigV4, crypto, scheduler, and UI logic; integration tests run against a real dufs container and an S3 mock via Docker Compose.

```sh
make test          # 200+ unit tests
make integration   # dufs + s3mock round-trips, conflicts, encrypted blob opacity
```

### Test map (spec requirement → suite)

| Spec "Mandatory automated tests" requirement | Suite(s)                                                                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| notes-storage                                | `src/core/storage.test.ts`, `src/core/import-export.test.ts`                                                                                 |
| profile-notes-ui                             | `src/core/profile.test.ts`, `src/ui/nav.test.ts`, `src/ui/panel.test.ts`, `src/ui/badges.test.ts`, `src/core/theme.test.ts`                  |
| notes-manager                                | `src/core/filters.test.ts`, `entrypoints/options/manager.test.ts`, `entrypoints/options/settings.test.ts`                                    |
| sync-engine (merge)                          | `src/sync/merge.test.ts`                                                                                                                     |
| sync-engine (scheduler)                      | `src/sync/scheduler.test.ts`                                                                                                                 |
| sync-backends                                | `src/sync/webdav.test.ts`, `src/sync/s3.test.ts`, `src/sync/sigv4.test.ts`, `src/sync/settings.test.ts`                                      |
| note-encryption                              | `src/sync/crypto.test.ts`                                                                                                                    |
| Dockerized workflow                          | `Makefile` targets + `.github/workflows/ci.yml` (CI parity), integration: `tests/integration/*.test.ts` via `docker/compose.integration.yml` |

Everything not unit-testable (real-browser behavior, service-worker torture, multi-device matrix) is tracked in [MANUAL_TESTING.md](MANUAL_TESTING.md).

## Store packaging

`make zip` produces `.output/xnotes-<version>-chrome.zip`, `.output/xnotes-<version>-firefox.zip` and the AMO sources zip (automatic for the Firefox target). See [SOURCE_CODE_REVIEW.md](SOURCE_CODE_REVIEW.md) for AMO review/build notes and [privacy_policy.md](privacy_policy.md) for the privacy policy.

## License

MIT — see [LICENSE](LICENSE).
