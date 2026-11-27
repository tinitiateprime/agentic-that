# AgenticThat Companion 2.11.0

This is a QA prerelease. Windows and macOS QA downloads may be unsigned; macOS
may not be notarized.

## Social Manager inbox: X replies and mentions

- When a company turns on an X account in Social Manager → Inbox, the
  Companion that holds that account checks every 20 minutes for replies to
  its posts, mentions and quotes.
- The check is read-only. The Companion opens x.com's Mentions tab in the
  account's own signed-in browser, reads the notifications data X sends that
  page, and closes it. It never clicks, types, likes, replies or posts.
  Likes, follows and reposts are left out.
- It never interrupts a post: if the account is busy publishing, the check is
  skipped and runs again a little later.
- YouTube (2.9.0) and LinkedIn (2.10.0) checks are unchanged. Companions older
  than 2.11.0 are never handed X checks.

Validation: the collector was run against a signed-in X account and read a
reply from another account (author, words, link to the post) in 9 seconds.
Social Manager tests pass, including wrapped posts, duplicates and the likes
and follows that are left out.
