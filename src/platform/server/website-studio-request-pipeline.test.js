import assert from "node:assert/strict";
import test from "node:test";
import { advanceWebsiteRequestPipeline } from "./website-studio-request-pipeline.js";

test("request delivery resumes all service photos and six visual checks before sending once", async () => {
  const services = Array.from({ length: 9 }, (_, i) => ({ name: `Service ${i}`, slug: `service-${i}` }));
  let staged = 0;
  let ready = 0;
  let delivered = 0;
  let job = { stage: "ai", token: "private-preview-token", profile: {} };
  const dependencies = {
    generate: async () => ({ state: {}, result: { spec: { services }, qa: { passed: true, checks: [] }, usage: {}, attempts: 1 } }),
    resolveMedia: async spec => ({ hero: { src: "https://photos.example.test/hero" }, services: Object.fromEntries(spec.services.map(item => [item.slug, { src: `https://photos.example.test/${item.slug}` }])) }),
    verifyMedia: async (_media, options) => ({ passed: true, checks: [{ id: `photo-${options.offset}`, passed: true }], complete: options.offset === 1 }),
    stagePreview: async state => { staged++; assert.equal(Object.keys(state.generated.spec.media.services).length, 9); },
    previewLinks: token => { assert.equal(token, "private-preview-token"); return { editorial: "editorial", momentum: "momentum", aura: "aura" }; },
    renderQa: async (links, options) => ({ passed: true, checks: [{ key: `render-${Object.keys(links)[0]}-${options.viewportNames[0]}`, passed: true }] }),
    markReady: async state => { ready++; assert.equal(state.renderChecks.length, 6); },
    deliver: async () => { assert.equal(ready, 1); delivered++; },
    fail: async () => { assert.fail("Valid pipeline should succeed"); },
  };
  for (let step = 0; step < 20 && job.stage !== "complete"; step++) {
    job = JSON.parse(JSON.stringify(await advanceWebsiteRequestPipeline(job, dependencies)));
    if (ready === 0) assert.equal(delivered, 0);
  }
  assert.equal(job.stage, "complete");
  assert.equal(staged, 1);
  assert.equal(delivered, 1);
  assert.equal(job.token, undefined);
});

test("transient AI errors preserve progress but invalid render QA prevents delivery", async () => {
  const job = { stage: "ai", aiState: { core: "saved" }, token: "private", profile: {} };
  let failed = 0;
  const retried = await advanceWebsiteRequestPipeline(job, {
    generate: async () => { throw Object.assign(new Error("busy"), { code: "AI_TEMPORARILY_BUSY" }); },
    fail: async () => { failed++; },
  });
  assert.equal(retried.stage, "ai");
  assert.equal(retried.aiState.core, "saved");
  assert.equal(retried.retries, 1);
  const invalid = await advanceWebsiteRequestPipeline({ stage: "render", token: "private", generated: {}, renderChecks: [] }, {
    previewLinks: () => ({ editorial: "preview" }),
    renderQa: async () => ({ passed: false, checks: [] }),
    fail: async () => { failed++; },
    deliver: async () => { assert.fail("Unreviewed sites must not be emailed"); },
  });
  assert.equal(invalid.stage, "failed");
  assert.equal(invalid.token, undefined);
  assert.equal(failed, 1);
});
