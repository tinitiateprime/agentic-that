# Publish Queue Runner

Publish Queue Runner is the local execution service for AgenticThat's Netlify
publishing dashboard. It supports Facebook, Instagram, X, LinkedIn, and YouTube
through isolated Chrome profiles and fully manual account login.

## Components

- Netlify serves `/publishing`, Config Manager, and Content Manager.
- The Manifest V3 extension in `extensions/publishing-companion` securely bridges
  the deployed dashboard to this computer.
- This companion stores queue metadata in `data/store.json`, stores media in
  `uploads/`, checks schedules every minute, and performs browser publishing.
- Each configured social account receives its own profile under `browser-data/`.

Social-network passwords and verification codes are never accepted or stored by
AgenticThat. The user enters them directly into the dedicated Chrome window.

## First-time setup

From the repository root:

1. Double-click `Install Publishing Extension.cmd` and follow its four steps.
2. Double-click `Start Publishing Companion.cmd`.
3. Optionally run `npm run publishing:install-startup` so the companion starts
   when the Windows user signs in.
4. Open `https://agenticthat.netlify.app/publishing`.
5. Sign in to Publish Queue, add accounts in Config Manager, and choose **Login**
   for each account.

Developer commands:

```text
npm run publishing:companion
npm run publishing:extension:open
npm run test:publishing
npm run build
```

## Upload and scheduling workflow

1. Choose **Create Post**.
2. Select one image or video using the normal file picker or drag and drop.
3. Enter the default description and optional per-platform variations.
4. Select one or more configured accounts.
5. Choose now, an exact future time, or a reusable schedule.
6. Submit. Media is transferred to the companion in safe, size-checked chunks;
   no structured folders are required.

Operations Manager submissions with **now** destinations start publishing
immediately. Scheduled posts remain queued until due. The computer must remain
powered on and the companion must be running; overdue work is picked up when it
returns. Schedule inputs use the publishing computer's local time; keep
`PUBLISH_QUEUE_SCHEDULER_TIMEZONE` aligned with that computer.

## Reliability behavior

- Queue execution is serialized and account concurrency is bounded by
  `PUBLISH_QUEUE_MAX_CONCURRENT_ACCOUNTS`.
- A post is marked processing before browser work begins and records attempt and
  failure details.
- After an interrupted publish, the default `review` recovery mode holds the post
  for human verification instead of risking a duplicate.
- Expired login sessions mark the account **Login required** and keep the failed
  post available for review and requeue.
- Uploaded file extension, MIME family, size, chunk offsets, and file signature
  are validated before queue creation.

Browser publishing depends on third-party interfaces. Platform UI changes,
CAPTCHA, two-factor prompts, restrictions, and internet outages may still need
manual action; these conditions are surfaced as recoverable failures rather than
silent success.

See [publishing-extension.md](../../../docs/publishing-extension.md) for extension
installation and architecture details.
