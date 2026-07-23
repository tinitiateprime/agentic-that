# AgenticThat Publishing Companion extension

This Manifest V3 Chrome extension connects the AgenticThat publishing dashboard
to the Windows companion on `127.0.0.1:8792`. It requests no broad browsing
permission and never receives or stores social-network passwords.

Customers install the reviewed extension from the Chrome Web Store using the
button on `https://agentic-that.netlify.app/publishing`. They do not load this
folder or download the repository.

For local development only, run `npm run publishing:extension:open`, enable
Developer mode on the Chrome extensions page, choose **Load unpacked**, and
select this directory.

Build the review ZIP with `npm run publishing:extension:package`. Store listing
copy, permission explanations, and the submission checklist are in
`docs/chrome-web-store-listing.md`.

The production origin is intentionally restricted to
`https://agentic-that.netlify.app`. Add a specific origin to `manifest.json`
before moving the production dashboard to another domain.
