# AgenticThat Companion for Windows

This Electron application packages the publishing queue API, public Instagram
and Facebook scraping engines, local JSON store, media uploads, scheduler, and
isolated browser profiles into a normal Windows desktop installer.

The Companion keeps AgenticThat itself in the user's normal browser. Instagram,
Facebook, and LinkedIn login open by default in an isolated browser pane inside
Companion. X and YouTube login open in a dedicated Google Chrome or Microsoft
Edge profile because those providers commonly reject embedded sign-in.
Companion verifies the external login and transfers it into its protected
partition when permitted; a provider-bound session remains in the isolated
managed Chrome profile and that same profile performs publishing. The user
enters credentials and verification codes only on the provider page.
Publishing runs remain visible in Companion's live activity grid, and an
emergency stop is always available.

The complete embedded AgenticThat dashboard implementation is preserved behind
the `EMBED_FULL_PUBLISHING_WORKSPACE` flag in `main.js`, but is temporarily
disabled pending product approval.

On first launch it creates a local auth secret, protects it with Electron safe
storage when available, encrypts exported publishing session state with a
separate OS-protected key, starts the service on loopback port 8792, and enables
launch at Windows sign-in. Each account has an isolated sign-in profile and an
isolated persistent publishing partition. Google Chrome or Microsoft Edge is
required for X and YouTube login and remains an optional fallback for the
other providers.

Version 1.7.5 adds timezone-aware date, month, and year range validation for
Instagram and Facebook, deeper range discovery, pinned-post-safe stopping, and
explicit coverage diagnostics so incomplete history is reported as partial
instead of complete. It retains the external-first X and YouTube login with encrypted
session transfer, restart verification, and protected managed-Chrome fallback.
It also includes the default Instagram and Facebook Companion engines,
one shared scraping slot with publishing priority, durable authenticated
workspace result history, version checks, and explicit custom-dashboard origin
approval. It also verifies short-lived workspace tokens against the signing key
of the exact trusted dashboard that sent the request, allowing self-hosted
AgenticThat websites to use Companion without sharing private signing keys.
Facebook profile analysis scans the public Reels grid for current
views, correlates every loaded Reel with its exact reactions, comment count,
and publish timestamp, and ranks separate Most Viewed, Most Reacted, and Most
Discussed lists only after the full scanned set is verified. Comment bodies are
not collected or displayed. Public Facebook collection runs in a fresh local
Chrome or Edge session for reliable profile hydration, with a fresh anonymous
embedded browser as the browser-launch fallback.
Instagram and Facebook scraping use hidden temporary browser partitions and never reuse connected publishing/login sessions. See
[`docs/instagram-companion-engine.md`](../../docs/instagram-companion-engine.md)
for its API, isolation, queue, and failure behavior.

Companion shows Instagram and Facebook work on a shared live activity screen with the
current profile, elapsed time, lifecycle stages, queue, recent results, and a
scraping-only stop action. Windows notifications and the tray tooltip announce
start and completion without taking over visible publishing browsers.

Instagram and Facebook scraping share one browser-work slot. New scraping waits
while publishing has priority, while provider/account publishing profiles and
temporary anonymous scraper partitions remain isolated from each other.

## Development

From the repository root:

```text
npm run publishing:desktop:install
npm run publishing:desktop:start
```

## Packaging

```text
npm run publishing:release:windows
```

The Squirrel installer and portable ZIP are copied to the repository's ignored
`artifacts/` directory. Set `WINDOWS_CERTIFICATE_FILE` and
`WINDOWS_CERTIFICATE_PASSWORD` to sign both the packaged application used by the
Portable ZIP and the installer during a production build. Public GitHub releases
also verify that both entry points have valid RSA Authenticode signatures and
trusted timestamps before publishing.

For Microsoft Store distribution, set `WINDOWS_MSIX_IDENTITY_NAME`,
`WINDOWS_MSIX_PUBLISHER`, and `WINDOWS_MSIX_PUBLISHER_DISPLAY_NAME` to the exact
values reserved in Partner Center, then run `npm run make:store`. The dedicated
GitHub Actions Store workflow accepts the same values and produces the MSIX
artifact for Partner Center submission.
