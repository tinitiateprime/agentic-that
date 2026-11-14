# AgenticThat Companion 2.5.1

This is a QA prerelease. Windows and macOS downloads are unsigned; macOS is not notarized.
The supported-OS owned-account validation matrix is still required before a production release.

## Group Manager: adding and removing people in Messenger and Instagram

2.5.0 could report people as added or removed in Messenger and Instagram without the change really happening.

- Adding and removing now use each app's real member list: Messenger's Chat members → Member settings → Remove
  member, and Add → tick the person → Add people; Instagram's chat details → Member settings → Remove from group, and
  Add people → tick the person → Next.
- A person counts as added or removed only after the Companion sees the change in the member list; otherwise the
  group shows "Couldn't remove" or "Failed" with the reason, and Try again repeats it.
- Someone who was in the group when it was made, then removed, is added back properly (the Companion no longer
  assumes they are still in it).

Validated on the real apps with test accounts: create, message, add, remove and add again in both Messenger and
Instagram. Automated validation covers the repository test suite; release CI builds the production website and
verifies the native Companion packages.

All desktop targets use the same implementation: Windows x64, macOS universal (Intel and Apple silicon), Linux x64 and
arm64.
