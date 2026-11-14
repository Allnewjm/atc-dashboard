# ATC Personal Control Tower
A static, air-traffic-control-style dashboard for to-dos, calendar, goals, and conflicts.
Views: SCOPE (radar, now/this week; zoom with + − ⟲, wheel/pinch, drag to pan), TIMELINE (6 weeks), BOARD (category columns), TASKS (edit list), PACK (pack my day), GOALS.

## Board data (`board.json`, single source of truth)
The live board is **`board.json` in this repo's root**. It is public: money amounts are masked as `$•••` (by `tools/migrate.js`, the dashboard and `board.py`); everything else is stored as written. The Google Drive `atc-board-data.json` is a frozen backup from before the move (Nov 14, 2026). Format: `board.schema.json` (JSON Schema 2020-12).

Top level: `schemaVersion` (1), `revision` (integer, +1 on every write), `updatedAt` (ISO UTC), `tasks`, plus the kept legacy data `label`, `generated`, `today`, `events`, `goals`, `sources`, `sectionOrder`.

Each task:
| field | meaning |
|---|---|
| `id` | stable string, the board number, e.g. `"#66"` |
| `title`, `notes` | text |
| `status` | `open` · `in-progress` · `waiting` · `done` · `parked` (old NOW→in-progress, THIS WEEK→open, WAITING→waiting, PARKED→parked, DONE→done) |
| `legacyStatus` | the old label (NOW, THIS WEEK, ...); shown while it agrees with `status`, removed when status changes |
| `duration` | `null` or `{value, unit: "hours"|"days"}` |
| `deadline` | `null` or `YYYY-MM-DD` (was `due`) |
| `sortOrder` | number; lower = higher in TASKS and in each BOARD column |
| `businessHours` | optional boolean; `true` = can only be done during business hours (roughly Mon–Fri 9–5 CT). Absent or `false` = no restriction |
| kept fields | `owner`, `priority` (-1..4), `category`, `section`, `court`, `completed`, `watching`, `waitingOn`, `waitingFor`, `replyContact` |

Completed items live in `tasks` with `status: "done"` (and `completed` date).

## Live sync
The page loads `board.json` on open and checks it every 5 s (paused while the tab is hidden), and redraws only when a newer `revision` arrives (radar zoom/pan, tab and scroll are kept).
* **No token (read-only):** reads the GitHub Pages copy `board.json?t=<now>` (same site, no API rate limit). It refreshes when Pages finishes rebuilding after a change, typically about 40–60 s. (raw.githubusercontent.com is the fallback; its `main` copy lagged several minutes in testing.)
* **With a token (⚙ Sync):** reads through the GitHub contents API with `If-None-Match` (unchanged checks return 304 and don't use up the 5,000/hr limit), so changes appear within about 5 s, and edits are enabled.
The header line shows `Last updated <time> CT · synced <n>s ago · rev N`.

Token (entered once per device, remembered in localStorage; viewing never asks): a fine-grained personal access token for **Allnewjm/atc-dashboard only**, permission **Contents: Read and write**. Paste it once per browser in ⚙ Sync. It is kept only in that browser's localStorage and sent only to api.github.com. Never commit a token.

Optional PIN: when saving the token you can set a 4-digit PIN. The token is then stored AES-GCM-encrypted with a PBKDF2 key from the PIN, and editing asks for the PIN once per browser session. Five wrong PINs, or *Forgot PIN?*, wipe the token and PIN so a token can be pasted again. A 4-digit PIN stops casual use of an unlocked phone; it is not strong protection against someone who copies the browser's storage.

Install: open the page on the phone and use *Add to Home Screen* (iOS Safari: Share → Add to Home Screen; Android Chrome: ⋮ → Install app). `manifest.webmanifest` + icons make it open full-screen like an app.

## Editing (TASKS tab, needs the token)
Drag ⠿ or ▲▼ to reorder (updates `sortOrder`), tick Done, change status, set deadline and duration, toggle 🏢 business hours (Mon–Fri 9–5 CT), add a task. Flagged tasks show an **M–F 9–5** badge (dimmed with “closed now” outside those hours). Changes show instantly, then are saved by a contents-API `PUT` with the current `sha` (one commit per change). If someone else changed the file first (409), the edit is re-applied on the latest version; if the save fails, the change is rolled back with a red message.

`Import file` still loads a board JSON (old or new format) into this browser only, as a fallback; it pauses live sync until reload.

## PACK MY DAY
The PACK tab greedily fits today's open tasks into the time you have left (a port of the Life Dashboard day packer). Settings stay on this device only (localStorage), not in `board.json`.

* **Window:** start defaults to now, rounded up to the next 5 minutes (or a fixed clock time). End defaults to 9:00 PM CT, or you can type a number of hours available instead. A buffer (default 15%) is left unscheduled.
* **Candidates:** not done, not parked; waiting-on-others is off by default (toggle to include). Missing durations count as 30 minutes and show a `~` with a hint to set a real estimate. 1 day = 8 working hours.
* **Order:** overdue and due today first, then in-progress, then higher priority (lower number is higher; −1 is top), then board `sortOrder`, then shorter tasks.
* **Business hours:** tasks flagged `businessHours` only land in Mon–Fri 9:00–17:00 CT. On a weekend, after 5 PM, or if the remaining window is too short, they go to **Needs business hours** (with the next weekday 9:00 AM CT), not Overflow. Other tasks fill the time before and after that window.
* **Result:** a timed timeline (CT), a one-line verdict (`Fits, 40 min to spare` / `Over by N min`), Overflow, and Needs business hours. Each row can mark Done, set a duration, or move the task to the top of the board (needs the sync token). The pack recalculates when the board syncs or settings change.


## Tests
`node --test test/*.test.js` (zoom, schema, migration counts, masking, reorder, change detection, day packer). Set `NODE_PATH` to a folder with `ajv` and `ajv-formats` to also check `board.schema.json` strictly.
