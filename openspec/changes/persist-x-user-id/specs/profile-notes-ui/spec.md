# profile-notes-ui — Delta Spec

## ADDED Requirements

### Requirement: Withheld note on handle reuse

The panel SHALL withhold the stored note when the visited handle's observed user ID differs from the recorded binding, and SHALL show the empty note state instead of the previous owner's text or color.

#### Scenario: Reused handle shows empty state

- **WHEN** a profile is visited whose observed user ID differs from the user ID recorded for that handle's existing note
- **THEN** the panel shows the empty state with no text or color from the withheld note

#### Scenario: Withheld note never leaks into view

- **WHEN** a reuse withholding is in effect for the visited handle
- **THEN** neither the panel view mode nor its edit textarea is pre-filled with the withheld note's content

### Requirement: Formerly-known-handle hint after rename

After a note has followed its account to a new handle via a rename move, the panel on the new handle SHALL display a hint naming the formerly-known handle the note was moved from.

#### Scenario: Hint visible after rename

- **WHEN** the user visits the new handle of a renamed account that carried a note
- **THEN** the panel shows the note content together with a hint referencing the old handle

#### Scenario: No hint without rename

- **WHEN** a note was created directly under the visited handle with no rename move
- **THEN** no formerly-known-handle hint is shown

### Requirement: Fail-soft identity learning on profile flow

Identity learning on the profile flow SHALL run fail-soft: unparseable or absent page ID data SHALL leave the panel fully usable, and the panel SHALL fall back to handle-keyed load and save with no error surfaced to the user.

#### Scenario: Malformed page data still renders panel

- **WHEN** the profile page contains malformed or missing ID evidence
- **THEN** the panel still renders for the URL handle and no error is shown

#### Scenario: Missing ID still saves by handle

- **WHEN** no usable user ID is learned during a profile visit and the user saves a note
- **THEN** the note is saved under the handle key and reloads on revisit
