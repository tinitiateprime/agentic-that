# AgenticThat Companion 2.1.11

- Facebook now signs in through a dedicated persistent Chrome, Edge, or Chromium profile on Windows, macOS, and Linux. Companion restart-checks the authenticated profile before reporting the account as ready.
- Existing Facebook accounts created with the embedded engine are moved to the provider-compatible external engine and request one verified reconnect.
- LinkedIn publishing now waits for provider response, visible success confirmation, or a composer that remains closed before reporting success and closing the browser.
- LinkedIn text replacement uses the correct Command shortcut fallback on macOS.

This QA release is unsigned and intended for owned-account validation on Windows, macOS, and Linux.
