# notes-storage — Delta Spec

## ADDED Requirements

### Requirement: Schema v2 data model
The system SHALL persist notes as a single `StoreV2` object: `{ schemaVersion: 2, notes: Record<handleLower, NoteRecord>, tombstones: Record<handleLower, deletedAtEpochMs> }`, where `NoteRecord = { handle, handleLower, text, color, createdAt, updatedAt }` with epoch-millisecond timestamps and `color` a palette key or null. The store SHALL live under the storage key `xnotes:store` in `browser.storage.local`.

#### Scenario: Store shape round-trip
- **WHEN** a note is saved and the extension is reloaded
- **THEN** the store read back contains the note under its `handleLower` key with all fields intact and `schemaVersion: 2`

#### Scenario: Tombstone recorded on delete
- **WHEN** an existing note for `@someuser` is deleted
- **THEN** `notes["someuser"]` is removed AND `tombstones["someuser"]` is set to the deletion timestamp

### Requirement: Handle normalization and keying
The system SHALL normalize handles by stripping a leading `@`, trimming whitespace, and lowercasing for the storage key, while preserving original casing in `NoteRecord.handle` for display.

#### Scenario: Case- and @-insensitive lookup
- **WHEN** a note exists for `@SomeUser` and the profile page for `someuser` is opened
- **THEN** the existing note is loaded into the panel

### Requirement: Single write path
All reads and writes of note data SHALL go through one storage module; no other module SHALL access extension storage for note data directly. All note-data mutations SHALL emit a change event observable by the content script, manager page, and sync scheduler.

#### Scenario: Sync scheduler observes local edits
- **WHEN** the user saves a note from the panel
- **THEN** the sync scheduler receives a storage-change notification for `xnotes:store` without polling

### Requirement: Validate-by-construction parsing
The storage module SHALL rebuild valid `StoreV2` objects from `unknown` input (storage reads, imports, remote payloads) without type assertions. Malformed fields SHALL fall back to safe defaults (e.g. missing `createdAt` → 0, missing `updatedAt` → `createdAt`, invalid `color` → null, non-string `text` → empty string); records with a missing/invalid handle SHALL be dropped.

#### Scenario: Corrupted field defaults
- **WHEN** storage contains a note with `updatedAt` missing and `color: 42`
- **THEN** the parsed record has `updatedAt = createdAt` and `color = null`

#### Scenario: Invalid record dropped
- **WHEN** storage contains a note record with an empty handle
- **THEN** the parsed store omits that record and all valid records remain

### Requirement: Corrupt store quarantine
If the stored blob cannot be parsed into a `StoreV2` at all, the system SHALL NOT silently discard it; it SHALL move the raw value to a quarantine key (`xnotes:corrupt-<timestamp>`) and start from an empty store.

#### Scenario: Unparseable blob quarantined
- **WHEN** `xnotes:store` contains invalid JSON/binary garbage
- **THEN** the raw value is preserved under a quarantine key, the active store is empty, and the extension functions normally

### Requirement: Upsert and delete semantics
Saving a note SHALL set `createdAt` only on first creation and update `updatedAt` on every save. Saving whitespace-only text for an existing note SHALL delete it (writing a tombstone). Deletes SHALL write tombstones, never physical-only removal.

#### Scenario: Update preserves createdAt
- **WHEN** an existing note is edited and saved
- **THEN** `createdAt` is unchanged and `updatedAt` is advanced

#### Scenario: Empty text deletes
- **WHEN** the user saves a note whose text is only whitespace
- **THEN** the note is removed and a tombstone is written for its handle

### Requirement: Local-only keys never synced
Per-device sync state (`xnotes:sync-state`), backend settings/credentials (`xnotes:settings`), and view preferences (`xnotes:view`) SHALL be stored under separate keys and SHALL never be included in the uploaded blob. The uploaded blob SHALL contain exactly the `StoreV2` (optionally wrapped in an encryption envelope).

#### Scenario: Device identity stays local
- **WHEN** sync uploads the store to a backend
- **THEN** the uploaded payload contains no `deviceId`, credentials, or view preferences

### Requirement: JSON export
The system SHALL export the full store as a JSON file named with the pattern `xnotes-backup-YYYYMMDD.json` containing the `StoreV2` including tombstones.

#### Scenario: Export contains tombstones
- **WHEN** the user exports after deleting a note
- **THEN** the downloaded JSON includes the tombstone entry so re-import cannot resurrect the note

### Requirement: JSON import with schema v1 compatibility
The system SHALL import JSON in both schema v2 and the reference extension's schema v1 shape (`{ schemaVersion: 1, notes: {...} }`, no tombstones), converting v1 by adding an empty tombstone map. Import SHALL support two modes: `merge` (per-entry last-write-wins through the sync merge function) and `replace` (full overwrite after explicit confirmation).

#### Scenario: Import v1 export
- **WHEN** the user imports a twitter-notes v1 backup in merge mode
- **THEN** its notes appear with their original timestamps and the store remains valid schema v2

#### Scenario: Merge import resolves by timestamp
- **WHEN** an imported note for a handle has a newer `updatedAt` than the local note
- **THEN** the imported note wins; when the local note is newer, the local note is kept

#### Scenario: Replace requires confirmation
- **WHEN** the user chooses replace mode
- **THEN** the system asks for explicit confirmation before overwriting, and aborts on decline

### Requirement: Mandatory automated tests for storage logic
The project SHALL include automated unit tests covering: validate-by-construction defaults for every malformed-field case; invalid-record dropping; corrupt-blob quarantine and recovery; handle normalization; upsert `createdAt`/`updatedAt` semantics; whitespace-only-save deletion with tombstone; tombstone writing on delete; local-only keys excluded from any serialized upload payload; export file contents including tombstones; import round-trip, schema v1 conversion, merge-mode LWW resolution in both directions, and invalid-file rejection.

#### Scenario: Storage suite runs green in Docker
- **WHEN** `make test` is run from a clean checkout
- **THEN** all storage test suites above execute inside the Docker container and pass with no host-side Node installation
