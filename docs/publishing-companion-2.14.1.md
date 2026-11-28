# AgenticThat Companion 2.14.1

This is a QA prerelease. Windows and macOS QA downloads may be unsigned; macOS
may not be notarized.

## New LinkedIn and X comments are no longer missed

- **LinkedIn** now puts its newest notifications only on the page itself, not
  in the notification data the Companion read, so new comments were missed
  (checks kept finding only older ones). The Companion now reads the
  notification cards on the page as well as the data, and one comment found
  by both is sent once.
- **X**'s Mentions tab leaves out some replies in a thread. The Companion now
  reads the All tab and keeps only replies, mentions and quotes, and reads
  every notifications response X sends (X can send a full one and an empty
  one).
- Both checks are still read-only.

Validation: on a signed-in LinkedIn profile the check now finds a comment
posted 17 hours earlier that 2.14.0 kept missing, plus the two older ones
(which the inbox already had and does not add again). On a signed-in X
account it finds 3 replies where 2.14.0 found 1, the same in two runs.
