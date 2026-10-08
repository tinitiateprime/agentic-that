# AgenticThat Companion 2.1.32

LinkedIn managed Page publishing clicks Page posts from the selected Page's
Dashboard, including sidebars rendered as text controls or tabs. If the click
is ignored, Companion opens Page posts using the verified admin Page ID.
Public slugs that resolve to numeric IDs must match the visible Page name.
Links or navigation to another administered Page stop before publishing.

Companion waits for the publishing controls to render and opens either Start
a post, Create a post, or Create → Create a post. The final Post action uses
a trusted browser click and records submission once. Success requires a provider
acceptance response or confirmation notice; a closed composer alone cannot mark
the post as published. Media uploads retain their completion safety window.

Browser regression tests cover the Manage → Dashboard → Page posts → Create
flow, delayed content, numeric redirects, ignored sidebar clicks, incorrect
Page destinations, rejected or unconfirmed submissions, and personal publishing.
Tests use intercepted LinkedIn pages; live account delivery is a separate check.

The publisher runs inside Companion. Rebuild or install this Companion version
to use the fix; updating the website alone does not update an installed app.

Release dependencies include patched Sharp 0.35.5 and Next.js 15.5.27, with
overrides for vulnerable transitive packages. The macOS universal build uses
matching Sharp 0.35.5 and libvips 1.3.4 binaries for Intel and Apple Silicon.
