# AgenticThat Companion 2.8.2

This is a QA prerelease. Live Reddit profile posting and the production validation
matrix remain outstanding. Windows and macOS QA downloads may be unsigned;
macOS may not be notarized.

Reddit publishing now follows the website's visible flow: **Create > Select
Community > search the exact community or profile > select it > fill the post >
Post**. For My profile, the Companion resolves the executing account's username
and searches `u/username`. It selects the exact handle rather than the first or
a partial search result, then verifies Reddit opened that destination's submit
page before entering content. Profile destinations use `/user/username/submit/`.

The Companion checks the destination again before submitting. If the body
editor does not appear for a nonempty caption, it stops instead of silently
omitting the text. Media upload completion, post confirmation, and the existing
immediate-removal check remain in place.

Validation: all 161 publishing tests passed, TypeScript passed, and the Companion
runtime built successfully. Browser tests against a simulated Reddit page cover
the picker with delayed and similar search results, a wrong destination, and
text, image, and video publishing with exact content and one Post click. These
tests do not establish that posting works on a live Reddit account.

The full local repository suite also passed: 583 passed, 3 skipped, zero failures.
Both production dependency audits reported zero vulnerabilities.
