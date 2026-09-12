# Design: persist-x-user-id

## Context

Notes are keyed by `handleLower` today: `NoteRecord` (`src/core/types.ts:3-16`) is stored in `StoreV2.notes: Record<string, NoteRecord>` keyed by `handleLower`, and all read/write paths in `src/core/storage.ts:81-205` (`toNoteRecord`, `toStoreV2`, `upsertNote`, `deleteNote`) normalize through `handle` → `handleLower`. The consequence is structural: a handle rename or handle hijack silently re-points or orphans the note, because there is no stable identity underneath the key.

There are three DOM→handle mappings, all handle-only: (1) profile page via `parseProfile` + anchor in `entrypoints/content/index.ts:11-13,60-128` (panel mount/load/save keyed by `handleLower`); (2) timeline avatars via `extractHandleFromAvatarTestid` / `decorateAvatars` in `src/ui/badges.ts:23-59`; (3) hover cards via `findNotedLink` in `src/ui/badges.ts:61-84,101-119`. None of these surfaces observes a stable numeric user ID today.

Sync and merge are keyed by handle with tombstones: `merge(local, remote)` in `src/sync/merge.ts:39-71` is pure last-write-wins over the union of handle keys (tombstone beats note at equal ts, note-vs-note by `canonicalNote`), and the wire path in `src/sync/scheduler.ts:81-102` (`encodeStore`/`hashStore`) serializes the same handle-keyed shape deterministically.

Platform constraints bound the solution space: the content script runs in the default `ISOLATED` world with host permissions for `x.com`/`twitter.com` only and no `api.twitter.com` access (`wxt.config.ts:14-21`), so any ID source must be readable from the page DOM without new hosts, new permissions, or authenticated API calls. Repo invariants hold throughout: **zero-`as`** with validate-by-construction parsers (`toNoteRecord`/`toStoreV2`), the **single write path** (only `src/core/storage.ts` touches `browser.storage.local`), Docker-only toolchain (`make typecheck` / `lint` / `test`), and JSDoc docblocks are mandated as an explicit user-approved deviation from the no-comments rule (see proposal).

## Goals / Non-Goals

**Goals:**

- Attach the stable X numeric user ID (`rest_id`, digits-only) to notes as observations become available, so renames follow the user and hijacks do not inherit the previous owner's note.
- Keep the change additive and shippable incrementally: old stores, old clients, and unknown-ID states must keep working exactly as today.
- Learn IDs passively from the DOM on surfaces already visited; fail soft everywhere an ID is absent or unparseable.
- Keep sync semantics untouched: merge stays pure, commutative, idempotent, and lossless.

**Non-Goals:**

- No re-keying of the store to ID keys, no backfill migration, no bulk resolution of IDs for never-visited handles.
- No new network surfaces: no GraphQL calls, no `api.twitter.com` permission, no MAIN-world script injection, no background fetching of IDs.
- No change to avatar-badge or hover-card matching logic (they stay handle-only); no syncing of learned alias state; no persistence of any secret material beyond what exists today.

## Decisions

### D1. Additive optional `userId?: string` on `NoteRecord`; keys stay `handleLower`

Choice: add `userId?: string` (digits-only, `^\d+$`, absent = unknown) to `NoteRecord`. Store keys, tombstone keys, panel hooks, and badge lookups all remain `handleLower`-keyed.

Why: fully backward compatible — old parsers ignore the extra JSON field, new parsers treat its absence as "unknown" and behave exactly as today. Coverage accrues gradually as the user visits profiles, with no flag day.

Rejected — ID-keyed migration: re-keying `notes`/`tombstones` to `rest_id` would break the wire format between mixed client versions (same note under two keys → duplicates after merge), require a backfill for the entire existing store that cannot be performed without visiting every profile, and regress badges for never-seen users (avatar testids and hover links carry handles, not IDs, so an ID-keyed store would miss them until an alias map re-introduces handle lookup anyway — at which point the migration bought nothing).

### D2. New local-only alias key (e.g. `xnotes:aliases`), never synced

