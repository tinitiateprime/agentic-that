# Store — v4 (2026-09-27)

Unified single theme (AgenticThat gold + neutral surfaces). Current live version.

Changes from v3:
- Messaging and Publishing show only their omnichannel panel; individual channel cards are removed from browse view
  (channels are links inside each panel; searching still lists individual apps)
- One gold theme for every section icon, chip, button, and hover state; platform logos are the only other colour
- Header is a framed hero with a soft gold glow and dot pattern
- Section headings show an app count
- Cards: gold top bar slides in on hover, neutral logo tiles, gold "View details" button
- "Coming soon" tiles use a dashed outline and muted logos

To restore v4:

    cp docs/store-content-versions/v4/AppsExplorer.jsx.bak src/platform/AppsExplorer.jsx
    cp docs/store-content-versions/v4/product-catalog.js.bak src/platform/product-catalog.js
    cp docs/store-content-versions/v4/apps-page.jsx.bak app/apps/page.jsx
    cp docs/store-content-versions/v4/app-store.module.css.bak src/platform/app-store.module.css
