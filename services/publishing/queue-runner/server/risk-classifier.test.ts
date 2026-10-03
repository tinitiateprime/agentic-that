import assert from "node:assert/strict";
import test from "node:test";
import { classifyPublishingRisk } from "./services/risk-classifier.js";

test("publishing risk classifier recognizes platform safety signals", () => {
  assert.equal(classifyPublishingRisk("HTTP 429 Too Many Requests")?.kind, "rate_limit");
  assert.equal(classifyPublishingRisk("Login stopped", "https://x.com/account/access")?.kind, "restriction");
  assert.equal(classifyPublishingRisk("Instagram manual verification did not finish in time")?.kind, "verification");
  assert.equal(classifyPublishingRisk("X did not confirm the post within 90 seconds.")?.kind, "uncertain_publish");
  assert.equal(classifyPublishingRisk("Media file was not found"), null);
});
