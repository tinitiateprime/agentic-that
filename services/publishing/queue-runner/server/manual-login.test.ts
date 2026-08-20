import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright-core";
import { waitForLoginWithManualFallback } from "./services/publishers/manual-login.js";

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
