# Tasks: xNotes

Reference material for the implementer: `x-notes-sync-analysis-and-plan.md` (repo root), `design.md` (decisions D1–D13), and the delta specs in `specs/`. The reference extension `piecioshka/twitter-notes` is an idea source only — write all code from scratch. Before writing any WXT code, verify current WXT APIs (entrypoints, manifest config, storage, testing plugin) against the official docs/Context7, since WXT is pre-1.0.

## 1. Scaffold & tooling (Phase 0)

- [x] 1.1 `wxt init` a TypeScript project named xnotes; pin the exact WXT version in package.json; configure `wxt.config.ts` (name, manifest base: `permissions: ["storage", "alarms"]`, `host_permissions` for x.com/twitter.com, `optional_host_permissions: ["*://*/*"]`, icons, `browser_specific_settings.gecko` with an id and `strict_min_version: 121`)
- [x] 1.2 Set tsconfig to the strict set from design D1 (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `isolatedModules`, `verbatimModuleSyntax`)
- [x] 1.3 Add ESLint + Prettier, including a rule (or lint check) forbidding direct `chrome.*` usage in `src/` and `entrypoints/`
- [x] 1.4 Add Vitest with the `WxtVitest()` plugin (`vitest.config.ts`); add npm scripts: `test`, `typecheck`, `lint`, `build`, `build:firefox`, `zip`, `zip:firefox`, `postinstall: wxt prepare`
- [x] 1.5 Create the `Makefile` with Docker-only targets per design D13 (`setup`, `test`, `typecheck`, `lint`, `build`, `zip`, `dev`, `dev-firefox`, `integration`), one pinned image `node:22-bookworm-slim`, npm-cache named volume, and `--user $(id -u):$(id -g)` handling for Linux hosts; verify `make setup typecheck` passes from a clean checkout with no host Node installed
- [x] 1.6 Create empty entrypoints that build on both targets: `background`, `content`, `options` (open_in_tab), `popup`; verify `wxt build` and `wxt build -b firefox` succeed and each manifest has the correct background key
- [x] 1.7 Add GitHub Actions CI on `ubuntu-latest` that invokes the same Makefile targets (`make setup typecheck lint test build zip`) so CI and local verification are identical; upload `wxt zip` artifacts
- [x] 1.8 Port the demo-mode idea: standalone Vite page (`demo/`) with a `chrome.storage` shim over localStorage that mounts the real panel + manager page (build after the UI modules exist; stub until then)

## 2. Core data layer (Phase 1a)

- [x] 2.1 `src/core/types.ts`: `NoteRecord`, `StoreV2` (`schemaVersion: 2`, `notes`, `tombstones`), `SyncState`, settings types, palette key union type
- [x] 2.2 `src/core/colors.ts`: 11 palette keys (`red, orange, yellow, green, blue, purple, pink, teal, lime, brown, indigo`) with labels; hex values only in CSS
- [x] 2.3 `src/core/storage.ts`: single write path over `browser.storage.local` keys `xnotes:store`, `xnotes:sync-state`, `xnotes:settings`, `xnotes:view`; validate-by-construction parsers (`toNoteRecord`, `toStoreV2` from `unknown`, safe defaults, drop invalid records); corrupt-blob quarantine to `xnotes:corrupt-<ts>`; stale-context guards (`browser.runtime?.id`, fail-soft catches)
- [x] 2.4 Storage operations: `upsertNote` (createdAt only on create, updatedAt always; whitespace-only text = delete), `deleteNote` (writes tombstone), `getStore`, `subscribeToStoreChanges`; v1-shape import conversion (schemaVersion 1 → empty tombstones)
- [x] 2.5 Unit tests: validation (malformed fields → defaults; invalid handle dropped), quarantine, upsert/update/delete/tombstone semantics, v1 conversion, change-event emission (mock storage via WxtVitest patterns)

## 3. Profile detection (Phase 1b)

- [x] 3.1 `src/core/profile.ts`: pure `parseProfile(url: URL)` — hosts x.com/twitter.com (±www), first segment `^[A-Za-z0-9_]{1,15}$`, RESERVED blocklist (copy the full list from the profile-notes-ui spec), PROFILE_SUBTABS allowlist for the 2nd segment, case-insensitive
- [x] 3.2 Unit tests: plain profile, subtabs, every RESERVED entry rejected, unknown 2nd segment, 15-char boundary, invalid chars, non-X hosts, case variations

