# AgenticThat Companion 2.8.5

This is a QA prerelease. Windows and macOS QA downloads may be unsigned; macOS
may not be notarized.

## Reddit posts go to the account's own profile

Every Reddit post now goes to the posting account's own profile (u/<name>).
Any community saved on a job, including jobs created before this release, is
ignored. The website and the queue-runner composer no longer offer a community
field.

The Companion follows Reddit's own flow, verified live on reddit.com: Create,
Select Community, type `u/` into the picker's search box, choose the exact
"u/<name> - Your profile" item, confirm Reddit opened that profile's submit
page, then fill the title, media and body and click Post. If the picker
misbehaves, the Companion opens the same profile submit page directly and
verifies it before entering content.

When Reddit refuses profile posts for an account (Reddit answers
PROFILE_SUBREDDIT_NOEXIST, "that community doesn't exist"; common for new or
low-karma accounts), publishing stops with a plain explanation and nothing is
posted. Reddit's submit errors listed under the Post button are now reported
in plain words.

## Instagram

- Live tiles always fit a desktop-sized page. Previously, when a managed-Chrome
  tile (such as Reddit) was also live, an Instagram tile could stay at 100% and
  fall below Instagram's 768px breakpoint, showing its phone layout without the
  Create control.
- Create is found by its sidebar icon labelled New post, Create, Create new or
  Post (the sidebar is not inside a <nav> element). If a Create new menu opens,
  its Post item is chosen, never the sidebar icon that opened it.
- Crop, Original, Next, Select and Done clicks fall back to the element's own
  click when tiles resize mid-click or an overlay covers the control.

Validation: all 168 publishing tests passed and TypeScript passed for the
changed files. Instagram posting was validated live on two accounts. The Reddit
flow published a live post through the picker on r/test; profile posting on the
test account is refused by Reddit itself (account restriction).
