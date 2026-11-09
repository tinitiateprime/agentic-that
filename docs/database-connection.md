# Hetzner PostgreSQL connection

The live AWS Amplify app `agentic-that`, production branch `main` in `us-east-1`,
uses Hetzner as of 2026-11-02. Its Companion transport is
`COMPANION_RPC_TRANSPORT=postgres`. The GitHub `production-database` environment's
`PRODUCTION_DATABASE_URL` secret also points to Hetzner. Production migration
code is committed on `main` at `46ebffb`; it was deployed from an isolated
checkout so existing local UI changes were preserved.

The cutover verified matching contents across 68 application tables and all
48 SQL migration checksums. Live pairing, heartbeat, job claim/completion,
signed media, range downloads, and all nine deployment health checks passed.
Private rollback backups remain in ignored local files.

Reconnect existing Companions once in Config Manager. The old Supabase
Companion RPCs and pairings were disabled to prevent stale job processing.
Private media continues to use the existing Supabase Storage bucket.

The shared application database is `ageticthat` on `mk3s.your-database.de:5432`,
with login `agenticthat`. Keep the password in private environment settings.

Set `DATABASE_URL` in the root `.env.local`. URL-encode the password and request
SSL with `?sslmode=require`. The development launcher uses the root database URL
ahead of the WhatsApp service fallback; explicitly inherited process settings
still take precedence. Restart a running development server after changing it.

Run `npm run db:check` to verify the connection, SSL, required tables, and
platform/WhatsApp migration records. This command uses a read-only transaction
and does not bootstrap accounts or apply migrations.

Leave local `ADMIN_PASSWORD` empty when using an existing shared database. The
legacy WhatsApp admin bootstrap updates an existing admin password to this value
when it is set. Existing accounts can sign in with their stored passwords.

Platform users, workspaces, access control, WhatsApp, and database document
storage use `DATABASE_URL`. Some standalone Telegram/publishing stores still use
JSON or Netlify Blobs, and the isolated automation server uses SQLite. Changing
the PostgreSQL connection does not migrate those stores.

## AWS Amplify

Set `DATABASE_URL` on the active Amplify app/branch to the same private Hetzner
connection string. Preserve existing session and credential encryption keys so
the copied encrypted data remains readable. Check branch overrides as well as
application settings.

For Next.js server rendering, ensure the existing Amplify build configuration
passes `DATABASE_URL` into the server runtime, then redeploy the app. Amplify
build variables are not automatically available to Next.js server components;
see [AWS runtime environment variable documentation](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-environment-variables.html).
Keep the connection string server-side, outside `NEXT_PUBLIC_*` variables.

The saved Netlify configuration belongs to the previous deployment and is not
the active AWS Amplify deployment.
