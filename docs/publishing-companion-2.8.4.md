# AgenticThat Companion 2.8.4

This is a QA prerelease. Windows and macOS QA downloads may be unsigned; macOS
may not be notarized.

## Instagram Create on icons-only sidebars

When no Create, New post or Create new control can be found by name (for
example an icons-only sidebar with a different label or another language), the
Companion now tries the sidebar's remaining icons. Icons that link to known
pages (Home, Reels, Messages, Explore, Notifications, Profile) are skipped. If an
icon navigates away, the Companion returns and tries the next one. It stops as
soon as the post composer opens, or when a Create new menu opens and Post is
selected from it. Accounts whose Create control is already recognized are
unchanged.

Validation: all 166 publishing tests passed, including a simulated
icons-only sidebar with no Create label, and TypeScript passed for the changed
files. Live posting on the affected account must still be validated.
