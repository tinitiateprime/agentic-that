import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const deploy = new URL("../deploy/ubuntu/", import.meta.url);
const read = file => readFile(new URL(file, deploy), "utf8");

test("the public Nginx site exposes only Next.js", async () => {
  const nginx = await read("nginx-agenticthat-automation.conf");
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:4173/);
  assert.doesNotMatch(nginx, /proxy_pass http:\/\/127\.0\.0\.1:(?:8787|8791|8793|8800)/);
  assert.match(nginx, /Strict-Transport-Security/);
  assert.match(nginx, /client_max_body_size 260m/);
});

test("browser-visible configuration contains no localhost service URL", async () => {
  const site = await read("site.env.example");
  assert.match(site, /INSTAGRAM_API_URL=http:\/\/127\.0\.0\.1:8791/);
  assert.match(site, /FACEBOOK_API_URL=http:\/\/127\.0\.0\.1:8793/);
  assert.match(site, /TELEGRAM_API_URL=http:\/\/127\.0\.0\.1:8787/);
  assert.doesNotMatch(site, /NEXT_PUBLIC_(?:INSTAGRAM|FACEBOOK|PUBLISH_QUEUE)_API_URL/);
  assert.match(site, /NEXT_PUBLIC_TEAM_TESTING_FULL_ACCESS=false/);
  assert.match(site, /RBAC_ENFORCEMENT_MODE=enforce/);
});

test("single-host production retains explicit encryption and backup gates", async () => {
  const automation = await read("automation.env.example");
  assert.match(automation, /SERVER_ARCHITECTURE_HOST=127\.0\.0\.1/);
  assert.match(automation, /SERVER_ARCHITECTURE_ALLOW_PUBLIC_BIND=false/);
  assert.match(automation, /SERVER_PROFILE_STORAGE_ENCRYPTED=true/);
  assert.match(automation, /SERVER_BACKUPS_CONFIGURED=true/);
  assert.match(automation, /SERVER_(?:INSTAGRAM|FACEBOOK|X|LINKEDIN|YOUTUBE)_PUBLISHING_ENABLED=true/);
});

test("all application services run unprivileged with private writable state", async () => {
  for (const file of [
    "agenticthat-site.service",
    "agenticthat-automation.service",
    "agenticthat-telegram.service",
    "agenticthat-instagram.service",
    "agenticthat-facebook.service",
  ]) {
    const unit = await read(file);
    assert.match(unit, /User=agenticthat/);
    assert.match(unit, /UMask=0077/);
    assert.match(unit, /ProtectSystem=strict/);
    assert.match(unit, /NoNewPrivileges=true/);
    assert.doesNotMatch(unit, /0\.0\.0\.0/);
  }
});
