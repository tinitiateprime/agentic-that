# AgenticThat Companion extension

This Manifest V3 Chrome extension connects AgenticThat publishing and scraping
to the Windows Companion on `127.0.0.1:8792`. It never receives or stores
social-network passwords.

Customers install the reviewed extension from the Chrome Web Store using the
button on `https://agentic-that.netlify.app/publishing`. They do not load this
folder or download the repository.

For local development only, run `npm run publishing:extension:open`, enable
Developer mode on the Chrome extensions page, choose **Load unpacked**, and
select this directory.

Build the review ZIP with `npm run publishing:extension:package`. Store listing
copy, permission explanations, and the submission checklist are in
`docs/chrome-web-store-listing.md`.

`https://agentic-that.netlify.app` is trusted by default. For a custom domain or
temporary HTTPS tunnel, open the extension, enter the exact website origin, and
approve it. The extension requests access only to that user-approved origin and
can remove the permission again from the same popup.
