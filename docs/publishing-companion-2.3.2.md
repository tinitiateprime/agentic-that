# AgenticThat Companion 2.3.2

This is a QA prerelease. Windows and macOS downloads are unsigned; macOS is not notarized.
The supported-OS owned-account validation matrix is still required before a production release.

## Gemini writes the way it does when you ask it yourself

- **Asked plainly first**: Gemini gets the same master prompt and post, without being told up front that its answer
  goes into sections. That made it write short, plain posts. It now writes its full answer, as it does in Gemini
  itself, and a second message asks it to put its own posts into the sections word for word, without shortening.
- **No rewrite pass**: the "judge and rewrite" step from 2.3.1 is removed. When Gemini's first reply was an error, it
  rewrote that error into a short answer.
- **Waits for the real answer**: an answer counts as finished only when it has the sections it was asked for, so a
  pause or a status line is never read as the answer. Gemini's stop button can stay on screen after it finishes; that
  no longer delays reading.
- **Gemini's error replies** ("I encountered an error doing what you asked. Could you try again?") are recognised at
  once and asked again in the same chat, up to twice. If Gemini still can't answer, its card says so clearly.
- **Long thinking**: on "Extra thorough", Gemini can think for minutes before it starts writing. The Companion keeps
  waiting, up to six minutes, while Gemini shows it is working.

Thinking level "High · Extra thorough" stays on for every post.

Automated validation covers the repository test suite. Release CI also builds the production website and verifies
the native Companion packages. Live AI behavior depends on the providers' websites and account limits.

All desktop targets use the same implementation: Windows x64, macOS universal (Intel and Apple silicon), Linux x64 and
arm64.
