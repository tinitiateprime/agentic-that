# AgenticThat Companion 2.1.1 release notes

Companion 2.1.1 fixes the Windows installed-app runtime and strengthens release
testing for Windows, macOS, and Linux.

## What to download

- Windows: `AgenticThat-Publishing-Companion-Setup.exe`
- macOS Intel or Apple Silicon: `AgenticThat-Publishing-Companion-macOS-universal.dmg`
- Ubuntu/Debian: the x64 or ARM64 `.deb` matching the computer
- Fedora/RHEL: the x64 or ARM64 `.rpm` matching the computer
- Other Linux distributions: the matching Linux `.zip`

The Windows portable ZIP and macOS ZIP are fallback packages. `RELEASES`, the
`.nupkg`, and `SHA256SUMS.txt` support updates and verification and normally do
not need to be downloaded manually.

## Fixes

- The desktop host now supplies the exact Companion identity variable consumed
  by its embedded service, preventing the watchdog from mistaking its own local
  service for a second Companion process.
- Windows release CI now installs `Setup.exe`, checks the installed Electron
  runtime files and Start Menu shortcut, and runs the full smoke test against
  the installed application rather than testing only the portable directory.
- The smoke test verifies that the desktop host and embedded service use the
  same Companion instance identity.

QA builds may be unsigned and are intended for Windows, macOS, and Linux testing,
not production distribution. Publishing and Telegram scheduling remain paused
pending production validation.
