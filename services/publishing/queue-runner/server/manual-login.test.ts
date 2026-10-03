import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright-core";
import { publishingEngineForPlatform, selectManualLoginSurface } from "./services/login-surface.js";
import { waitForLoginWithManualFallback, waitForSavedSessionVerification } from "./services/publishers/manual-login.js";

test("Facebook, X, and YouTube login opens in persistent external Chrome or Edge", () => {
  for (const platform of ["facebook", "x", "youtube"] as const) {
    assert.equal(selectManualLoginSurface({
      platform,
      requestedSurface: "engine",
      activeEngine: "companion",
      credentialConfigured: false,
      externalProfilePresent: false,
      embeddedBrowserAvailable: true,
    }), "external");
  }
});

test("normal Instagram and LinkedIn login remains embedded", () => {
  for (const platform of ["instagram", "linkedin"] as const) {
    assert.equal(selectManualLoginSurface({
      platform,
      requestedSurface: "engine",
      activeEngine: "companion",
      credentialConfigured: false,
      externalProfilePresent: false,
      embeddedBrowserAvailable: true,
    }), "embedded");
  }
});

test("normal reconnect preserves a provider-bound managed Chrome session", () => {
  assert.equal(selectManualLoginSurface({
    platform: "linkedin",
    requestedSurface: "engine",
    activeEngine: "external_browser",
    credentialConfigured: true,
    externalProfilePresent: true,
    embeddedBrowserAvailable: true,
  }), "external");
});

test("Facebook, X, and YouTube cannot be forced into an embedded login surface", () => {
  for (const platform of ["facebook", "x", "youtube"] as const) {
    assert.equal(selectManualLoginSurface({
      platform,
      requestedSurface: "embedded",
      activeEngine: "companion",
      credentialConfigured: false,
      externalProfilePresent: false,
      embeddedBrowserAvailable: true,
    }), "external");
  }
});

test("Facebook, X, and YouTube always use the persistent external publishing engine", () => {
  assert.equal(publishingEngineForPlatform("facebook", "companion"), "external_browser");
  assert.equal(publishingEngineForPlatform("x", "companion"), "external_browser");
  assert.equal(publishingEngineForPlatform("youtube", "companion"), "external_browser");
  assert.equal(publishingEngineForPlatform("instagram", "companion"), "companion");
  assert.equal(publishingEngineForPlatform("instagram", "external_browser"), "external_browser");
});

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
