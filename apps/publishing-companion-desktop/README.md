# AgenticThat Companion for Windows

The Electron Companion is AgenticThat's focused desktop execution engine. The
SaaS workspace stays in the user's normal browser while Companion owns the
loopback login API, encrypted social-account sessions, visible browser
publishing, and Instagram/Facebook scraping engines.

The Chrome extension is optional and is not part of the core workflow. Website
publishing and scraping enter the durable Supabase queue, and Companion claims
them directly using its encrypted, revocable device token.

X and YouTube sign-in opens in a Companion-managed Chrome or Edge profile by
default because those providers can reject embedded authentication. Companion
retains that dedicated profile, verifies the signed-in state, and reuses it for
publishing. Instagram, Facebook, and LinkedIn keep the embedded login flow with
the same external-browser fallback available when needed. Passwords and
verification codes are entered only on the provider page.

Instagram and Facebook scraping share one local browser-resource slot and wait
while publishing is active. Requested date ranges are timezone-aware and are
reported as partial when the scraper cannot prove that it scanned through the
range boundary; an incomplete scan is never represented as a trustworthy empty
result.

Publishing and Telegram scheduling are paused in release 2.0.0. Existing stored
records are retained for compatibility, but the UI does not expose scheduling
and the publishing API rejects new timed work. Publish-now jobs and Telegram's
manual **Post now** action remain available.

## Development

From the repository root:

```text
npm run publishing:desktop:install
npm run publishing:desktop:start
```

Set `AGENTICTHAT_DASHBOARD_URL` to an HTTPS dashboard URL (or an HTTP localhost
URL for development) when testing a self-hosted deployment.

## Packaging

```text
npm run publishing:release:windows
```

The release command validates and packages the optional extension, builds the
desktop application, and copies the installer, Squirrel update assets, and
versioned/stable ZIP names to `artifacts/`.
The legacy `AgenticThat-Publishing-Companion-Portable.zip` alias is retained so
existing website links continue to work.

Installed Squirrel builds check the signed GitHub release feed automatically.
Portable ZIP builds are intended for QA and report that an installer is needed
for automatic updates.
