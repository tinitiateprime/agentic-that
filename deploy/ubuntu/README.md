# Single-Ubuntu website deployment

This layout runs the website, publishing browsers, Telegram messaging, and the
Instagram/Facebook scrapers permanently on one Ubuntu machine. Remote users
open one HTTPS website and install nothing. Nginx is the only public process;
Next.js and every worker bind to `127.0.0.1`.

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
so build with these non-secret loopback settings:

```text
cd /opt/agenticthat
sudo -u agenticthat env NODE_ENV=production \
  NEXT_PUBLIC_TEAM_TESTING_FULL_ACCESS=false \
  INSTAGRAM_API_URL=http://127.0.0.1:8791 \
  FACEBOOK_API_URL=http://127.0.0.1:8793 \
  TELEGRAM_API_URL=http://127.0.0.1:8787 \
  npm run build
```

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

Only ports 22 (restricted), 80, and 443 should be publicly reachable. In the
website, test two separate workspaces and verify neither can see the other's
accounts, jobs, messages, or scraper runs. Then connect test accounts and
verify one text and one media post per enabled destination. Social sites can
change their web UI; keep the per-platform kill switches available and monitor
failed/uncertain jobs rather than automatically retrying an irreversible post.

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
