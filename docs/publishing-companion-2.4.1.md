# AgenticThat Companion 2.4.1

This is a QA prerelease. Windows and macOS downloads are unsigned; macOS is not notarized.
The supported-OS owned-account validation matrix is still required before a production release.

## Group Manager: app logins kept per workspace

In 2.4.0 the WhatsApp, Telegram and Discord logins in the Companion belonged to the computer, so after signing out of
AgenticThat and into another account on the same computer, Group Manager still showed (and could use) the first
account's connected apps.

- Each AgenticThat workspace now has its own WhatsApp link, Telegram login, Discord bot and working copy in the
  Companion, in its own encrypted folder. The workspace is taken from AgenticThat's signed token, so an account only
  ever sees and uses its own apps; another account sees "Not connected" and can connect its own.
- Logins saved by 2.4.0 move to the workspace this Companion is paired with (never to whichever account signs in
  first). Every workspace's apps reconnect, and unfinished work resumes, when the Companion starts.

Automated validation covers the repository test suite, including workspace separation of the app logins.
Release CI also builds the production website and verifies the native Companion packages.

All desktop targets use the same implementation: Windows x64, macOS universal (Intel and Apple silicon), Linux x64 and
arm64.
