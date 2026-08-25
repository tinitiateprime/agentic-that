import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("X login uses a standard Chrome process with a loopback-only DevTools endpoint", async () => {
  const source = await readFile(new URL("./login-browser.ts", import.meta.url), "utf8");

  assert.match(source, /spawn\(executablePath/);
  assert.match(source, /--remote-debugging-address=127\.0\.0\.1/);
  assert.match(source, /--profile-directory=Default/);
  assert.match(source, /--new-window/);
  assert.match(source, /\/json\/version/);
  assert.match(source, /chromium\.connectOverCDP\(endpoint\)/);
  assert.match(source, /filter\(candidate => candidate\.url\(\)\.includes\("x\.com\/"\)\)\.at\(-1\)/);
  assert.doesNotMatch(source, /--enable-automation/);
  assert.match(source, /X_LOGIN_HOLD_MS \?\? 15_000/);
  assert.match(source, /X authentication did not remain active during session stabilization/);
});
