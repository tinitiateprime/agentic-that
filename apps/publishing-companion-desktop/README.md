# AgenticThat Companion for Windows, macOS, and Linux

The Electron Companion is AgenticThat's focused desktop execution engine. The
SaaS workspace stays in the user's normal browser while Companion owns the
loopback login API, encrypted social-account sessions, visible browser
publishing, and Instagram/Facebook scraping engines.

The Chrome extension is optional and is not part of the core workflow. Website
publishing and scraping enter the durable Supabase queue, and Companion claims
them directly using its encrypted, revocable device token.

X and YouTube sign-in opens in a Companion-managed Chrome, Edge, or Chromium profile by
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

Publishing and Telegram scheduling are paused in release 2.1.0. Existing stored
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
npm run publishing:desktop:make:windows
npm run publishing:desktop:make:macos
npm run publishing:desktop:make:linux
```

Each target must be built on its native operating system. The tagged GitHub
Actions release workflow builds Windows Setup/ZIP, a universal macOS DMG/ZIP,
and Linux DEB/RPM/ZIP artifacts for x64 and ARM64. It publishes only after the
owned-account matrix is approved, Windows is signed, and macOS is signed and
notarized.

Installed Windows and signed macOS builds check the public release feed
automatically. Linux updates are delivered through a newly installed DEB/RPM or
portable archive because Electron does not provide a native Linux auto-updater.

On Linux, Companion refuses Electron's `basic_text` credential-storage fallback.
GNOME Keyring/libsecret or KWallet must be installed and unlocked before pairing.
