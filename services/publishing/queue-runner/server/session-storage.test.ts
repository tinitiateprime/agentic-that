import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { BrowserContext } from "playwright-core";
import { installBrowserStorageState, readEncryptedSessionState, writeEncryptedSessionState } from "./services/publisher.js";

test("publishing session exports are encrypted and authenticated", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agenticthat-session-storage-"));
  const sessionPath = path.join(temporaryRoot, "session.enc.json");
  const key = Buffer.alloc(32, 7);
  const state = {
    cookies: [{
      name: "sessionid",
      value: "plaintext-cookie-must-not-appear-on-disk",
      domain: ".example.com",
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const,
    }],
    origins: [],
  };

  context.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));
  writeEncryptedSessionState(sessionPath, state, key);

  const encryptedFile = await fs.readFile(sessionPath, "utf8");
  assert.doesNotMatch(encryptedFile, /plaintext-cookie-must-not-appear-on-disk/);
  assert.deepEqual(readEncryptedSessionState(sessionPath, key), state);

  const envelope = JSON.parse(encryptedFile) as { ciphertext: string };
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  ciphertext[0] ^= 1;
  envelope.ciphertext = ciphertext.toString("base64");
  await fs.writeFile(sessionPath, JSON.stringify(envelope), "utf8");
  assert.throws(() => readEncryptedSessionState(sessionPath, key));
});

test("publishing session restore uses the existing browser context without creating a target", async () => {
  const addedCookies: unknown[] = [];
  const initScriptArguments: unknown[] = [];
  const browserContext = {
    addCookies: async (cookies: unknown[]) => { addedCookies.push(...cookies); },
    addInitScript: async (_script: unknown, argument: unknown) => { initScriptArguments.push(argument); },
    setStorageState: async () => { throw new Error("setStorageState must not be used for Electron CDP"); },
  } as unknown as BrowserContext;
  const cookie = {
    name: "auth_token",
    value: "test-only",
    domain: ".x.com",
    path: "/",
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: "Lax" as const,
  };

  await installBrowserStorageState(browserContext, {
    cookies: [cookie],
    origins: [{
      origin: "https://x.com",
      localStorage: [{ name: "local", value: "saved" }],
      sessionStorage: [{ name: "session", value: "saved" }],
    }],
  });

  assert.deepEqual(addedCookies, [cookie]);
  assert.deepEqual(initScriptArguments, [{
    "https://x.com": {
      localStorage: [{ name: "local", value: "saved" }],
      sessionStorage: [{ name: "session", value: "saved" }],
    },
  }]);
});
