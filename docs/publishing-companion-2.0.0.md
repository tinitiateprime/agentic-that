# AgenticThat Companion 2.0.0 release notes

Companion 2.0 replaces the website-polling transport with a secure Supabase
job-control plane. The existing local publishing and scraping engines are
unchanged.

## Control plane

- One-time, instance-bound device pairing with hashed, revocable 384-bit tokens.
- Existing 1.x installations require one fresh pairing after installing 2.0;
  obsolete website-polling credentials are not reused.
- RLS enabled on devices, social-account metadata, jobs, events, results, and
  artifact metadata; `anon` and `authenticated` have no direct table access.
- Atomic job claims use `FOR UPDATE SKIP LOCKED`, five-minute renewable leases,
  bounded attempts, and workspace/device ownership checks.
- Publishing has terminal `SUCCESS`, `FAILED`, and `UNCERTAIN` outcomes. A lease
  lost after the final platform action becomes `UNCERTAIN` and is never blindly
  replayed.
- Instagram and Facebook Companion scraping now uses the same durable queue and
  persists results in Supabase for workspace history.
- Offline, restart, sleep, network-loss, and process-crash recovery are handled
  by durable job state and expiring leases.

## Security and media

- Browser cookies, provider sessions, passwords, and verification codes remain
  encrypted on the Companion computer and are rejected from web job payloads.
- Companion contains only the public Supabase publishable key and its encrypted
  device token; the database URL and secret key remain on the website deployment.
- Publishing media is stored in a private Supabase Storage bucket and delivered
  with scoped signed URLs plus SHA-256 integrity verification.

## Desktop experience

- Companion is now a focused tray worker, session/login surface, queue/activity
  monitor, log viewer, updater, and Emergency Stop interface.
- The SaaS workspace opens in the normal browser instead of being embedded.
- The Chrome extension remains optional for compatibility and is not required
  for publishing, scraping, pairing, or job progress.
- Publishing and Telegram scheduling remain paused.

Version 2.0.0 requires the database migration in
`supabase/migrations/202609020001_companion_job_control.sql` and the three
Supabase API/Storage environment variables documented in `docs/netlify-env.md`.
