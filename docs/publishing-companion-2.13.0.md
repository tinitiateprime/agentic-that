# AgenticThat Companion 2.13.0

This is a QA prerelease. Windows and macOS QA downloads may be unsigned; macOS
may not be notarized.

## Social Manager inbox: Facebook photo posts

- Facebook comment checks now read the latest 6 photo posts as well as the
  latest 6 reels. A comment on a post with several photos is sent once.
- Facebook's check status now says how many comments it read (it said
  "replies and mentions").
- The check is still read-only: it opens the profile's Reels and Photos tabs
  and each reel and photo in the account's own signed-in browser, reads the
  comment data Facebook sends, and closes it.

Validation: run against a signed-in Facebook profile with 6 reels and 6 photo
posts. It found the reel comment and the photo-post comment from another
account (author, words, time, link to the comment) in 43 seconds, and the
photo-post comment once although it shows on two photos of the same post.

Not yet covered on Facebook: text-only posts and posts older than the latest
6 reels and 6 photos.
