import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isAuthenticatedLinkedInUrl } from "./login-browser.ts";

test("provider-sensitive logins use standard Chrome with a loopback-only DevTools endpoint", async () => {
  const source = await readFile(new URL("./login-browser.ts", import.meta.url), "utf8");

  assert.match(source, /spawn\(executablePath/);
  assert.match(source, /--remote-debugging-address=127\.0\.0\.1/);
  assert.match(source, /--profile-directory=Default/);
  assert.match(source, /--new-window/);
  assert.match(source, /\/json\/version/);
  assert.match(source, /chromium\.connectOverCDP\(endpoint\)/);
  assert.match(source, /const targetHost = new URL\(targetUrl\)\.hostname/);
  assert.doesNotMatch(source, /--enable-automation/);
  assert.match(source, /\["x", "linkedin", "youtube"\]\.includes\(account\.platform\)/);
  assert.match(source, /account\.platform === "x" \? 15_000 : 5_000/);
  assert.match(source, /authentication did not remain active during session stabilization/);
});

test("LinkedIn accepts authenticated app pages without depending on changing navigation CSS", () => {
  assert.equal(isAuthenticatedLinkedInUrl("https://www.linkedin.com/feed/"), true);
  assert.equal(isAuthenticatedLinkedInUrl("https://www.linkedin.com/mynetwork/grow/"), true);
  assert.equal(isAuthenticatedLinkedInUrl("https://www.linkedin.com/login"), false);
  assert.equal(isAuthenticatedLinkedInUrl("https://www.linkedin.com/checkpoint/challenge/"), false);
  assert.equal(isAuthenticatedLinkedInUrl("https://example.com/feed/"), false);
});
