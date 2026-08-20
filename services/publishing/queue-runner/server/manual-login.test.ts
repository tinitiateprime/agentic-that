import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright-core";
import { waitForLoginWithManualFallback, waitForSavedSessionVerification } from "./services/publishers/manual-login.js";

test("manual login reports a closed browser with a useful retry message", async () => {
  const page = {
    isClosed: () => true,
  } as unknown as Page;

  await assert.rejects(
    waitForLoginWithManualFallback({
      page,
      platform: "YouTube",
      normalTimeoutMs: 100,
      isLoggedIn: async () => false,
      isManualVerificationVisible: async () => false,
    }),
    /YouTube login window was closed before sign-in completed\. Open Login and try again\./,
  );
});

test("saved session verification waits for a delayed authenticated page", async () => {
  let checks = 0;
  const page = {
    isClosed: () => false,
    waitForTimeout: async () => undefined,
  } as unknown as Page;

  await waitForSavedSessionVerification({
    page,
    platform: "X",
    timeoutMs: 1000,
    isLoggedIn: async () => ++checks >= 3,
  });

  assert.equal(checks, 3);
});

test("saved session verification returns the reconnect instruction after its deadline", async () => {
  const page = {
    isClosed: () => false,
    waitForTimeout: async () => undefined,
  } as unknown as Page;

  await assert.rejects(
    waitForSavedSessionVerification({
      page,
      platform: "YouTube",
      timeoutMs: 0,
      isLoggedIn: async () => false,
    }),
    /YouTube saved browser session is not active\. Open this account's Login action/,
  );
});
