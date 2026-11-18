# AgenticThat Companion 2.8.7

This is a QA prerelease. Windows and macOS QA downloads may be unsigned; macOS
may not be notarized.

## Social SEO offers the whole video to each AI first

For a video post, each connected AI app (ChatGPT, Claude and Gemini) is now
offered the video file itself, using the person's own account and plan.

- An AI that takes the file and can watch it writes the posts from the real
  video. Its card shows Watched the whole video.
- An AI moves on to the transcript and picture sheets when it refuses the file,
  the upload fails or stalls, or it says it can't watch the video. Each AI is
  decided on its own.
- The transcript and picture sheets are only prepared when at least one AI needs
  them.
- A plan's usage limit is reported as a limit and does not start the fallback.
- Videos over 2 GB skip the file offer and use the transcript and picture sheets.
- The saved copy stays on this computer until the AI apps finish, and is deleted
  afterwards. An unused copy is deleted after one hour.

An older website or Companion keeps working: if the file can't be offered, the
transcript and picture sheets are used as before.

Validation: all 213 publishing tests passed, including simulated AI pages that
accept, refuse, ignore and remove a video. The flow was not tested live against
ChatGPT, Claude or Gemini, so their real upload pages and limits are unconfirmed.
