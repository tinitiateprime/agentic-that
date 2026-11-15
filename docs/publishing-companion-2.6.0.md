# AgenticThat Companion 2.6.0

This is a QA prerelease. Windows and macOS downloads are unsigned; macOS is not notarized.
The supported-OS owned-account validation matrix is still required before a production release.

## Group Manager: X group chats

Group Manager now makes groups in X too, as X group chats (X Chat), next to WhatsApp, Telegram, Discord, Messenger and
Instagram.

- **Connecting:** click X on the Groups page and log in once in the window the Companion opens on x.com. X asks for
  the user's Chat passcode once on the computer; the window comes on screen when it does.
- **How it works:** X's API for chats is paid, so the Companion works in the user's own logged-in X, off screen:
  Chat → New message → Create a group → pick people → Next, then names the group. People are added and removed from the
  group's details (More), and messages are sent in the chat. Every change is confirmed in the group's member list.
- **Who can be added (X's rules):** people who follow the user's account and have set up X Chat. For anyone else X's
  own reason is shown next to them ("Doesn't follow you on X", "needs to upgrade to the new X Chat", message settings);
  the group's other apps still add them.
- X reopens an existing group that has exactly the same people instead of making a new one; Group Manager then says so
  instead of sharing one X chat between two groups.
- Contact Master's "X username" takes @name or an x.com link.

## Fixes

- The Companion no longer fails to start when AgenticThat answers slowly for a moment (for example while it deploys):
  loading the sign-in key is retried.

Validated on the real app with test accounts: create, message, add, remove, add again, and the duplicate-group case.
Automated validation covers the repository test suite; release CI builds the production website and verifies the
native Companion packages.

All desktop targets use the same implementation: Windows x64, macOS universal (Intel and Apple silicon), Linux x64 and
arm64.
