# AgenticThat automation server foundation

This service is the isolated starting point for website-only publishing and
scraping. It does not replace or import the current Companion. Every execution
feature is disabled by default, it binds to loopback by default, and it uses
an isolated local SQLite file under `.server-data`.

## Current capabilities

- Local health API on `127.0.0.1:8800`.
- Separate local media, browser-profile, result, and temporary directories.
- Local SQLite schema for accounts, browser profiles, publishing jobs,
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

No database, Docker, or cloud account needs to be installed. Node.js creates
the ignored `.server-data/automation.db` file directly.

1. Optionally copy `.env.example` to `.env.local` in this folder and replace
   the internal token before testing protected routes.
2. Create or update the local database:

```text
npm run server-architecture:db:migrate
```

3. Start the local service:

```text
npm run server-architecture:dev
```

4. Open `http://127.0.0.1:8800/health`.

The migration is intentionally absent from `netlify.toml` and the root build.
The database safety check refuses to open a SQLite file outside the isolated
server data directory.

## Checks

```text
npm run server-architecture:check
npm run test:publishing
npm run build
```

Local browser profiles are development-only and unencrypted. Do not put real
customer sessions in `.server-data`. Production requires encrypted profile
storage, a managed key service, and PostgreSQL before any customer rollout.
SQLite is intentionally limited to development on this computer; it is not the
future multi-server production database.
