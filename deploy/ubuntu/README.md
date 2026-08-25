# Ubuntu staging worker (no Docker)

This is a provider-neutral staging layout for one Ubuntu VM. It does not alter
the current Netlify site or Companion. Use only test social accounts: the
current worker still uses single-machine SQLite and local, unencrypted browser
profiles, so customer production mode is intentionally blocked in code.

## Server layout

- Repository: `/opt/agenticthat`
- Private state: `/var/lib/agenticthat-automation`
- Private environment: `/etc/agenticthat/automation.env`
- Node service: loopback `127.0.0.1:8800`
- Public entry: an HTTPS-only Nginx domain such as
  `worker-staging.example.com`

The Node service must never bind directly to the public internet. Nginx is the
TLS boundary, and every `/v1/` request still requires the private internal
token supplied only by the AgenticThat website server.

## Prepare the VM

1. Install a current Node.js LTS release, Git, Nginx, and Google Chrome Stable.
2. Create a locked service account named `agenticthat`.
3. Clone the repository into `/opt/agenticthat` and run `npm ci` there.
4. Copy `automation.env.example` to `/etc/agenticthat/automation.env`, replace
   the token with a random value of at least 32 characters, then set ownership
   to `root:agenticthat` and permissions to `0640`.
5. Copy `agenticthat-automation.service` to `/etc/systemd/system/`.
6. Replace the example domain and certificate paths in the Nginx template,
   install it as an enabled site, and validate Nginx configuration.

Before starting the service, validate configuration without opening the
database or a browser:

```text
sudo -u agenticthat /usr/bin/node \
  --env-file=/etc/agenticthat/automation.env \
  --import tsx services/automation-server/src/preflight.ts
```

Then enable the service and check both endpoints:

```text
sudo systemctl daemon-reload
sudo systemctl enable --now agenticthat-automation
curl http://127.0.0.1:8800/health
curl http://127.0.0.1:8800/ready
```

Use the system journal for diagnostics:

```text
sudo journalctl -u agenticthat-automation -f
```

## Connect the Netlify website

Only after HTTPS and readiness work, add these environment variables to a
separate Netlify deploy preview or staging site:

```text
SERVER_AUTOMATION_DASHBOARD_ENABLED=true
SERVER_AUTOMATION_ORIGIN=https://worker-staging.example.com
SERVER_AUTOMATION_INTERNAL_TOKEN=<same private token as the worker>
```

Do not add these to the current live Netlify site yet. First enable only
`SERVER_LOGIN_ENABLED=true` on the worker and connect a test Instagram account
through Config Manager. Enable live publishing flags only after login,
scheduling, restart recovery, and backup restoration are verified.

## Required before customer production

- Replace SQLite with managed PostgreSQL for multi-worker durability.
- Move uploaded media to private object storage with expiry policies.
- Encrypt saved browser profiles using a managed key service.
- Add automated backups and a tested restore procedure.
- Add metrics, alerts, job retry review, and audit-log retention.
- Complete platform terms, security, privacy, and account-risk review.