## 4. Content script UI (Phase 1c)

- [x] 4.1 `entrypoints/content/index.ts`: navigation loop (href diff + debounced MutationObserver ~150 ms + ~700 ms interval backstop + `navToken`), `parseProfile` gate, stale-context teardown
- [x] 4.2 Panel mounting: anchor `[data-testid="primaryColumn"] [data-testid="UserName"]`, poll ≤ 4 s then fail soft; insert panel after anchor
- [x] 4.3 Panel UI (vanilla DOM): empty/view/edit modes showing the `@handle` the note belongs to, textarea ≥3 rows, color swatches with aria-pressed + non-color labels, Save/Cancel/Delete; Enter saves, Shift+Enter newline, `isComposing` guard; theme detection from body background luminance; basic a11y (native focusable elements, visible focus, panel aria-label)
- [x] 4.3a Panel subscribes to store changes: refresh when the viewed handle's note changes externally (other tab, manager page, sync merge), preserving any edit in progress
- [x] 4.4 Avatar badges: decorate `[data-testid^="UserAvatar-Container-"]` avatars of noted handles (parse handle from testid), idempotent per tick, skip the currently viewed profile; inject note excerpt into `[data-testid="HoverCard"]` when shown
- [x] 4.5 CSS with light/dark variants and palette hex; scoped class/id prefix (e.g. `xn-`)
- [ ] 4.6 Manual test on a real X profile in Chrome and Firefox (panel shows, edits persist across navigation, fail-soft verified by temporarily breaking the selector)

## 5. All-notes manager page (Phase 1d)

- [x] 5.1 `entrypoints/options/`: table + card views with persisted preference, handle links (`rel="noopener noreferrer"`), updated timestamps, count line
- [x] 5.2 Search (handle or text, case-insensitive) + multi-select color filter incl. `none`
- [x] 5.3 Inline edit (text + color) and delete-with-confirm, via the storage module; live refresh on store changes with edit-in-progress protection
- [x] 5.4 Export JSON (`xnotes-backup-YYYYMMDD.json`) and Import JSON (file picker → merge/replace; replace double-confirmed; invalid file rejected with message); import runs through the merge function
- [x] 5.5 Unit tests for import/export logic (round-trip, v1 import, invalid file rejection); wire the demo page (task 1.8) to the real modules

## 6. Sync engine (Phase 2a)

- [x] 6.1 `src/sync/merge.ts`: pure `merge(local, remote)` per the sync-engine spec (LWW, tombstone-beats-note tie, canonical-serialization tie-break, 90-day tombstone GC)
- [x] 6.2 Merge unit tests: newer-wins, delete-vs-edit both directions, timestamp ties, commutativity (property-style random cases), idempotency, GC boundary, losslessness
- [x] 6.3 `src/sync/scheduler.ts`: cycle runner (conditional GET with `If-None-Match`/304 fast path → merge → local write if changed → PUT with `If-Match` or adapter fallback → persist etag/lastSyncAt), 412 retry ≤3, single-flight mutex, exponential backoff (1→60 min cap), typed error recording
- [x] 6.4 Triggers: `browser.alarms` periodic (default 5 min, configurable, min 1 min; re-register listeners synchronously at SW top level), ~10 s debounce on local store changes, manual "Sync now" message, `runtime.onStartup`, and an immediate cycle when a backend is first activated; no triggers when no backend configured
- [x] 6.5 Sync state persistence (`xnotes:sync-state`: deviceId UUID-once, lastSyncAt, lastRemoteEtag, status, lastError) and status reporting to popup (messages API)
- [x] 6.6 Unit tests for the scheduler against an in-memory fake adapter: full cycle, 304 path, conflict retry success/exhaustion, single-flight coalescing, backoff sequence, no-backend no-op

## 7. Backends & encryption (Phase 2b–3)

