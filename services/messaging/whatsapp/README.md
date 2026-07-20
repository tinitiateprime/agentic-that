# WhatsApp Workflow Console

This folder preserves the original standalone WhatsApp workflow console source.

The active AgenticThat deployment now serves WhatsApp from the root Next.js app:

- UI: `/dashboard`, `/contacts`, `/groups`, `/messages`, `/settings`
- API/webhooks: `/api/messages`, `/api/webhooks/meta`, `/api/meta/templates`, etc.

So the main Netlify site can deploy WhatsApp, Telegram, and Instagram together.

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
META_WEBHOOK_VERIFY_TOKEN=replace_me
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

Subscribe to the `messages` field and use the same `META_WEBHOOK_VERIFY_TOKEN` value from the service env.

## Capabilities

- CRM contacts and threads
- Quick send
- Approved WhatsApp templates
- Meta template create/edit/upload flow
- Sender phone-number discovery
- Groups and broadcasts
- Inbound webhook recording
- Read/unread and replied/unreplied views
