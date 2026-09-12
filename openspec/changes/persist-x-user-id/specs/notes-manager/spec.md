# notes-manager — Delta Spec

## ADDED Requirements

### Requirement: Orphaned notes listing

The all-notes page SHALL list orphaned notes withheld from profiles due to handle reuse, each with its last-known handle and the recorded user ID context that distinguishes it from the current holder of the handle.

#### Scenario: Withheld note appears as orphan

- **WHEN** a note has been withheld from its handle due to a user ID mismatch and the all-notes page is opened
- **THEN** the note appears in an orphaned state showing its last-known handle and the identity context, separate from any note for the current holder

#### Scenario: No orphans means no orphan section

- **WHEN** no notes are currently withheld and the all-notes page is opened
- **THEN** no orphan entries are shown and the regular list is unaffected

### Requirement: Explicit orphan actions

The all-notes page SHALL offer explicit user actions to delete an orphaned note or reassign its content to a chosen handle, and SHALL NEVER auto-resolve, auto-carry, or auto-delete orphans.

#### Scenario: Explicit delete removes orphan

- **WHEN** the user explicitly deletes an orphaned note and confirms
- **THEN** the orphan is removed, a deletion marker is written for its key, and it no longer appears in the orphan list

#### Scenario: Explicit reassign binds content to chosen handle

- **WHEN** the user explicitly reassigns an orphaned note's content to a chosen handle
- **THEN** a note with that text and color appears under the chosen handle and the orphan entry is resolved

#### Scenario: Orphan persists without user action

- **WHEN** an orphaned note exists and the user takes no action on it
- **THEN** the orphan remains listed and no note content is carried onto the reused handle's profile

### Requirement: Formerly-known-handle display

Notes that arrived under their current handle via a rename move SHALL display their formerly-known-handle context in the all-notes page alongside the current handle.

#### Scenario: Renamed note shows former handle

- **WHEN** the all-notes page lists a note that moved to a new handle after a rename
- **THEN** the entry shows the current handle together with a reference to the formerly-known handle

#### Scenario: Direct note shows no former handle

- **WHEN** the all-notes page lists a note created directly under its handle with no rename move
- **THEN** no formerly-known-handle reference is shown for that entry
