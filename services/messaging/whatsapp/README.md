# WhatsApp Workflow Console

This folder preserves the original standalone WhatsApp workflow console source.

The active AgenticThat deployment now serves WhatsApp from the root Next.js app:

- UI: `/dashboard`, `/contacts`, `/groups`, `/messages`, `/settings`
- API/webhooks: `/api/messages`, `/api/webhooks/meta`, `/api/meta/templates`, etc.

So the main Netlify site can deploy WhatsApp, Telegram, and Instagram together.

## Upstream Sync

This console is vendored from the standalone
[tinitiate-wa-workflows](https://github.com/tinitiateprime/tinitiate-wa-workflows)
repository. Upstream's flat layout is split across two roots here — its `app/`
stays at `app/`, its `lib/` and `components/` move under
`services/messaging/whatsapp/src/`, and `@/lib` imports become `@whatsapp/lib`.
Identity is the other difference: `src/lib/auth.js` keeps upstream's exported
API but resolves the signed-in user from the AgenticThat principal and enforces
`messaging.whatsapp` access, so upstream route handlers work unchanged.

`services/messaging/whatsapp/UPSTREAM.json` records the upstream commit this
copy was last adapted from. To pull newer upstream work:

```bash
git remote add wa-upstream https://github.com/tinitiateprime/tinitiate-wa-workflows.git
git fetch wa-upstream main
npm run whatsapp:sync              # report what would change
npm run whatsapp:sync:apply        # three-way merge into the working tree
```

The sync rebuilds both sides of the upstream change in local path and import
space, then merges against the working tree, so local adaptations surface as
conflicts rather than being overwritten. Files with no local counterpart
(`package.json`, `app/layout.jsx`, `app/page.jsx`, upstream `scripts/`) are
reported for review and never written. New route handlers are flagged when they
still carry upstream's flat `401` instead of `whatsappAccessErrorResponse`.

After resolving conflicts and carrying over review items, record the sync:

```bash
node scripts/sync-whatsapp-upstream.mjs --set-base
```

That step refuses to run while conflict markers remain. Until the base is
recorded, re-running the sync reports the same range again, and files already
resolved show as conflicts — they match neither upstream side any more.

## Local Start

From the AgenticThat root:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:5173/dashboard
```

The root `.env.local` contains the local Meta and PostgreSQL credentials and is ignored by git.

## Required Runtime Settings

Use Meta Cloud API for production WhatsApp automation:

```env
WA_PROVIDER=meta
META_API_VERSION=v25.0
META_ACCESS_TOKEN=replace_me
META_PHONE_NUMBER_ID=replace_me
META_WABA_ID=replace_me
META_APP_ID=replace_me
META_APP_SECRET=replace_me
META_CONFIGURATION_ID=replace_me
META_WEBHOOK_VERIFY_TOKEN=replace_me
CREDENTIAL_ENCRYPTION_KEY=replace_with_64_hex_characters
DATABASE_URL=replace_me
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-me
BUSINESS_NAME=AgenticThat
WA_FROM=+910000000000
```

For local-only demos without live WhatsApp delivery, set `WA_PROVIDER=mock`. A PostgreSQL `DATABASE_URL` is still required for application data.

## Webhook

Configure this callback in Meta for Developers:

```text
https://<whatsapp-service-domain>/api/webhooks/meta
```

Subscribe to the `messages` and `calls` fields and use the same
`META_WEBHOOK_VERIFY_TOKEN` value from the service env. `META_APP_SECRET`
enables signature verification for incoming webhook requests.

## Capabilities

- CRM contacts and threads
- Quick send
- Approved WhatsApp templates
- Meta template create/edit/upload flow
- Sender phone-number discovery
- Groups and broadcasts
- Inbound webhook recording
- Inbound and outbound message reactions with live updates
- Read/unread and replied/unreplied views
- Self-serve workspace signup and encrypted tenant credentials
- Meta Embedded Signup/coexistence onboarding
- WhatsApp calling events and call settings
- WATI onboarding and authenticated webhooks
- Bounded WATI recovery sync while an operator has the CRM open
- Optional read-only WhatsApp Web monitoring

## Database Migration

Reaction support adds two nullable columns and an index to the existing
`messages` table. Netlify applies this automatically before each build. For a
manual environment, run:

```bash
npm run db:migrate:whatsapp
```
