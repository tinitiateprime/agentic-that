# Social SEO

Social SEO lives under **Get found online** in the Store (`/apps/seo/social-seo`) and opens at `/social-seo`.
It replaces the former "Hashtag & Caption SEO" placeholder. It only produces suggestions; it does not publish.

The user uploads media and writes a short description. Everything else is suggested.

## Status

| Platform  | Free local AI (Companion) | Without the Companion |
|-----------|---------------------------|-----------------------|
| Instagram | Live                      | Rule-based engine     |
| Facebook  | Live                      | Needs the Companion   |
| LinkedIn  | Live                      | Needs the Companion   |
| YouTube   | Live                      | Needs the Companion   |

## Free local AI (in the Companion)

When the AgenticThat Companion is running, Social SEO uses a free, open-source vision model on the user's own
computer and writes ready-to-post results for **Instagram, Facebook, LinkedIn and YouTube**. The website falls back
to the rule-based Instagram engine below when the Companion isn't running.

```
Website: page opens → model loads in the background (/warm)
  → upload photo/video (description optional): media resized in the browser (5 frames for a video),
    sent only to 127.0.0.1:8792, and studied at once (/analyze) while the user types
  → Create: 1 writing pass per app (/write with live: true), the open tab first; the caption
    appears word by word while it is written
  → results fitted to each app's limits, with an SEO score out of 10 → shown on the Social SEO page
```

- **Engine**: llama.cpp `llama-server` build `b11946`, bound to 127.0.0.1
  (`services/publishing/queue-runner/server/services/ai/ai-engine.ts`).
  - On first start it times the graphics (Vulkan) build against the processor build once and keeps the faster one
    (`backendMeasured` in `ai-settings.json`). Integrated graphics are often slower than the processor.
  - Quality first: the chosen model is always used. Low free memory only makes it slower (the page then suggests
    closing other apps); a smaller model is used only if total memory cannot hold the chosen one.
  - Fixed instructions come first in every request and `--cache-ram 1024` keeps them, so the next post only reads its
    own details. It stops after 10 minutes idle, never while a request is running.
- **What the AI reads** (`analyzeMedia`): the message, mood and post type (selling, quote or motivation, tips, humour,
  news, personal), the quote on the media, the brand, every list exactly as written (sections with columns, step flows
  and plain lists), the slogan and the contact details. Our code, not the model, puts lists and contacts in the post.
- **Business posts** get the lists (each section with its own heading), the poster's slogan, a DM keyword line on
  Instagram (only promising what the owner stated), contacts, the brand and a local hashtag. **Creator posts**
  (quotes, moods, humour, moments) are written for message, saves and replies, with theme hashtags.
- **SEO score** (10 checks per app): Instagram (`instagramScore`, separate checks for creator posts), Facebook,
  LinkedIn and YouTube (`appScore`). Each missing point comes with a tip.
- Invented urgency ("limited slots", "hurry") is removed unless the author or the media says it.
- **Models** (`ai-catalog.ts`), each file pinned and checked against its SHA-256:

  | Tier | Model | Download | Memory | Licence |
  |---|---|---|---|---|
  | Standard (default) | Qwen3-VL 4B | 3.0 GB | 8 GB | Apache 2.0 |
  | High quality | Qwen3-VL 8B | 5.8 GB | 16 GB | Apache 2.0 |
  | Lite | Qwen3-VL 2B | 1.6 GB | 6 GB | Apache 2.0 |

  All are official Qwen builds. Qwen2.5-VL 3B is excluded because its licence is research-only.
- **One-time setup**: the user picks a tier (recommended by memory) and the Companion downloads it into
  `<Companion data>/ai` (`PUBLISH_QUEUE_AI_DIR`).
- **Limits applied to AI output** (`post-seo.ts`): Instagram 5 hashtags and 2,200 characters; Facebook 3 hashtags;
  LinkedIn 5 hashtags and 3,000 characters; YouTube title 100 characters, tags 500 characters, 3 hashtags, and
  `#Shorts` for vertical videos up to 3 minutes. Alt text is capped at 125 characters. The location tag always comes
  from photo GPS or the description, never from the model.
