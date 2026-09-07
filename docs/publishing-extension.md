# Desktop Companion and optional Chrome bridge

AgenticThat publishing has one recommended production flow and an optional
compatibility path:

1. Recommended: use the AgenticThat website, Supabase job control, and the paired
   **AgenticThat Companion** desktop app. No browser extension is required.
2. Optional compatibility: install the Chrome extension when a legacy local UI
   must relay restricted requests to Companion's loopback service.

The desktop application owns the persistent local queue, encrypted browser
profiles, uploaded media, visible publishing browsers, and Instagram/Facebook
scraping. The website and extension never receive social-network passwords or
verification codes.

## Customer setup

1. Download the Windows, macOS, or Linux installer from `/companion/download`.
2. Install and open **AgenticThat Companion**.
3. Use the AgenticThat website and pair this computer from
   **Connections → Publishing**.
4. Add a social account and choose **Login**. Facebook, X, and YouTube open in a dedicated
   Companion-managed Chrome, Edge, or Chromium profile; Instagram and LinkedIn open in
   the embedded browser and can fall back to a system browser if necessary.
5. Complete credentials and verification only on the provider page. Companion
   verifies and protects the resulting local session before using it.

Normal website use does not need the Chrome extension. Install it only for the
legacy local compatibility path. Its popup can grant one exact self-hosted HTTPS
origin; it does not ask for unrestricted browsing access.

## Publishing behavior

Release 1.8.0 supports publish-now queue execution for Facebook, Instagram, X,
LinkedIn, and YouTube. Scheduling is paused: schedule controls are absent, timed
API mutations return HTTP 410, and existing timed records are not executed.
Interrupted or uncertain final publish actions are held for inspection so the
system does not silently create duplicates.

## Security boundary

The local API binds only to `127.0.0.1`. Central workspace sharing uses an
outbound paired-token connection, never a public local port. Browser publishing
still depends on third-party interfaces; UI changes, CAPTCHA, account warnings,
rate limits, and internet failures are recorded as explicit recoverable errors
rather than false successes.
