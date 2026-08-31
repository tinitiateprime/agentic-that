# Production pilot readiness

Snapshot: code preparation complete without Azure credentials. “Done” means
implemented and locally verified; it does not mean Azure or a social platform
has been proven in production.

## DONE

- PostgreSQL/Supabase store parity for accounts, encrypted-profile metadata,
  login sessions, publishing jobs/attempts, account locks, scraping jobs,
  events, and migration state.
- Atomic `FOR UPDATE SKIP LOCKED` claims, account serialization, leases,
  monotonically increasing fencing tokens, guarded heartbeats/completion,
  idempotency, stale-job quarantine, and `UNCERTAIN` preservation.
- Explicit production migration and optional PostgreSQL integration test.
- Azure-independent storage interface covering profiles, media, screenshots,
  scraping results, and artifacts.
- AES-256-GCM encrypted profile archives with a random data key per archive,
  RSA-OAEP-256 Key Vault envelope wrapping, checksum verification, workspace and
  account ownership metadata, Blob ETag conditional writes, version metadata,
  cleanup, and Blob previous-version retention configuration.
- Final-action fencing for Instagram, Facebook, X, LinkedIn, and YouTube;
  ambiguous results are never blindly retried.
- Authenticated, workspace-forcing website bridge and audited manual resolution
  of `UNCERTAIN` as published/failed.
- Instagram/Facebook scraping job path isolated from publishing profiles.
- Authenticated website scraping bridge with server-forced workspace identity;
  the browser never receives the automation service credential.
- Bounded workers, timeouts, non-overlapping heartbeat calls, drain endpoint,
  separately bounded interactive-login browsers, SIGTERM/SIGINT lifecycle,
  dynamic database readiness, Blob privacy and Key Vault crypto startup probes,
  metrics, structured redacted logs, and startup cleanup.
- Fixed Node/Playwright container bases, bundled Chromium, non-root processes,
  immutable-image deployment workflows, Bicep infrastructure, managed identity
  RBAC, Key Vault references, private Blob containers, diagnostics, alerts, and
  automatic restoration of the previous image after a failed rollout.
- Every publishing/login/scraping flag defaults to off. Companion files and its
  existing workflows were not replaced.

## PARTIAL

- Worker cancellation uses abort signals and configured time limits. Some
  upstream scraper/browser calls only observe cancellation at safe boundaries;
  Azure memory behavior still needs a staging soak test.
- Website-to-automation authentication uses a strong static secret plus HTTPS
  and an IP restriction script. The configuration boundary permits later Azure
  identity/private networking, but managed-identity request authentication is
  not part of this single-instance pilot.
- Azure Monitor receives Web App logs/metrics and optional HTTP 5xx alerts.
  Job-state metrics are exposed on the authenticated `/v1/admin/metrics`
  endpoint; production alert thresholds for queue age, `UNCERTAIN`, lease loss,
  and scraping failures must be tuned after staging traffic exists.
- Interactive browser login retains the existing bounded frame/input protocol.
  Its real remote UX, reconnect behavior, 2FA challenges, and idle resource use
  require staging browsers and accounts.

## BLOCKED — REQUIRES AZURE/SUPABASE

- Deploy the compiled template against the target subscription and verify each
  Azure resource provider/API version in that subscription.
- Managed-identity Blob and Key Vault round trip, ETag conflict, Blob previous
  version restore, app restart/profile restoration, access restrictions, CPU and
  memory behavior, alert delivery, and graceful App Service replacement.
- Run PostgreSQL integration tests against the real staging Supabase connection.
- Configure and execute a real backup/restore drill.
- Cloudflare DNS, Full (strict) TLS, WAF/rate limits, and custom domain.

## BLOCKED — REQUIRES REAL TEST ACCOUNTS

- Login, 2FA/challenge, expiry/reconnect, publishing, scheduling, evidence
  capture, platform post URL/ID extraction, and UI-change validation for
  Instagram, Facebook, X, LinkedIn, and YouTube.
- Instagram/Facebook scraping validation under the intended account/network
  policy and rate limits.
- Deliberate safe validation of `LOGIN_REQUIRED` and an ambiguous/`UNCERTAIN`
  result. No test should publish unintended content.

## Tests implemented and run

On 2026-08-31:

- `npm run server-architecture:build` — passed.
- `npm run test:server-architecture` — 75 tests discovered, 74 passed, 1 skipped,
  0 failed in the ordinary no-database run. The skipped test requires
  `TEST_AUTOMATION_POSTGRES_URL`.
- PostgreSQL 18.6 temporary-cluster validation — migration passed twice,
  least-privilege runtime-role checks passed, and the normally skipped atomic
  claim/fencing/lease-recovery/`UNCERTAIN` integration test passed.
- `npm run test:publishing` — 60 passed, 0 failed; Companion validation/runtime
  build remained intact.
- `npm run test:rbac` — 20 passed, 0 failed.
- `NEXT_STANDALONE=true npm run build` — passed, including the production
  website health, private drain, publishing, and scraping bridge routes.
- Current Bicep CLI compilation, workflow YAML parsing, shell syntax, and
  `git diff --check` — passed.
- `npm audit --omit=dev --audit-level=high` — 0 vulnerabilities.

The suite covers safe defaults/config fail-closed behavior, SQLite migration,
job/account locking, platform final-action guards, scheduling, fencing, private
artifacts, workspace/auth isolation, encrypted profile round trip/tampering,
profile version conflicts and cleanup, worker concurrency, scraping isolation,
and manual `UNCERTAIN` resolution. CI supplies PostgreSQL 17 and runs the skipped
integration case.

Container builds and a real Azure deployment are not claimed as passed on this
machine because no Docker daemon or Azure account is available. GitHub CI is
configured to perform those checks before deployment.

## Risks to track

- Social websites change without notice; DOM-based automation must remain
  feature-flagged and platform-by-platform.
- App Service has finite browser memory and shutdown time. Start with one live
  publishing worker and one app instance; measure before increasing either.
- A final click followed by network/process failure is inherently ambiguous.
  `UNCERTAIN` and human reconciliation are permanent safety requirements.
- Browser profiles are credentials. Limit operators, monitor Key Vault unwraps,
  define retention/deletion policy, and never reuse customer profiles in public
  scraping.
- Website and automation database owners must remain migration-only secrets;
  runtime apps should use least-privilege roles.
- A Blob profile save can succeed immediately before its database metadata
  update fails. Version checks deliberately fail closed in that case; recovery
  requires inspecting the Blob version and database record instead of forcing
  an overwrite.
- App Service possible outbound IPs can expand after plan or networking
  changes. Re-run the automation access-restriction script and verify the deep
  health check after any such change.

The exact deployment and validation sequence is in
[`deploy/azure/README.md`](../deploy/azure/README.md).
