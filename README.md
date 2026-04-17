<p align="center">
  <img src="icons/icon128.png" width="80" alt="ig-unfollowkit icon" />
</p>

<h1 align="center">ig-unfollowkit</h1>

<p align="center">
  A Chrome extension that analyzes your Instagram follower/following relationships.<br/>
  Find out who doesn't follow you back, discover your real mutuals, track changes between scans, and filter by verified/unverified/public/private status.
</p>

> **Coming soon to the Chrome Web Store.** Until then, you can install it manually in developer mode.

## Features

- **Follower/Following cross-reference** — see who doesn't follow you back and who you don't follow back
- **Unverified unfollowers** — dedicated tab for public, unverified accounts that don't follow you back
- **Scan diff tracking** — compares each scan against the previous one to show new followers, lost followers, accounts you started/stopped following
- **Filters** — filter any list by All, Verified, Public & Unverified, Public, or Private
- **Search** — search across any tab by username or full name
- **Accuracy verification** — uses Instagram's `show_many` endpoint to eliminate false positives from API pagination gaps
- **Debug logging** — full structured logs with timestamps; copy to clipboard with one click for troubleshooting

## How It Works

The extension uses Instagram's private web API (the same endpoints the instagram.com website uses) to fetch your data. It requires you to be logged into Instagram in your browser.

**Endpoints used:**
| Endpoint | Purpose |
|---|---|
| `GET /api/v1/users/{id}/info/` | Fetch your profile info (follower/following counts) |
| `GET /api/v1/friendships/{id}/followers/` | Paginate through your follower list |
| `GET /api/v1/friendships/{id}/following/` | Paginate through your following list |
| `POST /api/v1/friendships/show_many/` | Bulk verify follow relationships for accuracy |

**Scan flow:**
1. Reads your session cookies (`csrftoken`, `ds_user_id`) from instagram.com
2. Fetches your profile to get follower/following counts
3. Paginates through all followers (100 per page, 2s delay between pages)
4. Paginates through all following (same pattern)
5. Deduplicates both lists
6. Cross-references using Set operations to compute: don't follow back, I don't follow back, mutuals
7. Verifies edge cases with the `show_many` endpoint
8. If a previous scan exists, computes the diff and verifies it too
9. Stores everything in `chrome.storage.local`

**Architecture:**
```
manifest.json          → MV3 Chrome extension manifest
background.js          → Service worker: scan orchestration, API calls, cross-referencing
content.js             → Content script: extracts session cookies from instagram.com
lib/
  api.js               → Instagram API client with pagination, rate limiting, retries
  logger.js            → Structured logging with persistence and clipboard export
  storage.js           → chrome.storage.local abstraction with scan history
popup/
  popup.html           → Extension popup UI
  popup.js             → Popup logic: polling, rendering, tab/filter switching
  popup.css            → Inter font, clean minimal styling
icons/                 → Extension icons (16, 48, 128px)
```

## Installation

### Manual Install (Developer Mode)

1. Clone this repository:
   ```bash
   git clone https://github.com/fyzanshaik/ig-unfollowkit.git
   ```

2. Open Chrome and go to `chrome://extensions`

3. Enable **Developer mode** (toggle in the top right)

4. Click **Load unpacked** and select the `ig-unfollowkit` folder

5. Make sure you are **logged into Instagram** in Chrome

6. Click the extension icon in the toolbar and hit **Start Scan**

### Chrome Web Store

The extension will be available on the Chrome Web Store soon. Star/watch this repo to get notified.

## Usage

1. **First scan** — click Start Scan. The extension will fetch all your followers and following. For an account with ~500 following, this takes about 30-40 seconds.

2. **View results** — four tabs show your data:
   - **Don't follow back** — accounts you follow that don't follow you back
   - **Unverified** — subset of above: not verified (useful for cleanup)
   - **I don't follow** — your followers that you don't follow back
   - **Mutuals** — accounts that follow each other

3. **Filter** — use the filter chips (All, Verified, Public & Unverified, Public, Private) to narrow down any tab.

4. **Search** — type a username or name to find specific accounts.

5. **Rescan** — run another scan anytime. If previous results exist, a **diff section** appears showing new followers, lost followers, accounts you started/stopped following. Click any diff card to see the specific users.

6. **Copy logs** — if something goes wrong, click **Logs** in the footer to copy debug logs to your clipboard.

## Rate Limiting

The extension is designed to be respectful of Instagram's API:
- 2 second delay between paginated requests
- 5 second pause between fetching followers and following
- 60 second backoff on rate limit (429) responses
- Maximum 3 retries with exponential backoff

## Privacy

- All data stays in your browser (`chrome.storage.local`)
- No external servers, no analytics, no data collection
- The extension only reads your own follower/following data using your existing Instagram session

## License

MIT