Choice: add a local-only key holding a bidirectional `handleLower <-> userId` map plus `observedAt` per entry, accessed only through `src/core/storage.ts` (single-write-path invariant). The uploaded blob remains exactly the `StoreV2` (optionally inside the existing crypto envelope).

Why local-only: aliases are per-device learned knowledge, not user data — the same category as `xnotes:sync-state`, `xnotes:settings`, `xnotes:view`, which never sync by invariant. Syncing learned mappings would add merge/conflict surface (two devices learning conflicting handle→ID bindings at different times) for zero user value, since each device re-learns on visit anyway.

Rejected — syncing aliases inside `StoreV2`: couples device-observation history to the user-data merge, risks cross-device alias flapping on hijack windows, and expands the encrypted wire payload with derivable cache data.

### D3. Passive ID sources, strictly ordered, validate-by-construction

Choice, in priority order:

1. (a) `script[type="application/ld+json"]` → `mainEntity.identifier`, cross-checked against the URL handle from `parseProfile` (stale-head guard on SPA navigation: if the script's handle does not match the current URL handle, discard the read). Parsed by a new validate-by-construction parser (returns `string | null`, `^\d+$` only, no `as`).
2. (b) Banner URL fallback matching `/profile_banners/(\d+)/` from page images, same handle cross-check and same parser discipline.
3. (c) Unknown → today's behavior: note saved/loaded handle-keyed with `userId` absent; alias untouched.

Why this order: JSON-LD is server-rendered structured data already in the ISOLATED DOM — no new permissions, no auth, no MAIN-world injection. The handle cross-check makes SPA staleness fail closed (drop the read) rather than mis-attribute an ID. The banner fallback covers pages where the JSON-LD block is missing but the banner CDN URL (which embeds the numeric ID) is present.

Rejected:

- Avatar-URL parsing: the numeric segment in avatar URLs is not the `rest_id`; using it would record wrong IDs silently.
- Meta tags (`og:*` / `twitter:*`): carry handle/title only, no stable numeric ID.
- Active GraphQL (`UserByScreenName` or similar): needs auth headers, query IDs, and transaction-ID upkeep from the MAIN world, plus rate-limit and ToS/privacy story the extension deliberately avoids.
- MAIN-world fiber/React-tree reading: Chromium-only injection surface, high churn against X's bundled internals, Firefox-hostile.

### D4. Rename follows the ID; hijack never inherits

Rename policy (same `userId`, different handle): move the note — create the note under the new `handleLower` preserving `text`/`color`/`createdAt`, bump `updatedAt`, and call the existing `deleteNote(oldHandle)` so a tombstone is written for the old key and sync convergence is preserved across devices.

Hijack policy (same handle, different `userId` from the learned alias): withhold the note from the panel, keep the stored record as an orphan, and surface it in the manager for explicit user delete/reassign — never auto-carry the old text onto the new owner, never auto-delete on suspicion.

Why: renames are the common benign case and should be lossless; hijacks are rare but high-harm (showing a private note about person A on person B's profile), so the fail-closed direction is to hide and ask. Both policies reuse existing primitives (`upsert`/`deleteNote` + tombstones), so merge semantics do not change.

Rejected — auto-carry on handle match regardless of ID: preserves the exact bug this change exists to fix. Rejected — auto-delete on ID mismatch: a stale alias entry (user B held the handle briefly between observations) would destroy user data; orphans + explicit user action cannot.

### D5. Single learning hook on the profile-page flow; avatars/hover unchanged

Choice: learn (handle, userId) in the profile-page flow after `parseProfile` succeeds — the `decorateTick` / `onNav` / `mountPanel` area of `entrypoints/content/index.ts` — fail-soft (parse failure or absent ID = no write, no error surface). Avatar badges (`decorateAvatars`) and hover cards (`findNotedLink`) stay handle-only lookups.

Why: the profile page is the only surface where the URL handle, the JSON-LD/banner evidence, and the panel's note context coincide, making the cross-check meaningful. Avatars and hover cards are handle-only surfaces by construction (testid handle, link href handle) with no colocated ID evidence; threading ID reads into their hot loops adds DOM cost per tick for no correctness gain.

Rejected — learning in `decorateAvatars` / `injectHoverCardNote` hot paths: per-tick JSON parsing over timelines, with no reliable handle↔ID binding context at that granularity.

### D6. Sync, export, and merge untouched; `userId` rides inside `NoteRecord`

Choice: no scheduler, adapter, crypto-envelope, or export changes. `userId` flows through the existing `encodeStore`/`merge` path as just another field of `NoteRecord`; `canonicalNote` gains the field in alphabetical order, which changes hash/wire bytes deterministically (same logical store ⇒ same bytes on all new clients).

Forward-compat caveat (task-level verification required): an old client receiving a note with the new `userId` field must either ignore-and-preserve it or drop it — implementers must verify which `toNoteRecord` behavior the shipped parser has and record the answer in the change's tasks. Either outcome is safe for correctness (ID is advisory; keys unchanged), but the two outcomes differ operationally: preserve ⇒ aliases survive round-trips through old clients; drop ⇒ the field is re-learned on next profile visit. The safe merge rule is absolute either way: **merge must never strip unknown fields** — parsers rebuild valid objects field-by-field, and any field the parser does not know must be carried, not discarded, so future additive fields survive.

Rejected — bumping `schemaVersion` or forking the wire format: forces coordinated upgrades across devices for an advisory field and breaks the "old client reads new blob" property the current version-tolerant parser (`toStoreV2` accepting v1/v2) deliberately provides.

### D7. Tests and docs mandates

Choice: colocated unit tests (`*.test.ts` next to the parser/alias/policy modules; happy-dom header for DOM tests) covering: parser accepts digits-only / rejects non-digits, stale-head cross-check drops mismatched reads, rename moves with tombstone, hijack withholds and orphans, merge commutativity fixtures with the optional field present and absent; plus JSDoc docblocks on all new exported functions as the user-mandated deviation from the no-comments rule (recorded in the proposal). Verify with `make typecheck`, `make lint`, `make test` (Docker-only; no host Node).

Why: the randomized commutativity tests guard the merge invariant directly, and the parser/policy tests pin the fail-closed directions (stale ⇒ drop, mismatch ⇒ withhold).

## Risks / Trade-offs

- [Risk] JSON-LD block is stale after SPA (pushState) navigation → Mitigation: handle cross-check against the `parseProfile` URL handle; mismatch discards the read, alias keeps its prior entry with `observedAt`.
- [Risk] X drops or renames the SSR JSON-LD block → Mitigation: ordered fallback to banner-URL parsing, then graceful unknown; learning is best-effort and every consumer treats absent `userId` as today.
- [Risk] Banner-less / default-banner accounts yield no fallback ID → Mitigation: same graceful-unknown path; coverage is explicitly gradual, not guaranteed.
- [Risk] Gradual coverage means mixed known/unknown stores for a long tail → Mitigation: all policy branches default to current handle-keyed behavior when either side's ID is unknown; no user-visible change until both sides are known.
- [Risk] Adding a field to `canonicalNote` changes tie-break bytes and affects existing randomized commutativity fixtures → Mitigation: extend fixtures with the optional field present/absent; commutativity/idempotence properties are unchanged (still a strict weak ordering over the same candidate structure), only the byte values shift deterministically.
- [Risk] Hijack false positives from a stale alias entry (brief handle reuse between observations) → Mitigation: cross-check at learn time, `observedAt` recency on the alias, withhold-but-keep-orphan (never auto-delete, never auto-carry); manager review resolves ambiguity explicitly.

## Migration Plan

None needed. The change is purely additive: existing stores parse unchanged (`userId` absent ⇒ unknown ⇒ current behavior), keys and tombstones keep their shape, and the alias key starts empty and fills on profile visits. No backfill, no version bump, no user action.

## Open Questions

- Does the JSON-LD block refresh reliably on pushState SPA navigation between profiles, or does a stale head persist long enough to matter (i.e., how often does the cross-check actually fire)? Needs live-browser verification.
- Is the JSON-LD identifier (and banner URL) present for protected, suspended, and logged-out views, or only for public profiles in a logged-in session? Needs live-browser verification across those states.
- Are hover-card surfaces available while logged out such that any ID-adjacent work there would even be reachable? Needs live-browser verification; current design assumes handle-only hover regardless.
