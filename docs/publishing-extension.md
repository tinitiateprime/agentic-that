# Desktop Companion and optional Chrome bridge

AgenticThat publishing has two supported access paths:

1. Recommended: install **AgenticThat Companion** and use the dashboard embedded
   in the desktop application.
2. Optional: open the dashboard in Chrome and install the Companion extension,
   which relays restricted requests to the same loopback service.

The desktop application owns the persistent local queue, encrypted browser
profiles, uploaded media, visible publishing browsers, and Instagram/Facebook
scraping. The website and extension never receive social-network passwords or
verification codes.

## Customer setup

1. Download and extract the latest Companion portable ZIP.
2. Open `AgenticThat Publishing Companion.exe` (the legacy executable name is
   retained for upgrade compatibility).
3. Use the embedded AgenticThat workspace and pair this computer from
   **Connections → Publishing**.
4. Add a social account and choose **Login**. X and YouTube open in a dedicated
   Companion-managed Chrome or Edge profile; other providers open in the
   embedded browser and can fall back to Chrome/Edge if necessary.
5. Complete credentials and verification only on the provider page. Companion
   verifies and protects the resulting local session before using it.

Install the Chrome extension only if the user wants the dashboard in a separate
browser. The popup can grant one exact self-hosted HTTPS origin; it does not ask
for unrestricted browsing access.

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
