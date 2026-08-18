# Centralized Authentication and RBAC

Last updated: 18 August 2026

## Status

The centralized authentication and RBAC implementation is present in this branch. PostgreSQL is the production authority for users, workspaces, self-service roles, trial/payment entitlements, billing status, sessions, and audit events. WhatsApp, Telegram, Publishing, Instagram scraping, and Facebook scraping now resolve access from the same AgenticThat identity.

The production migration has **not** been applied by this change. A read-only migration dry-run was completed against the currently configured stores; its results are recorded in [Migration dry-run](#migration-dry-run).

The rollout remains controlled by `RBAC_ENFORCEMENT_MODE=shadow|enforce`. Start in `shadow`, validate mappings and grants in Admin Center, and switch all deployments to `enforce` only after the review queue is resolved.

## Architecture

```mermaid
flowchart LR
    Browser[AgenticThat browser] -->|central session cookie| Next[Next.js platform]
    Signup[Self-service signup] -->|selected roles + 7-day trial| Auth
    Payment[Future verified payment webhook] -->|paid role entitlements| Auth
    Next --> Auth[(PostgreSQL identity and RBAC)]
    Next -->|5-minute Ed25519 JWT| Telegram[Telegram service]
    Next -->|5-minute Ed25519 JWT| Publishing[Publishing service]
    Next -->|5-minute Ed25519 JWT| Scraping[Cloud and companion scrapers]
    Next -->|central principal + workspace mapping| WhatsApp[WhatsApp APIs]
    Telegram -->|workspace-scoped records| TelegramStore[(Telegram store)]
    Publishing -->|workspace-scoped records| PublishingStore[(Publishing store)]
    Scraping -->|workspace-scoped jobs and runs| ScrapingStore[(Scraper stores)]
    WhatsApp -->|workspace-to-business mapping| WhatsAppStore[(WhatsApp tables)]
    Admin[Global Admin Center] --> Auth
```

There is one human login: AgenticThat email and password. Provider authentication, such as connecting a Telegram account or an Instagram publishing account, is an external account-connection workflow and requires `configure` permission. It is not a second human login.

## Resource catalog

Only live modules are registered:

| Category | Application resources |
| --- | --- |
| `messaging` | `messaging.whatsapp`, `messaging.telegram` |
| `publishing` | `publishing.instagram`, `publishing.youtube`, `publishing.facebook`, `publishing.x`, `publishing.linkedin` |
| `scraping` | `scraping.instagram`, `scraping.facebook` |

The canonical catalog is [src/platform/access-catalog.js](../src/platform/access-catalog.js). SEO and Engagement/Liking are intentionally not registered until those applications are live.

### Access levels

Access is ordered as `none < view < operate < configure`.

| Level | Meaning |
| --- | --- |
| `none` | No page or API access. |
| `view` | Open dashboards and read records, history, jobs, and results. |
| `operate` | Perform workflow mutations: send messages, create or schedule content, and run scrapers. Includes `view`. |
| `configure` | Connect or remove provider accounts and change module/provider settings. Includes `operate` and `view`. |

Global Admin Center access is not an RBAC grant. It requires an active account with `is_global_admin=true`, bootstrapped from `PLATFORM_SUPER_ADMIN_EMAILS`.

## Effective-access rules

Regular-user access comes only from active self-selected trial or payment entitlements. Administrators do not assign roles to users. The policy engine is [src/platform/server/access-policy.js](../src/platform/server/access-policy.js), and billing/trial behavior is defined in [src/platform/server/billing-policy.js](../src/platform/server/billing-policy.js).

1. Only active, unexpired entries in `user_role_entitlements` are evaluated.
2. Within a role, an application grant replaces that role's category grant for the application.
3. When a user selects multiple roles, the highest result for each resource wins.
4. Missing permissions resolve to `none`.
5. Suspended, rejected, and retained legacy-pending accounts resolve to `none` for every module.
6. When the seven-day trial expires without active payment, trial entitlements become inactive and selected-role access resolves to `none`.
7. Active global admins receive `configure` on live module resources and separately receive Admin Center access; their billing status is `exempt`.

Example: selecting `Publishing access` and `Scraping access` combines both role definitions. Selecting `Full module access` grants `configure` across all live categories but does not grant Admin Center access.

## Data model

The central schema is created idempotently by [src/platform/server/auth-store.js](../src/platform/server/auth-store.js).

| Table | Purpose |
| --- | --- |
| `platform_users` | Central identity, lifecycle status, billing status, trial timestamps, workspace request, and global-admin flag. |
| `platform_sessions` | Hashed central browser sessions and expiry. |
| `platform_workspaces` | Workspace registry. |
| `workspace_memberships` | One active workspace per regular user, enforced by `user_id` as the primary key. |
| `rbac_roles` | Reusable system or custom roles, including whether each role is self-selectable. |
| `rbac_role_grants` | Category and application permissions for a role. |
| `user_role_entitlements` | Time-limited trial and non-expiring paid role entitlements selected by the user. |
| `platform_billing_events` | Idempotent payment-state transitions from a future verified gateway adapter. |
| `user_role_assignments` | Retained only as legacy migration input; it is not an effective-access source. |
| `user_access_overrides` | Retained legacy schema; regular-user access no longer reads administrator overrides. |
| `rbac_audit_events` | Actor, target, action, before value, and after value for RBAC administration. |
| `rbac_identity_review_queue` | Product-local identities that cannot be mapped safely and automatically. |
| `platform_auth_migrations` | Idempotency markers for data migrations. |

WhatsApp adds a unique `businesses.platform_workspace_id` bridge and exact `users.platform_user_id` bridge. Telegram and Publishing preserve local actors for attribution while central workspace/user identifiers become the authorization boundary. Scraper jobs and runs include `workspaceId` and are filtered before reads or updates.

## Principal contract

Server-side code obtains a principal with [src/platform/server/access-control.js](../src/platform/server/access-control.js):

```js
{
  userId,
  workspaceId,
  name,
  email,
  businessName,
  status,          // pending | active | suspended | rejected
  isGlobalAdmin,
  billingStatus,   // trialing | payment_pending | active | past_due | canceled | expired | exempt
  trialStartsAt,
  trialEndsAt,
  access           // effective resource -> access-level map
}
```

Use `requireAccess(resource, level)` in protected pages and `authorizeApiAccess(resource, level)` plus `accessErrorResponse(error)` in central APIs. Authentication failures return `401`; authenticated users without sufficient access return `403`. Page guards redirect authenticated users to `/access-denied`, while pending users are sent to `/pending-approval`.

## Central APIs and pages

### Identity APIs

| Endpoint | Behavior |
| --- | --- |
| `GET /api/platform-auth/signup-options` | Returns server-approved self-service roles and the configured trial duration. |
| `POST /api/platform-auth/signup` | Validates selected roles, creates an active account/workspace, and starts the seven-day trial without payment. |
| `POST /api/platform-auth/login` | Creates the single central browser session. |
| `POST /api/platform-auth/logout` | Revokes the current central session. |
| `GET /api/platform-auth/me` | Returns the principal and effective access map. |
| `POST /api/platform-auth/service-token` | Issues a short-lived token for the requested `telegram`, `publishing`, or `scraping` audience when at least one audience resource is viewable. |

The signup UI is a four-step wizard: account details, self-service role selection, payment/free-trial review, and success. The account and trial are created only when step 3 is confirmed. Because no payment provider is connected yet, free trial is the only actionable signup path; the paid option remains unavailable until a provider adapter can verify payment server-side. Full module access is mutually exclusive with individual module selections in the wizard.

### Admin Center

`/admin-center` is protected by `requireGlobalAdmin()` and provides support and catalog administration. It does not assign roles to users.

- Account activation, suspension, rejection, workspace correction, and session revocation.
- Read-only visibility into each user's trial/payment role entitlements and billing status.
- Reusable self-service role definitions with category/application permission matrices.
- Control over whether a custom role appears during signup and billing.
- Identity-mapping review items and audit history.

The APIs under `/api/admin-center/*` independently verify global-admin access:

| Endpoint | Methods |
| --- | --- |
| `/api/admin-center` | `GET` snapshot of users, workspaces, roles, reviews, and audits |
| `/api/admin-center/workspaces` | `POST` create workspace |
| `/api/admin-center/users/:id` | `PATCH` lifecycle status, membership, or session revocation; never role assignment |
| `/api/admin-center/roles` | `POST` create role |
| `/api/admin-center/roles/:id` | `PATCH`, `DELETE` role |
| `/api/admin-center/identity-reviews/:id` | `PATCH` resolve or dismiss a review item |

Suspending or rejecting a user revokes central sessions. Admin Center mutations write `rbac_audit_events`. Role definitions with trial or payment history cannot be deleted.

## Service-token contract

Central Next.js signs Ed25519 JWTs in [lib/service-access-token.js](../lib/service-access-token.js). Tokens last at most five minutes and contain:

```json
{
  "iss": "agenticthat",
  "aud": "telegram | publishing | scraping",
  "sub": "central-user-id",
  "workspaceId": "central-workspace-id",
  "grants": { "resource.key": "level" },
  "iat": 0,
  "exp": 0,
  "jti": "unique-token-id"
}
```

The protected header contains `alg=EdDSA`, `typ=JWT`, and `kid`. Services reject malformed, unsigned, forged, expired, wrong-key, wrong-issuer, and wrong-audience tokens. The private key belongs only on the central Next.js deployment. Telegram, Publishing, cloud scrapers, and companion runtimes receive the public key only. Workspace secrets are never included in browser tokens.

The browser helper [src/platform/client-service-token.js](../src/platform/client-service-token.js) caches audience tokens and refreshes them before expiry. This bounds stale companion permissions to five minutes; central-cookie authorization changes take effect on the next request.

## Product integration

| Product | Human identity | Workspace boundary | Enforcement |
| --- | --- | --- | --- |
| WhatsApp | Central principal | `platform_workspace_id` maps to one business | Reads require `view`; sends and workflow changes require `operate`; provider/account/settings changes require `configure`. Legacy login/signup return `410` in enforce mode. |
| Telegram | `aud=telegram` service token | Central workspace-backed local actor | Reads require `view`, sends require `operate`, and account connect/delete requires `configure`. `/console` is a protected Next.js page. Local password/register/token login is disabled in enforce mode. |
| Publishing | `aud=publishing` service token | Central workspace-backed local actor | Reads are filtered by per-platform grants; post mutations require `operate`; publishing-account connection/removal requires `configure`. The manager/team password and local role-management step are bypassed. |
| Instagram scraping | `aud=scraping` service token or central page principal | Runs, saved queries, companion jobs, and Growth Advisor jobs carry a workspace ID | History/results require `view`; new runs and background execution require `operate`. |
| Facebook scraping | `aud=scraping` service token or central page principal | Runs and jobs carry a workspace ID | History/results require `view`; new runs and background execution require `operate`. |

Provider webhooks remain outside human RBAC. They must continue to validate provider signatures and use their provider tenant identifiers for routing.

The Apps page shows live but unauthorized modules as locked. Config Manager, Content Manager, product navigation, platform tabs, account selectors, and connection buttons use the same effective-access result. UI filtering is supplementary; every protected server route enforces access again.

## Environment configuration

Required production values are documented in [.env.example](../.env.example):

```dotenv
DATABASE_URL=postgresql://...
PLATFORM_SUPER_ADMIN_EMAILS=admin@example.com
PLATFORM_FREE_TRIAL_DAYS=7
RBAC_ENFORCEMENT_MODE=shadow

SERVICE_TOKEN_ISSUER=agenticthat
SERVICE_TOKEN_KEY_ID=at-ed25519-v1
SERVICE_TOKEN_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
SERVICE_TOKEN_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----
```

Generate a dedicated Ed25519 key pair:

```sh
openssl genpkey -algorithm Ed25519 -out service-token-private.pem
openssl pkey -in service-token-private.pem -pubout -out service-token-public.pem
```

Do not commit either generated file. Put the private key only in the central deployment's secret manager. Use the same issuer, key ID, and public key in every verifying service. `PLATFORM_SUPER_ADMIN_EMAILS` is required in production; use a comma-separated allowlist and keep it deliberately small.

## Migration

The migration/reporting script is [scripts/migrate-central-rbac.mjs](../scripts/migrate-central-rbac.mjs).

Run the read-only report first:

```sh
npm run rbac:migrate:dry-run
```

The dry-run:

- Reads central PostgreSQL users and memberships.
- Finds exact WhatsApp `platform_user_id` mappings.
- Inspects the existing Publishing and Telegram stores.
- Reports ambiguous and unmatched identities.
- Never links identities by email.
- Performs no writes.

After backups and Admin Center bootstrap, apply exact mappings and populate the review queue:

```sh
npm run rbac:migrate:apply
```

The apply mode is idempotent. It uses `platform_auth_migrations`, conditional columns/indexes, `ON CONFLICT`, and only fills an empty WhatsApp workspace mapping when one exact central workspace is found. Existing product data, legacy actors, and audit attribution are retained.

Existing active platform users receive the system `Legacy full access` role once so rollout does not silently remove their current live-module access. The migration converts that legacy assignment into an active entitlement, after which effective access no longer reads administrator assignments. New accounts select their own roles and receive trial entitlements. Product-only identity mapping and every ambiguous identity must still be confirmed by an administrator; matching email text is evidence for review, never authority to link records.

### Migration dry-run

The read-only dry-run against the currently configured data sources produced:

| Item | Count |
| --- | ---: |
| Central platform users | 8 |
| Active workspace memberships | 8 |
| WhatsApp businesses | 9 |
| Exact WhatsApp workspace mappings ready | 3 |
| Publishing legacy users | 4 |
| Telegram legacy users | 0 |
| Identity review items | 10 |

The ten review items consist of six WhatsApp mappings and four Publishing actors. No database or product-store state was changed by this dry-run. Re-run the report immediately before deployment because these counts describe a point-in-time snapshot.

## Rollout procedure

1. Back up PostgreSQL and the current WhatsApp, Telegram, Publishing, and scraper stores.
2. Deploy the central schema, principal resolution, and service verification configuration with `RBAC_ENFORCEMENT_MODE=shadow`.
3. Run `npm run rbac:migrate:dry-run`; reconcile totals and inspect every review item.
4. Sign in with an address in `PLATFORM_SUPER_ADMIN_EMAILS` and validate `/admin-center`.
5. Run `npm run rbac:migrate:apply` after approval of the dry-run and backups.
6. Resolve ambiguous identities; verify every active regular user has exactly one workspace and the expected trial, paid, or migrated entitlement.
7. Test a `view`, `operate`, and `configure` user in each granted product, plus explicit denial and cross-workspace cases.
8. Deploy the public signing key to Telegram, Publishing, scraper, and companion services.
9. Change the central app and all product services to `RBAC_ENFORCEMENT_MODE=enforce` in a coordinated release.
10. Verify legacy human-login endpoints are disabled and monitor denial/audit logs.

Rollback from enforcement by returning all deployments to `shadow`; do not delete migrated columns, actors, or role data. A rollback restores legacy compatibility while retaining the evidence needed to correct mappings.

## Verification

Run the automated checks from the repository root:

```sh
npm run test:rbac
npm --prefix services/messaging/telegram test
npm run test:instagram
npm run test:facebook
npm run test:publishing
npm run build
```

Acceptance verification must also cover:

- Signup requires at least one server-approved role, creates the workspace immediately, and starts a seven-day trial without payment.
- Selected roles work during the trial and resolve to `none` at the exact trial expiry when there is no successful payment.
- A verified, idempotent successful payment event converts the selected roles into active paid entitlements.
- Administrators cannot assign roles or direct access to regular users.
- One central login opens every granted module without a second product password.
- Category inheritance, application exceptions within a role, and multi-role union behave as documented.
- Operators cannot connect or remove provider accounts.
- Forged, unsigned, expired, wrong-audience, and wrong-workspace tokens are rejected.
- Records cannot be read or mutated across workspaces, including guessed job IDs.
- Suspension immediately blocks central pages and blocks service access when outstanding tokens expire within five minutes.
- Logout leaves no reusable product-local human session.
- Repeated migration dry-runs and apply runs preserve counts and do not duplicate mappings or reviews.

Focused policy, billing, and token tests are in [src/platform/server/access-policy.test.js](../src/platform/server/access-policy.test.js), [src/platform/server/billing-policy.test.js](../src/platform/server/billing-policy.test.js), and [lib/service-access-token.test.js](../lib/service-access-token.test.js). The shorter operational checklist remains available in [docs/central-rbac-rollout.md](central-rbac-rollout.md).

For the self-service signup, selected/full access, trial expiry, and future payment flow, see [Self-Service User Onboarding, Trials, and Paid Access](rbac-user-onboarding.md).

## Security and operations notes

- PostgreSQL is authoritative in production. The file-backed development path is not the production RBAC authority.
- Never copy `SERVICE_TOKEN_PRIVATE_KEY` into Telegram, Publishing, a scraper, a companion bundle, browser code, logs, or documentation containing real key material.
- Keep tokens audience-specific. A valid Publishing token must fail at Telegram and scraper boundaries.
- Treat workspace ID as a mandatory database filter, not only a token claim or UI filter.
- Do not automatically resolve the identity review queue from email similarity.
- Session revocation does not invalidate already issued stateless tokens; their maximum remaining lifetime is five minutes.
- Webhook authorization is provider-signature validation, not a user service token.
- Payment adapters must verify the provider's native webhook signature before calling `applyPlatformPaymentEvent()`; no generic browser-callable billing webhook is exposed.
- Audit logs should be retained for trial, payment, role-catalog, suspension, session-revocation, and identity-review actions.
