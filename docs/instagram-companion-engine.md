# AgenticThat Companion scraping engine

The Instagram and Facebook scrapers have two explicit execution engines:

- `companion` is the default and recommended engine. It runs the proven
  public-data extraction and ranking contract on the customer's computer and
  network.
- `server` runs the separate Ubuntu service and remains explicitly selectable
  for users who do not have Companion.

The selected engine is exact. Neither engine silently falls back to the other. Companion results are produced by the current job only and are never replaced with a saved server run.

## Local API

AgenticThat Companion owns the authenticated loopback API on `127.0.0.1:8792`:

- `GET /api/health` reports `capabilities.instagramScraping` availability, queue depth, and concurrency.
- `POST /api/scraping/instagram/jobs` validates and queues a fresh public scrape.
- `GET /api/scraping/instagram/jobs/:id` returns product-level progress and the normalized result.
- `DELETE /api/scraping/instagram/jobs/:id` cancels queued or active work.

Job routes use a short-lived scraping-only bearer session derived from the signed AgenticThat workspace identity and are scoped to the authenticated workspace and user. It is created automatically when Companion is selected; publishing permissions still require the separate Operations Manager session. The Chrome extension transports these loopback requests; it retains only its `http://127.0.0.1:8792/*` permanent host permission and receives no Instagram or Facebook host permission. A custom AgenticThat HTTPS dashboard origin must be explicitly approved in the extension popup.

## Browser isolation

Each attempt uses a hidden Electron `BrowserWindow` with a unique non-persistent partition. It is separate from the persistent publishing partitions and is never added to the publishing activity grid. The worker:

- has no Instagram login or publishing cookies;
- denies permission requests and contains Instagram popups in the hidden worker;
- permits top-level navigation only to HTTPS Instagram pages;
- clears storage and cache and destroys the window after success, failure, cancellation, recovery, or shutdown.

Recovery creates another fresh isolated worker. Instagram and Facebook share one
local scraping slot, so they cannot create simultaneous browser bursts. New
scrapes wait while a local publishing automation run has priority; an active
scrape is allowed to finish safely rather than being killed mid-collection.

## Collection behavior

The Companion engine reuses the server scraper's normalized output, parsing, source reconciliation, ranking, and analysis code. Profile analysis performs two phases: deep discovery (up to the configured 300-Reel cap) followed by detailed enrichment of only the unique ranking winners. Current Reels-grid and current payload evidence have priority; approximate and exact counters remain labeled separately, and unavailable likes/comments remain `null`.

## Operational limits

This engine improves reliability by moving requests away from shared server IPs, but a provider can still change public markup, require login, rate-limit a network, remove a profile, or experience an outage. These conditions return typed failures instead of cached or cross-profile data. Completed Companion results are validated and saved to the authenticated workspace's server-side run history. The website never silently reruns a failed Companion request on the Server engine.

The website requires AgenticThat Companion `1.7.4` and extension `1.2.0` or newer for the current Companion contract. Companion accepts a self-hosted dashboard's public verification key only when the request arrives through the trusted extension or desktop proxy; private signing keys remain on the website server.
