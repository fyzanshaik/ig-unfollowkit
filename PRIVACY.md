# Privacy Policy — ig-unfollowkit

**Last updated:** April 17, 2026

## Overview

ig-unfollowkit is a Chrome extension that analyzes your Instagram follower and following relationships. Your privacy is important to us. This policy explains what data the extension accesses, how it is used, and how it is stored.

## Data Collection

ig-unfollowkit does **not** collect, transmit, or share any user data with external servers, third parties, or the extension developer.

## Data Accessed

The extension accesses the following data solely within your browser:

- **Instagram session cookies** (`csrftoken`, `ds_user_id`, `sessionid`) — used to authenticate API requests to Instagram on your behalf. These are read from your existing browser session and are never transmitted externally.
- **Instagram follower and following lists** — fetched directly from Instagram's API using your logged-in session. This data is used to compute relationship analytics (mutual followers, non-followers, etc.).
- **Instagram profile pictures** — loaded from Instagram's CDN (`fbcdn.net`, `cdninstagram.com`) for display in the extension popup.

## Data Storage

All data is stored locally in your browser using Chrome's `chrome.storage.local` API. This includes:

- Scan results (follower/following lists, cross-reference data)
- Scan history (for computing changes between scans)
- Debug logs (for troubleshooting)

No data is ever sent to any external server, analytics service, or third party. You can clear all stored data at any time using the "Clear" button in the extension popup.

## Data Sharing

ig-unfollowkit does **not**:

- Sell or transfer user data to third parties
- Use or transfer user data for purposes unrelated to the extension's core functionality
- Use or transfer user data to determine creditworthiness or for lending purposes
- Use any analytics, tracking, or telemetry services

## Permissions

| Permission | Purpose |
|---|---|
| `storage` | Store scan results, history, and logs locally in the browser |
| `cookies` | Read Instagram session cookies for API authentication |
| `activeTab` | Access the active Instagram tab to extract session info |
| `host_permissions` (instagram.com) | Call Instagram's API to fetch follower/following data |
| `host_permissions` (fbcdn.net, cdninstagram.com) | Load profile pictures from Instagram's CDN |

## Remote Code

The extension does not use any remote code. All JavaScript is bundled within the extension package.

## Changes to This Policy

If this privacy policy is updated, the changes will be reflected in this document with an updated date.

## Contact

If you have questions about this privacy policy, please open an issue at [github.com/fyzanshaik/ig-unfollowkit](https://github.com/fyzanshaik/ig-unfollowkit/issues).
