# AgenticThat Companion 2.10.0

This is a QA prerelease. Windows and macOS QA downloads may be unsigned; macOS
may not be notarized.

## Social Manager inbox: LinkedIn comments and mentions

- When a company turns on a LinkedIn account in Social Manager → Inbox, the
  Companion that holds that account checks every 20 minutes for:
  - comments on the member's own posts and mentions of them, from their
    LinkedIn notifications;
  - comments on each Page they manage and mentions of those Pages, from each
    Page's admin Activity.
- The check is read-only. The Companion opens those pages in the account's own
  signed-in browser, reads the notification data LinkedIn sends them, and
  closes it. It never clicks, types, reacts, replies or sends anything.
  Reactions, reposts, visitor notes and "Suggested for you" posts are left out.
- It never interrupts a post: if the account is busy publishing, the check is
  skipped and runs again a little later.
- YouTube comment checks (2.9.0) are unchanged. Companions older than 2.10.0
  are never handed LinkedIn checks.

Validation: the collector was run against two signed-in LinkedIn accounts. On
a member's own profile it read 2 new comments from 2 other people (author,
words, the post, link to the comment); on a Page admin's account it read a
comment on one Page and a mention of another. Social Manager tests pass,
including a "Suggested for you" post that contains the word "mentioned" and is
correctly left out.
