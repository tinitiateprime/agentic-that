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
- Expired live publishing work moves to `UNCERTAIN` for verification instead
  of being blindly retried; expired non-publishing checks are safely cancelled.
- Internal-token protection for non-health endpoints.
- Instagram login-session lifecycle with one active login per account.
- Dedicated persistent Chrome/Edge profiles with password saving disabled.
- Automatic connection detection from Instagram's authenticated session cookie;
  the password is never sent to or stored by AgenticThat.
- Loopback-only development page for creating and connecting a test account.
- Website browser frames plus bounded click, keyboard, paste, and scroll input
  for local end-to-end login testing.
- Dry-run publishing worker using the real due-job claim, heartbeat, fencing,
  per-account lock, saved-profile check, media preflight, and audit trail.
- Dry-run jobs finish as `CANCELLED` with `DRY_RUN_COMPLETE` or
  `DRY_RUN_VALIDATION_FAILED`; they never become publishable live jobs.
- Confirmation-gated Instagram composer previews open the saved profile,
  upload one test image, enter the caption, capture the final composer, and
  close before Share. The preview boundary has no publish method.
- No Electron or Docker dependency.

The local milestone can run Chrome/Edge headlessly and show it inside the local
connection page. Integrating that stream with the authenticated, hosted
AgenticThat website and adding platform publishing executors are the next
implementation phases. Committed feature flags remain false by default.

`SERVER_PUBLISHING_DRY_RUN_ENABLED=true` enables only local preflight workers.
`SERVER_PUBLISHING_PREVIEW_ENABLED=true` additionally enables the private,
networked composer preview. Neither flag enables live publishing. The server refuses to start if
`SERVER_EXECUTION_ENABLED=true` because the live executor has not been safely
implemented yet.

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
6. To test the worker safely, also set
   `SERVER_PUBLISHING_DRY_RUN_ENABLED=true`, select a connected test account,
   choose a JPEG or PNG up to 25 MB, and click **Run safe check**. This validates
   the queue and saved files without opening Instagram or publishing anything.
7. To test the Instagram composer without publishing, also set
   `SERVER_PUBLISHING_PREVIEW_ENABLED=true`, restart, choose the same test media,
   and click **Prepare private preview**. After confirmation, this uploads the
   image into Instagram, captures the final composer, and closes before Share.

Google Chrome or Microsoft Edge must already be installed on the local server
computer. The development page never asks for a social-media password; enter
credentials only into the real Instagram page shown by the server browser. The
local HTTP input relay does not log or persist keystrokes. Production requires
TLS and short-lived stream authorization before any real customer login.

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
