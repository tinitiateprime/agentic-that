# AgenticThat Companion 2.6.1

This is a QA prerelease. Windows and macOS downloads are unsigned; macOS is not notarized.
The supported-OS owned-account validation matrix is still required before a production release.

## X posts: the Post button is always reached

When a post ended with hashtags, X opened its #hashtag suggestions, whose invisible backdrop covered the Post button,
so the click timed out and the post failed.

- Before clicking Post, the Companion closes X's #hashtag / @mention suggestions when they are showing.
- If something still covers the button, it uses X's own Ctrl+Enter (Cmd+Enter on macOS) shortcut, and only if the
  composer is still open after that, clicks the button directly. The post is submitted once; X's returned post ID still
  confirms it.

## Also in this release (website, already live)

- Social SEO can post straight to connected accounts (Post button).
- Private media is stored on Hetzner Object Storage; Companions download it through AgenticThat links, with no change
  needed on the Companion.

Automated validation covers the repository test suite; release CI builds the production website and verifies the
native Companion packages.

All desktop targets use the same implementation: Windows x64, macOS universal (Intel and Apple silicon), Linux x64 and
arm64.
