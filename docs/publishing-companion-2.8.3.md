# AgenticThat Companion 2.8.3

This is a QA prerelease. Live Reddit and Instagram posting and the production
validation matrix remain outstanding. Windows and macOS QA downloads may be
unsigned; macOS may not be notarized.

## Reddit profile selection

The Companion clicks the community picker's search input and types only `u/`.
It then selects the exact profile of the logged-in account, whose username is
resolved from the active Reddit session. No fixed profile name is used. The
destination is verified before entering content and again before submission.

Post must be enabled before the Companion clicks it. If it remains disabled,
publishing stops without clicking or marking the job as submitted. Existing
media-upload completion, post confirmation, and immediate-removal checks remain.

## Instagram alternate Create entry

When the usual Create control is absent, the Companion also recognizes the
alternate Create new icon and selects Post from its menu. An already-open
Create new menu is used without clicking its trigger again. Menu items are
preferred over unrelated Post buttons.

Composer detection now requires the exact Create new post heading or a usable
composer signal; the combined Create new / Post menu text and a hidden dialog's
file input no longer make the Companion report the composer as ready. The
remaining Instagram upload, caption, and Share flow is unchanged.

Validation: all 165 publishing tests passed, TypeScript passed, and the Companion
runtime built successfully. Simulated browser coverage includes different Reddit
account names, text/image/video posts, disabled Post controls, both Instagram
Create layouts, and an already-open menu. Live posting must still be validated
on owned accounts before production promotion.

The full local repository suite passed with 587 passed, 3 skipped, and zero
failures. Both production dependency audits reported zero vulnerabilities.
