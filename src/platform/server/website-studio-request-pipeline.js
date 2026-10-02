import { generateWebsiteSpecStep, WebsiteStudioError, websiteStudioModels, websiteStudioThemes } from "./website-studio-ai.js";
import { resolveWebsiteMedia, verifyWebsiteMedia } from "./website-studio-media.js";
import { runWebsiteRenderQa } from "./website-studio-render-qa.js";

// Each call completes one bounded step. The caller persists this private state
// in Supabase before responding; it never sends the preview token to polling UI.
export async function advanceWebsiteRequestPipeline(job, dependencies) {
  const next = structuredClone(job);
  const generate = dependencies.generate || generateWebsiteSpecStep;
  const resolveMedia = dependencies.resolveMedia || resolveWebsiteMedia;
  const verifyMedia = dependencies.verifyMedia || verifyWebsiteMedia;
  const renderQa = dependencies.renderQa || runWebsiteRenderQa;
  try {
    switch (job.stage) {
      case "ai": {
        const models = websiteStudioModels();
        const offset = (job.retries || 0) % models.length;
        const result = await generate(job.profile, job.aiState, { models: [...models.slice(offset), ...models.slice(0, offset)] });
        next.aiState = result.state;
        if (result.result) { next.generated = result.result; delete next.aiState; next.stage = "media"; }
        break;
      }
      case "media": {
        const media = await resolveMedia({ ...job.generated.spec, services: [] }, job.profile, { timeoutMs: 8_000 });
        if (!media.hero) throw new WebsiteStudioError("Professional website photos are unavailable.", "WEBSITE_IMAGES_UNAVAILABLE", 502);
        next.generated.spec.media = media;
        next.serviceOffset = 0;
        next.stage = "service-media";
        break;
      }
      case "service-media": {
        const services = job.generated.spec.services.slice(job.serviceOffset, job.serviceOffset + 4);
        if (services.length) {
          const media = await resolveMedia({ ...job.generated.spec, services }, job.profile, { timeoutMs: 8_000 });
          next.generated.spec.media.services = { ...job.generated.spec.media.services, ...media.services };
        }
        next.serviceOffset += services.length;
        if (next.serviceOffset >= job.generated.spec.services.length) next.stage = "verify-media";
        break;
      }
      case "verify-media": {
        const result = await verifyMedia(job.generated.spec.media, { offset: job.mediaOffset || 0, limit: 4, timeoutMs: 8_000 });
        if (!result.passed) throw new WebsiteStudioError("Website photos failed availability checks.", "WEBSITE_IMAGES_UNAVAILABLE", 502);
        next.mediaChecks = [...(job.mediaChecks || []), ...result.checks];
        next.mediaOffset = (job.mediaOffset || 0) + result.checks.length;
        if (result.complete) {
          next.generated.qa.checks.push(
            { key: "professional-media", passed: true, message: "Professional photography is attached to the website." },
            { key: "media-availability", passed: true, message: `${next.mediaChecks.length} selected photos were verified.` },
          );
          await dependencies.stagePreview(next);
          next.stage = "render";
          next.renderChecks = [];
        }
        break;
      }
      case "render": {
        const index = job.renderChecks.length;
        const theme = websiteStudioThemes()[Math.floor(index / 2)];
        const viewport = index % 2 ? "mobile" : "desktop";
        const links = dependencies.previewLinks(job.token);
        const result = await renderQa({ [theme]: links[theme] }, { viewportNames: [viewport], maxAttempts: 1, timeoutMs: 12_000, budgetMs: 22_000 });
        if (!result.passed) throw new WebsiteStudioError("The generated concepts did not pass visual QA.", "RENDER_QA_FAILED", 502);
        next.renderChecks.push(...result.checks);
        if (next.renderChecks.length === 6) {
          next.generated.qa = { ...next.generated.qa, passed: true, checks: [...next.generated.qa.checks, ...next.renderChecks], renderedAt: result.checkedAt };
          await dependencies.markReady(next);
          next.stage = "email";
        }
        break;
      }
      case "email":
        await dependencies.deliver(next);
        next.stage = "complete";
        delete next.token;
        delete next.generated;
        break;
      default: throw new Error("Unknown website generation step.");
    }
    next.retries = 0;
    delete next.lastError;
  } catch (error) {
    next.retries = (job.retries || 0) + 1;
    const retryable = error instanceof TypeError || ["AI_TRANSIENT", "AI_TEMPORARILY_BUSY", "AI_QA_FAILED", "EMPTY_AI_RESPONSE", "INVALID_AI_RESPONSE", "AI_MODEL_FORBIDDEN"].includes(error.code) || (error.code === "AI_PROVIDER_ERROR" && error.status === 404);
    next.lastError = error instanceof Error ? error.message : "Website generation failed.";
    if (!retryable || next.retries >= 12) {
      await dependencies.fail(next, error);
      next.stage = job.stage === "email" ? "complete" : "failed";
      delete next.token;
      delete next.generated;
      delete next.aiState;
    }
  }
  return next;
}
