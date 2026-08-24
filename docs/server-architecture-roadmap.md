# Website-only server execution roadmap

## Safety boundary

- `main` and the current Netlify site continue using Companion.
- New work is isolated on `server-architecture`.
- Server publishing, login, and scraping default to disabled.
- The new service uses its own local SQLite file and cannot read the existing production database variable.
- Local data stays in the ignored `.server-data/` directory.
- No Docker or additional cloud provider is required during local development.

## Implemented foundation

1. Loopback-only Node/Express automation service.
2. Explicit local configuration and internal request token.
3. Local media, profile, scraping-result, and temporary storage boundaries.
4. Separate local SQLite database and manual migration.
5. Server account and publishing-job contracts.
6. Per-account leases and monotonic fencing tokens.
7. Safe `UNCERTAIN` recovery state for interrupted publication.
8. Tests proving all server execution features remain disabled by default.
9. Instagram login-session lifecycle and restart recovery.
10. One isolated persistent Chrome/Edge profile per server account.
11. Local connection page and automatic authenticated-session detection.

## Next development work

1. Stream the server browser into an authenticated AgenticThat website page.
2. Forward keyboard, pointer, clipboard, and resize events safely to Chromium.
3. Add short-lived login-stream authorization and strict origin checks.
4. Verify one development-only Instagram profile with a test account.
5. Move the Instagram publisher behind `ServerPublishingExecutor`.
6. Add the publishing worker heartbeat and profile-version write guard.
7. Connect only a test workspace through a per-account `server` engine flag.
8. Add temporary-browser scraping workers.

## Requirements before live production

1. A fixed staging Netlify site and isolated managed PostgreSQL staging database.
2. A separate always-on automation server; Netlify remains the website host.
3. Encrypted browser-profile and media storage with managed keys.
4. Website authentication for login streams instead of the local internal token.
5. TLS/WSS, strict origin checks, rate limits, audit logs, and admin-access controls.
6. Worker resource limits, monitoring, backups, alerts, and disaster recovery.
7. Platform-by-platform manual login, publishing, scheduling, expiry, 2FA, and
   uncertain-result tests using test accounts.
8. Per-workspace rollout with Companion as rollback until the server path is
   proven stable.
9. A reconnect flow for existing accounts; locally encrypted Companion profiles
   are not silently uploaded.
10. Security, privacy, retention, and platform-policy review before customer use.
