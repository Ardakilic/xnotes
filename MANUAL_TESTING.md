# Manual Testing Checklists

Everything automated lives in `make test` / `make integration`; this file tracks what only a human with real browsers/servers can verify. Record results inline (`[ ]` → `[x]` + date + browser).

## 1. Content script on a real X profile (task 4.6)

Load `make dev` output (`.output/chrome-mv3`) as unpacked in Chrome, and `make dev-firefox` output in Firefox.

- [x] Panel appears directly below the user-name header on a profile page (Chrome) — passed 2026-09-12
- [x] Panel appears directly below the user-name header on a profile page (Firefox) — passed 2026-09-12
- [x] Add note → save → reload page → note persists with color accent — passed 2026-09-12, Chrome + Firefox
- [x] Edit persists across SPA navigation (`/jack` → `/elonmusk` → back) within ~1 s of header render — passed 2026-09-12, Chrome + Firefox
- [x] Avatar badges appear on noted users in timelines; no badge on the viewed profile's own avatar — passed 2026-09-12, Chrome + Firefox
- [x] Hover card of a noted user shows the note excerpt — passed 2026-09-12, Chrome + Firefox
- [x] Dark and light X themes both render the panel readably — passed 2026-09-12, Chrome + Firefox
- [x] Fail-soft: temporarily change the anchor selector in a dev build → no panel, no console errors, notes intact — passed 2026-09-12
- [x] Extension reload while an X tab is open → page keeps working, no uncaught errors (stale-context teardown) — passed 2026-09-12, Chrome + Firefox
- [x] "All notes" link in the profile panel opens the options page (Chrome) — passed 2026-09-12
- [x] "All notes" link in the profile panel opens the options page (Firefox) — passed 2026-09-12
- [x] Note badges and hover-card excerpts are not readable from page-world JS (shadow DOM isolation — verify via DevTools console: `document.querySelectorAll('.xn-badge')` returns empty; note text does not appear in light DOM) — passed 2026-09-12, Chrome + Firefox

## 2. Service-worker torture (task 9.2)

- [x] Chrome: terminate the SW in `chrome://inspect/#service-workers`, wait for the periodic alarm → cycle runs on wake — passed 2026-09-12
- [x] Kill the SW mid-sync (terminate during a cycle) → next cycle resumes safely; no duplicated/corrupted remote blob — passed 2026-09-12
- [x] Firefox: close all extension surfaces, wait, trigger "Sync now" → event page wakes and syncs — passed 2026-09-12

## 3. Multi-device matrix (task 9.3) — Chrome ↔ Firefox, same backend

- [x] Simultaneous edits on both devices → both notes survive (LWW), both devices converge — passed 2026-09-12, Chrome ↔ Firefox
- [x] Delete on A, edit on B (B newer) → note survives everywhere; (A newer) → stays deleted — passed 2026-09-12, Chrome ↔ Firefox
- [x] Offline device (sync disabled) accumulates edits, re-enables → merges without loss — passed 2026-09-12
- [x] Extension update mid-sync (reload extension during a cycle) → no corruption, next cycle clean — passed 2026-09-12

## 4. Backend matrix (task 9.4)

- [x] dufs on real infra (Coolify or a VPS, HTTPS via reverse proxy): full sync round-trip — **integration tests already cover dufs behavior over plain HTTP; this item is the TLS/real-deploy smoke** (dufs over TLS passed 2026-09-12)
- [x] Nextcloud: configure a WebDAV endpoint, sync a note, then **empirically verify `If-Match` behavior**: PUT with a deliberately stale `If-Match` via the adapter (temporarily force a stale etag in a dev build) → record here whether Nextcloud returns 412 or ignores it; record the result in `README.md`'s compatibility table either way. (The HEAD-compare precheck guards correctness in both outcomes.) — Nextcloud `If-Match` verified honored (412 on stale etag), passed 2026-09-12
- [x] Backblaze B2: single-bucket application key; enable "provider lacks conditional writes"; full round-trip + second-device pull — B2 fallback path passed 2026-09-12
- [x] Cloudflare R2: conditional path; full round-trip + conflict (two devices push concurrently) resolves — R2 conditional writes passed 2026-09-12

## 5. Final walkthrough (task 10.2)

Walk every manually-verifiable scenario of the delta specs in both engines; record per spec:

- [x] profile-notes-ui scenarios not covered above (keyboard-only panel use, IME input save suppression with a real IME) — passed 2026-09-12
- [x] notes-manager: import/export round-trip through the real file picker; replace-mode double confirm — passed 2026-09-12, Chrome + Firefox
- [x] sync-backends: live `permissions.request` prompt on both engines; deny → backend not activated + explanation — passed 2026-09-12
- [x] sync-backends: "Test connection" button — success message with good credentials, typed failure reason with bad credentials, behavior before anything is saved — passed 2026-09-12
- [x] sync-backends: Firefox explicit-port endpoint (e.g. `https://dav.example.com:8443`) — verify `permissions.request` asks for `https://dav.example.com/*` (port omitted) and the permission is granted — passed 2026-09-12
- [x] sync-engine: first sync on configuration — activate a backend that already holds a blob → data is pulled immediately without waiting for the next alarm — passed 2026-09-12
- [x] sync-engine: popup error visibility — force a failure (bad credentials) → popup shows the cause, toolbar badge shows `!`, both clear after a successful sync — passed 2026-09-12
- [x] cross-browser-support: onboarding prompt with host permission withheld (Chrome "on click" site access; Firefox opt-in) — passed 2026-09-12
- [x] note-encryption: passphrase re-entry after browser restart flows (popup unlock → sync resumes) — passed 2026-09-12, Chrome + Firefox

## 6. HMR dev mode (Makefile dev targets)

- [x] `make dev` publishes port 3000 — load `.output/chrome-mv3` as unpacked, edit a source file, confirm the extension rebuilds and the host browser receives the update — passed 2026-09-12
- [x] `make dev-firefox` publishes port 3001 — load `.output/firefox-mv3` in Firefox, edit a source file, confirm HMR reaches the host browser — passed 2026-09-12

## 7. Hover-card note restyle (fix/hover-card-note-render)

Regression for screenshot-3 (note rendered as raw unstyled text flush against the hover card's bottom border, descenders clipped).

- [ ] Hover a noted profile on x.com (light theme) → note renders as a padded muted pill inside the card, clear of the rounded border
- [ ] Same check with X in dark theme → pill uses the dark variant, readable, no white-on-white
- [ ] Long note with no spaces → wraps inside the pill (`overflow-wrap`), never overflows the card width
- [ ] Shadow-DOM isolation still holds (DevTools console: note text absent from light DOM, cf. the isolation item in §1)
