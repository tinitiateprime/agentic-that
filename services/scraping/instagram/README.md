# Instagram Scraper

Live scraping service for Instagram profile, hashtag, and post URL inputs.

## Local

```bash
npm run dev:instagram
```

Open `http://127.0.0.1:5173/scraper/instagram`.

## Deploy

The Netlify function is mounted at `/api/scraping/instagram/*`, and the console is served by the main React app at `/scraper/instagram`.

Private backend-only session states can be provided through one of these environment variables:

- `INSTAGRAM_STORAGE_STATE_JSON`
- `INSTAGRAM_STORAGE_STATE_BASE64`
- `INSTAGRAM_STORAGE_STATE_JSON_CHUNK_1`, `INSTAGRAM_STORAGE_STATE_JSON_CHUNK_2`, ... for one large JSON session split across env vars
- `INSTAGRAM_STORAGE_STATE_BASE64_CHUNK_1`, `INSTAGRAM_STORAGE_STATE_BASE64_CHUNK_2`, ... for one large base64 session split across env vars
- `INSTAGRAM_STORAGE_STATE_JSON_1`, `INSTAGRAM_STORAGE_STATE_JSON_2`, ...
- `INSTAGRAM_STORAGE_STATE_BASE64_1`, `INSTAGRAM_STORAGE_STATE_BASE64_2`, ...
- `INSTAGRAM_STORAGE_STATES_JSON` as a JSON array or object of storage states
- `INSTAGRAM_STORAGE_STATES_BASE64` as newline/comma separated base64 storage states
- `INSTAGRAM_STORAGE_STATE_PATH` for local development
- `INSTAGRAM_STORAGE_STATE_DIR` for a folder of local `*.json` session files

For local development, put admin account sessions here:

```text
services/scraping/instagram/account_config/sessions/
  instagram-1.json
  instagram-2.json
  instagram-3.json
```

These files are ignored by Git. The scraper rotates through the loaded sessions, prefers sessions that are not near expiry, and moves near-expiry sessions to the end of the pool. Set `INSTAGRAM_SESSION_EXPIRY_BUFFER_DAYS` to change the default 7-day expiry buffer.

To create a local session:

```bash
npm run instagram:login -- instagram-1
```

Repeat with `instagram-2` and `instagram-3` for more backend accounts.
