# AgenticThat automation server foundation

This service is the isolated starting point for website-only publishing and
scraping. It does not replace or import the current Companion. Every execution
feature is disabled by default. Development binds to loopback and uses an
isolated SQLite file under `.server-data`; production fails closed unless it is
configured for PostgreSQL, Azure Blob Storage, and Azure Key Vault encryption.

## Current capabilities

- Local health API on `127.0.0.1:8800`.
- Separate local media, browser-profile, result, and temporary directories.
- Interchangeable local SQLite and production PostgreSQL stores for accounts,
  browser profiles, publishing jobs, attempts, account locks, scraping jobs,
  and activity events.
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
  upload one JPEG/PNG image or MP4/MOV video, enter the caption, capture the final composer, and
  close before Share. The preview boundary has no publish method.
- Preview browser work has a 150-second hard limit, visible stage progress,
  safe interrupted-job recovery, and a private diagnostic screenshot when
  Instagram stops at an unexpected screen.
- First guarded Instagram live worker for one JPEG/PNG feed post or MP4/MOV Reel. Live jobs
  require two feature flags, an authorized database bit, exact `PUBLISH`
  confirmation, an owned account lease, and a fenced transition to `VERIFYING`
  before the executor can click Share.
- Local date/time scheduling, workspace-scoped live-job history and statuses,
  and cancellation that succeeds only while a job is still `SCHEDULED`.
- A bounded live-publishing pool can run different accounts concurrently while
  the database lease prevents two workers from using one account profile.
- Authenticated development integration with the existing AgenticThat
  publishing dashboard. The dashboard proxies through its own server, keeps
  the worker token out of browser JavaScript, forces the signed-in workspace on
  every request, supports website login frames, and routes single-media Instagram
  posts to server-managed accounts behind a disabled-by-default production flag.
- No Electron dependency. The production image uses fixed Playwright/Chromium
  versions; local development does not require Docker.

The local milestone can run Chrome/Edge headlessly and show it inside the local
connection page. The authenticated AgenticThat website now uses the same
bounded browser-input protocol through its server bridge, and Server Worker
account setup lives in Config Manager. Committed feature flags remain false by
default.

`SERVER_PUBLISHING_DRY_RUN_ENABLED=true` enables only local preflight workers.
`SERVER_PUBLISHING_PREVIEW_ENABLED=true` additionally enables the private,
networked composer preview. Neither flag enables live publishing. Live Instagram
testing requires both `SERVER_EXECUTION_ENABLED=true` and
`SERVER_INSTAGRAM_PUBLISHING_ENABLED=true`; committed defaults remain false.
Facebook server publishing is separately gated by
`SERVER_FACEBOOK_PUBLISHING_ENABLED=true` and supports text-only, one JPEG/PNG
image, or one MP4/MOV video per post. Instagram supports 1–10 same-format
images or videos for carousel jobs. All final publish actions still require the
explicit live authorization fence.
X server publishing is separately gated by `SERVER_X_PUBLISHING_ENABLED=true`
and supports standard text posts plus one JPEG/PNG image or MP4/MOV video.
`SERVER_LIVE_WORKER_COUNT` controls live publishing concurrency from 1 through
8 and defaults to 1. Increase it gradually because each active job can launch
its own Chromium process.
`SERVER_LOGIN_MAX_CONCURRENT` independently limits interactive login browsers
from 1 through 4 and defaults to 1 for the production pilot.

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
   `http://127.0.0.1:8800/ready` returns 200 only when the database, internal
   token, and any required browser executable are ready.
5. For local login testing, set `SERVER_LOGIN_ENABLED=true` and a long random
   `SERVER_ARCHITECTURE_INTERNAL_TOKEN` in `.env.local`, restart the service,
   then open `http://127.0.0.1:8800/development/connect`.
