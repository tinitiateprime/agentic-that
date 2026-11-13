# AgenticThat Companion 2.3.1

This is a QA prerelease. Windows and macOS downloads are unsigned; macOS is not notarized.
The supported-OS owned-account validation matrix is still required before a production release.

## X and Reddit

Social SEO now writes for six apps: Instagram, Facebook, LinkedIn, YouTube, **X** (a post within 280 characters with
its hashtags, and a character count) and **Reddit** (a title, a discussion-style post and the subreddits to post in).

## Gemini writes its best

- **Extra thorough thinking**: before each post, the Companion sets Gemini's thinking level to "High · Extra thorough"
  (available on free plans). Signed-in Gemini otherwise defaults to "Low · Fast and efficient".
- **A second pass**: Gemini then judges its own answer against a 10/10 standard and rewrites it in the same chat. The
  rewrite is used only when it keeps every section and doesn't collapse; otherwise the first answer is kept.
- **Nothing invented**: chapter timestamps that an AI made up for a YouTube description are removed, since the AIs only
  see a picture or a few frames. Gemini's source chips are removed whatever the file is called.

## Plan limits shown clearly

- When an AI's own plan stops it, for example ChatGPT Free's "Get Plus for more uploads · Or wait 19 hours to upload
  again", its card says **Plan limit reached** with the app's own words, and that the other connected AIs still write
  the post. It shows in about 30 seconds instead of a general error after two minutes.
- Message limits are recognised the same way for every AI: ChatGPT ("You've hit the Free plan limit…"), Claude ("You
  are out of free messages until…", "5-hour limit reached", "Usage limit reached") and Gemini ("You've reached your
  limit…"). The Companion stops waiting as soon as the app shows it.
- The Companion's recent runs list shows "plan limit reached" for these runs.

## More reliable ChatGPT

- ChatGPT first shows a placeholder message box and swaps in the real one a few seconds later. The Companion now waits
  for the real box, and finds it again before each step.
- An unsent draft that ChatGPT restores is cleared before typing, so nothing from an earlier post mixes into a new one.

Automated validation covers the repository test suite, including the new rewrite, timestamp, chip and limit cases.
Release CI also builds the production website and verifies the native Companion packages. Live AI behavior depends
on the providers' websites and account limits.

All desktop targets use the same implementation: Windows x64, macOS universal (Intel and Apple silicon), Linux x64 and
arm64.
