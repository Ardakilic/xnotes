# X Notes with Self-Hosted Sync — Analysis & Action Plan

> **SUPERSEDED** — this was the original planning document. The normative spec is now
> `openspec/changes/add-xnotes-extension/` (proposal, design, delta specs, tasks). Where this
> document conflicts with the spec or the implementation, the spec wins. Key corrections:
> dufs ignores `If-Match` on PUT (HEAD-compare required, not native optimistic locking);
> MinIO is excluded (OSS archived); merge tie-break is canonical-serialization-based, not
> position-dependent "remote wins"; the adapter `get()` contract is three-state
> (`found`/`not-found`/`not-modified`), not nullable.

**Goal:** A from-scratch browser extension (Chrome + Firefox, and Chromium/Gecko derivatives: Brave, Helium, Edge, Zen, LibreWolf, …) that adds private, color-coded notes to X/Twitter profiles and syncs them to a self-hosted backend.

**Reference:** [piecioshka/twitter-notes](https://github.com/piecioshka/twitter-notes) (MIT, MV3, TypeScript, zero runtime deps) — used as an idea/architecture reference only; all code written from scratch.

---

## 1. Analysis of the reference extension

### 1.1 What it does well (worth adopting as _ideas_)

| Aspect                       | Detail                                                                                                                                                                                 | Verdict                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Data model**               | Single `StorageShape { schemaVersion, notes: Record<handleLower, NoteRecord> }` under one storage key. `NoteRecord = { handle, handleLower, text, color, createdAt, updatedAt }`       | Adopt, extend to v2 (see §4)                                     |
| **Single write path**        | One `storage.ts` module is the only thing touching `chrome.storage`; everything else goes through it. Change detection via `storage.onChanged` on the one key                          | Adopt — this is exactly the seam where a sync engine plugs in    |
| **Validate-by-construction** | `toNoteRecord()` / `toStorageShape()` rebuild valid objects from `unknown` (storage, imports). No type assertions                                                                      | Adopt — doubly important once data arrives from a remote backend |
| **Profile detection**        | Pure URL parser: handle regex `^[A-Za-z0-9_]{1,15}$`, a broad `RESERVED` first-segment blocklist (`home`, `explore`, `i`, …), `PROFILE_SUBTABS` allowlist (`with_replies`, `media`, …) | Adopt nearly verbatim (rewrite, same logic)                      |
| **DOM anchoring**            | `[data-testid="primaryColumn"] [data-testid="UserName"]` — `data-testid` attrs are X's most stable hooks. Fail-soft: if X changes markup, panel just doesn't render; data stays safe   | Adopt                                                            |
| **SPA navigation**           | `href` diffing + debounced `MutationObserver` + low-freq interval fallback; a `navToken` guards against stale async mounts                                                             | Adopt pattern                                                    |
| **Stale-context hygiene**    | Checks `chrome.runtime?.id`, and every storage call catches "Extension context invalidated" (after extension reload/update)                                                            | Adopt                                                            |
| **Import merge**             | `merge` mode already does per-note last-write-wins on `updatedAt`                                                                                                                      | This _is_ the seed of the sync merge algorithm                   |
| **Demo mode**                | Standalone Vite page mounting the real panel + real all-notes page against a `localStorage` shim                                                                                       | Adopt — great for UI iteration without loading the extension     |

### 1.2 Gaps (why we're writing from scratch)

1. **Chrome-only.**
   - `chrome.*` namespace everywhere, no `browser` polyfill.
   - `background.service_worker` only. Per MDN (current as of 2026): **Chrome MV3 supports _only_ `service_worker`; Firefox MV3 supports _only_ `background.scripts` (event pages)**. A cross-browser MV3 extension must ship both keys — or use a framework that generates per-target manifests. Chrome ≥121 ignores `scripts` if present; Firefox ≥121 ignores `service_worker`. So one codebase works on both engines _if_ the manifest carries both keys and the background code is written to survive both lifecycles.
   - Build tooling is CRXJS, which is Chrome-oriented.
2. **No sync**, and two structural blockers for adding it:
   - **Hard deletes.** `deleteNote()` physically removes the record. In a two-device world, device B would happily "restore" a note device A deleted (its copy is "newer than nothing"). Sync needs **tombstones**.
   - No sync metadata (device id, last-synced markers, remote ETag).
3. Notes are keyed by `@handle`; if a user renames, the note orphans. The reference README acknowledges this (`schemaVersion` reserved for later keying by immutable ID). We inherit this limitation initially and leave the same escape hatch.

---

## 2. Backend research — how comparable tools solve self-hosted sync

Surveyed tools that sync browser-side data to user-controlled backends:

| Tool                             | Data           | Backends                                                                                                                                                   | Model                                                          |
| -------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **floccus** (bookmark sync)      | Bookmarks/tabs | Nextcloud Bookmarks, **any WebDAV**, Git (GitHub/Gitea/GitLab), Google Drive, Dropbox, Linkwarden, KaraKeep; **optional E2E encryption** for WebDAV/GDrive | Dumb storage + smart client: client pulls file, merges, pushes |
| **Violentmonkey / Tampermonkey** | Userscripts    | Dropbox, Google Drive, OneDrive, **WebDAV**                                                                                                                | Same: file(s) on dumb storage                                  |
| **Joplin**                       | Notes          | **WebDAV, S3, Nextcloud**, Dropbox, OneDrive, or dedicated Joplin Server                                                                                   | Dumb storage (file-per-item + lock files) _or_ smart server    |
| **xBrowserSync**                 | Bookmarks      | Its own **self-hostable API** (Node + Mongo), E2E-encrypted blobs                                                                                          | Smart server, dumb (encrypted) payload                         |
| **Obsidian LiveSync**            | Notes          | **CouchDB**                                                                                                                                                | Real replication protocol (multi-master, revision trees)       |

Two archetypes emerge:

- **A. Dumb storage + client-side merge** (floccus, Violentmonkey, Joplin-on-WebDAV): backend is any file store; the client owns merge logic. Zero custom server code; any WebDAV/S3/Nextcloud instance works.
- **B. Dedicated smart server** (xBrowserSync, Joplin Server, CouchDB): real conflict handling, push notifications, multi-user — at the cost of running and maintaining a bespoke service.

**Recommendation: archetype A**, for these reasons:

1. Our dataset is a small flat map (`handle → note`) with natural per-note LWW semantics. Even 2,000 notes ≈ 600 KB of JSON. There is nothing here that needs revision trees or delta protocols; a single-blob pull-merge-push is fully correct with tombstones.
2. It matches your stated preference (S3-compatible / Dropbox / etc.) and your infra: you already run **Backblaze B2** (S3-compatible API) and **Coolify** (one-container WebDAV server is trivial), and you already have **CouchDB** for Obsidian LiveSync if we ever want archetype B as a bonus adapter.
3. It's the proven pattern: floccus has run this model across Chrome/Firefox/Brave/Vivaldi for years, including E2E encryption on top of dumb backends.

### 2.1 Backend adapter assessment

| Adapter                    | Self-hosted?                                                           | Effort                                                                                                                                       | Concurrency safety                                                                                                                                                                                          | Notes                                                                                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WebDAV** ★ launch        | Yes (Nextcloud, `dufs`, `rclone serve webdav`, sftpgo, Apache mod_dav) | Low — plain `GET`/`PUT`/`HEAD` + Basic auth                                                                                                  | **Best**: native `ETag` + `If-Match` → true optimistic locking (412 on conflict)                                                                                                                            | Simplest possible protocol; on Coolify a `dufs` container with auth is a 10-minute deploy                                                                                                   |
| **S3-compatible** ★ launch | Yes (MinIO, Garage, SeaweedFS) + B2/R2                                 | Medium — needs SigV4 request signing. Use **`aws4fetch`** (~6 KB, WebCrypto-based, works in service workers) instead of the multi-MB AWS SDK | Good: AWS S3 now supports conditional writes (`If-None-Match` since 2024, `If-Match` ETag on PUT since late 2024); support on MinIO/B2/R2 varies → implement conditional-PUT with **HEAD-compare fallback** | Path-style URL toggle needed for MinIO; a B2 application key scoped to one bucket/prefix keeps blast radius small                                                                           |
| **Dropbox**                | No (3rd party)                                                         | Medium — OAuth2 PKCE via `identity.launchWebAuthFlow`                                                                                        | OK (`content_hash`, revision on upload)                                                                                                                                                                     | Phase 5; conflicts with "self-hosted preferred" but cheap once the adapter interface exists                                                                                                 |
| **CouchDB**                | Yes (you run one)                                                      | Medium-high                                                                                                                                  | Excellent (rev-based MVCC)                                                                                                                                                                                  | Phase 5 optional; overkill for this dataset but nearly free for you infra-wise                                                                                                              |
| **Mega**                   | No                                                                     | High — heavy client-side crypto SDK, awkward in extension contexts, API ToS friction                                                         | —                                                                                                                                                                                                           | **Not recommended**; document as out of scope                                                                                                                                               |
| **Git (à la floccus)**     | Yes                                                                    | High (isomorphic-git in an extension, packfile handling)                                                                                     | Good (push rejection)                                                                                                                                                                                       | Skip — WebDAV gives the same benefit cheaper                                                                                                                                                |
| `browser.storage.sync`     | —                                                                      | Zero                                                                                                                                         | —                                                                                                                                                                                                           | **Rejected as the mechanism** (kept only as a non-goal note): per-vendor (Chrome↔Chrome only, never Chrome↔Firefox), ~100 KB quota, requires a vendor account. Doesn't meet the requirement |

**Encryption layer (applies to any adapter, floccus-style):** notes about _people_ are sensitive. Before upload, optionally encrypt the JSON blob with WebCrypto — AES-256-GCM, key from passphrase via PBKDF2-SHA-256 (≥600k iterations) or scrypt; random salt + IV stored in the envelope header. Strongly recommended for any third-party-hosted storage (B2, Dropbox), optional for your own LAN/VPN WebDAV. The adapter sees only opaque bytes, so this is one wrapper, not per-adapter work.

---

## 3. Cross-browser strategy

### 3.1 Framework: **WXT**

Options considered:

- **WXT** (Vite-based): per-target builds (`wxt build -b chrome` / `-b firefox`), generates the correct manifest per browser (`service_worker` for Chromium, `scripts` event page for Firefox), unified promise-based `browser` API, `web-ext`-powered Firefox dev runner, `wxt zip` produces both store artifacts. Actively maintained; the current community default for cross-browser MV3.
- **Plasmo**: React-first, heavier conventions, maintenance momentum has been questioned.
- **CRXJS** (what the reference uses): great DX but Chromium-focused; you'd hand-roll the Firefox manifest split.
- **No framework** (MDN dual-key manifest + `webextension-polyfill`): viable, but you re-implement per-target packaging, HMR, and manifest generation that WXT gives for free.

**Decision: WXT + TypeScript (strict), no UI framework for the content script** (vanilla DOM like the reference — injecting React into X's page is weight and CSP risk for a small panel). The options/"all notes" page can be plain TS too; if it grows, Preact/Solid via WXT is a drop-in later. _Implementation-time caveat: verify current WXT API details against Context7/official docs at the start of Phase 0 — the Context7 lookup wasn't available during this planning session._

### 3.2 Engine-specific requirements checklist

**Firefox / Gecko (Zen, LibreWolf, Floorp):**

- `browser_specific_settings.gecko.id` + `strict_min_version` (target ≥121 so the dual-background story is clean).
- Background = **event page**: no `window` assumptions beyond DOM-in-event-page, non-persistent, but no service-worker-specific APIs either.
- **MV3 host permissions are opt-in at install in Firefox** — users must grant `x.com`/`twitter.com` access. Onboarding must detect missing grants (`permissions.contains`) and prompt (`permissions.request`), or the content script silently never runs.
- Distribution: AMO signing is mandatory even for self-distributed `.xpi` (unsigned only on Nightly/DevEd with `xpinstall.signatures.required=false`).

**Chromium (Brave, Helium, Edge, Vivaldi, Arc):**

- Background = **service worker**: dies after ~30 s idle. All state in storage; **event listeners registered synchronously at top level**; periodic work via `chrome.alarms` (min period 30 s), never `setInterval`.
- Brave/Helium load Chrome Web Store extensions directly — no separate build.

**Both:**

- Write against the `browser.*` promise API (WXT's unified export); never `chrome.*` callbacks directly.
- Sync endpoints are user-configured arbitrary origins → declare `optional_host_permissions: ["*://*/*"]` and call `permissions.request({ origins: [origin + "/*"] })` when the user saves sync settings. Granted host permissions let background `fetch` bypass CORS on both engines — no CORS config needed on your WebDAV/MinIO server for the extension itself.
- Shared background lifecycle discipline: since Chromium is the stricter environment (SW), write background code to SW constraints and it runs fine as a Firefox event page.

---

## 4. Data model v2 (sync-ready)

```ts
interface NoteRecord {
  handle: string; // display case, no "@"
  handleLower: string; // storage key
  text: string;
  color: string | null; // palette key
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms — LWW clock
}

interface StoreV2 {
  schemaVersion: 2;
  notes: Record<string, NoteRecord>;
  tombstones: Record<string, number>; // handleLower -> deletedAt (epoch ms)
}

// local-only, separate storage key (never uploaded)
interface SyncState {
  deviceId: string; // random UUID, generated once
  lastSyncAt: number;
  lastRemoteEtag: string | null;
  status: 'idle' | 'syncing' | 'error' | 'conflict-retried';
  lastError: string | null;
}
```

**Remote format** (`x-notes/notes.json` on the backend): exactly `StoreV2`, optionally wrapped in an encryption envelope `{ v: 1, cipher: 'aes-256-gcm', kdf: 'pbkdf2-sha256', iter, salt, iv, data }`.

**Merge algorithm** (pure function, the heart of the system — port of the reference's import-merge plus tombstones):

```
merge(local, remote) -> merged:
  for each handle in union(notes, tombstones) of both sides:
    candidates = { local note?, remote note?, local tombstone?, remote tombstone? }
    winner = candidate with max timestamp (updatedAt for notes, deletedAt for tombstones)
    tie -> deterministic: tombstone wins over note; else remote wins
  drop tombstones older than 90 days (GC)
```

Properties: commutative, idempotent, deletion-safe. Caveat to document: LWW on client wall-clocks — fine for a single user across a few devices; if clock skew ever bites, upgrade `updatedAt` to a hybrid `(wallClock, perDeviceCounter)` pair without changing the wire format materially.

**Sync cycle** (in background):

```
1. GET remote (with If-None-Match: lastRemoteEtag → 304 = fast path)
2. merged = merge(local, remote)
3. if merged != local  -> write local
4. if merged != remote -> PUT with If-Match: etag
     412/PreconditionFailed -> re-GET, re-merge, retry (max 3)
5. persist { lastSyncAt, lastRemoteEtag }
```

**Triggers:** `alarms` every N minutes (default 5, configurable); debounced (~10 s) after local `storage.onChanged`; manual "Sync now" button; on browser startup.

---

## 5. Action plan

### Phase 0 — Scaffold (½–1 day)

- `wxt init`, TS strict, ESLint + Prettier, `.nvmrc`.
- Verify WXT specifics against Context7/current docs (build targets, manifest generation, storage helpers).
- Entrypoints: `background`, `content` (matches `x.com`/`twitter.com`), `options` (all-notes page, `open_in_tab`), `popup` (sync status + "Sync now" + shortcuts).
- CI (GitHub Actions): typecheck, lint, unit tests, `wxt build -b chrome` + `-b firefox`, `wxt zip` artifacts.
- Port the reference's **demo mode** idea: standalone Vite page with a storage shim for UI iteration.

**Exit:** hello-world panel injects on an X profile in Chrome _and_ Firefox from the same codebase.

### Phase 1 — Core notes, local-only parity (2–3 days)

- `src/core/`: `types.ts` (StoreV2), `storage.ts` (single write path, validate-by-construction, tombstoned deletes), `profile.ts` (URL parser + RESERVED/SUBTABS lists), `colors.ts` (palette keys; hex in CSS).
- Content script: anchor on `data-testid`, SPA nav handling (href diff + MutationObserver + nav token), note panel (textarea, color swatches, save/delete), avatar dot decoration, stale-context guards.
- All-notes page: table/cards, search, color filter, edit/delete, **JSON export/import** (import runs through the same merge function — first consumer, free test surface).
- Unit tests (Vitest): profile parser, storage validation, tombstone behavior.

**Exit:** feature parity with the reference, on both engines, deletions tombstoned.

### Phase 2 — Sync engine, backend-agnostic (2–3 days)

- `src/sync/adapter.ts`:
  ```ts
  interface SyncAdapter {
    probe(): Promise<void>; // auth + reachability check
    get(): Promise<{ data: Uint8Array; etag: string } | null>;
    put(data: Uint8Array, opts: { ifMatch?: string; ifNoneMatch?: '*' }): Promise<{ etag: string }>;
  }
  ```
- `merge.ts` as pure functions with a thorough Vitest suite (concurrent edits, delete-vs-edit races, tombstone GC, idempotency).
- Scheduler in background (alarms + debounce + startup + manual), mutex so cycles never overlap, exponential backoff on errors.
- Settings UI: backend type, endpoint, credentials, interval, encryption passphrase; **runtime `permissions.request` for the endpoint origin on save**; probe + "test connection" button.
- Status surfaces: popup (last sync, error state), badge dot on failure.
- Credentials in `storage.local`, with the honest caveat in docs: extension storage isn't encrypted at rest; scoped credentials (B2 app key limited to one bucket/prefix; dedicated WebDAV user) are the real mitigation.

**Exit:** full pull-merge-push loop green against an in-memory fake adapter in tests.

### Phase 3 — Launch adapters + encryption (2–3 days)

1. **WebDAV adapter** (first): `GET`/`HEAD`/`PUT` + Basic auth + `If-Match`; `MKCOL` for the folder on first run. Manual test matrix: `dufs` (deploy on Coolify), Nextcloud.
2. **S3 adapter**: `aws4fetch` for SigV4; config = endpoint, region, bucket, key prefix, access/secret key, path-style toggle. Conditional PUT where supported; HEAD-compare fallback otherwise. Test matrix: MinIO (local Docker), **Backblaze B2** (your real target).
3. **Encryption wrapper** around any adapter (WebCrypto AES-GCM + PBKDF2 as in §2.1); wrong-passphrase and corrupt-envelope error paths.

- Integration tests in CI against dockerized MinIO + dufs.

**Exit:** two real self-hosted backends syncing Chrome ↔ Firefox with E2E encryption on.

### Phase 4 — Hardening + distribution (2–4 days, elapsed longer due to review queues)

- Multi-device torture pass: simultaneous edits, delete-on-A/edit-on-B, offline device rejoining after weeks (tombstone GC window), extension update mid-sync.
- Firefox onboarding flow for opt-in host permissions; verify on Zen/LibreWolf; verify Chromium build on Brave/Helium.
- Store prep: privacy policy (mirrors the reference's stance: no telemetry, data goes only to _the user's own_ backend), listing assets, AMO source-code submission notes (WXT build is reproducible — AMO reviewers require buildable sources).
- Submit to Chrome Web Store + AMO; keep a signed `.xpi` release on GitHub for sideloaders.

### Phase 5 — Later / optional

- Dropbox adapter (OAuth2 PKCE via `identity.launchWebAuthFlow`).
- CouchDB adapter (you already run one for Obsidian LiveSync).
- Re-key notes by X's immutable numeric user ID (scrape from DOM/hovercard) with handle as display-only — fixes the rename-orphan problem; `schemaVersion: 3` migration.
- Note templates, keyboard shortcut, per-note "remind me why I muted this person" quality-of-life bits.
- **Out of scope:** Mega (SDK/ToS friction, not worth it), Git backend (WebDAV covers the need), `storage.sync` (can't cross vendors).

---

## 6. Recommended deployment for your setup

- **Primary:** `dufs` (single Rust binary, WebDAV + auth + TLS-behind-proxy) as a Coolify service, storage on a named volume, folded into your existing restic/B2 backup routine. The extension talks WebDAV with `If-Match` — the safest concurrency semantics of all the adapters.
- **Alternative (zero new services):** point the S3 adapter straight at **Backblaze B2** with an application key scoped to a dedicated `x-notes` bucket. Turn encryption **on** — these are notes about people sitting on third-party storage.
- Either way the extension is the only client; there's no server-side code of ours to maintain, which is the whole point of archetype A.

## 7. Risks

| Risk                                       | Mitigation                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| X markup changes break panel injection     | `data-testid` anchoring + fail-soft (reference's approach); all-notes page always works           |
| MV3 service worker killed mid-sync         | Alarms-driven, resumable cycle; mutex; ETag makes any partial retry safe (PUT is atomic per blob) |
| Clock skew corrupts LWW                    | Single-user, few devices — low real risk; hybrid counter escape hatch documented                  |
| Firefox users never grant host permissions | Explicit onboarding check + prompt                                                                |
| Credentials readable in `storage.local`    | Scoped keys (single-bucket B2 key, dedicated WebDAV user), documented honestly                    |
| AMO review friction (WXT bundling)         | Ship source + build instructions per AMO policy; deterministic builds                             |

**Estimated total: ~2 weeks of focused work to Phase 3 (fully usable, self-hosted, cross-browser), plus store review latency in Phase 4.**
