# Hetzner database and Companion transport

Application PostgreSQL data is hosted on `mk3s.your-database.de:5432`, database
`ageticthat`, login `agenticthat`. Keep the password in private environment
settings, URL-encode it, and use `sslmode=require` in `DATABASE_URL`.

Set the same `DATABASE_URL` on the active Amplify app and any branch override.
Retain all existing encryption and signing keys. The Amplify environment
preparation step writes allowlisted server variables to `.env.production`.
`COMPANION_RPC_TRANSPORT=postgres` must be present in the build and runtime.

Run `npm run db:check` to verify connectivity, SSL, tables, and migration markers.
Run `npm run test:companion-database` for transport tests. A real-database
integration check is opt-in through `COMPANION_DATABASE_TEST_URL`; it rolls back
all fixtures and exercises one-time pairing, installation binding, heartbeats,
job leases, results, and workspace isolation. Regular test runs do not use a
production database.

## Companion compatibility

The website exposes only four token-authenticated operations at
`/rest/v1/rpc/companion_*`. They execute the existing scoped PostgreSQL
functions, whose definitions and private helper functions must be restored
alongside the tables. No arbitrary table access or SQL endpoint is exposed.

Pairing responses use `PLATFORM_PUBLIC_URL` as the API origin. Existing released
Companions support this protocol without a binary update. Reconnect each
Companion once through Config Manager after the migration; saved Supabase
pairings continue to target the old database until replaced.

Private media remains in its existing Supabase Storage bucket. Claimed jobs
receive website-origin signed download URLs, including chunked downloads.
The download proxy forwards only the signed URL and an optional byte range to
the configured storage origin; it never forwards cookies or elevated keys.

## Cutover

1. Verify the restored schema, encryption keys, row counts, and data checksums.
2. Test the PostgreSQL transport before changing the live connection.
3. Configure Amplify with the Hetzner URL and `COMPANION_RPC_TRANSPORT=postgres`.
4. Deploy and verify live pairing, heartbeat, claim, and update requests.
5. Revoke `anon` and `authenticated` execution privileges on the old Supabase
   `companion_redeem_pairing`, `companion_heartbeat`, `companion_claim_jobs`, and
   `companion_update_job` functions. This prevents old pairings from processing
   stale jobs. Keep the original grants available for rollback.
6. Reconnect existing Companions and verify a real workspace workflow.

Rollback restores the previous Amplify database URL and transport setting,
redeploys the previous source, and restores the old function grants. Reconcile
any new Hetzner writes before returning traffic to the old database.

For local development, the root `.env.local` database URL takes precedence over
the WhatsApp fallback. Explicit process variables take precedence over both.
Restart development servers after changing configuration. Leave local
`ADMIN_PASSWORD` empty against an existing shared database to avoid the legacy
admin bootstrap resetting its stored password.
