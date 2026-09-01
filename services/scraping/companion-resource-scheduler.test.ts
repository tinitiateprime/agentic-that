import assert from "node:assert/strict";
import test from "node:test";
import {
  companionResourceSchedulerState,
  resetCompanionResourceSchedulerForTests,
  runCompanionScrapingTask,
  setCompanionPublishingBusyProvider,
} from "./companion-resource-scheduler.js";

(process.env as Record<string, string | undefined>).NODE_ENV = "test";

test("Companion scraping uses one shared slot across platforms", async context => {
  context.after(() => resetCompanionResourceSchedulerForTests());
  let active = 0;
  let maximumActive = 0;
  const run = async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise(resolve => setTimeout(resolve, 20));
    active -= 1;
  };
  await Promise.all([
    runCompanionScrapingTask("instagram", "instagram-one", run),
    runCompanionScrapingTask("facebook", "facebook-one", run),
  ]);
  assert.equal(maximumActive, 1);
  assert.equal(companionResourceSchedulerState().active, null);
});

test("new scraping waits while publishing is busy", async context => {
  context.after(() => resetCompanionResourceSchedulerForTests());
  let busy = true;
  let started = false;
  setCompanionPublishingBusyProvider(() => busy);
  const task = runCompanionScrapingTask("instagram", "publishing-priority", async () => {
    started = true;
  });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(started, false);
  busy = false;
  setCompanionPublishingBusyProvider(() => busy);
  await task;
  assert.equal(started, true);
});

test("a waiting scrape can be cancelled", async context => {
  context.after(() => resetCompanionResourceSchedulerForTests());
  setCompanionPublishingBusyProvider(() => true);
  const controller = new AbortController();
  const task = runCompanionScrapingTask("facebook", "cancelled", async () => undefined, controller.signal);
  controller.abort();
  await assert.rejects(task, error => error instanceof DOMException && error.name === "AbortError");
  assert.equal(companionResourceSchedulerState().queued.length, 0);
});
