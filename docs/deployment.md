# AWS Amplify deployment

Amplify hosts the Next.js website and request-based APIs. A private Node 22
Lambda worker can run long scraping, Growth Advisor and Website Studio jobs.
Supabase remains the PostgreSQL database, private media storage and token-scoped
Companion job-control backend. Publishing browser sessions stay in the desktop
Companion. Request-based Telegram hosting does not run a permanent listener or
scheduler.

## Prepare and validate

Use the existing Supabase project and retain the original session, credential
and service signing keys. Retain the project-token key if its original value is
available. Masked values cannot decrypt existing records. Netlify secrets are
write-only: its UI, CLI and API cannot reveal them. Without an explicit project
key, the embedded project module creates one private key which is persisted in
the PostgreSQL project snapshot, including across cold starts. GitHub tokens
encrypted with a lost original key must be re-entered in Project Management.
The other encryption keys must remain unchanged. Never paste secrets into chat
or commit them.

If you have a private environment export, prepare the local import file:

```powershell
npm run aws:env:prepare -- --from "C:\path\to\your-private-environment.txt"
```

This writes the ignored `.env.aws-import`, preserves complete signing PEMs,
accepts supported Supabase aliases, excludes masked placeholders and generates
one stable rate-limit pepper if absent. Add any missing original encryption
keys directly to this local file. Leave the optional project key blank when it
is unavailable, rather than entering a masked value. Keep this file private.

## Deploy using the Amplify console

Add the private server values to Amplify environment variables; local ignored
files are not uploaded by GitHub. The build normalizes the legacy production
hostname to `https://www.agenticthat.com` and preserves custom preview origins.
Map `www.agenticthat.com` to this Amplify branch in Domain management, and
register `https://www.agenticthat.com/api/phone-front-desk/google/callback` in
Google Cloud. Existing Meta webhook settings should use the same canonical host.

`BACKGROUND_JOB_MODE=auto` uses the configured `BACKGROUND_JOB_FUNCTION_NAME`.
If no function name is set, Website Studio advances one bounded AI/media/render
step per authenticated request, with private state and claims in Supabase.
Growth Advisor makes one bounded provider attempt per request and persists a
retry or result. Keep the page open for request-driven progress; reopening
Website Studio resumes its saved steps. The Companion continues to run scraping
and publishing locally in either mode. Do not add an arbitrary Lambda name: the
function must run the compatible worker package and Amplify must be able to
invoke it. `BACKGROUND_JOB_MODE=lambda` explicitly requires this setup;
`BACKGROUND_JOB_MODE=request` explicitly selects the request fallback.

Redeploy `main` after adding valid credentials, then run:

```powershell
npm run aws:live:check
```

This checks the public site, service health and unauthenticated API guards. It
does not send messages or validate connected third-party accounts. Provider
tokens rejected by Meta or Resend must be replaced in the private environment.

```powershell
npm ci
npm run test:all
npm run build
npm run aws:worker:build
npm run db:verify-security
npm run aws:storage:check
```

Apply pending Supabase migrations before deploying the matching application
commit. The dedicated database workflow remains available. Ordinary Amplify
builds and production requests never perform DDL. The AWS document migration
adds private, RLS-protected storage without changing existing business records.
`aws:storage:check` creates and removes one temporary validation document and
tests concurrent changes and transaction rollback.

If Project Management or scraper history still exists only in Netlify Blobs,
configure `NETLIFY_SITE_ID` and `NETLIFY_AUTH_TOKEN` locally and run:

```powershell
npm run storage:migrate:netlify
npm run storage:migrate:netlify -- --apply
```

The first command is a dry run. The importer preserves source Netlify data and
does not overwrite existing PostgreSQL documents. Run it before creating new
AWS project data. Retain the original project encryption key. The remaining
Netlify Blobs dependency supports this migration and older Telegram cutover
readers; the Netlify deployment adapters and build plugin have been removed.

## Authenticate and configure AWS

Install [AWS CLI v2 for Windows](https://awscli.amazonaws.com/AWSCLIV2.msi), reopen
the terminal and use your existing AWS console login:

```powershell
aws login --profile agenticthat --region us-east-1
$env:AWS_PROFILE = 'agenticthat'
npm run aws:deploy -- --env-file .env.aws-import --check
npm run aws:deploy -- --env-file .env.aws-import
```

The helper targets app `d21kcrps3tyzwx`, branch `main`, region `us-east-1` by
default. Override them with `--app-id`, `--branch` and `--region` if needed.
An authenticated profile needs permission to read/update that Amplify app,
manage its CloudFormation stacks and scoped IAM roles, upload private S3
deployment artifacts, and write the worker configuration in Secrets Manager.
Browser sign-in alone does not authenticate the SDK.

`--check` makes read-only AWS calls and checks original environment values,
Supabase permissions and the worker package. Deployment stops before creating
resources when keys or migrations are missing. `--env-file <private-file>` can
supply missing values without overwriting existing cloud credentials; the helper otherwise reads the existing Amplify app and
branch variables. The environment reference is [amplify-env.md](amplify-env.md).

`aws:deploy` provisions a private artifact bucket and encrypted configuration,
the asynchronous worker, logs and a failure queue, and assigns a branch-scoped
Amplify role that can invoke only that worker. Worker secrets are limited to
the database, AI and email configuration it needs. Static AWS access keys are
not added to the app. The worker ZIP contains Linux x64 browser/native binaries,
even when prepared on Windows. Uploads use S3 because the worker package can
exceed Lambda's direct-upload limit.

## Release and check the live deployment

Configure the worker before pushing the tested commit to `main`. Then run:

```powershell
npm run aws:deploy -- --env-file .env.aws-import --release
```

This starts an Amplify release, waits for success and verifies `/health` reports
`provider: aws-amplify`. The checked-in `amplify.yml` installs the latest Node 22 and build
dependencies, prepares an allowlisted server environment, runs the production
configuration check and builds `.next`. Server environment files contain secrets
and must remain private deployment artifacts.

If the public domain changes, update `PLATFORM_PUBLIC_URL`, the Google OAuth
callback, Meta/WATI callbacks, verified email links and allowed Companion origins.
Both the apex domain and `www` may route to Amplify, but use `www` for production
links and OAuth callbacks so host-only session cookies stay on one origin.

After release, check signup/reset email, Google Calendar/Gmail reconnect where
needed, Telegram text/media, signed WhatsApp webhooks, private publishing media,
Companion job claims, scraper history, AI job completion and Project Management
after cold starts. Follow [the live readiness runbook](production-readiness-runbook.md)
for owned-account and cross-workspace validation. Local tests cannot establish
external provider account permissions or prove a deployment that has not run.

AWS references: [SSR environment variables](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-environment-variables.html),
[SSR compute roles](https://docs.aws.amazon.com/amplify/latest/userguide/amplify-SSR-compute-role.html),
[asynchronous Lambda invocation](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async.html),
[console login for local development](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html).
