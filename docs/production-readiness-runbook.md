# Production client-readiness runbook

Use this order for every production release. The application build never changes
the database.

1. Configure the `production-database` GitHub environment with
   `PRODUCTION_DATABASE_URL`, required reviewers, and the
   `PLATFORM_SUPER_ADMIN_EMAILS` variable.
2. Run **Production Database Migrations**, type `MIGRATE_PRODUCTION`, and require
   the RLS/grant verification step to pass.
3. Configure Netlify from `docs/netlify-env.md`; run `npm run production:check`
   with that same environment. Testing bypass must be false and RBAC must be
   `enforce`.
4. Deploy the matching commit. Verify signup email, email verification, password
   reset, admin TOTP/recovery code, one workspace owner, and one restricted member.
5. Create Client A and Client B. Attempt Client B IDs and tokens from Client A
   across Publishing, WhatsApp, Telegram, Instagram/Facebook scraping, team, and
   Admin Center. Every attempt must return not-found or forbidden and must create
   no row in the other workspace.
6. Send one immediate Telegram text and one media item; verify confirmed message
   IDs after a cold function invocation. Telegram scheduling is intentionally
   unavailable on Netlify.
7. Deliver a Meta webhook twice and verify one WhatsApp message row. Verify an
   invalid Meta signature, unknown WABA, missing WATI token, and invalid Baileys
   secret are rejected without tenant fallback.
8. Complete `docs/publishing-companion-production-validation.md` on the exact
   build, configure Windows and Apple signing/notarization secrets, set
   `COMPANION_LIVE_MATRIX_APPROVED_VERSION`, and publish the stable `vX.Y.Z` tag.
9. Set `NEXT_PUBLIC_PUBLISHING_COMPANION_RELEASE_TAG` to that stable tag, redeploy,
   and verify checksums and downloads on every supported OS/architecture.
10. Run load tests with representative concurrent workspaces and provider limits;
    monitor Netlify p95/p99 duration/error rate, Supabase connections/CPU/IO, queue
    depth, webhook retries, and provider rate-limit responses before increasing
    the client cohort.

Do not call the product generally available until steps 1-10 have recorded
evidence. Certificate issuance, provider accounts, email-domain verification,
and the live owned-account matrix cannot be completed from source code alone.
