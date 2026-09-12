# Store Submission Guide

Everything a human must do manually to publish xNotes. Text blocks are paste-ready. Artifacts come from `make zip`.

## Chrome Web Store

1. One-time $5 developer registration at <https://chrome.google.com/webstore/devconsole> (skip if already registered).
2. Re-shoot screenshots at **exactly 1280x800** (or 640x400) — the current ones in `assets/screenshots/` are the wrong sizes and will be rejected. At minimum: the profile panel on x.com, and the all-notes manager.
3. Create a small promotional tile at **440x280** (optional but recommended for store visibility) and upload it in the dashboard alongside the screenshots before submitting.
4. Publish PRIVACY.md at a public URL and enter it in the dashboard. Use the GitHub blob URL: <https://github.com/Ardakilic/xnotes/blob/main/PRIVACY.md> (verified via `git remote get-url origin`).
5. Upload `.output/xnotes-0.1.0-chrome.zip`.
6. Paste the dashboard texts (below): single purpose, permission justifications, short + detailed description.
7. Answer the data-use disclosure (below) — all "No" except website-content reading on x.com/twitter.com and authentication info (see note below).
8. Submit for review.

## Firefox Add-ons (AMO)

1. Free developer account at <https://addons.mozilla.org/developers/> (skip if registered).
2. Upload `.output/xnotes-0.1.0-firefox.zip`. If AMO asks for sources (the build is bundled/minified), upload `.output/xnotes-0.1.0-sources.zip` — auto-built by `make zip`, contains full source + SOURCE_CODE_REVIEW.md.
3. Data-collection disclosure: select **"No data collection"** (the manifest declares `data_collection_permissions: none`).
4. Paste the listing texts (below): summary + detailed description.
5. Screenshots: current ones pass AMO minimums. Optional: re-crop toward 1280x800 to match the Chrome set.
6. Expect a human-review delay because the JS is bundled — normal; the sources zip mitigates it.

## Paste-ready store texts (shared)

**Single purpose (CWS):**

> A single purpose: keeping private, local notes about X/Twitter profiles, with optional sync of those notes to storage the user themselves owns.

**Permission justifications (CWS, one line each):**

- `storage`: Stores your notes and extension settings locally in your browser; nothing else.
- `alarms`: Schedules the optional periodic sync to your own configured backend; no other scheduled work.
- Host permissions (x.com/twitter.com): Required to display the notes panel and avatar badges on X/Twitter profile pages. Reads only the profile handle from the page. Revocable at any time — the all-notes manager works without it.
- Optional host permissions (`https://*/*`): Optional, never requested at install. Only if you configure sync to your own WebDAV or S3 endpoint, the extension asks for permission to that one origin, inside the save action. HTTPS-only (HTTP endpoints are rejected). No origin is ever accessed without your explicit per-site grant, and the extension is fully functional without it.

**CWS data-use disclosure answers:**

- Does the extension collect or sell user data? **No.**
- Does it transfer data to third parties? **No** — the only network requests go to the sync backend the user configures themselves.
- Does it read website content? It reads the **profile handle on x.com/twitter.com pages only**.
- Authentication info? **Yes** — if (and only if) the user configures sync, the backend's credentials (WebDAV username/password or S3 access keys) are stored locally in extension storage on the user's device so unattended sync works. They are never collected by the developer, never sent anywhere except the user's own configured backend, and never leave the device otherwise. User activity? **No.** Web history? **No.** Personally identifiable info? **No.**

**Short description (CWS, ≤132 chars):**

> Private notes for X/Twitter profiles, stored locally. Optional end-to-end encrypted sync to your own storage. No telemetry.

**Detailed description (CWS + AMO):**

> xNotes keeps private notes about X/Twitter profiles right on the profile page, with color labels, avatar badges, and an all-notes manager with search and filters. All notes are stored locally in your browser — nothing leaves your machine by default. Optionally, sync your notes end-to-end encrypted (AES-256-GCM) to a WebDAV or S3-compatible backend that you yourself own and configure. There is no telemetry, no analytics, no accounts, and no developer-operated servers.

**AMO summary (≤250 chars):**

> Private, local notes for X/Twitter profiles with color labels and avatar badges. Optional end-to-end encrypted sync to your own WebDAV/S3 storage. No telemetry, no accounts, no developer servers — your notes stay yours.
