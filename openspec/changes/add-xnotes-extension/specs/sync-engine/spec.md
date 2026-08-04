# sync-engine — Delta Spec

## ADDED Requirements

### Requirement: Merge algorithm

The system SHALL merge local and remote `StoreV2` values with a pure function implementing per-entry last-write-wins: for each handle in the union of both sides' notes and tombstones, the candidate with the greatest timestamp wins (`updatedAt` for notes, `deletedAt` for tombstones). Tie-breaks SHALL be position-independent: (1) at equal timestamps a tombstone beats a note; (2) between two notes with equal timestamps, the winner is the deterministically larger canonical serialization (JSON with sorted keys). Tombstones older than 90 days SHALL be dropped (garbage collected). The function SHALL be commutative (`merge(a,b)` equals `merge(b,a)`), idempotent (`merge(x,x)` equals `x`), and lossless (no candidate entry silently dropped).

#### Scenario: Concurrent edits, newer wins

- **WHEN** local has note A updated at t2 and remote has note A updated at t1 < t2
- **THEN** the merged store contains the t2 version

#### Scenario: Delete beats older edit

- **WHEN** remote has a note updated at t1 and local has a tombstone for the same handle at t2 > t1
- **THEN** the merged store has the tombstone and no note

#### Scenario: Edit beats older delete

- **WHEN** local has a tombstone at t1 and remote has a note re-created at t2 > t1
- **THEN** the merged store contains the note

#### Scenario: Tombstone wins timestamp tie

- **WHEN** a note's `updatedAt` equals a tombstone's `deletedAt` for the same handle
- **THEN** the merged store has the tombstone

#### Scenario: Commutativity

- **WHEN** merge is computed as merge(a,b) and as merge(b,a) for arbitrary stores a, b
- **THEN** both results are deep-equal

#### Scenario: Tombstone GC

- **WHEN** a tombstone is older than 90 days
- **THEN** the merged store omits it

### Requirement: Sync cycle

A sync cycle SHALL: (1) GET the remote blob sending `If-None-Match` with the last known remote ETag, treating a 304 as "remote unchanged"; (2) merge local with remote; (3) write the merged store locally if it differs from local; (4) PUT the merged store if it differs from remote, using optimistic locking (`If-Match` with the fetched ETag, or the S3 HEAD-compare fallback); (5) persist `lastSyncAt`, the new remote ETag, and `status: 'idle'`. A cycle SHALL be a no-op when nothing changed on either side.

#### Scenario: Remote unchanged fast path

- **WHEN** the remote answers 304 to the conditional GET and local has no changes
- **THEN** no merge write and no PUT happen and status becomes idle

#### Scenario: Remote-only change pulled

- **WHEN** remote contains a note absent locally
- **THEN** the note appears in the local store after the cycle and no PUT is issued

#### Scenario: Local-only change pushed

- **WHEN** local contains a change absent remotely
- **THEN** the cycle PUTs the merged blob and stores the returned ETag

### Requirement: Conflict retry

When a PUT fails with 412/precondition-failed, the cycle SHALL re-GET the remote, re-merge, and retry, up to 3 attempts per cycle; after the final failure the cycle SHALL end in error state without corrupting local data.

#### Scenario: Concurrent push conflict resolves

- **WHEN** another device pushed between our GET and PUT, causing a 412
- **THEN** the engine re-fetches, merges both devices' changes, and the retry PUT succeeds within the attempt budget

#### Scenario: Retry budget exhausted

- **WHEN** 3 consecutive PUT attempts fail with 412
- **THEN** sync status becomes `error` with a recorded cause, and local data remains intact

### Requirement: Single-flight execution

At most one sync cycle SHALL run at a time; overlapping triggers SHALL be coalesced, not queued in parallel.

#### Scenario: Overlapping triggers coalesce

- **WHEN** an alarm fires while a cycle is already running
- **THEN** no second concurrent cycle starts; the pending trigger runs after the current cycle completes or is dropped in favor of the freshest state

### Requirement: Sync triggers

Sync cycles SHALL be triggered by: a periodic alarm every N minutes (default 5, user-configurable, minimum 1); a debounced trigger ~10 seconds after any local store change while a backend is configured; a manual "Sync now" action from the popup; browser startup; and immediately after a backend is first configured and activated. No periodic or debounced syncing SHALL occur while no backend is configured.

#### Scenario: Debounced push after edit

- **WHEN** the user saves a note with a backend configured
- **THEN** a sync cycle starts within ~15 seconds without user action

#### Scenario: No backend, no sync attempts

- **WHEN** no backend is configured
- **THEN** no alarms, network requests, or error states related to sync exist

#### Scenario: First sync on configuration

- **WHEN** the user activates a backend for the first time
- **THEN** a sync cycle runs immediately, pulling any existing remote data before the user waits for the next alarm

### Requirement: Sync state

The system SHALL persist per-device sync state under `xnotes:sync-state`: a `deviceId` (random UUID generated once), `lastSyncAt`, `lastRemoteEtag`, `status` (`idle | syncing | error`), and `lastError`. This state SHALL never be uploaded.

#### Scenario: Device id stable

- **WHEN** the extension restarts
- **THEN** `deviceId` is unchanged from before the restart

### Requirement: Error handling and backoff

Failed cycles SHALL record a human-readable `lastError`, set status to `error`, and schedule retries with exponential backoff (1, 2, 4, … minutes, capped at 60). Auth failures detected by `probe()` SHALL surface as configuration errors, not endless retries.

#### Scenario: Server unreachable

- **WHEN** the backend is unreachable during a cycle
- **THEN** status is `error` with the cause recorded, and the next attempt is delayed by backoff

#### Scenario: Bad credentials surfaced

- **WHEN** the backend rejects credentials during probe
- **THEN** the user sees an authentication error in settings/popup rather than repeated silent retries

### Requirement: Status surfaces

The popup SHALL show sync status (last sync time, current state, last error), a "Sync now" button, a link to sync settings, and a link to the all-notes page. When no backend is configured, the popup SHALL indicate local-only mode instead of an error. The toolbar icon SHALL show a visual error indicator (badge) while status is `error`.

#### Scenario: Error visible in popup

- **WHEN** the last sync failed
- **THEN** the popup shows the error cause and the toolbar badge indicates failure

### Requirement: Mandatory automated tests for the sync engine

The project SHALL include automated unit tests covering: every merge scenario in this spec (including randomized commutativity/idempotency cases and the 90-day GC boundary); the full cycle against an in-memory fake adapter (pull-only, push-only, no-op, 304 fast path); 412 retry success within budget and exhaustion; single-flight coalescing under overlapping triggers; backoff sequence; device-id stability; and the no-backend-configured no-op behavior.

#### Scenario: Engine suite runs green in Docker

- **WHEN** `make test` is run
- **THEN** all sync-engine suites above pass inside the Docker container with no network access
