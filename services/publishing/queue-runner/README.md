# Publish Queue Runner

This is the integrated AgenticThat publishing service. The UI is mounted at `/publishing`; its Express API runs as a managed development service. Local browser uploads go directly to that API so large media does not pass through the Next.js development proxy. Server-side tools continue to use `/api/publishing/*`.

## What is included

- Unified image/video composer for Instagram, X, LinkedIn, Facebook, and YouTube.
- Multiple publishing accounts with isolated persistent Chrome profiles.
- Queue, exact-time scheduling, reusable schedules, delivery history, and role-based access.
- Manual browser login followed by saved-session Playwright publishing. Official social APIs are not required.
- Atomic local JSON persistence for users, accounts, schedules, queue state, and activity history.

Machine-specific source state was intentionally not imported. `browser-data/`, `data/`, `uploads/`, logs, build output, and the old project's `node_modules/` remain excluded.

## Configuration

Copy `.env.example` to `.env.local` in this directory, or define the same values in the workspace `.env.local`. The data file defaults to `data/store.json`; set `PUBLISH_QUEUE_DATA_PATH` only when you want a different local path.

Required outside local-only development:

- `PUBLISH_QUEUE_AUTH_TOKEN_SECRET`
- Strong values for the four bootstrap role passwords

The local data file is created automatically on first start and is written atomically. Passwords are stored as salted PBKDF2 hashes. Setting a `PUBLISH_QUEUE_*_PASSWORD` value resets that named bootstrap user's password when the service starts, so local credentials can be recovered without editing the data file.

## Run

From the repository root:

```text
npm run dev
```

The workspace starts the website, Telegram, Instagram scraper, and Publish Queue Runner together. Sign in to AgenticThat, open Publish Queue Runner, then use the publishing service credentials. The outer AgenticThat session protects the page; the publishing login provides its finer-grained operations roles.

For a separately hosted API, set `PUBLISH_QUEUE_API_URL` for the Next.js server and `NEXT_PUBLIC_PUBLISH_QUEUE_API_URL` for browser requests. The API host must support persistent processes, local media storage, Chrome, and browser profiles; it cannot run as a request-only Netlify Function.

## Publishing workflow

1. Open AgenticThat **Config Manager** and select Publish Queue Runner.
2. Add the social account there, then use its login action to complete the normal platform login in Chrome.
3. Create a post and select destinations. Operations Managers immediately start a targeted background publish for every **now** destination; scheduled destinations remain queued until due.
4. Leave the API process and computer running. The scheduler checks due posts every minute by default.
5. Use **Run automation** to retry or drain other ready queue items. Account runs are serialized and Chrome concurrency is limited by `PUBLISH_QUEUE_MAX_CONCURRENT_ACCOUNTS`.

Publish Queue Runner only displays and selects configured accounts. Account creation, editing, login, pausing, and removal are centralized at `/config-manager?service=publishing`.

Platform UI changes, challenges, two-factor prompts, and account restrictions can still require manual intervention. Failed attempts remain visible for review.
