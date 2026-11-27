# AgenticThat Companion 2.14.0

This is a QA prerelease. Windows and macOS QA downloads may be unsigned; macOS
may not be notarized.

## Social Manager inbox: Instagram comments and mentions

- When a company turns on an Instagram account in Social Manager → Inbox, the
  Companion that holds that account checks every 20 minutes for comments on
  its posts, replies to its comments and mentions.
- The check is read-only. The Companion opens instagram.com/notifications in
  the account's own signed-in browser, reads the activity data Instagram sends
  that page, and closes it. It never clicks, types, likes, replies or posts.
  Likes, follows, suggestions and Instagram's own notices are left out.
- It never interrupts a post: if the account is busy publishing, the check is
  skipped and runs again a little later.
- YouTube, LinkedIn, X and Facebook checks are unchanged. Companions older
  than 2.14.0 are never handed Instagram checks.

Validation: the collector was run against a signed-in Instagram account and
read a comment from another account (author, words, time, link to the
comment) in 2 seconds.
