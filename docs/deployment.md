# Deployment

This project is set up for one Node deployment:

```text
/          React website from dist/
/console   Telegram dashboard
/v1/*      Telegram backend API
```

## Northflank

Create a Northflank **combined service** from this Git repository and choose **buildpack** as the build type.

Use these commands:

```text
Build command: npm run northflank:build
Start command: npm start
Health check: /health
```

Expose the public HTTP port that Northflank assigns through `PORT`. The server already reads `PORT` and binds to `0.0.0.0` in production.

Required runtime environment variables:

```text
NODE_ENV=production
SESSION_COOKIE_SECURE=true
SESSION_ENCRYPTION_KEY=<generated secret>
USER_PROVISIONING_KEY=<generated secret>
```

Generate each secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Keep `CORS_ORIGIN` blank because the website and API are same-origin.

## Data Note

The backend stores encrypted sessions and messages in `data/store.json` by default. If Northflank offers persistent storage in your plan, mount it and set:

```text
DATA_DIR=/data
```

Without persistent storage, the app can still run, but users may need to sign in/connect Telegram again after a service reset.

## Free Plan Note

Northflank's free Sandbox is good for testing and hobby use, but it is limited and not meant as production hosting.

## Local Check

Build and run the same shape locally:

```bash
npm run northflank:build
npm start
```

Open:

```text
http://127.0.0.1:8787/
http://127.0.0.1:8787/console
```
