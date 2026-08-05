# cross-browser-support — Delta Spec

## ADDED Requirements

### Requirement: Single codebase, two engine builds

The project SHALL build from one codebase, via WXT, into a Chromium MV3 extension (`background.service_worker`) and a Firefox MV3 extension (`background.scripts` event page with `browser_specific_settings.gecko.id` and `strict_min_version` ≥ 121). The build SHALL be driven by `wxt build` / `wxt build -b firefox` and produce store-ready zips via `wxt zip` / `wxt zip -b firefox` (the Firefox zip accompanied by a sources zip and build instructions per AMO policy).

#### Scenario: Both targets build

- **WHEN** `make build` runs
- **THEN** both the Chrome-target and Firefox-target builds complete successfully with valid manifests for each engine

#### Scenario: Firefox manifest correctness

- **WHEN** the Firefox build is inspected
- **THEN** its manifest contains `background.scripts`, a gecko id, and no `service_worker` key

### Requirement: Engine-agnostic extension APIs

Extension code SHALL use WXT's unified promise-based `browser.*` API exclusively; direct `chrome.*` usage SHALL be prevented (lint rule or equivalent). Background code SHALL satisfy service-worker constraints (state in storage, listeners registered synchronously at top level, `browser.alarms` instead of timers for scheduled work, no DOM assumptions) so the same code runs as a Firefox event page.

#### Scenario: No chrome namespace in source

- **WHEN** lint runs over the source tree
- **THEN** no direct `chrome.*` API usage is reported

#### Scenario: Background survives SW termination

- **WHEN** the Chromium service worker is terminated mid-idle and a sync alarm fires later
- **THEN** the worker wakes, restores all state from storage, and the cycle runs correctly

### Requirement: Host-permission onboarding on both engines

Because MV3 host permissions can be withheld or revoked by the user on **both** engines (Chrome requests x.com/twitter.com host permissions at install time, but users can restrict site access to "on click" or revoke it entirely, leaving required host access missing; Firefox makes them opt-in/revocable), the extension SHALL check `permissions.contains` for the x.com/twitter.com origins at startup and, when missing, show an onboarding prompt that requests them via `permissions.request` (user-gesture context). The all-notes page and sync settings SHALL remain functional regardless of the grant; only profile-page note injection depends on it.

#### Scenario: Grant missing on Firefox

- **WHEN** the extension loads in Firefox without x.com host permission granted
- **THEN** the user sees a prompt explaining why the permission is needed and can grant it, after which the content script activates

#### Scenario: Grant withheld on Chrome

- **WHEN** the extension loads in Chrome with site access set to "on click" or the x.com origin ungranted
- **THEN** the same onboarding prompt appears and granting activates the content script

#### Scenario: Manager works without grants

- **WHEN** host permissions are not granted
- **THEN** the all-notes page still lists, edits, exports, and imports notes

### Requirement: Minimal permissions

The manifest SHALL request only `storage` and `alarms` permissions, host permissions limited to `https://x.com/*` and `https://twitter.com/*`, with all other origins acquired at runtime through `optional_host_permissions`. The extension SHALL collect no telemetry and send no data anywhere except the user-configured sync backend.

#### Scenario: Privacy posture

- **WHEN** the extension runs with no backend configured
- **THEN** it makes zero network requests of any kind

### Requirement: Dockerized developer workflow

All standard workflows — dependency install (`setup`), typecheck, lint, unit tests, integration tests, build, store zip packaging (`zip`), and dev mode (`dev` / `dev-firefox`) — SHALL be runnable via Makefile targets that execute inside Docker containers using one pinned Node image, so a machine with only Docker and make can develop and verify the project. No workflow SHALL require a host-side Node.js, npm, or any other toolchain beyond Docker and make. npm downloads SHALL be cached in a Docker volume between runs. Files created by containers in the mounted repo volume (node_modules, build output, lockfile changes) SHALL remain usable by the host user (on Linux hosts, containers run as the host UID/GID). Integration tests SHALL run against real server containers (dufs for WebDAV, an S3 mock for S3) via docker compose. CI SHALL invoke the same Makefile targets.

#### Scenario: Fresh machine verification

- **WHEN** on a clean machine with only Docker and make installed, `make setup typecheck lint test build zip` is run
- **THEN** all targets succeed with no host-side Node.js installation

#### Scenario: Integration servers in Docker

- **WHEN** `make integration` runs
- **THEN** dufs and S3 mock containers start, the adapter test suites run against them over the compose network, and everything tears down afterwards

#### Scenario: Dev mode through Docker

- **WHEN** `make dev` runs and the host browser loads the generated `.output/` directory as an unpacked extension
- **THEN** the extension loads and rebuilds on change, with no Node toolchain on the host

#### Scenario: Container-created files host-owned

- **WHEN** any make target completes on a Linux host
- **THEN** files created in the repo volume are owned by the host user and editable/deletable without privilege escalation

#### Scenario: CI parity

- **WHEN** CI runs on a GitHub Actions ubuntu runner
- **THEN** it executes the same Makefile targets inside Docker, and a green CI implies a green `make` run locally
