# AgenticThat Companion 2.14.2

This is a QA prerelease. Windows and macOS QA downloads may be unsigned; macOS
may not be notarized.

## Facebook comment checks work on more accounts, and explain failures

- Facebook names the data that carries comments differently for different
  accounts and posts. The Companion listened for one name only, so on some
  accounts every check failed ("Facebook didn't load the comments in time"),
  and on others some comments were missed. It now reads comment data under
  any of Facebook's names, and keeps only real comment objects.
- Live-update streams (which never finish) are skipped, no single response is
  waited on longer than 5 seconds, and a whole Facebook check stops after
  3½ minutes, well inside the Companion's job time.
- After three posts in a row with no comment data, the check stops early.
- When a check fails, the Companion now reports what it saw: which pages
  opened and the names of the data they loaded (never comments, cookies or
  passwords), so the cause can be found without access to that computer.

## Inbox

- A single failed check no longer shows as an error in Social Manager. It
  shows "The latest check didn't finish; trying again" and turns red only
  after 3 failed checks in a row, or straight away when the account needs
  signing in again.

Validation: on a signed-in Facebook profile the check found 3 comments in
100 seconds, including one on a reel that 2.14.1 missed because Facebook sent
it under a different data name.
