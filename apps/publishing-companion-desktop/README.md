# AgenticThat Publishing Companion for Windows

This Electron application packages the persistent Publish Queue API, local JSON
store, media uploads, scheduler, and isolated Chrome profiles into a normal
Windows desktop installer.

The Companion keeps AgenticThat itself in the user's normal browser. Account
login opens by default in an isolated browser pane inside Companion. The user
enters credentials and verification codes only on the provider page; Companion
detects successful login, protects the resulting local session, and closes the
login pane automatically. A dedicated Google Chrome or Microsoft Edge login is
available as an explicit fallback for providers that reject embedded sign-in.
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
optional and used only for the system-browser login fallback.

Version 1.4.1 also provides the Instagram Local Companion engine. Public
scraping runs in hidden, non-persistent browser partitions that never reuse or
modify the persistent publishing sessions. See
[`docs/instagram-companion-engine.md`](../../docs/instagram-companion-engine.md)
for its API, isolation, queue, and failure behavior.

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
