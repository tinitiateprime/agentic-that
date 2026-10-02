# AWS Amplify deployment

Amplify hosts the Next.js website and request-based APIs. A private Node 22
Lambda worker runs long scraping, Growth Advisor and Website Studio jobs.
Supabase remains the PostgreSQL database, private media storage and token-scoped
Companion job-control backend. Publishing browser sessions stay in the desktop
Companion. Request-based Telegram hosting does not run a permanent listener or
scheduler.

## Prepare and validate

Use the existing Supabase project and retain the original session, credential,
service signing and project-token encryption keys. Masked values cannot decrypt
existing records. Copy `PROJECT_WORKSPACE_TOKEN_ENCRYPTION_KEY` from Netlify into
Amplify if it has not been added; the deployment helper generates a rate-limit
pepper only when it is missing. Never paste secrets into chat or commit them.

If you have a private environment export, prepare the local import file:

```powershell
npm run aws:env:prepare -- --from "C:\path\to\your-private-environment.txt"
```

This writes the ignored `.env.aws-import`, preserves complete signing PEMs,
accepts supported Supabase aliases, excludes masked placeholders and generates
one stable rate-limit pepper if absent. Add any missing original encryption
keys directly to this local file. A masked project-token key cannot be recovered
or replaced safely for existing data. Keep this file private.

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
supply missing values; the helper otherwise reads the existing Amplify app and
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
Keeping `https://agenticthat.com` preserves existing callback URLs.

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
