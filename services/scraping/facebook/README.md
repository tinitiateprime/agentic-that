# Facebook Scraper

Public-browser Facebook scraping service. It is organized independently from Instagram and supports two exact execution engines that share the same normalized extraction and analysis contract:

- `server` launches fresh, isolated Chromium contexts in the local service or Netlify background worker.
- `companion` launches fresh, non-persistent hidden Electron workers on the customer's computer and network.

Neither engine uses the Facebook Graph API, API tokens, OAuth, connected Facebook accounts, or saved Facebook sessions. The selected engine never silently falls back to the other engine.

## Inputs and collections

Supported inputs are Page/public-profile username, keyword/hashtag, Page/public-profile URL, and direct post/Reel/photo/video URL. Keywords are normalized to Facebook's public hashtag surface because logged-out general search is not consistently exposed. Supported collection modes are Latest, Date/Month/Year Range, Profile Analysis, and UI-orchestrated Profile Comparison. Profile runs deep-scroll the **All** tab for posts, then independently deep-scroll **Reels** and merge visible grid-overlay views by post/reel identity. Most Viewed is ranked from the complete Reels-grid scan rather than only the returned latest-post slice.

The normalized post contract includes author, permalink, content, media type, thumbnail, timestamp, reactions, comment count and visible comment samples, Reels-grid views, followers, metric precision, current source, and capture time. Selected posts are opened through their comment control, the comment region is scrolled to load entries, and visible comments are collected. Share counts are intentionally not extracted. A value that is not reliably visible remains `null` and is shown as `N/A`.

## Public-access behavior

The scraper reads public Facebook pages and the fresh browser responses produced by those pages. It does not bypass login walls, checkpoints, CAPTCHA, privacy controls, or private groups/profiles. Runs report `ok`, `partial`, `temporarily_unavailable`, `login_required`, or `not_found` rather than returning cross-target or invented data.

## Routes

The console is served at `/scraper/facebook`. The Server engine uses:

1. `POST /api/scraping/facebook/jobs`
2. `POST /api/scraping/facebook/jobs/:id/run`
3. `GET /api/scraping/facebook/jobs/:id`

The Local Companion exposes the same job shape on `127.0.0.1:8792`, transported through the existing Companion extension with a Facebook-scraping-only bearer session.

## Development

Run the complete workspace with `npm run dev`, or the Facebook service alone with `npm run services:facebook`. Run Facebook tests with `npm run test:facebook`.
