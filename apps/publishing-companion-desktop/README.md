# AgenticThat Publishing Companion for Windows

This Electron application packages the persistent Publish Queue API, local JSON
store, media uploads, scheduler, and isolated Chrome profiles into a normal
Windows desktop installer.

On first launch it creates a random Operations Manager password and auth secret,
stores them with Windows-protected Electron safe storage when available, starts
the service on loopback port 8792, and enables launch at Windows sign-in. The
control window shows health, Chrome availability, credentials, logs, and local
data without requiring a terminal.

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
