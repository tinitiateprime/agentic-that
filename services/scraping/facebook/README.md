# Facebook Scraper

Public-browser Facebook scraping service. It is organized independently from Instagram and supports two exact execution engines that share the same normalized extraction and analysis contract:

- `server` launches fresh, isolated Chromium contexts in the local service or Netlify background worker.
- `companion` launches fresh, non-persistent hidden Electron workers on the customer's computer and network.

Neither engine uses the Facebook Graph API, API tokens, OAuth, connected Facebook accounts, or saved Facebook sessions. The selected engine never silently falls back to the other engine.

## Inputs and collections

Supported inputs are Page/public-profile username, keyword/hashtag, Page/public-profile URL, and direct post/Reel/photo/video URL. Facebook Groups are rejected because they are not Page/profile targets. Keywords are normalized to Facebook's public hashtag surface because logged-out general search is not consistently exposed. Supported collection modes are Latest, Date/Month/Year Range, Profile Analysis, and UI-orchestrated Profile Comparison. Profile runs collect the official public Page timeline (the anonymous equivalent of the **All** tab), then independently deep-scroll **Reels** and merge visible grid-overlay views by post/reel identity. Most Viewed, Most Reacted, and Most Discussed are ranked from the complete scanned Reels set rather than only the returned latest-post slice. Every Reel missing exact feedback data in the grid response is checked against its own public page before those rankings are built.

The normalized post contract includes author, permalink, content, media type, thumbnail, timestamp, reactions, comment count, Reels-grid views, followers, metric precision, current source, and capture time. Returned Reels are checked against their own public page payload so publish time, reactions, and comment count are tied to the correct Reel. Comment bodies and share counts are intentionally not collected. A value that is not reliably visible remains `null` and is labeled as unavailable rather than invented.

## Public-access behavior

The scraper reads public Facebook pages and the fresh browser responses produced by those pages. It does not bypass login walls, checkpoints, CAPTCHA, privacy controls, or private groups/profiles. Runs report `ok`, `partial`, `temporarily_unavailable`, `login_required`, or `not_found` rather than returning cross-target or invented data.

## Routes

The console is served at `/scraper/facebook`. The Server engine uses:

1. `POST /api/scraping/facebook/jobs`
2. `POST /api/scraping/facebook/jobs/:id/run`
3. `GET /api/scraping/facebook/jobs/:id`

The production website stores the same job shape in Supabase, where the paired
Companion claims it with a token-scoped Facebook-scraping session. Companion
also exposes a loopback-only API on `127.0.0.1:8792` for its own UI and local
diagnostics. The optional browser extension can relay that local API for legacy
use, but is not required by the website flow.

## Development

Run the complete workspace with `npm run dev`, or the Facebook service alone with `npm run services:facebook`. Run Facebook tests with `npm run test:facebook`.
