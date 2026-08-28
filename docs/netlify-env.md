# Netlify Environment Variables

Use this as the production template for the main AgenticThat Netlify site. Replace every angle-bracket placeholder and never commit the completed file.

```env
# Build and routing
NODE_VERSION=22
DATA_STORE=netlify-blobs
NEXT_PUBLIC_TELEGRAM_DASHBOARD_URL=/console
NEXT_PUBLIC_WHATSAPP_DASHBOARD_URL=/dashboard
NEXT_PUBLIC_PUBLISHING_EXTENSION_URL=<approved-chrome-web-store-listing-url>
NEXT_PUBLIC_PUBLISHING_COMPANION_DOWNLOAD_URL=https://github.com/tinitiateprime/agentic-that/releases/latest/download/AgenticThat-Publishing-Companion-Portable.zip

# Telegram API and encrypted account sessions
SESSION_ENCRYPTION_KEY=<new-random-32-byte-base64url-secret>
USER_PROVISIONING_KEY=<different-new-random-32-byte-base64url-secret>
SESSION_COOKIE_SECURE=true

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
CREDENTIAL_ENCRYPTION_KEY=<new-random-32-byte-hex-key>

# WhatsApp application database and first admin
DATABASE_URL=<serverless-pooled-postgresql-url>
ADMIN_EMAIL=<production-admin-email>
ADMIN_PASSWORD=<new-strong-unique-password>
BUSINESS_NAME=AgenticThat
WA_FROM=<e164-whatsapp-number>
CURRENCY=INR

# Instagram scraping uses public Playwright pages; no Instagram session variables are required.
INSTAGRAM_CACHE_FALLBACK_MAX_AGE_MINUTES=360
```

## Scopes

If the Netlify plan supports variable scopes:

- Give `NODE_VERSION` and all `NEXT_PUBLIC_*` variables the **Builds** scope.
- Give all remaining variables the **Functions** scope.
- Using all scopes also works and is simplest when importing the block as an `.env` file.

Variables declared only under `[build.environment]` in `netlify.toml` are not exposed to Functions. `DATA_STORE` is therefore included above even though the repository also supplies its build-time value.

## Values not to add

These are unused, redundant, local-only, or provider-specific for the current production configuration:

```env
DB_CONNECTOR=
TELEGRAM_API_ID=
TELEGRAM_API_HASH=
TELEGRAM_API_URL=
NEXT_PUBLIC_PUBLISH_QUEUE_API_URL=
PUBLISH_QUEUE_API_URL=
PUBLISH_QUEUE_AUTH_TOKEN_SECRET=
PLATFORM_AUTH_DATA_PATH=
SECRETS_SCAN_OMIT_KEYS=
```

`DATABASE_URL` is the only database variable needed. Use a serverless-compatible pooled PostgreSQL connection URL. `CREDENTIAL_ENCRYPTION_KEY` must decode to exactly 32 bytes; keep it stable after deployment because changing it makes stored workspace credentials unreadable. `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` are entered per account in Config Manager; the environment versions are only used by the standalone CLI login command.

`META_APP_SECRET` is required for Embedded Signup token exchange and signed webhook validation. `META_CONFIGURATION_ID` is required for the recommended Embedded Signup/coexistence button. If you intentionally use only the advanced manual Cloud API credential form, the configuration id can be omitted, but the app secret should still be set for webhook validation.

Do not add `SECRETS_SCAN_OMIT_KEYS` in the Netlify UI. The repository excludes only public URLs, provider names, API versions, phone/WABA/app identifiers, and the Embedded Signup configuration id. Real tokens, app secrets, passwords, encryption keys, session cookies, and connection strings remain protected by secret scanning.

## Optional WATI fallback

New workspaces can choose Meta or WATI during WhatsApp onboarding. For WATI,
the workspace owner enters the tenant API URL and access token in the setup
wizard; AgenticThat validates them, generates a workspace-specific webhook
secret, and stores the connection encrypted. Those self-serve connections do
not require global WATI variables in Netlify.

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
https://<your-netlify-site>.netlify.app/api/webhooks/wati?token=<wati-webhook-secret>
```

Read-only WhatsApp Web monitoring requires a separately deployed Baileys service. Configure its HTTPS URL and shared secret from `/settings`; the archive does not contain a runnable Baileys service. For a legacy environment-configured monitor, the equivalent variables are `BAILEYS_SERVICE_URL` and `BAILEYS_API_SECRET`.

Only add `TELEGRAM_API_URL` when Telegram is hosted as an external service instead of the included Netlify Function. For publishing, omit both Publish Queue URL variables. The paired Workspace Companion keeps social-media sessions and browser profiles on the manager device, while the AgenticThat server keeps workspace account metadata, content, schedules, queue state, and live publishing status. Team members use the website directly and do not configure a local URL, tunnel, or Companion connection.

## Publish Queue distribution

Interactive social login and browser publishing use the installable Windows
Companion because a request-based Netlify Function cannot own persistent Chrome
profiles or a continuously running scheduler. A Workspace Manager installs and
pairs it once from Connections; other workspace users do not install it. After
downloading the portable companion, the manager extracts the ZIP and opens
`AgenticThat Companion.exe` from the extracted folder.

After the Chrome Web Store approves the extension, set
`NEXT_PUBLIC_PUBLISHING_EXTENSION_URL` to its public listing and redeploy. Keep
`NEXT_PUBLIC_PUBLISHING_COMPANION_DOWNLOAD_URL` on the stable portable GitHub
Release URL shown above. Do not set either Publish Queue API URL. The Companion
generates and protects its own local credentials and browser sessions; central
workspace posts and schedules remain available to the authorized team.

## Webhook

Use this Meta webhook callback URL:

```text
https://<your-netlify-site>.netlify.app/api/webhooks/meta
```

Enter the same newly generated value from `META_WEBHOOK_VERIFY_TOKEN` when Meta asks for the verification token.

Subscribe the Meta webhook to both `messages` and `calls`. The `calls` subscription powers the new call log and missed-call alerts.

## Upgrade behavior

After `CREDENTIAL_ENCRYPTION_KEY` is added and the site is redeployed, the first WhatsApp database request creates the new tenant/account, phone-number, call-log, and temporary-group schema. The existing environment-configured Meta account is imported into the encrypted account tables for the current admin workspace. Keep the existing `META_ACCESS_TOKEN`, `META_WABA_ID`, and `META_PHONE_NUMBER_ID` variables during this first deployment; after `/settings` shows the Meta account as connected, they remain a safe legacy fallback but new workspaces will not inherit them.
