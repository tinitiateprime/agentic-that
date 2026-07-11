# Integrations

Each external service lives in its own folder here. Keep service code, service UI, config examples, and service-specific dependencies inside that folder.

Current structure:

```text
integrations/
  telegram/
    src/        backend/API source
    public/     Telegram dashboard UI
    config/     service config files
    data/       local encrypted runtime data, ignored by git
```

The root app should only contain connection points:

- `src/integrations.js` stores frontend URLs and metadata.
- `package.json` stores root scripts that start each integration.

