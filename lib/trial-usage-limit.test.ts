import assert from "node:assert/strict";
import test from "node:test";
import { RollingTrialUsageLimiter } from "./trial-usage-limit.ts";

test("rolling trial limits isolate keys and reopen after the window", () => {
  const limiter = new RollingTrialUsageLimiter();
  assert.equal(limiter.check("workspace-a:profile-a", 2, 60_000, 500).remaining, 2);
  assert.equal(limiter.check("workspace-a:profile-a", 2, 60_000, 600).remaining, 2);
  assert.equal(limiter.consume("workspace-a:profile-a", 2, 60_000, 1_000).allowed, true);
  assert.equal(limiter.consume("workspace-a:profile-a", 2, 60_000, 2_000).allowed, true);
  const blocked = limiter.consume("workspace-a:profile-a", 2, 60_000, 3_000);
  assert.equal(blocked.allowed, false);
  assert.equal(limiter.consume("workspace-a:profile-b", 2, 60_000, 3_000).allowed, true);
  assert.equal(limiter.consume("workspace-a:profile-a", 2, 60_000, 61_001).allowed, true);
});