- [x] 7.1 `src/sync/adapter.ts`: `SyncAdapter` interface + typed error classes (auth, unreachable, conflict, decode)
- [x] 7.2 `src/sync/webdav.ts`: GET/HEAD/PUT + Basic auth, `If-None-Match`/`If-Match`, MKCOL on first run, configurable blob path; unit tests with fetch mocks (200/304/401/404/412/5xx matrix)
- [x] 7.3 `src/sync/sigv4.ts` + `src/sync/s3.ts`: aws4fetch-based signing; config endpoint/region/bucket/prefix/keys/path-style; conditional PUT with HEAD-compare fallback (detect unsupported via 501/NotImplemented or provider config flag); unit tests incl. AWS official SigV4 test vectors and the fallback path
- [x] 7.4 `src/sync/crypto.ts`: envelope `{v:1, cipher:"aes-256-gcm", kdf:"pbkdf2-sha256", iter≥600000, salt, iv, data}` via WebCrypto; encrypt/decrypt wrapper usable around any adapter; mode-mismatch handling (remote-encrypted/local-disabled and remote-plaintext/local-enabled → typed errors, no silent overwrite); unit tests: round-trip, fresh salt/iv, wrong passphrase → typed error, corrupt/unknown envelope → typed error, both mismatches, iter-count assertion
- [x] 7.5 Settings UI in options page: backend type, endpoint/credentials forms with validation (well-formed http(s) URL, visible warning for non-TLS endpoints, required fields per backend type), sync interval, encryption toggle + passphrase (with change-passphrase flow), "Test connection" via `probe()`, runtime `permissions.request` for the endpoint origin on save (deny → not activated + explanation); unit tests for the validation rules
- [x] 7.6 Popup: sync status (last sync, state, last error), "Sync now", link to settings; toolbar badge on error state

## 8. Dockerized integration tests (Phase 3)

- [x] 8.1 `docker/compose.integration.yml`: node test container + `sigoden/dufs` (≥ 0.42.0, auth enabled) + S3 mock (`adobe/s3mock` or LocalStack community) on a shared network; `make integration` target
- [x] 8.2 WebDAV integration suite against real dufs: first-run MKCOL, put/get round-trip, ETag/304, If-Match 412, two simulated devices racing (concurrent PUTs resolve via retry loop)
- [x] 8.3 S3 integration suite against the mock: SigV4 accepted, put/get round-trip, HEAD-compare fallback path
- [x] 8.4 Encryption integration pass: run one WebDAV sync cycle with encryption on; assert the stored blob on the server is an envelope with no plaintext
- [x] 8.5 Add integration job to CI (compose up → tests → down)

## 9. Cross-browser hardening & packaging (Phase 4)

- [x] 9.1 Host-permission onboarding on **both** engines (Chrome withholds host permissions by default too): detect missing x.com/twitter.com grants via `permissions.contains`, prompt UI + `permissions.request`; verify manager page and sync settings work without grants
- [ ] 9.2 Service-worker torture: verify alarms re-fire after SW termination, mid-sync kill resumes safely (manual + notes in test report)
- [ ] 9.3 Manual multi-device matrix (documented checklist with results): simultaneous edits, delete-on-A/edit-on-B, offline-device rejoin, extension update mid-sync — Chrome ↔ Firefox
- [ ] 9.4 Backend matrix (documented checklist): dufs (Coolify or local), Nextcloud (empirically verify `If-Match` behavior and record the result in README), Backblaze B2 (fallback path), Cloudflare R2 (conditional path)
- [x] 9.5 Store prep: privacy policy (no telemetry; data only to the user's own backend), README (setup, sync setup, security caveats: credentials at rest, tombstone GC 90-day window, handle-rename limitation), AMO sources-zip build notes (`SOURCE_CODE_REVIEW.md`), `wxt zip` artifacts for CWS + AMO, signed `.xpi` release on GitHub

## 10. Final verification

- [x] 10.1 From a clean checkout with only Docker + make installed, run `make setup typecheck lint test integration build zip` — all green, no host Node
- [ ] 10.2 Load the unpacked Chrome build and the Firefox build; walk every spec scenario that is manually verifiable; record results
- [x] 10.3 `openspec validate` the change; ensure all spec scenarios are covered by at least one automated test or a documented manual checklist item
- [x] 10.4 Verify every "Mandatory automated tests" requirement across all seven specs has a corresponding passing suite (map spec requirement → test file in a short table in the README or test report)
