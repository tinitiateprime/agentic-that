# Website-only server execution roadmap

## Safety boundary

- `main` and the current Netlify site continue using Companion.
- New work is isolated on `server-architecture`.
- Server publishing, login, and scraping default to disabled.
- The new service uses SQLite only in development/test and a dedicated
  PostgreSQL connection in production.
- Local data stays in the ignored `.server-data/` directory.
- No Docker or cloud account is required during local development; production
  container and Azure templates are prepared separately.

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
12. Local website browser frames and bounded pointer/keyboard input relay.
13. Non-networked Instagram publishing dry-run worker using production-shaped
    queue leases, profile/media validation, and terminal audit records.
14. Confirmation-gated Instagram composer preview with a separate job stage,
    saved-profile browser execution, private screenshot result, and no Share action.
15. Double-gated Instagram live worker with explicit authorization, exact Share
    targeting, pre-action fencing, platform confirmation, and `UNCERTAIN` recovery.
16. Local future-date scheduling with workspace-scoped job history, status
    refresh, and atomic cancellation before a worker claims the post.
17. Configurable 1-8 worker live-publishing pool with tests proving concurrent
    execution across accounts and strict serialization within one account.
18. Server-managed Instagram accounts are the authoritative account source for
    the authenticated Config Manager, product status, and publishing dashboard;
    legacy Companion records remain stored but are not offered in the main flow.
19. PostgreSQL production store with atomic skip-locked claiming and parity for
    leases, fences, attempts, events, scraping, and manual reconciliation.
20. Private Azure Blob storage with Key Vault envelope-encrypted, checksummed,
    conditionally versioned browser-profile archives.
21. Dedicated Facebook, X, LinkedIn, YouTube live worker paths and separate
    disabled-by-default flags for every platform.
22. Azure Web App containers/IaC, manual OIDC deployment workflows, managed
    identities, monitoring, graceful drain, rollout rollback, and operational
    metrics.
23. Separately bounded interactive-login browsers plus dynamic PostgreSQL,
    private-Blob, and Key Vault crypto readiness checks.

## Next development work

1. Run Azure/Supabase staging validation and a browser-memory soak test.
2. Replace frame polling with efficient short-lived TLS/WSS login streaming if
   the staging UX requires it.
3. Tune queue/lease/uncertain alert thresholds from staging observations.
4. Add richer multi-media support only after each basic platform worker is stable.
5. Consider Azure identity/private networking for website-to-automation auth
   after the single-instance pilot; do not add distributed infrastructure yet.

## Requirements before live production

1. Separate Azure staging Web Apps and isolated managed PostgreSQL staging database.
2. One always-on, single-instance automation Web App and a separate website Web App.
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
