# AgenticThat Companion 2.8.9

This is a QA prerelease. Windows and macOS QA downloads may be unsigned; macOS
may not be notarized.

## Discord groups are created again

- Creating a Discord group no longer fails with "The bot doesn't have permission
  for this" on servers where the bot is not an administrator. The bot used to give
  itself "Manage Permissions" on the new private channel, which Discord only
  allows for server administrators, so Discord rejected the whole request. The
  bot now gives itself only what it needs to see, post and invite in the channel;
  its server-wide Manage Roles still lets it add members.
- When Discord does refuse because the bot is missing a server permission, the
  message now names the permissions to turn on and where to find them.

After updating, open the failed group in Group Manager and choose Try again.

Validation: all 216 publishing tests and all 14 group tests passed, including a
new check that the bot's channel overwrite never asks for Manage Permissions and
that a missing-permission answer from Discord is explained. Not yet tried against
a live Discord server.
