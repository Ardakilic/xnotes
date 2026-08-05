# profile-notes-ui — Delta Spec

## ADDED Requirements

### Requirement: Profile URL detection

The system SHALL detect profile pages with a pure URL parser (no DOM dependency): host is `x.com` or `twitter.com` (with or without `www.`), the path has a first segment matching `^[A-Za-z0-9_]{1,15}$` that is not a reserved route, and an optional second segment only if it is a known profile subtab. Reserved first segments SHALL include at least: `home, explore, notifications, messages, bookmarks, search, settings, i, compose, lists, hashtag, tos, privacy, about, login, logout, signup, intent, share, account, communities, premium, premium_sign_up, verified_orgs, jobs, topics, connect_people, follower_requests, your_twitter_data, personalization, display, download, flow, oauth, oauth2, widgets, tweet, status, home_timeline, mentions, moments, analytics, ads, help, who_to_follow, graphql, live, broadcasts, spaces`. Profile subtabs SHALL include at least: `with_replies, media, likes, highlights, superfollows, affiliates, articles, verified_followers`. Detection SHALL be case-insensitive for host, reserved words, and subtabs.

#### Scenario: Plain profile

- **WHEN** the URL is `https://x.com/jack`
- **THEN** the parser returns handle `jack`

#### Scenario: Subtab profile

- **WHEN** the URL is `https://x.com/jack/with_replies`
- **THEN** the parser returns handle `jack`

#### Scenario: Reserved route rejected

- **WHEN** the URL is `https://x.com/home` or `https://x.com/i/flow/login`
- **THEN** the parser returns "not a profile"

#### Scenario: Unknown second segment rejected

- **WHEN** the URL is `https://x.com/jack/unknownthing`
- **THEN** the parser returns "not a profile"

#### Scenario: Invalid handle rejected

- **WHEN** the URL is `https://x.com/way-too-long-handle-name` (over 15 chars) or contains characters outside `[A-Za-z0-9_]`
- **THEN** the parser returns "not a profile"

#### Scenario: Non-X host rejected

- **WHEN** the URL is `https://example.com/jack`
- **THEN** the parser returns "not a profile"

### Requirement: Panel injection anchored to stable markup

On profile pages the system SHALL inject the note panel immediately after the element matching `[data-testid="primaryColumn"] [data-testid="UserName"]`, polling up to 4 seconds for the anchor. If the anchor never appears, the system SHALL fail soft: no panel, no error surfaced to the user, note data untouched.

#### Scenario: Panel appears on profile load

- **WHEN** a profile page finishes rendering
- **THEN** the note panel is visible directly below the user-name header block

#### Scenario: Markup change fails soft

- **WHEN** X changes its markup and the anchor selector matches nothing for 4 seconds
- **THEN** no panel is rendered, no exception escapes the content script, and stored notes are intact

### Requirement: Panel modes

The panel SHALL have three modes: **empty** (an "Add note" affordance plus a link to the all-notes page), **view** (note text with preserved line breaks, plus Edit and All-notes links), and **edit** (a textarea of at least 3 rows, color swatches, Save/Cancel/Delete buttons). The panel SHALL visibly identify the user it belongs to by displaying the `@handle` extracted from the profile URL. Saving SHALL persist through the storage module; Delete SHALL remove via tombstone.

#### Scenario: First visit shows empty mode

- **WHEN** the profile has no note
- **THEN** the panel shows the empty mode

#### Scenario: Edit and save

- **WHEN** the user opens edit mode, types text, picks a color, and saves
- **THEN** the panel returns to view mode showing the saved text and color accent, and the store is updated

#### Scenario: Delete from panel

- **WHEN** the user deletes the note from the panel
- **THEN** the panel returns to empty mode and a tombstone exists for the handle

#### Scenario: Panel identifies the user

- **WHEN** the panel renders on `/jack`
- **THEN** the panel visibly references `@jack`

### Requirement: Keyboard behavior in the editor

In the edit textarea, Enter SHALL save, Shift+Enter SHALL insert a newline, and save SHALL be suppressed while an IME composition is in progress (`isComposing`).

#### Scenario: Enter saves

- **WHEN** the user presses Enter in the textarea without Shift
- **THEN** the note is saved

#### Scenario: IME composition guarded

- **WHEN** a keydown Enter arrives with `isComposing` true
- **THEN** the note is NOT saved

### Requirement: Color labels

