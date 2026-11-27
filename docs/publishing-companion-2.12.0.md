# AgenticThat Companion 2.12.0

This is a QA prerelease. Windows and macOS QA downloads may be unsigned; macOS
may not be notarized.

## Social Manager inbox: Facebook comments

- When a company turns on a Facebook account in Social Manager → Inbox, the
  Companion that holds that account checks its latest 6 reels every 20
  minutes and sends new comments and replies to the inbox.
- Facebook often sends no notification for a comment (especially from new
  accounts), so the Companion reads the comments Facebook sends with each
  reel's own page. The account's own replies are left out.
- The check is read-only. It opens the profile's Reels tab and each reel in
  the account's own signed-in browser, reads the data, and closes it. It never
  clicks, types, reacts, replies or posts.
- It never interrupts a post: if the account is busy publishing, the check is
  skipped and runs again a little later.
- YouTube, LinkedIn and X checks are unchanged. Companions older than 2.12.0
  are never handed Facebook checks.

Validation: the collector was run against a signed-in Facebook profile with 6
reels. It found the one comment from another account (author, words, time,
link to that comment) in 23 seconds; Facebook had sent no notification for it.
