# AgenticThat Publishing Companion extension

This Manifest V3 Chrome extension connects the deployed AgenticThat dashboard
to the publishing companion running on `127.0.0.1:8792`. It does not receive or
store social-network passwords. Social account login remains manual in the
dedicated Chrome profile opened by the companion.

For development, open `chrome://extensions`, enable **Developer mode**, choose
**Load unpacked**, and select this directory. For customer distribution, publish
this same directory through the Chrome Web Store after completing store review.

The production dashboard origin is intentionally restricted to
`https://agenticthat.netlify.app`. Add an exact custom-domain match to
`manifest.json` before deploying the dashboard on another domain.
