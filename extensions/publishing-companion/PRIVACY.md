# AgenticThat Companion extension privacy policy

The extension connects the AgenticThat publishing dashboard at
`https://agentic-that.netlify.app`, or one HTTPS origin explicitly approved by
the user, to AgenticThat Companion on `http://127.0.0.1:8792`.

## Data handled for the extension's single purpose

To provide the local publishing bridge, the extension handles:

- user-provided post text, selected images or videos, and publishing actions;
- AgenticThat dashboard authentication information forwarded to the local
  companion; and
- locally returned workspace and connected-account identifiers used by the
  publishing dashboard.

This information is transferred only between the AgenticThat dashboard and the
companion running on the same computer. The extension does not retain publishing
content. It stores only the additional dashboard origins explicitly trusted by
the user.

## Social credentials and local storage

The extension does not receive or store social-network passwords, verification
codes, or authentication cookies. Users enter social credentials directly on
each social network's own Chrome page.

Publishing metadata, uploaded media, and saved browser sessions are
stored locally by the companion. Users can remove this local data from the
companion's data directory.

## Sharing and limited use

AgenticThat does not sell extension data, use it for advertising, or transfer it
for purposes unrelated to the extension's single purpose. Use of information
handled by this extension complies with the Chrome Web Store User Data Policy,
including the Limited Use requirements.

The extension always has access only to the production dashboard and local
Companion. An additional HTTPS origin is requested only after the user enters
and approves that exact origin in the popup.
