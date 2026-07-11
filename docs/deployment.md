# Deployment

The React website is deployed on Netlify. The Telegram console is a separate Node.js service and must be deployed as a web service.

## Netlify Website

Netlify uses `netlify.toml`:

```toml
[build]
  command = "npm run build"
  publish = "dist"
```

## Telegram Backend

Deploy the Telegram backend as a long-running web service from `integrations/telegram`.

The repo includes `render.yaml` for Render:

1. Open Render and create a new Blueprint from this GitHub repo.
2. Render will use `integrations/telegram/Dockerfile`.
3. Render generates the backend encryption/provisioning secrets automatically.
4. After the Render service is live, copy its public URL.
5. In Netlify, add this environment variable:

```text
VITE_TELEGRAM_DASHBOARD_URL=https://your-render-service.onrender.com
```

6. Redeploy the Netlify site.

## Free Hosting Note

The current `render.yaml` uses Render's free web service plan. This avoids the payment prompt, but the Telegram service stores encrypted sessions in local JSON files, and free hosting does not preserve local filesystem changes across sleeps, restarts, or redeploys.

That means this is good for testing/demo use, but you may need to log in to Telegram again after the service resets. For production, use a paid service with a persistent disk or move the datastore to a hosted database.

## User Telegram Credentials

The backend no longer needs the site owner's Telegram API ID or API hash. Each user enters their own Telegram API ID and API hash on the Add Number screen before receiving the Telegram verification code.
