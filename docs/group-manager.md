# Group Manager

Create a group once and it is made in the user's real WhatsApp, Telegram and Discord. Contacts are kept once in
**Contact Master** with their number or ID for every app; adding a contact to a group adds them in each app, and a
message is sent to every app the group is in.

Page: `/group-manager` (open to every signed-in user with a workspace). Data: the platform PostgreSQL database
(Hetzner). App work: the AgenticThat Companion on the user's computer.

## How it works

```
Website /group-manager
  -> /api/group-manager/*            contacts and groups in Hetzner (group_manager_* tables, per workspace)
       new work is saved as pending: apps "creating", members "pending", messages "sending"
  -> Companion 127.0.0.1:8792/api/group-manager/jobs   (short-lived "group-manager" token)
       the job carries the group as saved and the contacts it needs; the Companion does everything pending
       WhatsApp: the user's own number, linked like WhatsApp Web (QR code once), as a direct connection (Baileys)
       Telegram: the user's own account, through Telegram's official API (GramJS), phone number + code
       Discord:  the user's own bot, through Discord's official API (bot token)
  <- results reported to Hetzner as they happen:
       1. by the Companion itself, over its workspace pairing: /rest/v1/rpc/companion_group_sync
       2. by the open page, from the Companion's /state (when the Companion is not paired)
```

- **Hetzner holds** contacts, groups, members (with each person's status in each app) and the last 50 messages
  per group. They are shared across devices and the workspace's team, and visible with the Companion closed.
- **The Companion holds** only the app logins (WhatsApp link keys, Telegram session, Discord bot token) and a working
  copy of the groups it is doing work for, all encrypted (AES-256-GCM with the Companion's session key, protected by
  the operating system's secure storage) in `publishing-data/browser-data/groups/`.
- Work saved while the Companion was closed (or on another device) is sent to it automatically when the page finds it
  running. Work interrupted by closing the Companion resumes by itself after it restarts.
- The paired report checks the Companion's pairing token and installation, and only touches groups of the pairing's
  workspace. Newer requests from the website (adding someone again after a removal or failure) are never overwritten
  by an older report.

## Tables (`supabase/migrations/202611140001_group_manager.sql`)

| Table | Holds |
|---|---|
| `group_manager_contacts` | name, WhatsApp, Telegram, Discord, Instagram, Facebook, X, Reddit, LinkedIn, note |
| `group_manager_groups` | name (unique per workspace), description, Discord server, `apps` (per app: state, app ids, invite link, error) |
| `group_manager_members` | group, contact, `apps` (per app: pending, added, invited, not-on-app, missing-id, failed, removed) |
| `group_manager_messages` | text, `results` (per app: sending, sent, failed) |

All rows reference `platform_workspaces` with cascade delete; RLS is on and the public roles have no access.
Apply with `npm run db:migrate`.

## What happens in each app

| | WhatsApp | Telegram | Discord |
|---|---|---|---|
| A group is | a WhatsApp group | a Telegram supergroup | a private text channel in a server the user picks |
| Add a member | added directly; if their privacy settings don't allow it (or they left recently), they are sent the group's invite link | added directly; if their privacy settings don't allow it, they are sent the invite link | people already in the server get access to the channel; anyone else gets the server invite link (Discord lets no one add a person to a server). "Try again" gives access once they have joined |
| Remove a member | removed from the group | removed (and unbanned, so they can be added again later) | channel access removed |
| Message | sent to the group | sent to the group | posted in the channel (split at 2,000 characters) |
| Contact field | WhatsApp number with country code | phone number or @username | user ID (17–20 digits), or username |

Members are added one at a time per app: every 6 seconds on WhatsApp (WhatsApp limits numbers that add people
quickly), 4 seconds on Telegram and about 1 second on Discord. "Try again" retries what failed; a failed removal is
retried as a removal. Deleting a group in Group Manager does not delete the real groups in the apps.

## Connecting the apps (in the Companion, from the page)

- **WhatsApp**: scan the QR code in WhatsApp → Settings → Linked devices → Link a device.
- **Telegram**: the user enters only their phone number and the code Telegram sends (and the two-step verification
  password, if any). Everyone shares AgenticThat's Telegram app identity: set `TELEGRAM_API_ID` and
  `TELEGRAM_API_HASH` (my.telegram.org) in the website environment (AWS Amplify).
- **Discord**: create an application in the Discord Developer Portal, paste its bot token, then add the bot to a
  server the user owns or manages (the page explains creating one and notices when the bot joins).

## The Companion's Group Manager view

The Companion window has a **Group Manager** section: each app's connection, how many changes are queued, and the
recent changes made in the apps (groups created, people added or removed, messages sent), with a button that opens the
Group Manager page.

## Posting apps (later)

X Lists, Reddit communities, LinkedIn groups, Facebook groups and Instagram group chats are shown as "Coming later".
Contact Master already stores each contact's Instagram, Facebook, X, Reddit and LinkedIn IDs for them.

## Code

- Website: `app/group-manager/page.jsx`, `app/api/group-manager/[...path]/route.js`,
  `app/api/group-manager/companion-token/route.js`, `src/platform/group-manager/`,
  `src/platform/server/group-manager-store.js`, the `companion_group_sync` operation in
  `src/platform/server/companion-database-api.js`
- Companion: `services/publishing/queue-runner/server/services/groups/` (`routes.ts`, `engine.ts`, `store.ts`,
  `reporting.ts`, `whatsapp.ts`, `telegram.ts`, `discord.ts`, `secure-file.ts`, tests in `groups.test.ts`), and the
  Group Manager view in `apps/publishing-companion-desktop/control.*`
