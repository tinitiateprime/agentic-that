# AgenticThat Companion 2.8.1

This is a QA prerelease. Live profile posting and native installer validation remain outstanding.
Windows and macOS QA downloads may be unsigned; macOS may not be notarized.

Reddit destinations now accept a community (`r/marketing`) or the connected account's
profile (`u/Creative-Alarm-3814`). The Social posts composer, post editor, and Social SEO
posting panel each include **My profile**. This saves `u/me` in the queued job and resolves
it from the logged-in Reddit account when the Companion executes the job. With multiple
accounts selected, each account posts to its own profile.

Profile usernames accept letters, numbers, underscores and hyphens, with 3–20 characters.
Explicit profile destinations are normalized to `u_<username>` and opened at
`https://www.reddit.com/r/u_<username>/submit/`. A mismatch with the executing account
stops publishing before the form is filled. Community destinations keep their existing
validation. Existing API-connected accounts resolve My profile from their connection.

The existing immediate-removal check remains in the publisher: an accepted post that is
removed shortly afterward reports the removal reason. Profile posts can still be subject
to Reddit's site-wide filters, account restrictions, rate limits, and media restrictions.

Validation: all 155 publishing tests passed, both production dependency audits reported
zero vulnerabilities, and the Companion runtime built successfully.

Automated coverage checks destination validation across intake and schema, profile URL
construction, per-account resolution, mismatched accounts, legacy API payloads, and the
existing Reddit confirmation and removal-message helpers. Live text, photo, and video
profile posts must still be checked on an owned test account before promoting this release to production.
