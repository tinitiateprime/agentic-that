# AgenticThat Companion 2.5.0

This is a QA prerelease. Windows and macOS downloads are unsigned; macOS is not notarized.
The supported-OS owned-account validation matrix is still required before a production release.

## Group Manager: Messenger and Instagram

Group Manager now makes groups in Messenger and Instagram too, next to WhatsApp, Telegram and Discord.

- **Connecting:** click Messenger or Instagram on the Groups page and log in once in the window the Companion opens
  on Facebook's or Instagram's own login page. The login stays on this computer, separately for each workspace.
- **How it works:** Messenger and Instagram have no API for group chats, so the Companion works in the user's own
  logged-in browser (a dedicated Chrome or Edge profile), off screen, the way a person would: New message, pick the
  people, send the first message (the group's name), name the group, add or remove people, send messages. People
  are picked by their Facebook profile or Instagram username, never by a guessed name.
- **Contact Master:** "Facebook (for Messenger)" takes the profile link (best) or the full name as shown on
  Facebook; "Instagram username" takes the username.
- A group chat needs at least 2 people. People can now be added to a group before its chat exists; adding them makes
  the chat.
- If Facebook or Instagram asks the user for something (the Messenger chats PIN on a new computer, a security
  check), the window comes on screen and Group Manager says what to do.
- One person about every 9 seconds, to stay within the apps' limits.

## Fixes

- Browser windows for Messenger, Instagram and Social SEO (ChatGPT, Claude, Gemini) now close properly, so a login
  made moments before closing is kept.

Automated validation covers the repository test suite. Messenger and Instagram group creation was verified on the
real apps with test accounts. Release CI also builds the production website and verifies the native Companion
packages.

All desktop targets use the same implementation: Windows x64, macOS universal (Intel and Apple silicon), Linux x64 and
arm64.
