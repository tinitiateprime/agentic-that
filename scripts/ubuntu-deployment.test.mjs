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
  const services = await read("services.env.example");
  assert.match(site, /INSTAGRAM_API_URL=http:\/\/127\.0\.0\.1:8791/);
  assert.match(site, /FACEBOOK_API_URL=http:\/\/127\.0\.0\.1:8793/);
  assert.match(site, /TELEGRAM_API_URL=http:\/\/127\.0\.0\.1:8787/);
  assert.doesNotMatch(site, /NEXT_PUBLIC_(?:INSTAGRAM|FACEBOOK|PUBLISH_QUEUE)_API_URL/);
  assert.match(site, /NEXT_PUBLIC_TEAM_TESTING_FULL_ACCESS=true/);
  assert.match(services, /NEXT_PUBLIC_TEAM_TESTING_FULL_ACCESS=true/);
  assert.match(site, /Set this to false and rebuild/);
  assert.match(site, /RBAC_ENFORCEMENT_MODE=enforce/);
});

test("single-host production retains explicit encryption and backup gates", async () => {
  const automation = await read("automation.env.example");
  assert.match(automation, /SERVER_ARCHITECTURE_HOST=127\.0\.0\.1/);
  assert.match(automation, /SERVER_ARCHITECTURE_ALLOW_PUBLIC_BIND=false/);
  assert.match(automation, /SERVER_PROFILE_STORAGE_ENCRYPTED=true/);
  assert.match(automation, /SERVER_BACKUPS_CONFIGURED=true/);
  assert.match(automation, /SERVER_MEDIA_UPLOAD_MAX_BYTES=10737418240/);
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

test("browser services receive isolated writable HOME and XDG directories", async () => {
  for (const service of ["automation", "instagram", "facebook"]) {
    const stateDirectory = `agenticthat-${service}`;
    const unit = await read(`${stateDirectory}.service`);
    assert.match(unit, new RegExp(`Environment=HOME=/var/lib/${stateDirectory}`));
    assert.match(unit, new RegExp(`Environment=XDG_CONFIG_HOME=/var/lib/${stateDirectory}/\\.config`));
    assert.match(unit, new RegExp(`Environment=XDG_CACHE_HOME=/var/lib/${stateDirectory}/\\.cache`));
    assert.match(unit, new RegExp(`Environment=XDG_DATA_HOME=/var/lib/${stateDirectory}/\\.local/share`));
    assert.match(unit, new RegExp(`Environment=XDG_RUNTIME_DIR=/run/${stateDirectory}`));
    assert.match(unit, new RegExp(`StateDirectory=${stateDirectory}`));
    assert.match(unit, new RegExp(`RuntimeDirectory=${stateDirectory}`));
    assert.match(unit, /StateDirectoryMode=0700/);
    assert.match(unit, /RuntimeDirectoryMode=0700/);
  }
});

test("the integrated Telegram console bundles its upload UI and styles with versioned Next assets", async () => {
  const page = await readFile(new URL("../app/console/page.jsx", import.meta.url), "utf8");
  const consoleSource = await readFile(new URL("../services/messaging/telegram/console/src/TelegramConsole.jsx", import.meta.url), "utf8");
  const controller = await readFile(new URL("../services/messaging/telegram/console/src/telegram-controller.js", import.meta.url), "utf8");

  assert.match(page, /import "@telegram\/public\/styles\.css"/);
  assert.doesNotMatch(page, /telegram-console-assets\/styles\.css/);
  assert.match(consoleSource, /post-media-file/);
  assert.match(consoleSource, /Images, videos, GIFs, audio, voice messages, video notes, and documents/);
  assert.match(controller, /uploadTelegramDeviceFile/);
});
