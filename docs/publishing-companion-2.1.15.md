# AgenticThat Companion 2.1.15

- Fixed LinkedIn managed-Page discovery running before the asynchronous **Manage** card finished rendering.
- Added scoped discovery for LinkedIn layouts that expose public company links in **Manage** instead of direct admin URLs.
- Kept company-link discovery restricted to the **Manage** card so company mentions in the feed cannot become publishing destinations.
- Added regression coverage for public company links being converted into verified direct Page-admin posting URLs.

Reconnect each LinkedIn account once after upgrading so Companion refreshes and synchronizes its managed Pages.
