# ATC Personal Control Tower
A static, air-traffic-control-style dashboard for to-dos, calendar, goals, and conflicts.
Views: SCOPE (radar, now/this week; zoom with + − ⟲, wheel/pinch, drag to pan), TIMELINE (6 weeks), BOARD (category columns), TASKS (edit list), GOALS.

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
Drag ⠿ or ▲▼ to reorder (updates `sortOrder`), tick Done, change status, set deadline and duration, add a task. Changes show instantly, then are saved by a contents-API `PUT` with the current `sha` (one commit per change). If someone else changed the file first (409), the edit is re-applied on the latest version; if the save fails, the change is rolled back with a red message.

`Import file` still loads a board JSON (old or new format) into this browser only, as a fallback; it pauses live sync until reload.

## Tests
`node --test test/*.test.js` (zoom, schema, migration counts, masking, reorder, change detection). Set `NODE_PATH` to a folder with `ajv` and `ajv-formats` to also check `board.schema.json` strictly.
