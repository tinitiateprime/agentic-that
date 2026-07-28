# AgenticThat Publishing Companion for Windows

This Electron application packages the persistent Publish Queue API, local JSON
store, media uploads, scheduler, and isolated Chrome profiles into a normal
Windows desktop installer.

The Companion keeps AgenticThat itself in the user's normal browser. When the
user clicks an account login key or a publishing run starts, Companion opens
each required social account in an isolated live browser pane and displays
concurrent platform actions in a clear activity grid. Before each publishing
run, a native Allow/Deny popup asks permission to protect automated panes from
accidental mouse and keyboard input. Manual login panes remain interactive, and
an emergency stop is always available.

The complete embedded AgenticThat dashboard implementation is preserved behind
the `EMBED_FULL_PUBLISHING_WORKSPACE` flag in `main.js`, but is temporarily
disabled pending product approval.

On first launch it creates a local auth secret, protects it with Electron safe
storage when available, encrypts exported publishing session state with a
separate OS-protected key, starts the service on loopback port 8792, and enables
launch at Windows sign-in. Each account keeps its own persistent browser
partition and session. The standalone Chrome automation remains available as a
fallback when the queue runner is used outside the desktop app.

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
