# Store — v5 (2026-09-27)

v4 design re-applied on top of origin/main @ bd343ea. Current live version.

Changes from v4:
- Merged upstream: new "AI Websites" category (AI Website Studio) with Globe icon, new capability icons, "·" split fix
- Upstream's AI Phone Front Desk (messaging, live) appears as a channel inside the Messaging panel
- Messaging panel description mentions the AI phone front desk
- /apps metadata description mentions AI websites

Note: v1–v4 were based on the pre-pull code and should not be restored over this version without re-merging.

To restore v5:

    cp docs/store-content-versions/v5/AppsExplorer.jsx.bak src/platform/AppsExplorer.jsx
    cp docs/store-content-versions/v5/product-catalog.js.bak src/platform/product-catalog.js
    cp docs/store-content-versions/v5/apps-page.jsx.bak app/apps/page.jsx
    cp docs/store-content-versions/v5/app-store.module.css.bak src/platform/app-store.module.css
