# Social SEO

Social SEO lives under **Get found online** in the Store (`/apps/seo/social-seo`) and opens at `/social-seo`.
It replaces the former "Hashtag & Caption SEO" placeholder. It only produces suggestions; it does not publish.

The user uploads media and writes a short description. Everything else is suggested.

## Status

| Platform  | With a connected AI (Companion) | Without one             |
|-----------|---------------------------------|-------------------------|
| Instagram | Live                            | Rule-based engine       |
| Facebook  | Live                            | Needs a connected AI    |
| LinkedIn  | Live                            | Needs a connected AI    |
| YouTube   | Live                            | Needs a connected AI    |
| X         | Live                            | Needs a connected AI    |
| Reddit    | Live (title, post, subreddits)  | Needs a connected AI    |

## Your own AI accounts (in the Companion)

The user logs in to **ChatGPT, Claude or Gemini** once in the AgenticThat Companion. When they click
**Create SEO posts**, every connected AI writes its own version for all six apps at the same time, and the
website shows each one in its own card.

```
Website: upload photo/video (description optional)
  -> media resized in the browser (1600 px, 1024 px per slide, 5 frames for a video), sent only to 127.0.0.1:8792
  -> Companion: for each connected AI, its own Chrome/Edge profile opens hidden and off the taskbar,
     starts a new chat, types the master prompt, attaches the images, sends, reads the answer as it is written
  -> answer split into each app's parts by section markers -> shown on the Social SEO page
  -> Gemini (thinking level "Extra thorough") is asked plainly first, as a person would, then asked to put its own
     posts into the sections word for word; an error reply ("Could you try again?") is asked again in the same chat
  -> the AI's browser closes as soon as its answer is read
  -> an AI stopped by its own plan (upload or message limit) shows "Plan limit reached" with the app's words
```

- **Code**: `services/publishing/queue-runner/server/services/chat-ai/`
  - `providers.ts`: per-app selectors (prompt box, upload, send, stop, answer, signed-out signs), checked on the live
    sites in 2026-11, each a list with fallbacks because these sites change often.
  - `chat-ai.ts`: login windows, hidden work windows, "needs you" handling, attaching with proof (a thumbnail must
    appear), sending until the message leaves the box, reading the answer, a step log and the Companion view state.
  - `native-window.ts`: on Windows, takes the AI windows off the taskbar and Alt+Tab while they work (they stay
    shown off screen, so Chrome keeps the page running at full speed).
  - `master-prompt.ts`: the short master prompt ("Give me the best of the best, 10/10 social media SEO for this
    post… You know what to do.") with the post's details and the section markers, and the answer parser.
  - `chat-ai-routes.ts`: `GET /status` (open), `POST /connect`, `/disconnect`, `/show` and `/generate` (one JSON
    line per update) under `/api/social-seo/ai/`. All but status need a five-minute `social-seo` token from
    `POST /api/social-seo/companion-token` on the website.
- **Logins** use the real Chrome or Edge (the same engine as publishing), so Google sign-in works. Each AI has its
  own profile in `<Companion data>/publishing-data/browser-data/ai-accounts/<ai>`; `accounts.json` records which
  are connected. Disconnect deletes that profile.
- **The user is needed** when an AI asks to log in again or shows a "verify you are human" check: its window comes
  forward (back on the taskbar), the website and the Companion show "needs you", and the work continues by itself.
- **Not run twice**: the website keeps each AI's result per post (media, description, brand, business details).
  Create only runs AIs that are missing or failed; "Write again" asks one AI for a fresh version.
- **Answer cleaning**: Instagram keeps the AI's first 5 hashtags (the platform limit since December 2025, also stated
  in the prompt); Gemini's source chips ("post-1.jpg"), ChatGPT's card headings and hashtags repeated at the end of
  a caption are removed.
- **Companion view**: "Social SEO" in the Companion shows each AI's step (Opening, Uploading, Sending, Writing),
  "needs you" with a button to show its window, and recent runs. The step log is `ai-accounts/ai.log` (steps and
  timings only, never prompts, answers or images).
- **Requirements**: Google Chrome, Microsoft Edge or Chromium, and an account with the AI (free plans work, with
  their usage limits).

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
