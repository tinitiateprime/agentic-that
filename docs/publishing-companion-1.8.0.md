# AgenticThat Companion 1.8.0 release notes

This release moves the current `main` application onto a unified Companion
instead of extending the older divergent 1.7.x release branch.

## Reliability changes

- The production AgenticThat dashboard opens inside Companion by default, so a
  separate extension install is no longer required.
- X and YouTube normal login uses a dedicated external Chrome/Edge profile;
  provider-bound profiles survive restart and are verified before reuse.
- Instagram and Facebook share one scrape slot and yield to active publishing,
  preventing simultaneous browsers from starving each other.
- Range input rejects impossible calendar dates. Range scans continue past the
  requested row count until the lower boundary is observed or the scan budget
  is exhausted.
- Range diagnostics distinguish complete, incomplete, and undated coverage.
  Incomplete empty scans return a partial result instead of a false clean zero.
- The optional extension supports an explicitly trusted self-hosted origin,
  retryable loopback health checks, and restricted API/media proxy paths.
- Publishing and Telegram scheduling are paused without deleting historical
  stored records.

## Verification required before public promotion

- Run the automated publishing, Instagram, Facebook, TypeScript, Telegram, and
  production website builds.
- Smoke-test the packaged Windows application and health endpoint.
- With owned test accounts, verify one image/video/text publish per compatible
  platform, X/YouTube restart persistence, provider 2FA, cancellation, and an
  intentionally interrupted final action.
- Compare a recent and a deep date-range scrape against the visible source UI.
  Automated tests validate contracts and parsers but cannot certify live
  third-party selectors without test accounts.
