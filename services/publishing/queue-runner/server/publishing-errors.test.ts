import assert from "node:assert/strict";
import test from "node:test";
import { explainPublishingError } from "./services/publishing-errors.js";

test("failed posts are explained in plain words, with the technical detail kept short", () => {
  const covered = "locator.click: Timeout 10000ms exceeded.\nCall log:\n  - <div class=\"css\"></div> subtree intercepts pointer events";
  assert.equal(explainPublishingError("x", covered), "Something on X's page covered the button the Companion needed to click. Detail: locator.click: Timeout 10000ms exceeded.");
  assert.match(explainPublishingError("linkedin", "locator.click: Timeout 10000ms exceeded.\nwaiting for locator('button')"), /^LinkedIn's page didn't show what the Companion expected in time/);
  assert.match(explainPublishingError("facebook", "page.goto: net::ERR_INTERNET_DISCONNECTED at https://www.facebook.com/"), /couldn't reach Facebook/);
  assert.match(explainPublishingError("youtube", "Target page, context or browser has been closed"), /The YouTube window was closed/);
  assert.equal(explainPublishingError("instagram", "Instagram does not support text-only feed posts."), "Instagram does not support text-only feed posts.", "plain messages stay as they are");
});
