# notes-manager — Delta Spec

## ADDED Requirements

### Requirement: All-notes page

The extension SHALL provide an all-notes page as the options page, opened in a tab, listing every stored note with the profile handle (linked to `https://x.com/<handle>` in a new tab with `rel="noopener noreferrer"`), note text, color, and updated timestamp. The page SHALL offer table and card views with the preference persisted locally.

#### Scenario: List all notes

- **WHEN** the user opens the all-notes page with 12 notes stored
- **THEN** all 12 notes are listed with handle, text, color, and updated time

#### Scenario: Handle link opens profile

- **WHEN** the user clicks a handle link
- **THEN** `https://x.com/<handle>` opens in a new tab

#### Scenario: Empty state

- **WHEN** the page is opened with zero notes stored
- **THEN** a helpful empty state is shown (no broken/blank list), pointing the user to X profiles to start noting

### Requirement: Search

The page SHALL provide a search box filtering notes by profile name or note text, case-insensitively, with a result count shown while filtered.

#### Scenario: Search by handle

- **WHEN** the user types a partial handle
- **THEN** only notes whose handle or text match are shown, with a "N of M notes" count

### Requirement: Color filter

The page SHALL provide a multi-select color filter covering all palette keys plus "none", combinable with the search filter.

#### Scenario: Filter by color

- **WHEN** the user selects the `red` filter
- **THEN** only notes with color `red` are shown; selecting additional colors widens the result set

### Requirement: Inline edit and delete

The page SHALL allow editing a note's text and color inline within the list and deleting a note with explicit confirmation. Edits and deletes SHALL go through the storage module (delete writes a tombstone).

#### Scenario: Inline edit persists

- **WHEN** the user edits a note's text in the list and saves
- **THEN** the change is persisted and visible on the corresponding X profile

#### Scenario: Delete confirmed

- **WHEN** the user deletes a note and confirms
- **THEN** the note disappears from the list and a tombstone is written

### Requirement: Live updates

The page SHALL refresh automatically when the store changes (local edit elsewhere, sync merge, import), and SHALL suppress refresh of a row/card currently being edited.

#### Scenario: Sync merge updates list

- **WHEN** a sync cycle merges in a new remote note while the page is open
- **THEN** the new note appears in the list without a manual reload

#### Scenario: Edit not clobbered

- **WHEN** a store change arrives while the user is mid-edit on a note
- **THEN** the user's in-progress edit is preserved

### Requirement: Export and import UI

The page SHALL provide "Export JSON" (downloads the backup file per the notes-storage export requirement) and "Import JSON" (file picker, then merge or replace mode selection per the notes-storage import requirement, with replace double-confirmed).

#### Scenario: Backup round-trip

- **WHEN** the user exports, wipes local data, and imports the file in merge mode
- **THEN** all notes, including colors and timestamps, are restored together with the formerly-known-handle context for renamed notes

#### Scenario: Invalid import rejected

- **WHEN** the user imports a file that is not valid xNotes JSON
- **THEN** the import is rejected with a clear message and the store is unchanged

### Requirement: Mandatory automated tests for manager logic

The project SHALL include automated unit tests covering: search filtering (handle and text, case-insensitivity), color-filter combination logic, export file naming and contents, import mode selection flows (merge vs replace, confirmation abort), invalid-import rejection, and live-refresh suppression while editing.

#### Scenario: Manager suite runs green in Docker

- **WHEN** `make test` is run
- **THEN** all manager logic suites above pass inside the Docker container
