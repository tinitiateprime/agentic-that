# AgenticThat Companion 2.1.2 release notes

Companion 2.1.2 fixes account readiness synchronization and makes external
browser sessions durable for providers that reject embedded sign-in.

## Fixed

- A successful login now triggers an immediate Companion heartbeat so the
  website changes from **Reconnect required** to **Ready** automatically.
- The website refreshes Companion account state every three seconds while the
  configuration page is open, covering delayed networks and resumed devices.
- X and YouTube always sign in and publish through the same dedicated Chrome,
  Edge, or Chromium profile. Companion restart-verifies that profile before it
  marks the account connected.
- Explicit external-browser accounts on other supported platforms now retain
  and use their selected engine instead of silently reverting to embedded mode.
- Supabase account metadata reports the actual local publishing engine while
  cookies, passwords, and browser profiles remain only on the Companion.

## Cross-platform behavior

- Windows: Google Chrome, Microsoft Edge, or Chromium.
- macOS: Google Chrome, Microsoft Edge, or Chromium from Applications or the
  user Applications folder.
- Linux: Chrome, Edge, or Chromium installed through a system package, PATH,
  `/opt`, or Snap.

These QA packages are unsigned. Windows SmartScreen, macOS Gatekeeper, or Linux
package-manager warnings can therefore appear during installation.
