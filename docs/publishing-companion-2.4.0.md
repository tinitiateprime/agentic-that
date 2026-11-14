# AgenticThat Companion 2.4.0

This is a QA prerelease. Windows and macOS downloads are unsigned; macOS is not notarized.
The supported-OS owned-account validation matrix is still required before a production release.

## New: Group Manager

Create a group once and it's made in your real WhatsApp, Telegram and Discord (agenticthat.com/group-manager).

- **Contact Master**: add each person once, with their WhatsApp number, Telegram number or @username, Discord user ID,
  and their Instagram, Facebook, X, Reddit and LinkedIn IDs.
- **Real groups**: choose the apps, pick people from Contact Master, and the group is created in those apps with them
  in it. Members see "You were added" like any group.
- **Add, remove and message** in every app at once. Each person shows their real status in each app: Added, Invite
  sent (when their privacy settings or Discord's rules require an invite link, which is sent to them automatically),
  Not on this app, or No ID saved.
- **Your own accounts, no browser windows**:
  - WhatsApp: your own number, linked like WhatsApp Web by scanning a QR code once.
  - Telegram: your own account through Telegram's official API: just your phone number and the code Telegram sends.
  - Discord: your own bot through Discord's official API; groups are private channels in your server.
- **Safe pace**: people are added one at a time (every few seconds on WhatsApp), and Telegram's and WhatsApp's own
  limits are explained in plain words.
- **Saved on AgenticThat**: contacts and groups are kept in AgenticThat's database for the whole workspace, so they
  are the same on every device and for the team, even with the Companion closed. The Companion reports each result
  (added, invite sent, message sent…) as it happens, over its workspace pairing.
- **Logins stay on this computer**: the WhatsApp link, Telegram session and Discord bot token are kept only by the
  Companion, encrypted. Work saved while the Companion was closed starts as soon as it runs, and work cut short by a
  restart carries on by itself. Updates and restarts wait while Group Manager is working.
- **Group Manager view in the Companion**: each app's connection, the changes still to do, and the recent changes
  made in the apps.

X Lists, Reddit communities, LinkedIn and Facebook groups and Instagram group chats are shown as coming later.

Automated validation covers the repository test suite, including Group Manager's contacts, encryption, group actions
in every app, retries after a restart, the Discord API flow and the authenticated routes. Release CI also builds the
production website and verifies the native Companion packages. Live behavior depends on each app's own rules and limits.

All desktop targets use the same implementation: Windows x64, macOS universal (Intel and Apple silicon), Linux x64 and
arm64.
