# AgenticThat Companion 1.9.0 release notes

This release hardens Companion as the local execution engine for the AgenticThat
SaaS control plane. The browser extension remains optional.

## Security and control plane

- Pairing now uses a five-minute, one-time challenge. The website never receives
  the permanent Companion credential.
- The permanent pairing credential, scrape queues, results, and social session
  snapshots are encrypted locally from an operating-system-protected key.
- Packaged Companion fails closed if OS secure storage is unavailable.
- Revoked devices delete their local pairing when the control plane rejects it.
- The website enforces a minimum Companion version before leasing new jobs.

## Recovery and observability

- Publishing data uses synced atomic writes and a last-known-good backup.
- Queued and interrupted Instagram/Facebook scrape work survives restart.
- Safe pre-submit publishing work requeues after interruption; final-action
  ambiguity is terminal `UNCERTAIN`, blocks automatic retry, and requires
  platform verification.
- Heartbeats report runtime, updater, version, platform, architecture, secure
  storage, account-login health, last error, and last-seen time.
- A local watchdog restarts failed idle services, and sleep/resume triggers an
  immediate health and workspace-job check.
- Installed Windows builds automatically download applicable GitHub releases.

## Release verification

Release tags require passing automated tests, the production web build, packaged
Companion smoke test, and SHA-256 checksum generation. The 1.9.0 direct-download
installer is currently unsigned and may trigger a Windows SmartScreen warning.
Owned-account validation and code signing remain recommended before describing
the release as fully production-validated. Scheduling remains paused.
