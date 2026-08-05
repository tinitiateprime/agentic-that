# Instagram Scraper

Public browser scraping service for Instagram profile, keyword/hashtag, and post/reel URL inputs.

The console separates Profile URL from Post URL. Profile and Profile URL inputs support Latest, Range, and Analyze Profile. Post URL accepts only a public `/p/` or `/reel/` link and always returns data for that one post, with the count fixed to one.

```text
console/src/   Instagram console UI and styles
src/           scraper API, runtime, and storage code
scripts/       service maintenance scripts
```

## Local

```bash
npm run dev
```

Open `http://127.0.0.1:5173/scraper/instagram`.

This command also starts the main website/WhatsApp and Telegram services. The
legacy `npm run dev:instagram` command is kept as an alias to the same launcher.

## Deploy

The console is served by the main React app at `/scraper/instagram`. Production scrapes use a persistent job flow so they are not limited by Netlify's normal request timeout:

1. `POST /api/scraping/instagram/jobs` validates the request and creates a pending job.
2. `POST /api/scraping/instagram/jobs/:id/run` starts the 15-minute Netlify Background Function.
3. `GET /api/scraping/instagram/jobs/:id` is polled until the job is complete or failed.

Jobs and completed runs use separate Netlify Blob keys, so concurrent users cannot overwrite one another's scrape state. Set `DATA_STORE=netlify-blobs` in the Netlify Functions environment. Local development uses `data/jobs.json` and executes the same job route in the local Instagram service.

The scraper does not use Instagram API tokens, OAuth, shared accounts, user accounts, or saved Instagram sessions. It opens public pages with Playwright, dismisses public signup/cookie prompts, extracts visible post data, then opens the public owner profile to read follower count when Instagram exposes it.

Netlify datacenter browsers do not always receive the public profile grid links that a home browser sees. For Profile and Profile URL jobs, the scraper therefore also reads the anonymous public profile/feed requests made by Instagram's logged-out page, merges those candidates with the visible grid, and opens each post page normally. Every extracted post is checked against the requested profile username before it can enter the dataset.

## Collection modes

`collection_mode: "latest"` returns publicly discoverable posts newest-first. `collection_mode: "range"` supports inclusive date, month, and year ranges for profile, profile URL, and keyword/hashtag inputs. The range follows the selected direction: August to June returns August, July, then June, while June to August returns June, July, then August. Calendar boundaries use `timezone_offset_minutes`.

`collection_mode: "engagement"` powers Profile Analysis and is available only for Profile and Profile URL inputs. The public post and Reels grids are inspected for profile averages, observed posting frequency, engagement rate, content formats, caption patterns, posting times, and independent Most Watched, Most Liked, and Most Discussed rankings.

Most Watched follows Instagram's visible public Reels-grid view count. The exact compact value displayed by Instagram is preserved in `views_display`, while `views` contains its numeric form for sorting. Follower values follow the same rule: `follower_count_display` preserves Instagram's public text such as `23.9K`, while `follower_count` is its numeric approximation for calculations. Likes and comments come from the opened public post/reel pages. Missing public metrics remain `null`; they are never replaced with invented values.

When Instagram shows the Likes or Comments label without a public number, the matching `likes_hidden` or `comments_hidden` flag is `true`. The console displays `Hidden` and keeps the numeric field `null`, so a nearby count cannot be assigned to the wrong metric or treated as zero.
