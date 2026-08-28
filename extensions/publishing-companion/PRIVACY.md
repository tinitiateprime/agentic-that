# AgenticThat Companion privacy policy

The extension connects the AgenticThat publishing dashboard at
`https://agentic-that.netlify.app` (or an HTTPS origin the user explicitly
approves in the extension popup) to the AgenticThat Companion on
`http://127.0.0.1:8792`.

## Data handled for the extension's single purpose

To provide the local publishing and scraping bridge, the extension handles:

- user-provided post text, selected images or videos, schedules, publishing
  actions, scraping queries, and public scraping results;
- AgenticThat dashboard authentication information forwarded to the local
  companion; and
- locally returned workspace and connected-account identifiers used by the
  publishing dashboard.

This information is transferred only between the AgenticThat dashboard and the
companion running on the same computer. The extension does not retain it or send
it to AgenticThat servers.

## Social credentials and local storage

The extension does not receive or store social-network passwords, verification
codes, or authentication cookies. Users enter social credentials directly on
each social network's own Chrome page.

Publishing metadata, uploaded media, schedules, saved browser sessions, and
temporary scraping jobs are stored locally by Companion. Completed scraping
results are also saved to the authenticated AgenticThat workspace selected by
the user.

## Sharing and limited use

AgenticThat does not sell extension data, use it for advertising, or transfer it
for purposes unrelated to the extension's single purpose. Use of information
handled by this extension complies with the Chrome Web Store User Data Policy,
including the Limited Use requirements.

The extension requests permanent access only to the primary AgenticThat
dashboard and the local Companion address. Any additional HTTPS dashboard
origin requires a separate user approval and can be removed at any time.
