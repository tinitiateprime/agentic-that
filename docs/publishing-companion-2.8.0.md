# AgenticThat Companion 2.8.0

This is a QA prerelease. Windows and macOS downloads are unsigned; macOS is not notarized.
The supported-OS owned-account validation matrix is still required before a production release.

## Reddit posts through the Companion

Reddit now posts like X, Facebook and YouTube: through the Companion's external browser with the account's own
logged-in Reddit. Zernio is no longer used for new Reddit accounts.

- **Connecting:** on the Connect page, add the Reddit account and use Login once in its dedicated Chrome or Edge window.
- **Posting:** the Companion opens the community's submit page, fills the title, attaches the photo or video with
  Reddit's own Image / Video button and waits for Reddit's upload to finish, adds the description as body text, sets
  NSFW / Spoiler when chosen, and clicks Post.
- **Confirmation:** a post counts as done only once Reddit returns its new post id, or lists the post (same title, made
  after the click) among the account's own posts.
- **Clear reasons** when Reddit refuses: required flair, "doing that too much", karma or account-age limits,
  communities that don't allow posting or media, missing title.

Requires the database migration `202611170001_reddit_companion_jobs.sql`, which lets the Companion take Reddit jobs.

Validated on real Reddit (r/test): text posts and photo posts, each published and confirmed in 11–15 seconds. Video
posts use the same path and are not yet validated on Reddit. Automated validation covers the repository test suite;
release CI builds the production website and verifies the native Companion packages.

All desktop targets use the same implementation: Windows x64, macOS universal (Intel and Apple silicon), Linux x64 and
arm64.
