# Website-only server execution roadmap

## Safety boundary

- `main` and the current Netlify site continue using Companion.
- New work is isolated on `server-architecture`.
- Server publishing, login, and scraping default to disabled.
- The new service cannot read the existing production database variable.
- Local data stays in the ignored `.server-data/` directory.
- No Docker or additional cloud provider is required during local development.

## Implemented foundation

1. Loopback-only Node/Express automation service.
2. Explicit local configuration and internal request token.
3. Local media, profile, scraping-result, and temporary storage boundaries.
4. Separate PostgreSQL schema and manual migration.
5. Server account and publishing-job contracts.
6. Per-account leases and monotonic fencing tokens.
7. Safe `UNCERTAIN` recovery state for interrupted publication.
8. Tests proving all server execution features remain disabled by default.

## Next development work

1. Install and initialize local PostgreSQL.
2. Add the login-session state machine.
3. Start headed Playwright Chromium without Electron.
4. Stream the login browser to a local website page.
5. Save one development-only account profile.
6. Move one platform publisher behind `ServerPublishingExecutor`.
7. Add the publishing worker heartbeat and profile-version write guard.
8. Connect only a test workspace through a per-account `server` engine flag.
9. Add temporary-browser scraping workers.

## Requirements before live production

1. A fixed staging Netlify site and isolated staging database.
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
