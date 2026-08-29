# Single-Ubuntu website deployment

This layout runs the website, primary publishing, Telegram messaging, and the
separately selectable Instagram/Facebook **Ubuntu Server** scraping engine
permanently on one Ubuntu machine. Remote users can use those server services
from one HTTPS website without installing anything. The recommended
**Companion** scraping engine runs on a user's Windows computer and therefore
requires AgenticThat Companion plus its extension. Nginx is the only public
Ubuntu process; Next.js and every Ubuntu worker bind to `127.0.0.1`.

The Telegram systemd service is also the durable post scheduler. Once a remote
user queues a Telegram post, the service keeps its schedule and per-recipient
delivery checkpoints under `/var/lib/agenticthat-telegram` and sends it even
when that user's browser is closed. Telegram contacts, broadcast groups,
channel records, and connected-account profile metadata are also encrypted in
that server store and shared across devices only within the same workspace.

## Required host safeguards

Use Ubuntu 24.04 LTS (or a currently supported Ubuntu release), a static public
IP or DNS name, and router/firewall forwarding for ports 80 and 443. The Ubuntu
machine must stay powered on and connected. Before setting the automation
production acknowledgements to `true`:

- place `/var/lib/agenticthat-automation` on encrypted-at-rest storage (for
  example, an unlocked LUKS volume);
- configure encrypted backups for PostgreSQL and every `/var/lib/agenticthat-*`
  directory, then perform a restore test;
- restrict SSH, enable unattended security updates, and allow only 22/80/443 in
  the firewall;
- use a domain with a valid TLS certificate.

The browser publisher is deliberately single-host: run exactly one automation
service against its SQLite database. PostgreSQL on the same Ubuntu host is the
multi-user authority for accounts, workspaces, roles, WhatsApp, and audit data.

Publishing offers two explicit account engines. **Server Worker** is the
default and needs no user download. **Local Companion** is optional: install
Companion and the Chrome extension on the device that will publish, open
Config Manager, pair that device, and choose Local Companion when adding the
account. The engines are never automatic fallbacks for each other; this avoids
submitting the same post twice when a platform confirmation is delayed.

## 1. Install software

Install a supported Node.js LTS, PostgreSQL, Nginx, Certbot, Google Chrome
Stable, Xvfb, Git, and build tools. Create a locked `agenticthat` system user
whose state lives under `/var/lib`, then clone this branch at
`/opt/agenticthat` and run:

```text
sudo -u agenticthat npm ci
sudo -u agenticthat npm --prefix services/messaging/telegram ci
```

Create a local PostgreSQL role/database with a unique generated password. Keep
PostgreSQL on loopback; put its connection URL only in
`/etc/agenticthat/site.env`.

## 2. Create private configuration

Create `/etc/agenticthat`, copy the three `*.env.example` files there without
the `.example` suffix, replace every `replace-*` value, then set ownership to
`root:agenticthat` and permissions to `0640`.

Generate independent random values; never reuse a social-media password. The
service-token pair can be generated as base64 DER so it fits safely on one
EnvironmentFile line:

```text
openssl genpkey -algorithm Ed25519 -out /tmp/agenticthat-service-private.pem
openssl pkey -in /tmp/agenticthat-service-private.pem -pubout -out /tmp/agenticthat-service-public.pem
openssl pkey -in /tmp/agenticthat-service-private.pem -outform DER | base64 -w0
openssl pkey -pubin -in /tmp/agenticthat-service-public.pem -outform DER | base64 -w0
```

Put the first base64 value only in `site.env`; put the public value in both
`site.env` and `services.env`. Securely delete the temporary key files after
the real environment files and encrypted backup have been created.

The same automation internal token goes in `site.env` and `automation.env`.
Set `CORS_ORIGIN` to the final `https://` website origin. Telegram API ID/hash
come from the operator's Telegram application and stay server-side.

## 3. Build and migrate

The scraper proxy destinations are compiled into the Next.js route manifest,
so build with these non-secret loopback settings. Full testing access is
temporarily enabled here: it removes AgenticThat's trial clock, module
entitlements, and product usage quotas while preserving sign-in, workspace
isolation, operational roles, provider limits, and publishing safeguards.

```text
cd /opt/agenticthat
sudo -u agenticthat env NODE_ENV=production \
  NEXT_PUBLIC_TEAM_TESTING_FULL_ACCESS=true \
  INSTAGRAM_API_URL=http://127.0.0.1:8791 \
  FACEBOOK_API_URL=http://127.0.0.1:8793 \
  TELEGRAM_API_URL=http://127.0.0.1:8787 \
  npm run build
```

When testing is complete, set `NEXT_PUBLIC_TEAM_TESTING_FULL_ACCESS=false` in
both `/etc/agenticthat/site.env` and `/etc/agenticthat/services.env`, rebuild
with the same value, and restart the site, Telegram, Instagram, and Facebook
services to restore the stored trial, plan, module-access, and usage
restrictions.

The website service applies the idempotent platform and WhatsApp database
migrations before every start. For the first deployment, run them once and
confirm they succeed before exposing Nginx.

## 4. Install services and HTTPS

Copy all five `agenticthat-*.service` files to `/etc/systemd/system/`. Replace
`app.example.com` and its certificate paths in the Nginx template, install it
as an enabled site, then validate with `sudo nginx -t`.

```text
sudo systemctl daemon-reload
sudo systemctl enable --now \
  agenticthat-automation \
  agenticthat-telegram \
  agenticthat-instagram \
  agenticthat-facebook \
  agenticthat-site
```

## 5. Verify before inviting users

All internal listeners must answer only on loopback:

```text
curl --fail http://127.0.0.1:8800/ready
curl --fail http://127.0.0.1:8787/health
curl --fail http://127.0.0.1:8791/api/scraping/instagram/health
curl --fail http://127.0.0.1:8793/api/scraping/facebook/health
curl --fail http://127.0.0.1:4173/
curl --fail https://app.example.com/
sudo ss -ltnp
```

The Telegram health response must include `"scheduler":"server"`. Schedule a
small test message, close the browser before it is due, and confirm it is sent
and appears in Delivery history after reopening the website. Create one
contact, group, and channel record, then sign in from a second browser and
confirm they appear only in the same workspace.

Only ports 22 (restricted), 80, and 443 should be publicly reachable. In the
website, test two separate workspaces and verify neither can see the other's
accounts, jobs, messages, or scraper runs. Then connect test accounts and
verify one text and one media post per enabled destination. Social sites can
change their web UI; keep the per-platform kill switches available and monitor
failed/uncertain jobs rather than automatically retrying an irreversible post.

For Companion scraping, install Companion `1.7.0` and extension `1.2.0` or
newer. Open the extension and approve the exact production HTTPS origin once.
Quick-tunnel origins change when restarted and must be approved again; a stable
production domain is strongly preferred. Confirm Instagram and Facebook both
default to Companion, Ubuntu Server remains selectable, and completed
Companion runs appear in workspace history from a second browser session.

## Updates and operations

For each update: back up, pull the intended commit, run `npm ci`, run the full
test suite, rebuild with the loopback settings above, and restart the five
services. Follow logs without printing environment files:

```text
sudo journalctl -u agenticthat-site -u agenticthat-automation \
  -u agenticthat-telegram -u agenticthat-instagram \
  -u agenticthat-facebook -f
```

Never copy browser-profile directories between workspaces, expose ports
8787/8791/8793/8800, or put provider credentials in the repository.
