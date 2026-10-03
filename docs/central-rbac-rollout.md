# Central authentication and RBAC rollout

For the full architecture, policy, schema, API, migration, and operations reference, see [Centralized Authentication and RBAC](central-auth-rbac-implementation.md).

AgenticThat is the only human identity provider. WhatsApp, Telegram, Publishing, and scraping services accept the central principal or a five-minute audience-scoped Ed25519 token. Provider logins remain account-connection workflows and require `configure` access.

## Required configuration

- PostgreSQL: `DATABASE_URL` or `SUPABASE_DB_URL`
- Global administrators: `PLATFORM_SUPER_ADMIN_EMAILS`
- Free trial duration: `PLATFORM_FREE_TRIAL_DAYS=7`
- Rollout mode: `RBAC_ENFORCEMENT_MODE=shadow` initially, then `enforce`
- Central signer: `SERVICE_TOKEN_PRIVATE_KEY`, `SERVICE_TOKEN_PUBLIC_KEY`, `SERVICE_TOKEN_KEY_ID`, and `SERVICE_TOKEN_ISSUER`
- Telegram, Publishing, and companion deployments receive the public key and matching key ID/issuer, but never the private key.

Generate a key pair with OpenSSL:

```sh
openssl genpkey -algorithm Ed25519 -out service-token-private.pem
openssl pkey -in service-token-private.pem -pubout -out service-token-public.pem
```

Store PEM values as deployment secrets. Newlines may be preserved or represented as `\n`.

## Rollout

1. Deploy the schema and application with `RBAC_ENFORCEMENT_MODE=shadow`.
2. Run `npm run rbac:migrate:dry-run`. It does not write data or link identities by email.
3. Review counts and all unmatched identities. Run `npm run rbac:migrate:apply` only after taking backups.
4. Sign in using an email in `PLATFORM_SUPER_ADMIN_EMAILS`, open `/admin-center`, resolve identity reviews, and verify every active user has a workspace and a trial, paid, or migrated entitlement.
5. Verify page/API access for `view`, `operate`, and `configure` users.
6. Set `RBAC_ENFORCEMENT_MODE=enforce` on the central app and product services. Legacy WhatsApp, Telegram, and Publishing human-login endpoints then return `410` or reject their local tokens.

The migration is idempotent. Exact WhatsApp `platform_user_id` links can populate central workspace mappings. Publishing and Telegram records without an exact central identifier enter `rbac_identity_review_queue`; email is reported for review but is never used to link records automatically.

## Verification

Run:

```sh
npm run test:rbac
npm --prefix services/messaging/telegram test
npm run test:instagram
npm run test:facebook
npm run test:publishing
npm run build
```

Trial expiry and payment changes affect central requests immediately. Existing service tokens expire in at most five minutes. Regular users select roles during signup; administrators do not assign roles.
