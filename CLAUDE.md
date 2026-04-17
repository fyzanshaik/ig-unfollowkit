# ig-unfollowkit

Chrome extension (Manifest V3) for Instagram follower/following analytics.

## Project Structure

- `background.js` — Service worker. Handles all API calls, scan orchestration, cross-referencing, diff computation. Imports from `lib/`.
- `content.js` — Content script injected on instagram.com. Extracts session cookies and sends to background.
- `lib/api.js` — Instagram API client. Pagination, rate limiting (2s delay, 60s on 429), retry with exponential backoff, `show_many` verification.
- `lib/logger.js` — Structured logging with levels (DEBUG/INFO/WARN/ERROR), persistence to chrome.storage, clipboard export.
- `lib/storage.js` — Abstraction over chrome.storage.local. Stores session, profile, scan results, scan history (max 10), scan state.
- `popup/` — Extension popup UI. Inter font, filter chips, tabs, diff cards. Uses `data-src` pattern for images to attach error handlers before loading.
- `manifest.json` — MV3 manifest with host_permissions for instagram.com and fbcdn.net, CSP for Google Fonts.

## Key Design Decisions

- Images use `data-src` → attach load/error handlers → set `src` to avoid CSP issues with inline `onerror` and race conditions with `innerHTML`.
- `show_many` endpoint verifies "I don't follow back" and diff results to eliminate false positives from pagination gaps.
- Scan state is persisted after every page fetch so service worker restarts can resume.
- Diff is computed by comparing current vs previous scan results, then verified via `show_many`.

## Instagram API Endpoints

All require logged-in session cookies. See `lib/api.js` for implementation.

- `GET /api/v1/users/{id}/info/` — profile info
- `GET /api/v1/friendships/{id}/followers/?count=100&max_id={cursor}` — paginated followers
- `GET /api/v1/friendships/{id}/following/?count=100&max_id={cursor}` — paginated following
- `POST /api/v1/friendships/show_many/` — bulk follow status verification

## Rules

- Never add Co-Authored-By lines to commits.
- No inline event handlers in popup HTML (MV3 CSP blocks them). Use JS event listeners.
- Keep API delays: 2s between pages, 5s between phases, 60s on 429.
