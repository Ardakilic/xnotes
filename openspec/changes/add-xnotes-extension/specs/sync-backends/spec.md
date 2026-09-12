# sync-backends — Delta Spec

## ADDED Requirements

### Requirement: Backend adapter contract

All sync backends SHALL implement a single adapter interface: `probe(): Promise<void>` (auth + reachability check, throwing typed errors), `get(opts?: { ifNoneMatch?: string }): Promise<GetResult>` where `GetResult` distinguishes `found` (data + ETag), `not-found` (no remote blob yet), and `not-modified` (304 to the conditional GET), and `put(data: Uint8Array, opts?: { ifMatch?: string, ifNoneMatch?: '*' }): Promise<{ etag: string }>`. The sync engine SHALL depend only on this interface.

#### Scenario: First sync to empty backend

- **WHEN** the user syncs for the first time and the backend has no blob yet
- **THEN** `get()` returns null and the engine creates the remote blob via `put` with `ifNoneMatch: '*'` or plain PUT

#### Scenario: Adapter swap

- **WHEN** the user switches the configured backend type from WebDAV to S3
- **THEN** the sync engine operates unchanged against the new adapter

### Requirement: WebDAV adapter

The WebDAV adapter SHALL talk plain HTTP (`GET`/`HEAD`/`PUT`, plus `MKCOL` to create the folder on first run) with Basic auth against a user-supplied URL, using `ETag`/`If-None-Match` for conditional GET. Because the reference server dufs ignores `If-Match` on PUT (verified empirically against v0.46.0), the adapter SHALL enforce optimistic locking itself: before a conditional PUT it SHALL HEAD the blob and report a conflict when the live remote ETag differs from the caller's precondition (or the blob vanished, or an `ifNoneMatch: '*'` create finds an existing blob). The HEAD-then-write sequence is NOT an atomic optimistic-locking guarantee — a race window exists between the HEAD and the PUT; it is a best-effort guard for servers lacking atomic conditional writes. Providers that lack any atomic conditional-write, lock, or versioning primitive SHALL be marked as unsupported for concurrent multi-device sync. The adapter SHALL still forward `If-Match`/`If-None-Match` on the PUT for servers that honor them, and SHALL treat a server 412 as a conflict signal for the engine's retry loop. The blob path SHALL be configurable (default: a single `notes.json` inside a dedicated folder). The documented reference server SHALL be dufs ≥ 0.42.0.

#### Scenario: Folder created on first run

- **WHEN** the configured folder does not exist on the server
- **THEN** the adapter creates it via MKCOL and completes the sync

#### Scenario: Conditional PUT conflict

- **WHEN** the remote blob changed since the caller's last known ETag
- **THEN** the adapter reports a conflict to the engine (via the HEAD-compare precheck, or a server 412 where honored), which retries per the sync-engine spec

#### Scenario: Wrong password

- **WHEN** credentials are wrong
- **THEN** `probe()` rejects with a typed authentication error

### Requirement: S3 adapter

The S3 adapter SHALL sign requests with SigV4 (via a WebCrypto-based signer usable in MV3 service workers) against user-supplied endpoint, region, bucket, key prefix, and access/secret key, with a path-style URL toggle for self-hosted endpoints. It SHALL use conditional PUT (`If-Match`) where the server supports it; where the server does not support conditional writes (e.g. Backblaze B2), it SHALL fall back to HEAD-compare: fetch the remote ETag via HEAD, compare with the engine's `lastRemoteEtag`, PUT only if unchanged, otherwise report conflict so the engine re-GETs and re-merges.

#### Scenario: B2-style fallback path

- **WHEN** the S3 endpoint does not honor conditional PUT headers
- **THEN** the adapter detects this (e.g. 501/NotImplemented or documented provider behavior) and uses the HEAD-compare path, completing the sync

#### Scenario: HEAD-compare detects concurrent change

- **WHEN** the remote ETag from HEAD differs from the stored `lastRemoteEtag`
- **THEN** the adapter reports conflict instead of PUTting over the newer data

#### Scenario: Path-style self-hosted endpoint

- **WHEN** the user configures a self-hosted S3 endpoint with path-style enabled
- **THEN** requests address `https://endpoint/bucket/key` and succeed

### Requirement: Endpoint validation

Sync settings SHALL validate input before activation: the endpoint MUST be a well-formed `https://` URL; HTTP endpoints SHALL be rejected with a field-level error for credentialed sync backends (WebDAV and S3), because credentials and notes would travel in plain text. WebDAV requires username/password; S3 requires endpoint, region, bucket, non-empty key prefix, and access/secret keys. Activation SHALL be blocked while validation fails, with field-level messages. Adapters SHALL validate redirect targets and refuse redirects to HTTP before attaching credentials or sending note data.

#### Scenario: Malformed URL rejected

- **WHEN** the user enters `not a url` as the endpoint
- **THEN** saving is blocked with a field-level error

#### Scenario: Plain-HTTP endpoint rejected

- **WHEN** the user enters `http://192.168.1.10:5244` as a WebDAV or S3 endpoint
- **THEN** saving is blocked with a field-level error stating HTTPS is required

### Requirement: Connection testing

Sync settings SHALL provide a "Test connection" action that runs `probe()` and reports success or the typed failure reason (unreachable, auth, TLS, unexpected response) before anything is saved as the active backend.

#### Scenario: Probe before save

- **WHEN** the user enters new backend settings and clicks "Test connection"
- **THEN** the UI shows a clear success or failure result with the reason

### Requirement: Runtime host permission acquisition

Because sync endpoints are arbitrary user-chosen HTTPS origins (HTTP is rejected by endpoint validation), the manifest SHALL declare `optional_host_permissions: ["https://*/*"]`, and saving sync settings SHALL request host permission for the endpoint origin at runtime (within the user gesture). If the user denies, the settings SHALL NOT be activated and the UI SHALL explain why.

#### Scenario: Permission granted on save

- **WHEN** the user saves WebDAV settings pointing at `https://dav.example.com` and grants the permission prompt
- **THEN** background fetches to that origin succeed without CORS restrictions on both engines

#### Scenario: Permission denied

- **WHEN** the user denies the permission prompt
- **THEN** the backend is not activated and an explanatory message is shown

### Requirement: Credential storage

Backend credentials SHALL be stored in `browser.storage.local` under `xnotes:settings`, SHALL never be uploaded, and SHALL never appear in logs. The documentation SHALL state plainly that extension storage is not encrypted at rest and recommend scoped credentials (single-bucket application keys, dedicated WebDAV users).

#### Scenario: Credentials excluded from upload

- **WHEN** any sync request is built
- **THEN** credentials are used only for request signing/headers and never serialized into the uploaded blob

### Requirement: Mandatory automated tests for backends

The project SHALL include automated unit tests covering: the WebDAV adapter against mocked `fetch` across the status matrix (200, 201, 204, 304, 401, 404, 412, 5xx) including MKCOL-on-first-run and Basic-auth header construction; the S3 adapter's request construction (path-style vs virtual-host), the conditional-PUT path, and the HEAD-compare fallback including conflict detection; SigV4 signing verified against AWS's official published test vectors; and endpoint validation rules (malformed URL, http warning, required fields per backend type).

#### Scenario: Backend suites run green in Docker

- **WHEN** `make test` is run
- **THEN** all backend suites above pass inside the Docker container with no network access (all HTTP mocked)
