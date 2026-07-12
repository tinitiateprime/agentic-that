# Instagram Scraper

Live scraping service for Instagram profile, hashtag, and post URL inputs.

## Local

```bash
npm run dev:instagram
```

Open `http://127.0.0.1:5173/scraper/instagram`.

## Deploy

The Netlify function is mounted at `/api/scraping/instagram/*`, and the console is served by the main React app at `/scraper/instagram`.

Optional private session state can be provided through one of these environment variables:

- `INSTAGRAM_STORAGE_STATE_JSON`
- `INSTAGRAM_STORAGE_STATE_BASE64`
- `INSTAGRAM_STORAGE_STATE_PATH` for local development
