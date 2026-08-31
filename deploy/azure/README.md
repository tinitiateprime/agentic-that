# Azure production-pilot deployment

This directory prepares two isolated Azure Web Apps: the Next.js website and a
single-instance automation API/worker service. It deliberately does not add
Service Bus, Container Apps, Kubernetes, or autoscaling. All publishing,
scraping, preview, and login feature flags are deployed **off**.

No Azure resource has been created by this repository work. Real provisioning
starts only when credentials are available and the staging checklist below is
followed.

## Before provisioning

1. Create separate `staging` and `production` Supabase projects (preferred) or
   otherwise prove strict database/environment isolation.
2. Enable Supabase backups. Before production, restore a backup into a temporary
   project and record the date/result; only then set `backups_verified=true`.
3. Run the automation migration with the database-owner direct connection:

   ```bash
   SERVER_DATABASE_ENGINE=postgres \
   SERVER_AUTOMATION_DATABASE_URL="$SERVER_AUTOMATION_MIGRATION_DATABASE_URL" \
   npm run server-architecture:db:migrate
   ```

4. Create the least-privilege automation login after the migration created its
   group role:

   ```bash
   psql "$SERVER_AUTOMATION_MIGRATION_DATABASE_URL" \
     --set=automation_password="$(openssl rand -base64 36)" \
     --file deploy/supabase/create-automation-login.sql
   ```

   Build `SERVER_AUTOMATION_DATABASE_URL` from that login. Keep the owner URL
   only as the migration secret. Use Supabase's session pooler when Azure does
   not have direct IPv6 connectivity; do not use transaction pooling for this
   long-running worker.
5. Generate the website-to-automation secret once with
   `openssl rand -base64 48`. Store the same value as
   `SERVER_AUTOMATION_INTERNAL_TOKEN` in both GitHub environments.
6. Configure GitHub OIDC federation for the repository/environment. Do not
   create a long-lived Azure client secret. The provisioning identity needs
   Contributor plus permission to create role assignments (Role Based Access
   Control Administrator or Owner) at the isolated resource-group scope.

## GitHub environment configuration

Create protected GitHub environments named `staging` and `production`.
Production should require an approver.

Secrets in each environment:

- `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` (OIDC identity)
- `WEBSITE_DATABASE_URL` (website runtime role)
- `WEBSITE_MIGRATION_DATABASE_URL` (database-owner migration connection)
- `SERVER_AUTOMATION_DATABASE_URL` (least-privilege automation login)
- `SERVER_AUTOMATION_MIGRATION_DATABASE_URL` (database-owner direct connection)
- `SERVER_AUTOMATION_INTERNAL_TOKEN` (48-byte random value)
- `WEBSITE_SECRET_SETTINGS_JSON` (JSON object containing the website's existing
  authentication/provider secrets; use `{}` only for a deliberately minimal
  staging environment)

Variables before provisioning:

- `AZURE_RESOURCE_GROUP` (different for staging and production)
- `AZURE_LOCATION`, for example `centralindia`
- `OPERATIONS_ALERT_EMAIL`

After provisioning, copy workflow summary outputs into these environment
variables:

- `AZURE_CONTAINER_REGISTRY_NAME`
- `AZURE_CONTAINER_REGISTRY_SERVER`
- `AZURE_WEBSITE_APP_NAME`, `AZURE_WEBSITE_URL`
- `AZURE_AUTOMATION_APP_NAME`, `AZURE_AUTOMATION_URL`

## Provision and deploy staging

1. Run **Provision Production Pilot Infrastructure** with `staging`. The
   workflow validates Bicep, provisions ACR, separate App Service plans/apps,
   private Blob containers, Key Vault, a versioned RSA wrapping key, managed
   identities/RBAC, Log Analytics, App Insights, diagnostics, and optional 5xx
   alerts.
2. Add the non-secret output values to the staging environment variables.
3. Run **Deploy Website Pilot**. It tests, builds, explicitly migrates the
   website database, publishes an immutable image, deploys, and probes health.
4. Run **Deploy Automation Pilot**. It runs unit plus PostgreSQL integration
   tests, explicitly migrates the automation database, deploys an immutable
   image, and verifies automation readiness through the website.
5. Confirm Key Vault references resolve and the automation identity has only
   ACR pull, Blob data contributor, Key Vault secret-user, and Key Vault crypto
   permissions.
6. After both apps are healthy, restrict the automation Web App to all possible
   website outbound IPs:

   ```bash
   deploy/azure/restrict-automation-access.sh \
     "$AZURE_RESOURCE_GROUP" "$AZURE_WEBSITE_APP_NAME" "$AZURE_AUTOMATION_APP_NAME"
   ```

   The deep website health check continues to work after this restriction.
   Keep the internal token as defense in depth. Re-run this script after any
   App Service plan, scale, or networking change because the possible outbound
   IP list can change.
7. Put Cloudflare in front of the website only. Use Full (strict) TLS, disable
   caching for `/api/*`, rate-limit login, publishing mutations, and
   `/api/internal/automation/*`, and do not expose the automation hostname
   through Cloudflare or client JavaScript.

## Staging validation order

Keep everything off after first deployment. Then:

1. Verify `/api/health` and `/api/health?automation=1`, logs, metrics, and alert delivery.
2. Prove an encrypted test profile is uploaded with Blob versioning and cannot
   be read without the Key Vault unwrap permission.
3. Enable login only; connect one non-production test account, restart the
   automation app, and prove the encrypted session restores.
4. Enable dry-run only, then Instagram preview, and verify restart/lease recovery.
5. For each platform in order—Instagram, Facebook, X, LinkedIn, YouTube—enable
   that one platform, publish one intended test post, test one scheduled post,
   inspect logs/attempts, then disable it before moving to the next platform.
6. Force an ambiguous post result in a test scenario and prove it becomes
   `UNCERTAIN`, is never retried, and requires an audited manual resolution.
7. Enable Instagram/Facebook scraping separately and prove no publishing
   profile is reused.
8. Restart during safe pre-final-action work and verify stale lease recovery.
   Do not intentionally interrupt a real post after its final click merely to
   test infrastructure.
9. Restore the database backup and a prior Blob profile version in an isolated
   recovery environment.

Only after every staging result is recorded should production infrastructure
be provisioned. Repeat the process one platform at a time; never turn all flags
on together.

## Rollback

Images are tagged with the Git commit SHA. Deployment workflows record the
current image and restore it automatically when the new image fails its health
probe. For a manual rollback, drain the service, point the Web App at the
previous known-good SHA, restart, and verify deep health. Do not roll back a
database migration destructively. An interrupted job whose final action may
have happened stays `UNCERTAIN` until an operator checks the social platform.

The automation App Service must remain one instance during this pilot. Database
leases make later horizontal scaling possible, but remote interactive login and
browser resource behavior still require real staging soak tests before any
scale-out decision.
