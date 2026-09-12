# user-identity — Spec

## ADDED Requirements

### Requirement: Stable ID learning

The system SHALL learn the stable digits-only user ID for a visited profile from page data in strict priority order: first the profile page JSON-LD block (`mainEntity.identifier`), cross-checked against the handle in the profile URL, then the profile banner URL numeric segment with the same cross-check, else unknown. The system SHALL accept only digits-only identifiers and SHALL discard any read whose embedded handle does not match the current URL handle.

#### Scenario: Valid JSON-LD learned

- **WHEN** a profile page contains a JSON-LD block whose identifier is digits-only and whose embedded handle matches the profile URL handle
- **THEN** the system records that user ID as known for the lowercased handle

#### Scenario: Stale-head mismatch discarded

- **WHEN** the JSON-LD block's embedded handle does not match the current profile URL handle
- **THEN** the read is discarded and previously recorded bindings are left unchanged

#### Scenario: Malformed JSON ignored

- **WHEN** the JSON-LD block is missing, unparseable, or lacks a usable identifier
- **THEN** the JSON-LD source yields unknown and no binding is recorded from it

#### Scenario: Non-digit identifier ignored

- **WHEN** the JSON-LD identifier is present but contains anything other than digits
- **THEN** the read is ignored and treated as unknown

#### Scenario: Banner fallback learned

- **WHEN** no usable JSON-LD identifier exists but the profile banner image URL embeds a numeric user segment and the page handle matches the URL handle
- **THEN** the system records that numeric user ID as known for the lowercased handle

#### Scenario: Unknown behaves as today

- **WHEN** neither the JSON-LD block nor the banner URL yields a usable digits-only ID
- **THEN** notes for that handle are saved and loaded by handle exactly as before, with no binding recorded

### Requirement: Local-only alias store

The system SHALL persist learned bindings of lowercased handle to user ID plus observation time in local-only storage. The alias store SHALL NEVER be synced to remotes, included in the uploaded sync blob, or included in exports.

#### Scenario: Alias written on learn

- **WHEN** a digits-only user ID is learned for a profile handle
- **THEN** a local binding of lowercased handle to user ID with the observation time is stored

#### Scenario: Alias absent from uploaded blob

- **WHEN** sync uploads the store to a backend after aliases have been learned
- **THEN** the uploaded payload contains notes and deletion markers only, with no alias bindings

#### Scenario: Alias absent from export

- **WHEN** the user exports a backup after aliases have been learned
- **THEN** the exported file contains notes and deletion markers only, with no alias bindings

### Requirement: Rename policy

When the same user ID is observed under a new handle, the system SHALL move the note to the new handle key preserving text, color, and creation time while advancing the update time, and SHALL retire the old handle key with a deletion marker so synced devices converge.

#### Scenario: Rename moves note with content preserved

- **WHEN** a user ID already bound to a noted handle is observed under a different handle
- **THEN** the note appears under the new handle with the same text, color, and creation time and a newer update time

#### Scenario: Old key retired on rename

- **WHEN** a rename move completes
- **THEN** the old handle key no longer resolves to a note and carries a deletion marker

#### Scenario: Rename converges across sync

- **WHEN** a renamed store merges with a remote copy that still holds the note under the old handle key
- **THEN** the merged store keeps the note under the new handle key and keeps the deletion marker under the old key, with no duplicate and no resurrection of the old key

### Requirement: Hijack policy

When a handle is observed with a different user ID than the recorded binding, the system SHALL withhold the existing note from the profile surface, SHALL keep it as an orphan, SHALL surface it for explicit user action, and SHALL NEVER automatically carry its text onto the new owner or automatically delete it.

#### Scenario: Note withheld on reuse

- **WHEN** a visited handle's observed user ID differs from the recorded user ID for that handle's existing note
- **THEN** the profile surface does not display the existing note's text

#### Scenario: Orphan preserved

- **WHEN** a handle reuse is detected
- **THEN** the existing note record is retained as an orphan rather than removed

#### Scenario: Never auto-carried onto new owner

- **WHEN** a reused handle with a withheld note is visited
- **THEN** the new owner is shown an empty note state, not the previous owner's text or color

#### Scenario: Never auto-deleted on suspicion

- **WHEN** a handle reuse is detected
- **THEN** no deletion marker is written for the withheld note without an explicit user delete action

#### Scenario: Orphan surfaced for explicit action

- **WHEN** a note has been withheld due to handle reuse
- **THEN** the orphan is listed for review with its last-known handle context, awaiting an explicit user delete or reassign decision

### Requirement: Graceful unknown

When the stored note or the observed profile, or both, have no known user ID, the system SHALL behave exactly as handle-keyed notes do today for load, save, and display.

#### Scenario: Stored note without ID loads by handle

- **WHEN** a stored note has no recorded user ID and its handle profile is visited
- **THEN** the note loads by handle match exactly as before

#### Scenario: Observed profile without ID saves by handle

- **WHEN** a visited profile yields no usable user ID
- **THEN** saving a note stores it under the handle key with no ID attached, and loading follows the handle key

#### Scenario: Both sides unknown unchanged

- **WHEN** neither the stored note nor the observed profile has a known user ID
- **THEN** all panel, list, and sync-visible behavior is identical to handle-keyed behavior with no user-visible change
