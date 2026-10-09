# AWS Amplify Environment Variables

Use this as the production template for the main AgenticThat AWS Amplify site. Replace every angle-bracket placeholder and never commit the completed file.

```env
# Hosting and routing
HOSTING_PROVIDER=aws-amplify
SERVERLESS=true
DATA_STORE=postgres
BACKGROUND_JOB_MODE=auto
# Optional; when set, this must identify the compatible deployed Lambda worker.
BACKGROUND_JOB_FUNCTION_NAME=
BACKGROUND_JOB_REGION=us-east-1
RUN_DATABASE_MIGRATIONS=false
NEXT_PUBLIC_TELEGRAM_DASHBOARD_URL=/console
NEXT_PUBLIC_WHATSAPP_DASHBOARD_URL=/dashboard
NEXT_PUBLIC_PUBLISHING_EXTENSION_URL=<approved-chrome-web-store-listing-url>
NEXT_PUBLIC_PUBLISHING_COMPANION_DOWNLOAD_URL=/companion/download

# Supabase Data API. The publishable key is public and constrained by RLS plus
# token-authenticated Companion RPCs. The secret key stays server-only.
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<supabase-publishable-key>
SUPABASE_SECRET_KEY=<supabase-secret-key>

# Telegram API and encrypted account sessions
SESSION_ENCRYPTION_KEY=<original-telegram-session-encryption-key>
USER_PROVISIONING_KEY=<original-user-provisioning-key>
SESSION_COOKIE_SECURE=true
TELEGRAM_DATA_STORE=postgres

# Platform authentication, verification, reset, and distributed abuse controls
PLATFORM_PUBLIC_URL=https://www.agenticthat.com
PLATFORM_SUPER_ADMIN_EMAILS=<production-admin-email>
AUTH_EMAIL_FROM="AgenticThat <accounts@your-domain.example>"
RESEND_API_KEY=<server-only-resend-api-key>
# Verify the sender domain in the Resend account that owns this key.
# Copy its email DNS records when changing DNS providers, then rerun domain verification.
AUTH_RATE_LIMIT_PEPPER=<random-32-byte-base64url-secret>
# Optional: retain the original value when available; never enter a masked value.
PROJECT_WORKSPACE_TOKEN_ENCRYPTION_KEY=
SERVICE_TOKEN_PRIVATE_KEY=<original-ed25519-private-key-pem>
SERVICE_TOKEN_PUBLIC_KEY=<matching-ed25519-public-key-pem>
NEXT_PUBLIC_TEAM_TESTING_FULL_ACCESS=false
RBAC_ENFORCEMENT_MODE=enforce

# AI services (server-only)
GEMINI_API_KEY=<server-only-google-ai-key>
ELEVENLABS_API_KEY=<server-only-elevenlabs-api-key>
ELEVENLABS_AGENT_ID=agent_6301m36sxacff369ckangq84hzxx

# AI Phone Front Desk business-owned Gmail and Google Calendar
# Enable only after the migration and Google OAuth production redirect are ready.
PHONE_FRONT_DESK_FOLLOW_UP_ENABLED=true
GOOGLE_OAUTH_CLIENT_ID=<google-oauth-web-client-id>
GOOGLE_OAUTH_CLIENT_SECRET=<google-oauth-web-client-secret>

# WhatsApp using the Meta Cloud API
WA_PROVIDER=meta
META_API_VERSION=v25.0
META_ACCESS_TOKEN=<new-meta-system-user-token>
META_PHONE_NUMBER_ID=<meta-phone-number-id>
META_WABA_ID=<whatsapp-business-account-id>
META_APP_ID=<meta-app-id>
META_APP_SECRET=<meta-app-secret>
META_CONFIGURATION_ID=<embedded-signup-configuration-id>
META_WEBHOOK_VERIFY_TOKEN=<new-random-webhook-verify-token>
CREDENTIAL_ENCRYPTION_KEY=<original-credential-encryption-key>

# WhatsApp application database and first admin
DATABASE_URL=<serverless-pooled-postgresql-url>
ADMIN_EMAIL=<production-admin-email>
ADMIN_PASSWORD=<new-strong-unique-password>
BUSINESS_NAME=AgenticThat
WA_FROM=<e164-whatsapp-number>
CURRENCY=INR

# Optional pin to a stable signed Companion release. QA tags are rejected by
# the production configuration check.
COMPANION_RELEASE_TAG=<optional-stable-release-tag>

# Instagram scraping uses public Playwright pages; no Instagram session variables are required.
INSTAGRAM_CACHE_FALLBACK_MAX_AGE_MINUTES=360
```

## Amplify runtime configuration

