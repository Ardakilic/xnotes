# Proposal: xNotes — private notes for X/Twitter profiles, with self-hosted sync

## Why

There is no good way to keep private notes about X/Twitter users (e.g. "who is this, why did I mute them") that follow you across browsers and devices. The closest reference ([piecioshka/twitter-notes](https://github.com/piecioshka/twitter-notes), MIT) is Chrome-only, has no sync, and no tests. We want **xNotes**: a cross-browser MV3 extension that stores notes locally by default and optionally syncs them — end-to-end encrypted — to a backend the user controls (WebDAV or S3-compatible storage), in the proven "dumb storage + client-side merge" style of floccus.

## What Changes

- Greenfield browser extension **xNotes** built with **WXT + TypeScript (strict)**, compiled to both Chromium (`background.service_worker`) and Firefox/Gecko (`background.scripts` event page) from one codebase.
- Content script on `x.com`/`twitter.com`: detects profile pages from the URL, injects a note panel (textarea + color labels) anchored to stable `data-testid` markup, survives SPA navigation, decorates avatars of noted users, fails soft if X's markup changes.
- Local-first storage: all notes live in `browser.storage.local` behind a single write path with validate-by-construction parsing; notes carry `createdAt`/`updatedAt`; deletes write **tombstones** so sync cannot resurrect deleted notes. Extension is fully usable with no backend configured.
- All-notes manager page (options, open in tab): search, color filter, inline edit/delete, JSON export/import (import runs through the sync merge function).
- Sync engine in the background: pure last-write-wins merge with tombstones (commutative, idempotent), scheduled via `alarms` + debounced local-change trigger + manual "Sync now", optimistic-locking push (`If-Match`/ETag) with retry, per-device state never uploaded.
- Two launch backends behind one adapter interface: **WebDAV** (dufs, Nextcloud, …) and **S3-compatible** (Backblaze B2, Cloudflare R2, self-hosted) via SigV4 signing. Optional **E2E encryption** (AES-256-GCM, PBKDF2-SHA-256) wrapping any adapter.
- Cross-browser packaging and distribution readiness: runtime host-permission grants (Firefox opt-in model), store-ready zips, privacy policy.
- Engineering baseline: Vitest unit tests (merge, storage validation, profile parser, SigV4, crypto round-trip), Docker-based integration tests against real dufs and an S3 mock, CI (typecheck + lint + test + both builds), and a **Makefile whose commands all run through Docker** (e.g. `make test` → `docker run --rm -v ${PWD}:/app -w /app node:22-bookworm-slim npm test`). The host needs only Docker + make — no local Node. Test coverage is **normative**: every capability spec contains a "Mandatory automated tests" requirement listing the suites that must exist.

## Capabilities

### New Capabilities

- `notes-storage`: Data model (schema v2 with tombstones), single storage write path, validate-by-construction parsing, local persistence, JSON export/import.
- `profile-notes-ui`: Profile URL detection, content-script panel on X profiles, SPA navigation handling, avatar decoration, fail-soft behavior, theme adaptation.
- `notes-manager`: All-notes page — listing, search, color filtering, inline editing, deletion, export/import UI.
- `sync-engine`: Merge algorithm, sync scheduling and triggers, conflict/412 retry, sync state and status surfaces, single-flight guarantees.
- `sync-backends`: Backend adapter contract, WebDAV adapter, S3 adapter, connection probing, runtime host-permission acquisition.
- `note-encryption`: Optional end-to-end encryption envelope over synced data, passphrase key derivation, wrong-passphrase/corruption handling.
- `cross-browser-support`: One codebase targeting Chromium and Gecko MV3, engine-specific lifecycle constraints, permission model and onboarding, store packaging.

### Modified Capabilities

None (greenfield; `openspec/specs/` is empty).

## Impact

- **Code**: Entire repo scaffolded from scratch (WXT project: `entrypoints/`, `src/core`, `src/sync`, options/popup pages, tests, `Makefile`, CI workflow).
- **Dependencies**: `wxt`, `aws4fetch` (SigV4, ~2.5 KB, WebCrypto-based), `typescript`, `vitest`, ESLint/Prettier. No UI framework (vanilla DOM, like the reference).
- **Infra (user-side, out of scope to build)**: any WebDAV server (dufs ≥ 0.42.0 recommended) or S3-compatible bucket; no server-side code of ours exists.
- **Research corrections folded in** (vs. earlier plan doc): MinIO OSS is archived/unmaintained (Apr 2026) — excluded; Backblaze B2 does not document conditional writes — S3 adapter needs HEAD-compare fallback; Nextcloud `If-Match` is undocumented — pending empirical verification, treat dufs as the reference WebDAV server; dufs ignores `If-Match` on PUT (verified v0.46.0) — the adapter uses HEAD comparison before writes since native optimistic locking is unavailable on the PUT path.
- **Privacy**: notes never leave the machine unless the user configures a backend; no telemetry; credentials stored in `storage.local` (documented caveat: not encrypted at rest; mitigation = scoped credentials).
