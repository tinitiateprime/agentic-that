# Netlify Deployment

This repo is configured for one Netlify deploy:

```text
/          React website
/console   Telegram console
/v1/*      Netlify Functions backend API
/health    Netlify Functions health check
```

## Build Settings

Netlify reads [netlify.toml](../netlify.toml):

```text
Build command: npm run build
Publish directory: .next
Functions directory: netlify/functions
```

## Required Environment Variables

The Telegram API always requires these values in Netlify site settings:

```text
SESSION_ENCRYPTION_KEY=<generated secret>
USER_PROVISIONING_KEY=<generated secret>
SESSION_COOKIE_SECURE=true
DATA_STORE=netlify-blobs
TELEGRAM_DATA_STORE=postgres
```

The complete environment list for Telegram, WhatsApp, Instagram scraping, and publishing is maintained in [netlify-env.md](./netlify-env.md).

Generate the two secrets locally:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Run it twice and use different values.

## Storage

Supabase PostgreSQL stores normalized, workspace-owned Telegram state and media,
Publishing state, WhatsApp data, central accounts, roles, and job control. Netlify
Blobs is retained only as a temporary Telegram cutover source and for the
workspace-scoped scraper caches.

## Database releases

Netlify builds never run migrations. Apply pending migrations first with the
approval-gated **Production Database Migrations** GitHub Actions workflow, verify
its RLS/grant check, and only then deploy the matching application commit.

## Important Netlify Limitation

Netlify Functions are request-based. They can handle login, account listing, and sending messages, but they do not keep a permanent Telegram listener running in the background.
They also cannot retain interactive Chrome profiles or run browser publishing
continuously. Keep the website and request-based API on Netlify and run the
publishing Companion on the Windows, macOS, or Linux computer used for social
login. The Companion claims workspace jobs through outbound, token-scoped
Supabase RPCs; no public local port, permanent server, or browser extension is
required. The extension remains an optional compatibility bridge. See
[publishing-extension.md](./publishing-extension.md).
