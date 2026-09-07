# AgenticThat Companion 2.1.13

- Fixed central publishing jobs with an exact time so the Companion executes them once they become due instead of incorrectly treating them as not ready.
- Fixed reusable schedule-template jobs so due occurrences enter the local publishing runner.
- Added independent exact-time or schedule-template controls for every uploader-selected destination in the Scheduler handoff.
- Preserved uploader-selected destinations as locked while allowing the Scheduler to control timing per account.
- Added regression coverage for separate destination times and due scheduled-job readiness.

This QA release is unsigned and intended for owned-account validation on Windows, macOS, and Linux. Scheduled jobs that failed before the Companion reached a platform are safe to retry after installing this version.
