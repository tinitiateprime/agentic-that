# Store — v3 (2026-09-27)

"Polished marketplace" look and feel on top of the v2 copy. Current live version.

Changes from v2 (layout/style only; catalog copy unchanged):
- Featured strip under the search: "Omnichannel publishing" and "Omnichannel messaging" cards with channel logos, linking to their sections
- Grid fills the page width (auto-fill, min 300px cards) instead of a fixed 2-column layout
- Cards: accent top bar, tinted logo tile, status pill under the app name (names no longer truncated), capability chips wrap above a filled "View details" button
- "Coming soon" apps (SEO, Post engagement) render as compact tiles without the action row
- Distinct neutral style for "Access required"

To restore v3:

    cp docs/store-content-versions/v3/AppsExplorer.jsx.bak src/platform/AppsExplorer.jsx
    cp docs/store-content-versions/v3/product-catalog.js.bak src/platform/product-catalog.js
    cp docs/store-content-versions/v3/apps-page.jsx.bak app/apps/page.jsx
    cp docs/store-content-versions/v3/app-store.module.css.bak src/platform/app-store.module.css
