# AgenticThat Companion 2.9.0

This is a QA prerelease. Windows and macOS QA downloads may be unsigned; macOS
may not be notarized.

## Social Manager inbox: YouTube comments

- When a company turns on **YouTube comments** for one of its YouTube accounts
  in Social Manager → Inbox, the Companion that holds that account checks for
  new comments every 20 minutes and sends them to the inbox.
- The check is read-only. The Companion opens YouTube Studio's comments page
  (newest first, only comments the channel hasn't answered yet) in the
  account's own signed-in browser, reads the comments data YouTube sends that
  page, and closes it. It never clicks, types, likes, replies or sends
  anything. The channel's own comments are left out.
- It never interrupts a post: if the account is busy publishing, the check is
  skipped and runs again a little later.
- Comments answered on YouTube drop out of Studio's "unanswered" list, and the
  inbox then marks them Done by itself.
- Companions older than 2.9.0 are never handed these checks.

Validation: the collector was run against a signed-in YouTube Studio on a
test channel and read 4 comments from 2 other accounts (author, text, video,
link to the comment) in under 8 seconds, leaving out the channel's own 3
comments. 36 Social Manager tests pass, including the YouTube Studio data
reader and the checks on what the Companion reports back.