- **Endpoints** (Companion): `GET /api/social-seo/ai/status` (open), and `POST` `install`, `warm`, `analyze`,
  `write` (one JSON line per update with `live: true`) and `generate` under `/api/social-seo/ai/`. All but status
  require a five-minute `social-seo` token from `POST /api/social-seo/companion-token` on the website.
- **Manual checks** (real AI, not part of the test suite): `node --import tsx scripts/ai-flow-bench.ts <image>` in
  `services/publishing/queue-runner` prints timings, the SEO score and the post (`APPS=instagram`, `DESC`, `BRAND`,
  `LOCATION`, `BUSINESS`).

## How it works (no AI)

1. **Media, in the browser** (`src/platform/social-seo/media-probe.js`): reads width, height, video length, file size,
   photo GPS (JPEG EXIF, rounded to about 1 km) and the best cover frame (sharpness, exposure and contrast over 8 sampled
   frames). Media files are never uploaded; only these numbers go to the server.
2. **Free public signals** (`src/platform/server/social-seo-signals.js`). Each one is optional and times out after 2.5 s:
   - Google search suggestions: a public autocomplete endpoint with no key. It is unofficial and could change without
     notice. It is used to validate keywords and to show "what people search for".
   - OpenStreetMap Nominatim (free): turns photo GPS into a city, or confirms a place name written in the description
     ("in Indiranagar, Bengaluru"). Requests follow its policy of one per second and are cached for 6 hours.
3. **Engine** (`instagram-engine.js`, `text-analysis.js`, `topics.js`, `instagram-rules.js`). It is deterministic, so the same input
   always gives the same output:
   - **Topic library** (`topics.js`): about 57 built-in topics (food, courses and tech, fitness, beauty, fashion, property,
     travel, events, festivals, services and more), each with trigger words and evergreen hashtags. Users maintain nothing;
     only stable topic tags belong there, never trends.
   - **Post type** (course, food, sale, service, event, greeting, teaser, pets, hiring and others) comes from the
     description's own words plus the matched topics. It chooses the hooks and the call to action.
   - **Keyword**: phrases ranked by repetition, the opening sentence, file names, topic words and real search
     suggestions. Business names, filler words and call-to-action phrases are pushed down.
   - **Hashtags (maximum 5)**: the post's own keyword tag, niche tags from the library, a local tag, and the brand tag.
     Near-duplicates and generic tags are removed, and every candidate is also shown grouped for swapping.
   - **Captions**: three versions (your words polished, a scroll-stopping hook, short and punchy). Sentences are tidied,
     lists become emoji bullet points, the author's own call to action moves to the end, and repeats are removed.
   - **Brand**: the typed brand name, then a name matching a website or email in the text, then a business name in
     the text ("Glow Studio"), then the workspace name.
   - Alt text, a location tag, format checks and a checklist score covering only what the author controls.

The score measures how many best practices the post covers. It does **not** predict reach.

Instagram limits are kept in `instagram-rules.js` (`reviewedAt`). Review them when Instagram changes its rules.

## Access

Social SEO is open to every signed-in, active user. It needs no role, plan or database permission.
The page and API use `requireOpenServicePrincipal` and `authorizeOpenServiceApi` in
`src/platform/server/access-control.js`. All "Get found online" cards in the Store are treated as open
(`OPEN_CATEGORIES` in `AppsExplorer.jsx`).

## Tests

```
npm run test:social-seo
```

The quality suite (`social-seo.quality.test.js`) checks about 30 real posts against expected results, applies the
quality rules to every output (hashtag format and count, no duplicates, no leaked values, caption length, keyword
visible before "… more", alt text length), and runs 400 generated posts. To run more generated posts:

```
SOCIAL_SEO_FUZZ_CASES=5000 SOCIAL_SEO_FUZZ_SEED=7 npm run test:social-seo
```
