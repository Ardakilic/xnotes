# Design: xNotes

## Context

Greenfield browser extension. The repo currently contains only planning docs. The reference implementation ([piecioshka/twitter-notes](https://github.com/piecioshka/twitter-notes), MIT, ~1,900 lines TS, zero deps, zero tests) was cloned and analyzed; all 12 architectural claims in `x-notes-sync-analysis-and-plan.md` were verified against its source (see "Reference findings" below). Its patterns are adopted as _ideas_; all code is written from scratch, tested, and extended with sync.

Constraints:

- One codebase → Chromium MV3 (`background.service_worker`) **and** Firefox/Gecko MV3 (`background.scripts` event page; Firefox does not support `service_worker`). Chrome ≥121 ignores `scripts`, Firefox ≥121 ignores `service_worker`, so a dual-key manifest works — WXT generates this per target.
- Local-first: extension must be fully usable with no backend configured.
- Self-hosted sync preferred; no server-side code of ours may exist ("dumb storage + smart client", the floccus archetype).
- Notes are about _people_ → E2E encryption must be available for any third-party-hosted storage.
- All dev/CI commands (install, lint, typecheck, test, build, zip) must be runnable through Docker via a Makefile; the developer machine needs only Docker + make.

Reference findings that shape this design (from source analysis of twitter-notes):

- Single storage key + single write path (`storage.ts` only module touching `chrome.storage`) — adopted; it is the seam where sync plugs in.
- Validate-by-construction (`toNoteRecord`/`toStorageShape` rebuild from `unknown`, zero `as` assertions) — adopted, critical once data arrives from remote.
- URL parser: `HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/`, 50-entry RESERVED blocklist, 8-entry PROFILE_SUBTABS allowlist — adopted nearly verbatim (lists reproduced in spec).
- DOM anchor `[data-testid="primaryColumn"] [data-testid="UserName"]`, fail-soft after ~4 s polling — adopted.
- SPA nav: href diff + debounced MutationObserver (150 ms) + 700 ms interval backstop + `navToken` — adopted.
- Delete is a hard `delete shape.notes[key]` — **not** adopted; replaced by tombstones (the reference's model cannot sync safely: device B would resurrect notes device A deleted).
- Import merge uses `>=` on `updatedAt` (incoming wins ties) — refined into a position-independent deterministic tie-break (see D6).
- Bonus feature discovered and adopted: avatar color badges + hover-card note injection (`[data-testid^="UserAvatar-Container-"]`).
- Reference has zero tests and Chrome-only CRXJS tooling — both gaps this project closes.

Backend research corrections (verified Aug 2026, sources in research report):

- **MinIO OSS was archived 2026-04-25** (company pivoted to commercial AIStor) and had conditional-write bugs until Sep 2025 → excluded as backend and as test server.
- **Backblaze B2** S3 API documents **no** conditional writes → S3 adapter needs a HEAD-compare fallback path.
- **Cloudflare R2** supports all four conditional headers on PutObject → first-class S3 target.
- **Nextcloud** WebDAV exposes ETags, but `If-Match` on PUT is undocumented (sabre/dav base likely supports it) → verify empirically; dufs is the reference WebDAV server.
- **dufs** `If-None-Match` on GET works (304) since v0.42.0, but **`If-Match` on PUT is ignored** (verified empirically against v0.46.0: stale etag → 201) → the WebDAV adapter enforces optimistic locking itself via a HEAD-compare precheck before every conditional PUT (same shape as the S3 fallback), and still forwards `If-Match` for servers that honor it (e.g. sabre-based).
- **aws4fetch** v1.0.20: 0 deps, ~2.5 KB gz, SigV4 via `fetch`+WebCrypto, works in MV3 service workers; dormant ~2 years but surface is frozen/stable.
- OWASP (current): PBKDF2-HMAC-SHA256 → **600,000 iterations**.
- Chrome `alarms` minimum period still 30 s (unpacked exempt); `permissions.request` for runtime origins requires them declared in `optional_host_permissions`; Firefox MV3 host permissions are user-grantable/revocable → must check `permissions.contains` and prompt.

## Goals / Non-Goals

**Goals:**

- Private per-profile notes on X/Twitter, visible on profile pages and in an all-notes manager.
- Fully functional offline/local-only; sync is an opt-in upgrade, never a dependency.
- Cross-browser (Chrome, Brave, Edge, Arc/Helium, Firefox, Zen, LibreWolf, Floorp) from one codebase.
- Self-hosted sync over WebDAV and S3-compatible stores with optimistic concurrency and optional E2E encryption.
- Thorough automated testing: pure-logic unit tests, Dockerized integration tests against real servers, CI gating.
- Docker-only developer workflow via Makefile.

**Non-Goals:**

- No multi-user sharing / collaboration. Single user, few devices.
- No `browser.storage.sync` (vendor-locked, Chrome↔Chrome only, ~100 KB quota).
- No Mega (heavy SDK, ToS friction), no Git backend (WebDAV covers the need cheaper), no CouchDB/Joplin-style smart server (Phase-5 candidate at most).
- No Dropbox at launch (Phase-5 candidate once the adapter interface proves out).
- No note keying by X's immutable numeric user ID at launch (handle-keyed like the reference; schema v3 escape hatch documented).
- No i18n at launch (English strings), no mobile.
- We do not operate any backend; deployment of dufs/B2 buckets is the user's own infra task (documented, not built).

## Decisions

### D1. Framework: WXT + TypeScript strict; no UI framework

WXT (current 0.21.x, Vite-based) generates the per-browser manifest (Chromium `service_worker` vs Firefox `scripts` + `browser_specific_settings.gecko`), provides the unified promise-based `browser.*` API, `wxt zip` store packaging (including AMO sources zip), and a Vitest plugin (`wxt/testing/vitest-plugin` → `WxtVitest()`). Alternatives rejected: Plasmo (React-first, heavier), CRXJS (Chromium-only, what the reference uses), raw MDN dual-key manifest (re-implements packaging/HMR WXT gives free).

UI is vanilla DOM (like the reference): the panel lives inside X's page — a framework adds weight and CSP surface for a small widget. Options/popup pages stay plain TS too; a framework is a drop-in later if they grow.

TS config mirrors the reference's strictness: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `isolatedModules`, `verbatimModuleSyntax`.

### D2. Sync archetype: dumb storage + client-side merge (floccus model)

Backend holds one opaque blob (`notes.json`); the client owns pull → merge → push. Zero server code, any WebDAV/S3 endpoint works, proven at scale by floccus. Dataset is a flat `handle → note` map with natural per-note LWW semantics (2,000 notes ≈ 600 KB) — revision trees/delta protocols buy nothing here. Alternative (xBrowserSync-style smart server) rejected: bespoke service to run and maintain for no functional gain at this scale.

### D3. Launch adapters: WebDAV + S3

| Adapter        | Concurrency mechanism                                                                                                                                                                 | Notes                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| WebDAV (first) | HEAD-compare precheck before conditional PUT (dufs ignores `If-Match` on writes — verified v0.46.0); `If-Match` still forwarded for servers that honor it; `If-None-Match`/304 on GET | dufs ≥ 0.42.0 as reference server; Nextcloud `If-Match` to verify empirically |
| S3             | conditional PUT (`If-Match`) where supported (AWS, R2); **HEAD-compare fallback** where not (B2, older MinIO-likes)                                                                   | SigV4 via `aws4fetch`; path-style toggle for self-hosted endpoints            |

Adapter contract (the only surface the sync engine sees):

```ts
interface SyncAdapter {
  probe(): Promise<void>; // auth + reachability, throws typed errors
  get(opts?: { ifNoneMatch?: string }): Promise<
    | { kind: 'found'; data: Uint8Array; etag: string }
    | { kind: 'not-found' } // no remote blob yet
    | { kind: 'not-modified' } // 304 to the conditional GET
  >;
  put(data: Uint8Array, opts?: { ifMatch?: string; ifNoneMatch?: '*' }): Promise<{ etag: string }>;
}
```

(Refinement during implementation: the original `get(): {data, etag} | null` signature could not express the conditional-GET 304 fast path required by the sync cycle, so it became a three-state result with an `ifNoneMatch` option.)

Encryption wraps any adapter (adapter sees opaque bytes) — one wrapper, not per-adapter work.

**SigV4 choice:** `aws4fetch` (0 deps, WebCrypto-based, works in service workers, includes retry/backoff). Dormant ~2 years but the surface (SigV4) is a frozen spec; accepted. Alternative: hand-rolled SigV4 (~50–80 lines over SubtleCrypto HMAC, testable against AWS's official test vectors) — take this path if aws4fetch ever breaks, the vectors make it low-risk.

**S3 fallback semantics (B2 et al.):** HEAD → compare server ETag with `lastRemoteEtag` → if unchanged, PUT; if changed, re-GET + re-merge + retry. There is a small HEAD→PUT race window; accepted for single-user scale and documented (worst case: one extra merge cycle, no data loss — merge is idempotent and lossless).

### D4. Data model v2 (sync-ready)

```ts
interface NoteRecord {
  handle: string; // display case, no "@"
  handleLower: string; // storage key
  text: string;
  color: string | null; // palette key; hex lives in CSS only
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms — LWW clock
}
interface StoreV2 {
  schemaVersion: 2;
  notes: Record<string, NoteRecord>; // key = handleLower
  tombstones: Record<string, number>; // handleLower -> deletedAt epoch ms
}
```

Storage keys (all `browser.storage.local`):

| Key                 | Content                                                       | Synced?                |
| ------------------- | ------------------------------------------------------------- | ---------------------- |
| `xnotes:store`      | `StoreV2`                                                     | yes (this is the blob) |
| `xnotes:sync-state` | `{ deviceId, lastSyncAt, lastRemoteEtag, status, lastError }` | never                  |
| `xnotes:settings`   | backend type/endpoint/credentials/interval/encryption-on      | never                  |
| `xnotes:view`       | manager page view preference                                  | never                  |

Tombstones GC'd after 90 days (see D6 caveat). Deletes write tombstones; upsert with whitespace-only text = delete (reference behavior, kept).

**Handle-keying limitation (inherited, documented):** if a user renames their handle, the note orphans. Escape hatch = schema v3 keying by immutable numeric user ID (scraped from DOM), later change.

### D5. Single write path + validate-by-construction

One module (`src/core/storage.ts`) is the only code touching extension storage for note data. All reads rebuild valid objects from `unknown` (no `as` assertions); malformed fields fall back to safe defaults; unparseable blobs are quarantined (kept under a `xnotes:corrupt-<ts>` key, never silently dropped). Every write fires the change event the content script, manager page, and sync scheduler listen to. Stale-context guards: check `browser.runtime?.id`, wrap storage calls so "Extension context invalidated" (after extension reload/update) fails soft.

### D6. Merge algorithm (pure function — the heart of the system)

```
merge(local: StoreV2, remote: StoreV2) -> StoreV2
  for each handleLower in union of both sides' notes + tombstones:
    candidates: local note?, remote note?, local tombstone?, remote tombstone?
    winner = max timestamp (updatedAt for notes, deletedAt for tombstones)
    tie-breaks (position-independent, so merge is commutative):
      1. tombstone beats note at equal timestamps
      2. note vs note: winner = deterministically larger canonical serialization
         (JSON with sorted keys) — arbitrary but stable on both devices
  tombstones older than 90 days are dropped (GC)
```

Refinement over the plan doc: "remote wins on tie" is _not_ commutative as a pure function (winner would depend on argument position); a canonical-serialization tie-break keeps `merge(a,b) === merge(b,a)` testable and convergence is unchanged (both devices compute the same winner for the same candidate pair). Ties at ms precision across devices are near-impossible in practice; the rule exists for correctness and testability.

Properties (all unit-tested): commutative, associative enough for pairwise cycles, idempotent (`merge(x,x)=x`), deletion-safe (a tombstone always beats an older note), lossless (no candidate silently dropped).

**Tombstone GC caveat:** a device offline > 90 days could resurrect a deleted note on rejoin (its old note beats nothing). Accepted for single-user scale; documented in README. Upgrade path if it ever bites: per-handle "seen tombstone" watermark instead of time GC.

### D7. Sync cycle, scheduling, single-flight

```
1. GET remote (If-None-Match: lastRemoteEtag → 304 = fast path, skip merge)
2. merged = merge(local, remote)
3. merged != local  → write local store
4. merged != remote → PUT (If-Match: etag)          [WebDAV / conditional-S3]
                     or HEAD-compare then PUT        [S3 fallback]
   412/precondition-failed → re-GET, re-merge, retry (max 3, then error state)
5. persist { lastSyncAt, lastRemoteEtag, status: 'idle' }
```

- Triggers: `alarms` every N minutes (default 5, configurable, floor 1 min); debounced ~10 s after local `storage.onChanged` (only when sync configured); manual "Sync now" (popup); on browser startup (`runtime.onStartup`).
- Single-flight: a mutex in the background ensures cycles never overlap (SW can be killed mid-cycle; ETag + idempotent merge make any partial retry safe).
- Errors: exponential backoff (1 min → 2 → 4 → … capped 60 min), `status: 'error'` + `lastError` surfaced in popup and badge dot.
- Credentials/config live in `xnotes:settings`; `deviceId` (random UUID) generated once. Nothing per-device is ever uploaded.

### D8. Encryption (optional, per-backend setting)

Envelope (the blob stored on the backend when encryption is on):

```json
{
  "v": 1,
  "cipher": "aes-256-gcm",
  "kdf": "pbkdf2-sha256",
  "iter": 600000,
  "salt": "<b64 16B>",
  "iv": "<b64 12B>",
  "data": "<b64 ciphertext>"
}
```

WebCrypto only (`crypto.subtle`, available in both engines' background contexts): PBKDF2-SHA-256 → AES-256-GCM; fresh random salt+IV per encryption; passphrase never persisted. Wrong passphrase → GCM auth-tag failure → typed "decryption failed (wrong passphrase?)" error, local data untouched. Corrupt/unknown envelope → typed error, no overwrite of local store. Changing the passphrase re-encrypts and pushes on next sync. Plaintext `StoreV2` remains the in-memory/local format — encryption is strictly a transport wrapper.

### D9. Content script behavior

- Profile detection is a pure URL parser (unit-tested): hosts `x.com|twitter.com` (+www), exactly 1 path segment matching `^[A-Za-z0-9_]{1,15}$`, not in RESERVED (50 entries, reproduced in spec), optional 2nd segment only if in PROFILE_SUBTABS (8 entries).
- Panel mounts after `[data-testid="primaryColumn"] [data-testid="UserName"]` (`insertAdjacentElement('afterend')`); polls ≤ 4 s then fails soft (data safety > UI).
- Three modes: empty ("Add note"), view (text + Edit/All notes), edit (textarea rows=3, color swatches, Save/Cancel/Delete). Enter saves, Shift+Enter newline, IME-composition guarded.
- 11-color palette keys (red, orange, yellow, green, blue, purple, pink, teal, lime, brown, indigo) + none; hex only in CSS; color drives panel accent + avatar badge.
- SPA nav: href diff + debounced MutationObserver + interval backstop + `navToken` stale-mount guard.
- Avatar badges on `[data-testid^="UserAvatar-Container-"]` (handle parsed from testid), idempotent per tick, skipped for the currently viewed profile; note excerpt injected into X's `[data-testid="HoverCard"]` when present.
- Theme: detect X dark/light from body background luminance; also honor `prefers-color-scheme` on our own pages.

### D10. Cross-browser discipline

- Code against WXT's `browser.*` promises; `chrome.*` never appears in source (lint-enforced).
- Background written to service-worker constraints (strictest): all state in storage, listeners registered synchronously at top level, `alarms` instead of `setInterval`, no DOM assumptions → runs fine as Firefox event page.
- Manifest: `permissions: ["storage", "alarms"]`; `host_permissions: ["https://x.com/*", "https://twitter.com/*"]`; `optional_host_permissions: ["https://*/*"]` (sync endpoints are arbitrary user HTTPS origins — HTTP is rejected by validation — granted at runtime via `permissions.request` when sync settings are saved — must be inside a user gesture on both engines).
- Firefox: `browser_specific_settings.gecko.id` + `strict_min_version` ≥ 142 (floor for the manifest keys used: `optional_host_permissions` needs 128, `data_collection_permissions` needs 140 on desktop / 142 on Android — without a `gecko_android` sub-key the gecko floor governs both); distribution requires AMO signing (sources zip from `wxt zip -b firefox` + build README per AMO policy).
- Host permissions on **both** engines: Chrome MV3 requests x.com/twitter.com host permissions at install time, but users can restrict site access to "on click" or revoke it (user-controlled site access since Chrome 121); Firefox MV3 makes them opt-in/revocable → onboarding must check `permissions.contains` for the x.com/twitter.com origins and prompt via `permissions.request` on both engines, not just Firefox.
- Chromium: same build loads on Brave/Helium/Edge/Vivaldi via CWS.

### D11. Project layout

```
wxt.config.ts            # manifest, targets, zip config
vitest.config.ts         # WxtVitest plugin
Makefile                 # ALL targets run through docker (see D13)
docker/                  # Dockerfiles/compose for dev + integration servers
entrypoints/
  background/index.ts    # sync scheduler, alarms, messages
  content/index.ts + style.css
  options/index.html + main.ts + style.css   # all-notes manager (open_in_tab)
  popup/index.html + main.ts                 # sync status + Sync now
public/icons/
src/
  core/    types.ts storage.ts profile.ts colors.ts dom.ts format.ts
  sync/    adapter.ts merge.ts scheduler.ts webdav.ts s3.ts sigv4.ts crypto.ts settings.ts
demo/      # standalone Vite page + storage shim for UI iteration
tests/     unit (*.test.ts next to modules or here), integration/ (dockerized)
```

### D12. Testing strategy (thorough, per requirement)

- **Unit (Vitest + WxtVitest):** merge (concurrent edits, delete-vs-edit races, tie-breaks, tombstone GC, commutativity/idempotency property-style cases), storage validation (malformed/corrupt inputs, quarantine), profile parser (RESERVED/SUBTABS/handle edges), crypto round-trip + wrong-passphrase + corrupt envelope, SigV4 signing against AWS's official test vectors, WebDAV/S3 adapters against `fetch` mocks (status matrix incl. 304/412/412-retry, 501→fallback for S3).
- **Integration (Docker compose, run in CI and via `make integration`):** real **dufs** container (WebDAV ETag/If-Match/412 loop incl. two simulated devices racing) + **S3 mock** container for the S3 adapter's request/response handling. ponytail: use `adobe/s3mock` (or LocalStack community) rather than archived MinIO; the adapter's real-world quirks (B2 no-conditional-writes) are covered by the HEAD-fallback unit path + a documented manual B2 smoke checklist.
- **Manual matrices (documented checklists, Phase 4):** Chrome + Firefox + one Chromium-derivative + one Firefox-derivative; dufs + Nextcloud; B2 + R2; multi-device torture (simultaneous edits, delete-on-A/edit-on-B, offline > 90-day rejoin, extension update mid-sync).
- **CI (GitHub Actions):** typecheck, lint, unit tests, integration (compose), `wxt build -b chrome` + `-b firefox`, `wxt zip` artifacts uploaded to the run.

### D13. Docker-only workflow (explicit user requirement)

Every command runs through Docker; host needs only `make` + Docker:

```make
DOCKER = docker run --rm -v $(PWD):/app -v xnotes-npm-cache:/root/.npm -w /app node:22-bookworm-slim
setup:       ; $(DOCKER) npm ci
test:        ; $(DOCKER) npm test
typecheck:   ; $(DOCKER) npm run typecheck
lint:        ; $(DOCKER) npm run lint
build:       ; $(DOCKER) sh -c "npm run build && npm run build:firefox"
zip:         ; $(DOCKER) sh -c "npm run zip && npm run zip:firefox"
dev:         ; $(DOCKER) npm run dev        # dev-firefox variant; host browser loads .output/ from the mounted volume
integration: ; docker compose -f docker/compose.integration.yml up --build --abort-on-container-exit
```

One pinned Node image everywhere (`node:22-bookworm-slim`); a named volume caches npm downloads between runs; `node_modules` lives in the mounted repo volume and is only ever executed by Linux containers (host never runs Node — esbuild/rollup platform binaries being Linux ones is therefore correct). Integration compose runs the Node test container alongside dufs + S3 mock on a shared network. On Linux hosts the Makefile passes `--user $(id -u):$(id -g)` (with `HOME` pointed at a writable path inside the volume) so container-created files stay host-user-owned; the default root user is fine on macOS. CI (GitHub Actions `ubuntu-latest`, Docker preinstalled) invokes the exact same Makefile targets, so "everything through Docker" holds in CI too. The only host-side activity left is loading the built extension into a real browser (unavoidable — the browser is the runtime).

## Risks / Trade-offs

| Risk                                                                          | Mitigation                                                                                                                                     |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| X markup changes break panel injection                                        | `data-testid` anchoring + fail-soft; all-notes page always works regardless                                                                    |
| MV3 service worker killed mid-sync                                            | alarms-driven resumable cycles, mutex, ETag/If-Match makes retries safe, merge idempotent                                                      |
| Clock skew breaks LWW                                                         | single-user few-devices → low risk; documented upgrade path: hybrid `(wallClock, perDeviceCounter)` without wire-format break                  |
| Tombstone GC + device offline > 90 days resurrects a deleted note             | documented limitation; watermark upgrade path noted (D6)                                                                                       |
| B2/S3-without-conditional-writes HEAD→PUT race                                | single-user scale; worst case one extra merge cycle, lossless; documented                                                                      |
| Test S3 mock (adobe/s3mock) also ignores `If-Match` on PUT — same class as B2 | integration suite exercises the HEAD-compare fallback against it; the 412 mapping is unit-tested                                               |
| Nextcloud `If-Match` undocumented                                             | empirical verification task in Phase 3; dufs is the supported reference server; adapter degrades to HEAD-fallback on 501/ignored preconditions |
| Firefox users never grant host permissions                                    | onboarding check + `permissions.request` prompt; manager page usable regardless                                                                |
| Credentials readable in `storage.local` (not encrypted at rest)               | honest docs; scoped credentials (single-bucket B2 app key, dedicated WebDAV user); encryption of the blob itself is independent of this        |
| `aws4fetch` dormant                                                           | frozen spec, tiny surface; hand-rolled SigV4 with official test vectors is the documented fallback                                             |
| MinIO-style servers unmaintained/buggy (MinIO archived 2026-04)               | don't recommend MinIO; test against dufs + S3 mock; R2/AWS/B2 are the named real targets                                                       |
| AMO review friction                                                           | sources zip + build README per AMO policy; deterministic WXT builds                                                                            |
| WXT pre-1.0 API drift                                                         | pin exact version; verify APIs against Context7 docs at Phase 0 before writing code                                                            |

## Migration Plan

Greenfield — nothing to migrate at release. Two compatibility seams:

1. **Import of twitter-notes v1 exports:** the manager's JSON import accepts both `schemaVersion: 1` (no tombstones) and v2 shapes; v1 imports convert by adding an empty tombstone map. This doubles as the merge function's first real consumer.
2. **Future schema v3 (user-ID keying):** `schemaVersion` field + single write path mean one migration function in `storage.ts` handles it when built.

Rollback: extension is client-only; "rollback" = shipping the previous store zip. Sync wire format is versioned (`schemaVersion`, envelope `v`).

## Open Questions

1. Nextcloud `If-Match` behavior — pending empirical verification in Phase 3 (task 9.4); outcome only changes docs/recommendations, not architecture. dufs `If-Match` on PUT was verified as ignored (v0.46.0) — HEAD comparison is the real guard.
2. Popup vs. options as the home of sync settings UI — default: settings live in options page, popup shows status + "Sync now" + link. Revisit only if UX testing says otherwise.
3. Whether to ship the demo page in store builds — default: exclude (`demo/` is dev-only, not an entrypoint).
