# AgenticThat Companion 2.8.8

This is a QA prerelease. Windows and macOS QA downloads may be unsigned; macOS
may not be notarized.

## Social SEO no longer waits on the slowest AI

- An AI that refuses the whole video starts on the transcript and picture sheets
  straight away, while the other AI apps keep working.
- An AI that hasn't started writing real posts 5 minutes after receiving the video
  moves on to the transcript and picture sheets. A whole-video answer is limited
  to 10 minutes.
- An AI whose upload allowance or plan is used up is skipped, and its card shows
  the app's limit message. The other AI apps carry on.

Validation: all 216 publishing tests passed. The earlier 2.8.7 run showed the real
behaviour this release answers: Gemini refused a 130 MB video, ChatGPT took the
file but could not watch it, and Claude spent over 8 minutes reading still images
from it. The 2.8.8 changes were not tested live against ChatGPT, Claude or Gemini.
