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
- Instagram login-session lifecycle with one active login per account.
- Dedicated persistent Chrome/Edge profiles with password saving disabled.
- Automatic connection detection from Instagram's authenticated session cookie;
  the password is never sent to or stored by AgenticThat.
- Loopback-only development page for creating and connecting a test account.
- No Electron or Docker dependency.

The local milestone opens Chrome/Edge on the automation-server computer. The
actual browser stream inside the hosted AgenticThat website and the platform
publishing executors are the next implementation phases. Committed feature
flags remain false by default.

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

4. Check `http://127.0.0.1:8800/health`.
5. For local login testing, set `SERVER_LOGIN_ENABLED=true` and a long random
   `SERVER_ARCHITECTURE_INTERNAL_TOKEN` in `.env.local`, restart the service,
   then open `http://127.0.0.1:8800/development/connect`.

Google Chrome or Microsoft Edge must already be installed on the local server
computer. The development page never asks for a social-media password; enter
credentials only on the real Instagram page in the dedicated browser window.

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
