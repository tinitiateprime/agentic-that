# AgenticThat Companion 2.1.14

- Discovers every LinkedIn Page shown in the signed-in profile's **Manage** section and syncs the Page names to the publishing dashboard.
- Lets users select the personal LinkedIn profile, any managed Pages, or both as independent publishing destinations.
- Preserves separate post text and timing for each selected LinkedIn identity while keeping the existing personal-profile flow unchanged.
- Opens each selected Page's verified admin Page-posts surface directly, with a dashboard-and-**Page posts** fallback when LinkedIn redirects.
- Processes multiple destinations sequentially in the same saved LinkedIn session and keeps duplicate/pacing safeguards isolated per identity.
- Rejects stale or invalid Page selections before a post can reach LinkedIn.

This QA release is unsigned and intended for owned-account validation on Windows, macOS, and Linux. Reconnect each LinkedIn account once after upgrading so Companion can discover and sync its managed Pages.
