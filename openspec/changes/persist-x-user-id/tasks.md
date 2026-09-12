# Tasks: persist-x-user-id

## 1. Model + forward-compat

- [x] 1.1 Add optional `userId?: string` (digits-only `^\d+$`, absent = unknown) to `NoteRecord` in `src/core/types.ts`, keys stay `handleLower`
- [x] 1.2 Parse/serialize `userId` validate-by-construction in `toNoteRecord` (`src/core/storage.ts`, zero `as`); absent/invalid → omitted, valid digits preserved
- [x] 1.3 Carry `userId` through `toStoreV2` unchanged and gain field in `canonicalNote` (`src/sync/merge.ts`, alphabetical order); verify `encodeStore`/`hashStore` (`src/sync/scheduler.ts`) round-trip it deterministically with no scheduler logic change
- [x] 1.4 VERIFY + record old-client forward-compat: exercise shipped `toNoteRecord` against a note containing unknown `userId` field (preserve vs drop), document outcome in change tasks; confirm `merge` never strips unknown fields

## 2. Alias store (local-only)

- [x] 2.1 Add `src/core/aliases.ts` with bidirectional `handleLower<->userId` + `observedAt` get/save/record (`getAlias`, `saveAlias`, `lookupByHandle`/`lookupByUserId` or equivalent), JSDoc docblocks on all exported functions
- [x] 2.2 Wire alias key (e.g. `xnotes:aliases`) through `src/core/storage.ts` single-write-path only; prove never in `StoreV2` blob or export (no import in `encodeStore`/export path)

## 3. ID parsers

- [x] 3.1 Add `parseJsonLdUserId` in `src/core/user-id.ts`: `script[type="application/ld+json"]` → `mainEntity.identifier`, `^\d+$` only, handle cross-check vs `parseProfile` URL handle (mismatch → `null`), validate-by-construction, zero `as`, JSDoc
- [x] 3.2 Add `parseBannerUserId` fallback in same module: `/profile_banners/(\d+)/` from page images with same handle cross-check and parser discipline, unknown → `null`; JSDoc

## 4. Profile flow + panel + manager

- [x] 4.1 Hook ID learning into profile-page flow after `parseProfile` succeeds (`entrypoints/content/index.ts` `decorateTick`/`onNav`/`mountPanel` area): try JSON-LD then banner then unknown, fail-soft (no write, no error surface), JSDoc on new/changed functions
- [x] 4.2 Implement rename (same `userId`, new handle): move note preserving `text`/`color`/`createdAt`, bump `updatedAt`, `deleteNote(oldHandle)` for tombstone so sync converges; JSDoc
- [x] 4.3 Implement hijack withhold in `src/ui/panel.ts`: ID mismatch → empty state, never pre-fill view/edit with withheld text/color; add formerly-known-handle hint after rename move; JSDoc on new/changed functions
- [x] 4.4 Implement orphan handling in `entrypoints/options/manager.ts`: orphan listing with last-known handle + ID context, explicit delete (writes tombstone) / reassign to chosen handle, never auto-carry/auto-delete; formerly-known-handle display on renamed notes; JSDoc on new/changed functions

## 5. Tests (mandatory — all new code + affected suites)

- [x] 5.1 New colocated parser suite (`src/core/user-id.test.ts`): valid JSON-LD, stale-handle mismatch drop, malformed/missing JSON, non-digit reject, banner fallback learn, unknown → handle-only
- [x] 5.2 New alias suite (`src/core/aliases.test.ts`): learn round-trip both directions, `observedAt` recorded, overwrite on re-learn, local-only exclusion from `encodeStore` output and export file
- [x] 5.3 Rename suite: move preserves content, `updatedAt` advances, old key tombstoned, sync-convergence via `merge` (renamed store + stale remote → new key wins, no duplicate/resurrection)
- [x] 5.4 Hijack suite: withhold renders empty panel, orphan preserved with no tombstone, no auto-carry of text/color, no auto-delete without explicit action, orphan surfaced for review
- [x] 5.5 Merge commutativity fixtures with `userId` present/absent/mismatched: pure, commutative, idempotent, lossless incl. randomized runs
- [x] 5.6 UPDATE core/sync suites whose `NoteRecord` literals gain the optional field: `src/core/storage.test.ts`, `src/core/import-export.test.ts`, `src/core/filters.test.ts`, `src/sync/merge.test.ts`, `src/sync/scheduler.test.ts`, `src/sync/crypto.test.ts`
- [x] 5.7 UPDATE UI/options/integration suites: `src/ui/badges.test.ts`, `src/ui/panel.test.ts`, `entrypoints/options/manager.test.ts`, `tests/integration/webdav.test.ts`, `tests/integration/s3.test.ts`; keep `// @vitest-environment happy-dom` header on all DOM tests

## 6. Validation + docs

- [x] 6.1 Run `make typecheck`, `make lint`, `make test` green via Docker toolchain (no host Node)
- [x] 6.2 Run `make integration` green (required: `encodeStore`/`canonicalNote` bytes changed) and `openspec validate persist-x-user-id` clean
- [x] 6.3 Add `MANUAL_TESTING.md` entries for the three live-browser open questions: JSON-LD SPA-refresh staleness, protected/suspended/logged-out identifier/banner presence, logged-out hover reachability

## 7. Final invariants

- [x] 7.1 Verify no new permissions/hosts in `wxt.config.ts`/manifest and no MAIN-world injection or new network surfaces
- [x] 7.2 Verify zero `as` assertions in `src/` and `entrypoints/` (grep) and validate-by-construction holds in all new parsers
- [x] 7.3 Verify single-write-path intact: only `src/core/storage.ts` touches `browser.storage.local`

## Forward-compat record (1.4)

Outcome: **new `toNoteRecord` preserves** a valid digits-only `userId` and drops
absent/invalid (unit-tested in `src/core/storage.test.ts`). An **old client**
(pre-change parser, which rebuilds `NoteRecord` field-by-field without `userId`)
**drops** the field on parse, so a sync round-trip through an old client strips
IDs — they are re-learned on the next profile visit; keys, tombstones, and merge
outcomes are unaffected, so this is operationally safe. `merge` never strips the
field on new clients: it carries winning `NoteRecord` objects wholesale and never
rebuilds them (`canonicalNote` only affects tie-break bytes); covered by the
`userId` commutativity fixtures in `src/sync/merge.test.ts`.
