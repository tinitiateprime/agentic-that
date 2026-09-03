# AgenticThat Companion 2.1.0 release notes

Companion 2.1 adds first-class Windows, macOS, and Linux desktop distribution
while retaining the secure Supabase job-control plane introduced in 2.0.

## Cross-platform desktop support

- Windows 10/11 x64 Setup and portable ZIP builds remain supported.
- One universal macOS build supports Intel and Apple Silicon through DMG and ZIP.
- Linux builds ship as DEB, RPM, and portable ZIP for x64 and ARM64.
- Google Chrome, Microsoft Edge, and Chromium discovery covers standard system,
  per-user, Snap, and `PATH` installations, with an explicit executable override.
- Login startup uses Squirrel.Windows, macOS Login Items, or an XDG autostart
  desktop entry as appropriate.
- Tray-less Linux desktops keep the main Companion window available instead of
  leaving an invisible background process.

## Security and updates

- macOS credentials use Keychain and production publishing is gated on Developer
  ID signing plus Apple notarization.
- Linux credentials require GNOME Keyring/libsecret or KWallet; Companion refuses
  Electron's insecure `basic_text` fallback.
- Windows and signed macOS installations use the Electron public update service.
  Linux updates use the installed DEB/RPM package or a replacement portable archive.
- Production releases cannot publish until the complete owned-account OS matrix is
  approved, Windows signing passes, and macOS signing/notarization passes.

The Chrome extension remains optional. Publishing, pairing, scraping, job
progress, and results continue to work through the website, Supabase, and the
paired desktop Companion without a tunnel or separate persistent server.

Publishing and Telegram scheduling remain paused pending production validation.

QA tags such as `v2.1.0-qa.1` are published as GitHub prereleases for native OS
testing. They may be unsigned and must not be presented as production builds.
