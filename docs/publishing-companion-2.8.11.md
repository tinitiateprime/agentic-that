# AgenticThat Companion 2.8.11

This is a QA prerelease. Windows and macOS QA downloads may be unsigned; macOS
may not be notarized.

## ChatGPT: the post image is attached once and sent straight away

- ChatGPT now shows attached pictures as tiles rather than plain thumbnails, so
  the Companion didn't see that an upload had worked. It tried the next upload
  button, and the next, and ChatGPT ended up with the same image up to five
  times. A picture now counts as attached when the app shows an image
  thumbnail, a tile painted with the picture, or a "Remove file" button beside
  it, and the first upload that works ends the attempts.
- After attaching, the Companion waited the full two minutes because it didn't
  recognise ChatGPT's send button. A greyed-out send button (an upload still
  finishing) is still waited for; when no send button can be found at all,
  Enter sends the message after 10 seconds.
- The Companion's AI log now records what it saw when an upload isn't
  recognised, and the send button's state before sending, so a future change
  on ChatGPT's page can be diagnosed from the log.

Validation: all 216 publishing tests and all 26 AI tests passed, including a new
real-browser check that a background-image tile, a "Remove file" button and an
image thumbnail are each counted as one attachment and an avatar is not. The log
of the 24 November runs showed the cause (every upload logged "no thumbnail",
and sending waited 2 minutes before Enter worked). Not yet tried against the
live ChatGPT page.
