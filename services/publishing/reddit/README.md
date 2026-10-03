# Reddit Publisher

Reddit publishes only through Zernio; it never uses the Companion or an
external browser.

- Reddit API access comes from
  [Zernio](https://zernio.com) through its official SDK, `@zernio/node`.
  A Publishing Manager adds the account in Config Manager and chooses
  **Connect with Reddit**; Zernio hosts the Reddit sign-in, holds the OAuth
  grant, and refreshes it. AgenticThat stores only the workspace's Zernio
  profile id and the Zernio account id (`publishing_zernio_profiles`,
  `publishing_reddit_connections`). Due jobs are published by
  `src/platform/server/reddit-publishing.js`, right after queueing and every
  minute by `netlify/functions/reddit-publisher.mts`. Text, image, and native
  video posts are supported. Each request carries an Idempotency-Key, so
  retries after a timeout never duplicate a post.
- An account that is not connected, or was disconnected, keeps its queued
  posts waiting until **Connect with Reddit** is used again. The Companion
  never claims Reddit jobs or reports Reddit accounts (enforced in
  `companion_claim_jobs` and `companion_heartbeat`).

Every Reddit post needs a subreddit and a title, stored in
`platformOptions.reddit` and validated by `../queue-runner/shared/reddit-options.js`.

Configure `ZERNIO_API_KEY`; see `.env.example`. Zernio bills per connected
social account.
