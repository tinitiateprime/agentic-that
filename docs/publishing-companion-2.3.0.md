# AgenticThat Companion 2.3.0

This is a QA prerelease. Windows and macOS downloads are unsigned; macOS is not notarized.
The supported-OS owned-account validation matrix is still required before a production release.

## Social SEO with your own ChatGPT, Claude and Gemini

Social SEO no longer downloads a local AI. Log in once to ChatGPT, Claude or Gemini in the Companion, and every AI
you connect writes its own ready-to-post caption, hashtags and alt text for Instagram, Facebook, LinkedIn and YouTube.

- **Your own logins**: each AI opens in its own Chrome or Edge profile, so Google, Microsoft, Apple or email sign-in
  works, and the login is remembered. Free plans work, with their own usage limits.
- **Hidden while working**: the AI browsers stay off screen and off the Windows taskbar, and close as soon as their
  answer is ready. A window only comes forward when an AI needs you to log in or confirm you are human; the work then
  continues by itself.
- **New "Social SEO" view** in the Companion: each AI's step (opening, uploading your post, sending, writing), a live
  timer, "needs you" with a button to show its window, and recent runs.
- **Reliable on the live sites**: attaching is proven by a thumbnail before sending, sending is repeated until the
  message leaves the box, and answers are cleaned (Instagram's 5-hashtag limit, no source chips or repeated tags).
- **Not run twice**: an AI that already answered a post is not asked again unless you choose "Write again".

## Looks like AgenticThat

- The Keystone @ logo on the app, taskbar, tray, installer and Microsoft Store tiles, and the AgenticThat gold and ink
  colors throughout the Companion.
- Real Instagram, Facebook, YouTube, X, Reddit and LinkedIn logos in publishing and scraping.

Automated validation covers the repository test suite, Social SEO and AI response parsing, authenticated routes,
split UTF-8 streaming and interrupted connections. Release CI also builds the production website and verifies
the native Companion packages. Live AI behavior depends on the providers' websites and account limits.

All desktop targets use the same implementation: Windows x64, macOS universal (Intel and Apple silicon), Linux x64 and
arm64.