The checked-in amplify.yml installs the latest Node 22, installs development build dependencies,
writes an allowlisted .env.production, validates production keys, and builds .next.
The runtime file preserves multiline PEM keys and excludes AWS build credentials.
It contains server secrets: restrict deployment artifact access and never commit it.
No server secret may have a NEXT_PUBLIC_ prefix.

When using Lambda, set BACKGROUND_JOB_FUNCTION_NAME to the worker output and
BACKGROUND_JOB_REGION=us-east-1. HOSTING_PROVIDER, SERVERLESS, DATA_STORE,
TELEGRAM_DATA_STORE, pool limits, secure cookies, RBAC, and migration flags are
set by the deployment helper. Ordinary builds and requests never run database DDL.

The region defaults to the Amplify build region, falling back to `us-east-1`.
The function name must identify a deployed worker; a name alone does not create
Lambda or grant Amplify permission to invoke it. With no function name, auto
mode uses durable request-driven AI steps, while Companion scraping/publishing
continues locally. Explicit lambda mode requires a configured worker; request
mode bypasses it. Supabase legacy aliases are
mapped to their canonical runtime names. Signing keys accept actual PEM
newlines, literal `\n` escapes, or base64-encoded PEM, matching the runtime.

The worker receives only its required configuration through AWS Secrets Manager.
Amplify uses a branch-specific IAM role to invoke that worker without static AWS keys.
See [deployment.md](deployment.md) for setup, migration and live validation.

## Login email delivery

An unverified account now receives a fresh verification **link** when signing in
with the correct password. Verified accounts sign in with their password;
the application does not send a numeric login code. Automatic sends and the
Resend verification email button share the same abuse limits (three requests
per email and five per IP per hour). Previously issued links remain valid until
one succeeds or their 24-hour expiry is reached.

In Amplify Hosting, open **Hosting > Environment variables** and check the
values for the `main` branch:

```text
AUTH_EMAIL_FROM = AgenticThat <accounts@agenticthat.com>
RESEND_API_KEY = your actual Resend sending key
PLATFORM_PUBLIC_URL = https://www.agenticthat.com
```

Enter the values directly in the console, without the surrounding quotes used
in dotenv files. Save and redeploy `main` after changing them: `amplify.yml`
copies the server variables into the Next.js runtime during the build.
The key must have permission to send from `agenticthat.com`. In Resend Domains,
verify that this exact domain has its required sending DNS records verified.
Use Resend Emails to check whether a requested message was delivered, bounced,
or suppressed, and check the recipient's spam folder. Sending-only API keys
cannot list domains; that restriction does not mean email sending is broken.

Check the sender and key without emailing a real person:

```powershell
npm run email:check -- --env-file .env.aws-import
```

The check sends to Resend's `delivered@resend.dev` simulation and prints no
credentials. API acceptance does not prove delivery to a real inbox.
For local development, set `AUTH_EMAIL_FROM` and `RESEND_API_KEY` in
`.env.local`, set `PLATFORM_PUBLIC_URL=http://localhost:5173` (or your actual
local port), and restart the dev server. `.env.aws-import` is a deployment
input and Next.js does not load it automatically. Missing local email settings
now produce a delivery error instead of silently skipping the email.

