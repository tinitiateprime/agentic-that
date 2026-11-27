# AgenticThat Companion 2.13.1

This is a QA prerelease. Windows and macOS QA downloads may be unsigned; macOS
may not be notarized.

## Facebook comments on photo posts are no longer missed

- Facebook loads a photo post's data twice: the first response carries no
  comments and a later one does. 2.13.0 read only the first, so a photo-post
  comment could be missed depending on timing (the 2.13.0 check on a test
  profile found 0 where there was 1).
- The Companion now reads every response for each reel and photo post for a
  few seconds after the first arrives. A Facebook check takes about 85
  seconds for 6 reels and 6 photo posts.

Validation: two runs in a row against a signed-in Facebook profile each found
both comments from another account, on a reel and on a photo post.
