# Companion production validation

Complete this matrix on the exact signed build before setting the GitHub
repository variable `COMPANION_LIVE_MATRIX_APPROVED_VERSION` to its version.
Record evidence in the release ticket; never commit account credentials,
cookies, screenshots containing secrets, or pairing tokens.

## Required operating-system matrix

- Windows 10 and Windows 11 x64: verify Setup installation, upgrade, login
  startup, tray mode, automatic update, Authenticode signature, and uninstall.
- macOS on Intel and Apple Silicon: verify the universal DMG, Developer ID
  signature, Apple notarization/Gatekeeper, Keychain persistence, login startup,
  menu-bar mode, automatic update, and uninstall.
- Ubuntu/Debian x64 and ARM64: verify DEB installation, Secret Service storage,
  XDG login startup, tray behavior (and main-window fallback), upgrade, and uninstall.
- Fedora/RHEL-compatible x64 and ARM64: verify RPM installation, Secret Service
  storage, XDG login startup, tray behavior (and main-window fallback), upgrade,
  and uninstall.
- Verify the portable ZIP on Windows, macOS, and Linux for QA. Portable builds
  must clearly direct users to reinstall when native automatic updates are unavailable.

## Required environment tests

- Pairing is single-use, expires after five minutes, binds only the requested
  Companion instance and workspace, and stops after server-side revocation.
- Publishing and scraping queues survive app termination, operating-system restart,
  internet loss, sleep/resume, and a browser-process crash.
- A crash before the final platform action safely requeues the post. A crash at
  or after the final action produces `UNCERTAIN` and never automatically retries.
- The website reports Online, Offline, Updating, Login Required, Error, version,
  minimum supported version, and last heartbeat correctly.
- A damaged primary queue file recovers from its last known-good backup.
- Windows has a valid Authenticode signature, macOS passes `codesign` and
  Gatekeeper assessment, and every release asset matches `SHA256SUMS.txt`.

## Required owned-account matrix

On every supported desktop OS, for Instagram, Facebook, X, LinkedIn, and YouTube,
verify login, 2FA/checkpoint
handling, session reuse after restart, expired-session detection, logout/relogin,
one valid supported publish-now format, cancellation before submission, and
post-result verification. Use dedicated test accounts and comply with each
platform's terms.

On every supported desktop OS, for Instagram and Facebook scraping, compare profile, post, latest, date-range,
and engagement results with the visible source UI. Verify empty, private,
deleted, renamed, login-wall, rate-limit, partial-range, and UI-change failures
are reported honestly and never returned as invented or silently incomplete data.
