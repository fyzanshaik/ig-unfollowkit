# Agents Guide

## Overview

ig-unfollowkit is a Chrome extension (MV3) that analyzes Instagram follower/following relationships. There is no build step — all files are vanilla JS/HTML/CSS loaded directly by Chrome.

## Working on this codebase

### Testing changes
1. Go to `chrome://extensions`
2. Click the reload icon on the extension card
3. If `manifest.json` permissions changed, remove and re-add the extension instead

### Key constraints
- **No inline JS in HTML** — Chrome MV3 CSP blocks inline event handlers (`onclick`, `onerror`, etc.). Always use `addEventListener` in JS files.
- **Service worker lifecycle** — `background.js` runs as a MV3 service worker. It can be terminated at any time. Scan state is persisted to `chrome.storage.local` after each page fetch.
- **Image loading** — Instagram CDN images (`*.fbcdn.net`) require `referrerpolicy="no-referrer"` on img tags. Use the `data-src` pattern: render without `src`, attach load/error handlers, then set `src`.
- **API rate limiting** — Instagram rate limits aggressively. Maintain 2s delays between paginated requests. On 429, back off 60s. Max 3 retries.
- **Pagination gaps** — Instagram's follower/following endpoints can miss users across pages. Always verify critical results (diff, "I don't follow back") using the `POST /api/v1/friendships/show_many/` endpoint.

### File responsibilities

| File | Role | When to modify |
|---|---|---|
| `background.js` | Scan orchestration, message handling | Adding new scan logic, message types, or data processing |
| `lib/api.js` | Instagram API calls | Changing endpoints, pagination, rate limits |
| `lib/storage.js` | Data persistence | Adding new stored data types or changing storage schema |
| `lib/logger.js` | Logging | Changing log format or persistence behavior |
| `content.js` | Session extraction | Changing how auth cookies are read |
| `popup/popup.js` | UI logic | Adding UI features, new tabs, filters |
| `popup/popup.html` | UI structure | Adding new sections or controls |
| `popup/popup.css` | Styling | Visual changes |
| `manifest.json` | Extension config | Changing permissions, CSP, or extension metadata |

### Adding a new tab/category

1. Add the computed list in `background.js` (in the cross-reference section after step 8)
2. Add it to the `setResults()` call
3. Add a `<button class="tab">` in `popup.html`
4. Update `loadResults()` in `popup.js` to set the tab count
5. The `switchTab()` and `renderList()` functions handle everything else automatically via `currentResults[tab]`

### Adding a new filter

1. Add a `<button class="chip" data-filter="name">` in `popup.html`
2. Add the filter logic in `renderList()` in `popup.js` (the `if/else if` chain after `let filtered = users`)
3. Click handlers are already wired up via `$$('.chip').forEach(...)`