The system SHALL offer a fixed palette of label keys `red, orange, yellow, green, blue, purple, pink, teal, lime, brown, indigo` plus "none". Palette keys SHALL be stored in data; concrete hex values SHALL live only in CSS. The selected color SHALL render as the panel accent and as the avatar badge color.

#### Scenario: Color persists

- **WHEN** a note is saved with color `teal` and the profile is revisited
- **THEN** the panel accent and avatar badge render in teal

### Requirement: SPA navigation handling

The content script SHALL detect client-side navigations by combining href diffing, a debounced MutationObserver on the document body, and a low-frequency interval backstop. On navigation to a different profile the panel SHALL remount for the new handle; a navigation token SHALL invalidate in-flight mounts from the previous page.

#### Scenario: Navigate between profiles

- **WHEN** the user clicks from `/jack` to `/elonmusk` without a full page load
- **THEN** the panel disappears and reappears bound to `elonmusk` within ~1 second of the new header rendering

#### Scenario: Stale mount discarded

- **WHEN** navigation occurs while the previous profile's anchor is still being awaited
- **THEN** the stale mount is aborted and no panel for the old handle appears on the new page

### Requirement: Stale extension context safety

The content script SHALL verify the extension context is alive (`browser.runtime?.id`) and SHALL stop observers/intervals when it is not. Storage calls SHALL fail soft after "Extension context invalidated" errors (e.g. after the extension updates or reloads), without throwing into the host page.

#### Scenario: Extension updated while page open

- **WHEN** the extension is reloaded while an X tab is open
- **THEN** the page keeps working, no uncaught errors are thrown into the page, and observers are torn down

### Requirement: Avatar badges and hover cards

For any rendered avatar whose owning handle has a note (selector prefix `[data-testid="UserAvatar-Container-"]`, handle parsed from the testid), the system SHALL decorate the avatar with a colored badge matching the note color, idempotently on every navigation tick, and SHALL inject the note text into X's hover card (`[data-testid="HoverCard"]`) when one is shown. The currently viewed profile's own avatar SHALL NOT be badged.

#### Scenario: Badge in timeline

- **WHEN** the timeline shows an avatar of a noted user
- **THEN** the avatar carries the note-color badge

#### Scenario: No self-badge

- **WHEN** viewing `/jack`'s own profile
- **THEN** the profile header avatar carries no badge even though a note exists

### Requirement: Theme adaptation

The panel and badge styles SHALL adapt to X's current light/dark theme (detected from the page's background luminance) so the panel remains readable in both themes.

#### Scenario: Dark theme

- **WHEN** X is in dark mode
- **THEN** the panel renders with dark-theme colors and readable contrast

### Requirement: Panel live-updates on external store changes

The panel SHALL subscribe to store change events and refresh its display when the note for the currently viewed handle changes from outside the panel (another tab showing the same profile, the all-notes page, or a sync merge), and SHALL NOT clobber an edit currently in progress in the panel.

#### Scenario: Sync merge updates open panel

- **WHEN** a sync cycle merges in a newer version of the note for the profile being viewed
- **THEN** the panel's view mode shows the merged text without a page reload

#### Scenario: Two tabs, same profile

- **WHEN** the same profile is open in two tabs and the note is saved in one
- **THEN** the other tab's panel shows the updated note

#### Scenario: In-progress edit preserved

- **WHEN** an external store change arrives while the user is editing in the panel
- **THEN** the textarea content being edited is not overwritten

### Requirement: Basic accessibility

Panel interactive elements SHALL be native focusable elements (buttons, textarea, links) with accessible names; color swatches SHALL expose their selection state (`aria-pressed`) and a non-color label (title/aria-label); the panel root SHALL carry an identifying aria-label. Functionality SHALL not depend on hover alone.

#### Scenario: Keyboard-only use

- **WHEN** a keyboard user tabs into the panel
- **THEN** they can reach and activate Add/Edit/Save/Delete and the swatches, with visible focus indication

### Requirement: Mandatory automated tests for content-script logic

The project SHALL include automated unit tests covering: the profile parser (every scenario in this spec's profile-detection requirement, including each RESERVED entry and subtab), navigation-token invalidation logic, stale extension-context teardown, theme detection from background luminance, and panel mode transitions (empty → edit → view → empty via save/delete). DOM-dependent behavior SHALL be tested against a minimal DOM shim; anything not unit-testable SHALL be covered by the documented manual checklist.

#### Scenario: Parser suite exhaustive

- **WHEN** `make test` runs
- **THEN** the profile parser suite includes at least one case per scenario of the Profile URL detection requirement and passes inside Docker
