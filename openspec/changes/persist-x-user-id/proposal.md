## Why

xNotes keys every note by lowercased X handle (`NoteRecord {handle, handleLower, text, color, createdAt, updatedAt}`, `StoreV2` maps keyed by handle). X handles are unstable and reusable: a user can change their handle at any time, and X can reassign a released handle to a completely different account.

This creates two failures, one of them actively dangerous:

1. **Rename orphans the note.** When a noted account changes its handle, the existing note stays under the old key and never appears on the new profile. The user loses context silently.
2. **Handle reuse shows the WRONG note.** When a different person claims a previously-noted handle, xNotes today displays the old owner's private note on the new owner's profile. Private context about one person presented as fact about another is a trust-destroying misattribution.

X provides a stable numeric user ID (`rest_id`) that survives renames and distinguishes reuse. Persisting it alongside each note lets xNotes treat the ID — not the handle string — as the authority for "is this the same person," fixing both failures while keeping today's handle-keyed behavior as the graceful fallback where no ID is known.

## What Changes

- Persist the stable numeric X user ID alongside each note, learned opportunistically on profile-page visits from already-rendered page data, with ordered fallbacks ending in pure handle-keyed behavior as today when no ID is recoverable.
- Make the ID the authority for rename/hijack decisions: same ID under a new handle is a rename (the note follows the account, with the old key retired so sync converges); the same handle under a different ID is a hijack/reuse (the old note is withheld from the profile and surfaced as an orphan for explicit user action instead of being shown to the wrong person).
- Keep notes, tombstones, merge, wire format, and export handle-keyed: no schema migration and no breaking sync change. The ID is additive confidence, never a new sync key.
- Add a new local-only alias store recording known ID↔handle bindings. It is never synced, like `xnotes:sync-state` / settings / view.
- Hover cards and timeline avatars expose handles only and stay handle-matched; only full profile visits can teach IDs.
- ID learning uses isolated-world DOM text already present in the page and requires no new host permissions; WXT's default isolated world shares only DOM (MAIN world is Chromium-only), so this approach preserves cross-browser support.
- Implementation mandates for this change: unit tests for ALL new code plus updates to affected existing tests; JSDoc docblocks on all new/changed functions. The JSDoc requirement is an EXPLICIT approved deviation from the repo's no-comments-except-`ponytail` rule (`AGENTS.md`), recorded here.

## Capabilities

### New Capabilities

- **`user-identity`**: learning and persisting stable X user IDs, the local-only ID↔handle alias store, and the rename vs. hijack/reuse policy (note follows on rename; note withheld and orphaned on reuse).

### Modified Capabilities

- **`profile-notes-ui`**: panel reflects ID-backed state, including a formerly-known-handle hint after a rename and withholding the note on detected handle reuse.
- **`notes-manager`**: surfaces orphaned notes from renames/reuse for explicit user action and displays formerly-known-handle context.
- `notes-storage` is intentionally NOT listed as modified: its requirements do not change because the `StoreV2` schema version is unchanged and the ID is an optional additive field only.

## Impact

- **Users:** notes survive renames instead of silently disappearing; reused handles no longer display a stranger's private note. Worst case (no ID ever learned) degrades exactly to today's behavior.
- **Sync/compat:** no migration, no wire-format change, no cross-device behavior change — remote blobs, merge semantics, and exports are untouched; the alias store stays per-device local-only.
- **Permissions/compat:** no new permissions, no MAIN-world execution, no Firefox-incompatible APIs; hover/timeline flows are unchanged.
- **Risk:** IDs are learned opportunistically, so coverage builds gradually per visited profile rather than all at once; until an ID is known, the existing handle-keyed risks for that note remain.
