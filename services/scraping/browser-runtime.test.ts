import assert from "node:assert/strict";
import test from "node:test";
import {
  operationalBrowserError,
  resolveLocalChromeExecutable,
  scrapingBrowserLaunchArgs,
} from "./browser-runtime.ts";

test("normal Chrome never receives serverless single-process launch flags", () => {
  const args = scrapingBrowserLaunchArgs("local", [
    "--single-process",
    "--no-zygote",
    "--disable-web-security",
    "--headless='shell'",
  ]);

  assert.deepEqual(args, ["--disable-dev-shm-usage", "--disable-gpu", "--no-sandbox"]);
});

test("serverless Chromium retains runtime flags without duplicate base flags", () => {
  const args = scrapingBrowserLaunchArgs("serverless", ["--single-process", "--no-sandbox"]);

  assert.equal(args.filter(value => value === "--no-sandbox").length, 1);
  assert.ok(args.includes("--single-process"));
  assert.ok(args.includes("--disable-dev-shm-usage"));
});

test("configured browser wins over platform defaults only when it exists", () => {
  const available = new Set(["/usr/bin/google-chrome-stable"]);
  const exists = (candidate: string) => available.has(candidate);

  assert.equal(resolveLocalChromeExecutable({
    platform: "linux",
    environment: { PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: "/missing/chrome" },
    exists,
  }), "/usr/bin/google-chrome-stable");
  available.add("/custom/chrome");
  assert.equal(resolveLocalChromeExecutable({
    platform: "linux",
    environment: { PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: "/custom/chrome" },
    exists,
  }), "/custom/chrome");
});

test("browser diagnostics redact configured secrets and URL credentials", () => {
  const previous = process.env.AUTOMATION_INTERNAL_TOKEN;
  process.env.AUTOMATION_INTERNAL_TOKEN = "test-secret-value";
  try {
    const summary = operationalBrowserError(new Error(
      "launch failed with test-secret-value at https://worker:password@example.com --token=another-secret\n[pid=1][err] browser exited safely",
    ));
    assert.doesNotMatch(summary, /test-secret-value|worker:password|another-secret/);
    assert.match(summary, /redacted/i);
    assert.match(summary, /browser exited safely/);
  } finally {
    if (previous === undefined) delete process.env.AUTOMATION_INTERNAL_TOKEN;
    else process.env.AUTOMATION_INTERNAL_TOKEN = previous;
  }
});
