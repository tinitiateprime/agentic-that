# AgenticThat automation server foundation

This service is the isolated starting point for website-only publishing and
scraping. It does not replace or import the current Companion. Every execution
feature is disabled by default, it binds to loopback by default, and it uses
only `SERVER_ARCHITECTURE_DATABASE_URL`.

## Current capabilities

- Local health API on `127.0.0.1:8800`.
- Separate local media, browser-profile, result, and temporary directories.
- Additive PostgreSQL schema for accounts, browser profiles, publishing jobs,
  attempts, account locks, scraping jobs, and activity events.
- Transactional due-job claiming with one active lease per social account.
- Monotonic fencing tokens so an expired worker cannot complete a newer job.
- Expired publishing work moves to `UNCERTAIN` for verification instead of
  being blindly retried.
- Internal-token protection for non-health endpoints.
- No Electron or Docker dependency.

The actual remote login stream and platform Playwright executors are the next
implementation phase. Until those are complete, keep all feature flags false.

## Local setup

1. Install PostgreSQL locally when database-backed testing begins.
2. Create a database named `agenticthat_server_staging`.
3. Copy `.env.example` to `.env.local` in this folder and replace the local
   password and internal token.
4. Run the migration manually:

```text
npm run server-architecture:db:migrate
```

5. Start the local service:

```text
npm run server-architecture:dev
```

6. Open `http://127.0.0.1:8800/health`.

The migration is intentionally absent from `netlify.toml` and the root build.
It refuses to use the URL from `DATABASE_URL`, `SUPABASE_DB_URL`, or
`SUPABASE_DATABASE_URL`.

## Checks

```text
npm run server-architecture:check
npm run test:publishing
npm run build
```

Local browser profiles are development-only and unencrypted. Do not put real
customer sessions in `.server-data`. Production requires encrypted profile
storage and a managed key service before any customer rollout.
