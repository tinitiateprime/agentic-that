# Instagram Local Companion Engine

The Instagram scraper has two explicit execution engines:

- `server` keeps the existing cloud/Netlify scraping path unchanged.
- `companion` runs the same public-data extraction and ranking contract on the customer's computer and network.

The selected engine is exact. Neither engine silently falls back to the other. Companion results are produced by the current job only and are never replaced with a saved server run.

## Local API

The existing Publishing Companion owns the authenticated loopback API on `127.0.0.1:8792`:

- `GET /api/health` reports `capabilities.instagramScraping` availability, queue depth, and concurrency.
- `POST /api/scraping/instagram/jobs` validates and queues a fresh public scrape.
- `GET /api/scraping/instagram/jobs/:id` returns product-level progress and the normalized result.
- `DELETE /api/scraping/instagram/jobs/:id` cancels queued or active work.

Job routes use a short-lived scraping-only bearer session derived from the signed AgenticThat workspace identity and are scoped to the authenticated workspace and user. It is created automatically when Local Companion is selected; publishing permissions still require the separate Operations Manager session. In the production website flow, the job is stored in Supabase and claimed directly by the paired Companion. The loopback routes remain internal and diagnostic; the optional Chrome extension can relay them for legacy local use but receives no Instagram host permission.

## Browser isolation

Each attempt uses a hidden Electron `BrowserWindow` with a unique non-persistent partition. It is separate from the persistent publishing partitions and is never added to the publishing activity grid. The worker:

- has no Instagram login or publishing cookies;
- denies permission requests and contains Instagram popups in the hidden worker;
- permits top-level navigation only to HTTPS Instagram pages;
- clears storage and cache and destroys the window after success, failure, cancellation, recovery, or shutdown.

Recovery creates another fresh isolated worker. The local queue allows one active scrape so overlapping users cannot create an uncontrolled browser burst.

## Collection behavior

The Companion engine reuses the server scraper's normalized output, parsing, source reconciliation, ranking, and analysis code. Profile analysis performs two phases: deep discovery (up to the configured 300-Reel cap) followed by detailed enrichment of only the unique ranking winners. Current Reels-grid and current payload evidence have priority; approximate and exact counters remain labeled separately, and unavailable likes/comments remain `null`.

## Operational limits

This engine improves reliability by moving requests away from shared server IPs, but Instagram can still change public markup, require login, rate-limit a network, remove a profile, or experience an outage. These conditions return typed failures instead of cached or cross-profile data. Product rate limits can be added above the existing one-job local concurrency without changing the scraping engine.

Desktop release containing live scraping activity and the Electron multi-page compatibility fix: `1.4.3`.
