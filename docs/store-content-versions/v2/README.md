# Store content — v2 (2026-09-27)

Omnichannel publishing/messaging copy update. Current live version.

Changes from v1:
- Store intro, search placeholder ("Search channels, apps, or workflows..."), "Popular:" → "Browse:"
- /apps metadata: title "Store — AgenticThat" and omnichannel description
- Messaging and Publishing category title/description (labels stay "Messaging" / "Publishing")
- Card copy for WhatsApp, Telegram, Instagram, YouTube, Facebook, X, LinkedIn
- Shared publishing promise and "One omnichannel composer" capability
- Uses "queue" (not "schedule"); Scraping, SEO, and Engagement unchanged

To restore v2:

    cp docs/store-content-versions/v2/AppsExplorer.jsx.bak src/platform/AppsExplorer.jsx
    cp docs/store-content-versions/v2/product-catalog.js.bak src/platform/product-catalog.js
    cp docs/store-content-versions/v2/apps-page.jsx.bak app/apps/page.jsx

    cp docs/store-content-versions/v2/app-store.module.css.bak src/platform/app-store.module.css
