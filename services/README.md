# Services

Each product service lives in this folder by category. Keep service code, service UI, config examples, service-specific assets, and service-specific dependencies inside the relevant folder.

Current structure:

```text
services/
  messaging/
    telegram/      live Telegram workflow console and backend API
    whatsapp/      placeholder for WhatsApp automation
  scraping/        scraper service placeholders by platform
  publishing/
    queue-runner/  live multi-platform queue UI, scheduler, API, and browser publishers
    <platform>/    platform-specific service notes and extension points
  engagement/      post engagement placeholders by platform
```

Root-level files should only contain shared app connection points:

- `app/config-manager/` is the central account configuration surface for live services.
- `src/platform/` contains the shared product homepage and service catalog.
- `src/styles/` contains shared global styles.
- Each service-specific UI stays inside its own service folder (normally `console/` or `src/`).
- `netlify/functions/` adapts live service APIs to Netlify Functions.
- `package.json` stores root scripts that start or build service code.