6. To test the worker safely, also set
   `SERVER_PUBLISHING_DRY_RUN_ENABLED=true`, select a connected test account,
   choose a JPEG or PNG, and click **Run safe check**. Large media is uploaded
   in small chunks; the configurable host storage ceiling still protects the
   server disk. This validates the queue and saved files without opening
   Instagram or publishing anything.
7. To test the Instagram composer without publishing, also set
   `SERVER_PUBLISHING_PREVIEW_ENABLED=true`, restart, choose the same test media,
   and click **Prepare private preview**. After confirmation, this uploads the
   image or video into Instagram, captures the final composer, and closes before Share.
8. Only with a test account and content you intend to make public, enable both
   live flags, restart, click **Publish test post**, and type the exact word
   `PUBLISH`. This performs the irreversible Instagram Share action. If the
   platform receives Share but its confirmation cannot be verified, the job is
   marked `UNCERTAIN` and must be checked manually before any retry.
9. To schedule instead, choose a future local date/time and click **Schedule
   post**, then type `PUBLISH`. The browser page can close, but this local server
   computer must remain running. A queued post can be cancelled only while its
   status is still `SCHEDULED`.
10. During local Next.js development, the publishing dashboard can reuse this
    service's `.env.local` when live execution is explicitly enabled. Open the
    normal AgenticThat `/publishing` page to add a server-managed Instagram
    account and use it in the existing composer. The old Companion accounts
    remain separate and unchanged. Production never reads this local fallback;
    it requires `SERVER_AUTOMATION_DASHBOARD_ENABLED=true`, an HTTPS
    `SERVER_AUTOMATION_ORIGIN`, and a matching
    `SERVER_AUTOMATION_INTERNAL_TOKEN` in the website environment.

Google Chrome or Microsoft Edge must already be installed on the local server
computer. The development page never asks for a social-media password; enter
credentials only into the real Instagram page shown by the server browser. The
local HTTP input relay does not log or persist keystrokes. Production requires
TLS and short-lived stream authorization before any real customer login.

The migration is intentionally absent from `netlify.toml` and the root build.
The database safety check refuses to open a SQLite file outside the isolated
server data directory.

## Production pilot

The prepared pilot is one Next.js Azure Web App plus one single-instance
automation Web App, Supabase PostgreSQL, private Azure Blob containers, and
Azure Key Vault envelope encryption. Production DDL is explicit and never runs
during server startup. Profile archives use AES-256-GCM with per-archive data
keys wrapped by a versioned RSA Key Vault key; conditional Blob writes prevent
stale workers from overwriting a newer account profile.

Use [`deploy/azure/README.md`](../../deploy/azure/README.md) for provisioning,
deployment, staged enablement, recovery, and rollback. The current readiness
record is [`docs/production-pilot-readiness.md`](../../docs/production-pilot-readiness.md).
Do not enable a live platform until its staging test-account checklist passes.

## Ubuntu staging foundation

Run `npm run server-architecture:preflight` before starting the worker. The
provider-neutral systemd, Nginx, environment, and rollout templates are in
`deploy/ubuntu`.

`SERVER_ARCHITECTURE_DEPLOYMENT=staging` adds fail-closed checks: the service
must bind to loopback behind HTTPS, use a strong internal token, use absolute
persistent paths, enable automatic migrations, and use an absolute browser
path when browser features are enabled. Staging also removes the local
`/development/connect` page so its development-only embedded token cannot be
exposed through the reverse proxy.

`SERVER_ARCHITECTURE_DEPLOYMENT=production` requires PostgreSQL, Azure storage,
Key Vault configuration, encrypted profile storage, explicit migrations, a
strong internal token, and an acknowledged/tested backup configuration. It
refuses SQLite, local profile storage, automatic migrations, or missing safety
configuration.

## Checks

```text
npm run server-architecture:check
npm run test:publishing
npm run build
```

Local browser profiles remain development-only and unencrypted; do not put real
customer sessions in `.server-data`. SQLite is intentionally limited to local
development/test. PostgreSQL and encrypted Azure profile storage are the only
accepted production implementations.
