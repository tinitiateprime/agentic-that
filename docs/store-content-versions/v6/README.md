# Store — v6 (2026-09-27)

Adds the omnichannel messaging composer. Current live version.

Changes from v5:
- New page /messaging (app/messaging/page.jsx + src/platform/OmnichannelComposer.jsx + omnichannel-composer.module.css):
  one message, pick WhatsApp and/or Telegram, pick each channel's audience, review, send.
  - WhatsApp: contact group broadcast via POST /api/groups/[id]/broadcast (free text or approved template)
  - Telegram: saved groups + @channels/recipients via POST /api/telegram/posts then /posts/[id]/send-now
  - Connections are read only; anything not connected links to Connection Manager (/config-manager)
- Store Messaging panel: "Compose message" button -> /messaging
- Store Publishing panel: "Open publishing composer" button -> /publishing (existing)

To restore v6:

    cp docs/store-content-versions/v6/AppsExplorer.jsx.bak src/platform/AppsExplorer.jsx
    cp docs/store-content-versions/v6/product-catalog.js.bak src/platform/product-catalog.js
    cp docs/store-content-versions/v6/apps-page.jsx.bak app/apps/page.jsx
    cp docs/store-content-versions/v6/app-store.module.css.bak src/platform/app-store.module.css
    cp docs/store-content-versions/v6/OmnichannelComposer.jsx.bak src/platform/OmnichannelComposer.jsx
    cp docs/store-content-versions/v6/omnichannel-composer.module.css.bak src/platform/omnichannel-composer.module.css
    mkdir -p app/messaging && cp docs/store-content-versions/v6/messaging-page.jsx.bak app/messaging/page.jsx
