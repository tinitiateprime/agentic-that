# AgenticThat Companion 2.14.3

This is a QA prerelease. Windows and macOS QA downloads may be unsigned; macOS
may not be notarized.

## Facebook: a profile with few posts no longer fails its check

- A check on a profile with no reels and one photo failed every time: that
  photo (likely a profile picture) opens without any separate comment data,
  and as the only post checked it counted as "everything failed".
- The Companion now also reads the comment data Facebook builds into a page
  itself, and a photo that opens with no comment data at all counts as
  "no comments" instead of a failure. Reels still report a failure when their
  comment data doesn't arrive, and what each page loaded is still recorded.

Found from the failure report a 2.14.2 Companion sent for that profile (0
reels, 1 photo, no comment data). Checked on another Facebook profile that
already worked: still 3 comments found, in 95 seconds.
