# Netlify Environment Variables

Use this as the production template for the main AgenticThat Netlify site. Replace every angle-bracket placeholder and never commit the completed file.

```env
# Build and routing
NODE_VERSION=22
DATA_STORE=netlify-blobs
NEXT_PUBLIC_TELEGRAM_DASHBOARD_URL=/console
NEXT_PUBLIC_WHATSAPP_DASHBOARD_URL=/dashboard

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
META_WEBHOOK_VERIFY_TOKEN=<new-random-webhook-verify-token>

# WhatsApp application database and first admin
DATABASE_URL=<serverless-pooled-postgresql-url>
ADMIN_EMAIL=<production-admin-email>
ADMIN_PASSWORD=<new-strong-unique-password>
BUSINESS_NAME=AgenticThat
WA_FROM=<e164-whatsapp-number>
CURRENCY=INR

# Instagram authenticated scraper session
INSTAGRAM_STORAGE_STATE_BASE64=<authenticated-session-payload>
INSTAGRAM_SESSION_EXPIRY_BUFFER_DAYS=7
INSTAGRAM_MAX_SESSION_ATTEMPTS=3
```

Use the single Instagram value when it fits the Netlify variable limit. For a larger regenerated payload, replace it with consecutive `INSTAGRAM_STORAGE_STATE_BASE64_CHUNK_1`, `_2`, and so on, without gaps. Netlify accepts up to 5,000 characters per value, while function-runtime limits still apply.

## Scopes

If the Netlify plan supports variable scopes:

- Give `NODE_VERSION` and both `NEXT_PUBLIC_*` variables the **Builds** scope.
- Give all remaining variables the **Functions** scope.
- Using all scopes also works and is simplest when importing the block as an `.env` file.

Variables declared only under `[build.environment]` in `netlify.toml` are not exposed to Functions. `DATA_STORE` is therefore included above even though the repository also supplies its build-time value.

## Values not to add

These are unused, redundant, local-only, or provider-specific for the current production configuration:

```env
DB_CONNECTOR=
META_APP_SECRET=
TELEGRAM_API_ID=
TELEGRAM_API_HASH=
TELEGRAM_API_URL=
NEXT_PUBLIC_PUBLISH_QUEUE_API_URL=
PUBLISH_QUEUE_API_URL=
PUBLISH_QUEUE_AUTH_TOKEN_SECRET=
PLATFORM_AUTH_DATA_PATH=
SECRETS_SCAN_OMIT_KEYS=
```

`DATABASE_URL` is the only database variable needed. Use a serverless-compatible pooled PostgreSQL connection URL. `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` are entered per account in Config Manager; the environment versions are only used by the standalone CLI login command.

Do not add `SECRETS_SCAN_OMIT_KEYS` in the Netlify UI. The repository only excludes the two intentionally public `NEXT_PUBLIC_*` values from scanning. Real tokens, passwords, session cookies, and connection strings should remain protected by secret scanning.

## Optional alternatives

Only add these when switching WhatsApp from Meta to WATI:

```env
WA_PROVIDER=wati
WATI_API_URL=<wati-tenant-api-url>
WATI_ACCESS_TOKEN=<wati-access-token>
```

Only add `TELEGRAM_API_URL` when Telegram is hosted as an external service instead of the included Netlify Function. For the normal local publishing setup, omit both Publish Queue URL variables. The Chrome extension connects the dashboard to the companion at `http://127.0.0.1:8792`, keeping account configuration, schedules, local media, and browser sessions together on the computer that performs publishing.

## Local Publish Queue companion

Interactive social login and browser publishing require the long-running local companion because a request-only Netlify Function cannot keep Chrome profiles or a scheduler running. Configure these values in the repository `.env.local` on the publishing computer, not in Netlify:

```env
PUBLISH_QUEUE_SERVICE_HOST=127.0.0.1
PUBLISH_QUEUE_WEB_ORIGIN=https://<your-netlify-site>.netlify.app
PUBLISH_QUEUE_DATA_PATH=<persistent-data-path>/store.json
PUBLISH_QUEUE_UPLOAD_DIR=<persistent-upload-directory>
PUBLISH_QUEUE_AUTH_TOKEN_SECRET=<new-random-secret>
PUBLISH_QUEUE_OPERATIONS_MANAGER_PASSWORD=<new-strong-password>
PUBLISH_QUEUE_POST_UPLOADER_PASSWORD=<new-strong-password>
PUBLISH_QUEUE_SCHEDULER_PASSWORD=<new-strong-password>
PUBLISH_QUEUE_VIEWER_PASSWORD=<new-strong-password>
PUBLISH_QUEUE_SCHEDULER_TIMEZONE=Asia/Kolkata
PUBLISH_QUEUE_MAX_CONCURRENT_ACCOUNTS=2
```

Install the extension with `Install Publishing Extension.cmd`, and start the companion with `Start Publishing Companion.cmd`. Do not set either Publish Queue URL on Netlify for this local-extension architecture, and do not use development default passwords in production.

When no external runner is configured, start the local companion before opening Publish Queue. The dashboard intentionally refuses to create a second serverless publishing store because the local scheduler would not see posts saved there.

## Webhook

Use this Meta webhook callback URL:

```text
https://<your-netlify-site>.netlify.app/api/webhooks/meta
```

Enter the same newly generated value from `META_WEBHOOK_VERIFY_TOKEN` when Meta asks for the verification token.