References: [Amplify SSR environment variables](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-environment-variables.html),
[Resend domain verification](https://resend.com/docs/dashboard/domains/introduction),
and [Resend sending status](https://resend.com/docs/dashboard/emails/introduction).

## Values not to add

These are unused, redundant, local-only, or provider-specific for the current production configuration:

```env
DB_CONNECTOR=
TELEGRAM_API_URL=
NEXT_PUBLIC_PUBLISH_QUEUE_API_URL=
PUBLISH_QUEUE_API_URL=
PUBLISH_QUEUE_AUTH_TOKEN_SECRET=
PLATFORM_AUTH_DATA_PATH=
SECRETS_SCAN_OMIT_KEYS=
```

`DATABASE_URL` is the server-side Postgres connection. The public Supabase URL
and publishable key let Companion call only the granted RLS-protected RPCs.
`SUPABASE_SECRET_KEY` stays on AWS Amplify and is used only to put publishing
media in the private `job-artifacts` bucket and issue scoped signed downloads.
Legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` values are
accepted during migration. All Supabase variables and `DATABASE_URL` must point
to the same project.
`CREDENTIAL_ENCRYPTION_KEY` must decode to exactly 32 bytes; keep it stable after
deployment because changing it makes stored workspace credentials unreadable.
The Google Calendar/Gmail connections use this same key and the configured OAuth
client. If the local test used a different key or OAuth client from AWS Amplify,
reconnect Google on the deployed site; do not replace an in-use AWS Amplify key.
With `PLATFORM_PUBLIC_URL=https://www.agenticthat.com`, the OAuth callback is
`https://www.agenticthat.com/api/phone-front-desk/google/callback`; register it in
Google Cloud. `GOOGLE_OAUTH_REDIRECT_URI` is normally unnecessary in AWS Amplify.
`PROJECT_WORKSPACE_TOKEN_ENCRYPTION_KEY`, when configured, encrypts the GitHub
tokens used only by Global Admin Center project management. Without it, the
embedded module persists its generated key in the private PostgreSQL snapshot.
This key survives cold starts and deployments. An unavailable original Netlify
secret cannot decrypt existing GitHub tokens: re-enter those tokens rather than
changing other encryption keys. Keep a configured original key stable.
`TELEGRAM_API_ID` and `TELEGRAM_API_HASH` are entered per connection in Config
Manager when no shared credentials are configured. They may instead be set as
server runtime variables to keep the connection form phone-only for every
workspace. Both modes encrypt the credentials alongside the Telegram session.

`META_APP_SECRET` is required for Embedded Signup token exchange and signed webhook validation. `META_CONFIGURATION_ID` is required for the recommended Embedded Signup/coexistence button. If you intentionally use only the advanced manual Cloud API credential form, the configuration id can be omitted, but the app secret should still be set for webhook validation.

`SECRETS_SCAN_OMIT_KEYS` configures the old Netlify scanner and is unused on Amplify. Keep real tokens, app secrets, passwords, encryption keys, session cookies, and connection strings private.

## Optional WATI fallback

New workspaces can choose Meta or WATI during WhatsApp onboarding. For WATI,
the workspace owner enters the tenant API URL and access token in the setup
wizard; AgenticThat validates them, generates a workspace-specific webhook
secret, and stores the connection encrypted. Those self-serve connections do
not require global WATI variables in AWS Amplify.

Only add these variables when seeding a legacy/default WATI connection for the
first admin workspace:

```env
WA_PROVIDER=wati
WATI_API_URL=<wati-tenant-api-url>
WATI_ACCESS_TOKEN=<wati-access-token>
WATI_WEBHOOK_SECRET=<new-random-webhook-secret>
```

The WATI webhook URL must include the same tenant secret:

```text
https://<your-public-domain>/api/webhooks/wati?token=<wati-webhook-secret>
```

Read-only WhatsApp Web monitoring requires a separately deployed Baileys service. Configure its HTTPS URL and shared secret from `/settings`; the archive does not contain a runnable Baileys service. For a legacy environment-configured monitor, the equivalent variables are `BAILEYS_SERVICE_URL` and `BAILEYS_API_SECRET`.

Only add `TELEGRAM_API_URL` when Telegram is hosted as an external service
instead of the included Next.js API. For publishing, omit both Publish
Queue URL variables. Supabase keeps workspace metadata, durable jobs, leases,
events, results, and private media. The paired Companion keeps browser sessions
and profiles locally and calls Supabase directly. Team members use the website
without a tunnel, extension, or local URL.

## Publish Queue distribution

Interactive social login and browser publishing use the installable desktop
Companion because the Amplify request runtime cannot own persistent browser
profiles or a continuously running local worker. A Workspace Manager installs and
pairs it once from Connections; other workspace users do not install it. After
downloading the installer for their operating system, the manager runs it once;
Companion can then start at login. Windows and signed macOS builds update from
signed GitHub releases, while Linux upgrades use the newer DEB/RPM or archive.

The Chrome extension is an optional compatibility bridge; core website jobs do
not require it. Keep
`NEXT_PUBLIC_PUBLISHING_COMPANION_DOWNLOAD_URL` on `/companion/download`, which
offers the signed Windows Setup, universal macOS DMG, and Linux DEB/RPM/ZIP
assets from the latest release. Do not set either Publish Queue API URL. The Companion
generates and protects its own local credentials and browser sessions; central
workspace publishing remains available to the authorized team. Publishing and
Telegram scheduling are intentionally paused in this release.

## Webhook

Use this Meta webhook callback URL:

```text
https://<your-public-domain>/api/webhooks/meta
```

Enter the same newly generated value from `META_WEBHOOK_VERIFY_TOKEN` when Meta asks for the verification token.

Subscribe the Meta webhook to both `messages` and `calls`. The `calls` subscription powers the new call log and missed-call alerts.

## Upgrade behavior

Run the database workflow before deploying. It creates the tenant/account,
phone-number, call-log, normalized Telegram/Publishing, authentication-security,
and job-control schema, then verifies every public table has RLS with browser
grants revoked. Complete any legacy Telegram Blob import while the Netlify
source is still accessible, and verify the normalized Supabase account rows
before cutover. An Amplify request has no Netlify Blob credentials. Keep the
existing `META_ACCESS_TOKEN`, `META_WABA_ID`, and `META_PHONE_NUMBER_ID` variables
during the first WhatsApp cutover; new workspaces never inherit them.
