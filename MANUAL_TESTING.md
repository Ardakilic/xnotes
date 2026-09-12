# Manual Testing Checklists

Everything automated lives in `make test` / `make integration`; this file tracks what only a human with real browsers/servers can verify. Record results inline (`[ ]` → `[x]` + date + browser).

## 1. Content script on a real X profile (task 4.6)

Load `make dev` output (`.output/chrome-mv3`) as unpacked in Chrome, and `make dev-firefox` output in Firefox.

- [ ] Panel appears directly below the user-name header on a profile page (Chrome)
- [ ] Panel appears directly below the user-name header on a profile page (Firefox)
- [ ] Add note → save → reload page → note persists with color accent
- [ ] Edit persists across SPA navigation (`/jack` → `/elonmusk` → back) within ~1 s of header render
- [ ] Avatar badges appear on noted users in timelines; no badge on the viewed profile's own avatar
- [ ] Hover card of a noted user shows the note excerpt
- [ ] Dark and light X themes both render the panel readably
- [ ] Fail-soft: temporarily change the anchor selector in a dev build → no panel, no console errors, notes intact
- [ ] Extension reload while an X tab is open → page keeps working, no uncaught errors (stale-context teardown)
- [ ] "All notes" link in the profile panel opens the options page (Chrome)
- [ ] "All notes" link in the profile panel opens the options page (Firefox)
- [ ] Note badges and hover-card excerpts are not readable from page-world JS (shadow DOM isolation — verify via DevTools console: `document.querySelectorAll('.xn-badge')` returns empty; note text does not appear in light DOM)

## 2. Service-worker torture (task 9.2)

- [ ] Chrome: terminate the SW in `chrome://inspect/#service-workers`, wait for the periodic alarm → cycle runs on wake
- [ ] Kill the SW mid-sync (terminate during a cycle) → next cycle resumes safely; no duplicated/corrupted remote blob
- [ ] Firefox: close all extension surfaces, wait, trigger "Sync now" → event page wakes and syncs

## 3. Multi-device matrix (task 9.3) — Chrome ↔ Firefox, same backend

- [ ] Simultaneous edits on both devices → both notes survive (LWW), both devices converge
- [ ] Delete on A, edit on B (B newer) → note survives everywhere; (A newer) → stays deleted
- [ ] Offline device (sync disabled) accumulates edits, re-enables → merges without loss
- [ ] Extension update mid-sync (reload extension during a cycle) → no corruption, next cycle clean

## 4. Backend matrix (task 9.4)

- [ ] dufs on real infra (Coolify or a VPS, HTTPS via reverse proxy): full sync round-trip — **integration tests already cover dufs behavior over plain HTTP; this item is the TLS/real-deploy smoke**
- [ ] Nextcloud: configure a WebDAV endpoint, sync a note, then **empirically verify `If-Match` behavior**: PUT with a deliberately stale `If-Match` via the adapter (temporarily force a stale etag in a dev build) → record here whether Nextcloud returns 412 or ignores it; record the result in `README.md`'s compatibility table either way. (The HEAD-compare precheck guards correctness in both outcomes.)
- [ ] Backblaze B2: single-bucket application key; enable "provider lacks conditional writes"; full round-trip + second-device pull
- [ ] Cloudflare R2: conditional path; full round-trip + conflict (two devices push concurrently) resolves

## 5. Final walkthrough (task 10.2)

Walk every manually-verifiable scenario of the delta specs in both engines; record per spec:

- [ ] profile-notes-ui scenarios not covered above (keyboard-only panel use, IME input save suppression with a real IME)
- [ ] notes-manager: import/export round-trip through the real file picker; replace-mode double confirm
- [ ] sync-backends: live `permissions.request` prompt on both engines; deny → backend not activated + explanation
- [ ] sync-backends: "Test connection" button — success message with good credentials, typed failure reason with bad credentials, behavior before anything is saved
- [ ] sync-backends: Firefox explicit-port endpoint (e.g. `https://dav.example.com:8443`) — verify `permissions.request` asks for `https://dav.example.com/*` (port omitted) and the permission is granted
- [ ] sync-engine: first sync on configuration — activate a backend that already holds a blob → data is pulled immediately without waiting for the next alarm
- [ ] sync-engine: popup error visibility — force a failure (bad credentials) → popup shows the cause, toolbar badge shows `!`, both clear after a successful sync
- [ ] cross-browser-support: onboarding prompt with host permission withheld (Chrome "on click" site access; Firefox opt-in)
- [ ] note-encryption: passphrase re-entry after browser restart flows (popup unlock → sync resumes)

## 6. HMR dev mode (Makefile dev targets)

- [ ] `make dev` publishes port 3000 — load `.output/xnotes-chrome-mv3` as unpacked, edit a source file, confirm the extension rebuilds and the host browser receives the update
- [ ] `make dev-firefox` publishes port 3001 — load `.output/xnotes-firefox-mv3` in Firefox, edit a source file, confirm HMR reaches the host browser
