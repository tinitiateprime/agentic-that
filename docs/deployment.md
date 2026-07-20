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
```

The complete environment list for Telegram, WhatsApp, Instagram scraping, and the externally hosted Publish Queue backend is maintained in [netlify-env.md](./netlify-env.md).

Generate the two secrets locally:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Run it twice and use different values.

## Storage

On Netlify, backend users, Telegram sessions, login challenges, and message history are stored in Netlify Blobs.

## Important Netlify Limitation

Netlify Functions are request-based. They can handle login, account listing, and sending messages, but they do not keep a permanent Telegram listener running in the background.
