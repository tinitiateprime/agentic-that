import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { telegramProxyHeaders } from "./telegram-proxy-origin.ts";

test("Telegram preserves the external reverse-proxy origin without a configured public URL", () => {
  const request = new Request('http://localhost:3000/v1/telegram/login/start', { headers: {
    origin: 'https://www.agenticthat.com', 'x-forwarded-host': 'www.agenticthat.com, internal.example', 'x-forwarded-proto': 'https, http',
  } });
  const headers = telegramProxyHeaders(request, '');
  assert.equal(headers.get('x-forwarded-host'), 'www.agenticthat.com');
  assert.equal(headers.get('x-forwarded-proto'), 'https');
});

test("Telegram rejects invalid deployment URLs instead of trusting the browser Origin", () => {
  const request = new Request('http://localhost:3000/v1/telegram/login/start', { headers: { origin: 'https://untrusted.example' } });
  assert.throws(() => telegramProxyHeaders(request, 'javascript:alert(1)'), /PLATFORM_PUBLIC_URL/);
  assert.throws(() => telegramProxyHeaders(request, 'https://user:password@example.com'), /PLATFORM_PUBLIC_URL/);
});

test("real Telegram HTTP connection requests use the configured public origin and reject forged origins", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'agenticthat-telegram-origin-'));
  const values = {
    NODE_ENV: 'test', DATA_STORE: 'json', TELEGRAM_DATA_STORE: 'json', DATA_DIR: directory,
    SESSION_ENCRYPTION_KEY: randomBytes(32).toString('base64url'), USER_PROVISIONING_KEY: 'test-origin-provisioning',
    SESSION_COOKIE_SECURE: 'true', CORS_ORIGIN: '', TELEGRAM_API_ID: '', TELEGRAM_API_HASH: '',
    SERVICE_TOKEN_PRIVATE_KEY: '', SERVICE_TOKEN_PUBLIC_KEY: '',
  };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  const { createTelegramHttpServer } = await import('../../../services/messaging/telegram/src/server.ts');
  const { signServiceAccessToken } = await import('../../../lib/service-access-token.js');
  const server = await createTelegramHttpServer({ startListeners: false });
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const target = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/telegram/login/start`;
    const token = signServiceAccessToken({ audience: 'telegram', subject: 'origin-test-user', workspaceId: 'origin-test-workspace',
      grants: { 'messaging.telegram': 'configure' }, capabilities: ['messaging.configure'], name: 'Origin test' });
    const send = async (origin: string, publicUrl = 'https://www.agenticthat.com') => {
      const incoming = new Request('http://localhost:3000/v1/telegram/login/start', { method: 'POST', body: '{}', headers: {
        origin, authorization: 'Bearer ' + token, 'content-type': 'application/json',
        'x-forwarded-host': 'untrusted.example', 'x-forwarded-proto': 'http',
      } });
      const response = await fetch(target, { method: incoming.method, headers: telegramProxyHeaders(incoming, publicUrl), body: '{}' });
      return { status: response.status, body: await response.json() };
    };
    const accepted = await send('https://www.agenticthat.com');
    assert.equal(accepted.status, 400);
    assert.match(accepted.body.error, /telegramApiId is required/);
    const apex = await send('https://agenticthat.com');
    assert.equal(apex.status, 400);
    assert.match(apex.body.error, /telegramApiId is required/);
    const rejected = await send('https://untrusted.example');
    assert.equal(rejected.status, 403);
    assert.match(rejected.body.error, /browser origin is not allowed/);
    assert.equal((await send('null')).status, 403);
    assert.equal((await send('http://www.agenticthat.com')).status, 403);
    assert.equal((await send('https://app.agenticthat.com')).status, 403);
    const configured = await send('https://alternate.example', 'https://alternate.example');
    assert.equal(configured.status, 400);
    assert.match(configured.body.error, /telegramApiId is required/);
    assert.equal((await send('https://www.alternate.example', 'https://alternate.example')).status, 403);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    const resolved = path.resolve(directory);
    assert(resolved.startsWith(path.resolve(tmpdir()) + path.sep));
    assert(path.basename(resolved).startsWith('agenticthat-telegram-origin-'));
    await rm(resolved, { recursive: true, force: true });
  }
});
