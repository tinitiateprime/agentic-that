# AgenticThat Companion 2.7.0

This is a QA prerelease. Windows and macOS downloads are unsigned; macOS is not notarized.
The supported-OS owned-account validation matrix is still required before a production release.

## Faster, steadier posting

- **Several apps at once:** the Companion takes up to 5 workspace posts at a time, prepares them together (session
  check, media download) and posts them in one run, where different accounts post side by side. Each account still
  posts one post at a time. Total time is about the slowest post instead of the sum.
- **Closing on confirmation, not fixed waits:**
  - LinkedIn: a photo or text post finishes 2 seconds after LinkedIn confirms it (previously at least 90 + 15 + 5
    seconds). A video stays open for as long as LinkedIn shows "Uploading" or "Processing", then a short quiet
    moment. The extra hold after posting is now 0 (LINKEDIN_POST_HOLD_MS can still set one).
  - YouTube Community posts finish as soon as YouTube confirms the post (up to 20 seconds without its answer)
    instead of a fixed 5-second wait.
- **Covered buttons:** the final Post / Share click on Instagram and LinkedIn (and X since 2.6.1) clears suggestion
  lists that cover the button, retries, and only then clicks the button directly. A covered click never lands, so a post
  is submitted once.
- **Failures in plain words:** for example "Something on X's page covered the button the Companion needed to click",
  with the short technical detail kept at the end.

All per-post safeguards stay: execution leases refreshed while posting, one submission per post, cancellation and
"uncertain" handling.

Automated validation covers the repository test suite; release CI builds the production website and verifies the
native Companion packages.

All desktop targets use the same implementation: Windows x64, macOS universal (Intel and Apple silicon), Linux x64 and
arm64.
