import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { ChildProcess } from "node:child_process";
import type { Browser, Page } from "playwright-core";
import {
  gracefullyCloseStandardChrome,
  isAuthenticatedLinkedInPage,
  isAuthenticatedLinkedInUrl,
} from "./login-browser.ts";

test("X and Google logins use standard Chrome while LinkedIn uses the normal persistent context", async () => {
  const source = await readFile(new URL("./login-browser.ts", import.meta.url), "utf8");

  assert.match(source, /spawn\(executablePath/);
  assert.match(source, /--remote-debugging-address=127\.0\.0\.1/);
  assert.match(source, /--profile-directory=Default/);
  assert.match(source, /--new-window/);
  assert.match(source, /\/json\/version/);
  assert.match(source, /chromium\.connectOverCDP\(endpoint\)/);
  assert.match(source, /const targetHost = new URL\(targetUrl\)\.hostname/);
  assert.doesNotMatch(source, /--enable-automation/);
  assert.match(source, /--password-store=basic/);
  assert.match(source, /\["x", "youtube"\]\.includes\(account\.platform\)/);
  assert.doesNotMatch(source, /\["x", "linkedin", "youtube"\]\.includes\(account\.platform\)/);
  assert.match(source, /account\.platform === "x" \? 15_000 : 5_000/);
  assert.match(source, /authentication did not remain active during session stabilization/);
  assert.match(source, /verifySavedSession/);
});

test("standard Chrome is asked to exit gracefully so its saved session is flushed", async () => {
  const child = new EventEmitter() as ChildProcess;
  let exitCode: number | null = null;
  Object.defineProperty(child, "exitCode", { get: () => exitCode });
  let command = "";
  let signal = "";
  child.kill = ((value?: NodeJS.Signals | number) => {
    signal = String(value);
    return true;
  }) as ChildProcess["kill"];
  const browser = {
    newBrowserCDPSession: async () => ({
      send: async (value: string) => {
        command = value;
        exitCode = 0;
        child.emit("exit", 0, null);
      },
    }),
  } as unknown as Browser;

  await gracefullyCloseStandardChrome(browser, child);

  assert.equal(command, "Browser.close");
  assert.equal(signal, "");
});

test("LinkedIn accepts authenticated app pages without depending on changing navigation CSS", () => {
  assert.equal(isAuthenticatedLinkedInUrl("https://www.linkedin.com/feed/"), true);
  assert.equal(isAuthenticatedLinkedInUrl("https://www.linkedin.com/mynetwork/grow/"), true);
  assert.equal(isAuthenticatedLinkedInUrl("https://www.linkedin.com/login"), false);
  assert.equal(isAuthenticatedLinkedInUrl("https://www.linkedin.com/checkpoint/challenge/"), false);
  assert.equal(isAuthenticatedLinkedInUrl("https://example.com/feed/"), false);
});

test("LinkedIn accepts a visibly authenticated feed when CDP omits its session cookie", async () => {
  const page = {
    url: () => "https://www.linkedin.com/feed/",
    locator: () => ({ first: () => ({ isVisible: async () => true }) }),
  } as unknown as Page;
  assert.equal(await isAuthenticatedLinkedInPage(page), true);
});
