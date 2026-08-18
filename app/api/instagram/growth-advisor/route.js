import {
  accessErrorResponse,
  authorizeApiCapability
} from "@platform/server/access-control";
import {
  GrowthAdvisorError,
  growthAdvisorModel,
  validateAdvisorRequest
} from "@instagram/src/growth-advisor";
import {
  failStaleGrowthAdvisorJob,
  GrowthAdvisorJobStore,
  growthAdvisorJobPayload
} from "@instagram/src/growth-advisor-jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 300_000;
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_LIMIT = 12;
const rateBuckets = globalThis.__agenticThatGrowthAdvisorRateBuckets || new Map();
globalThis.__agenticThatGrowthAdvisorRateBuckets = rateBuckets;
const jobStore = new GrowthAdvisorJobStore();

const configuredApiKey = () => process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || "";

function consumeRateLimit(userId) {
  const now = Date.now();
  const recent = (rateBuckets.get(userId) || []).filter((timestamp) => now - timestamp < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) return false;
  recent.push(now);
  rateBuckets.set(userId, recent);
  if (rateBuckets.size > 1000) {
    for (const [key, timestamps] of rateBuckets) {
      if (!timestamps.some((timestamp) => now - timestamp < RATE_WINDOW_MS)) rateBuckets.delete(key);
    }
  }
  return true;
}

export async function GET(request) {
  let principal;
  try {
    principal = await authorizeApiCapability("scraping.view");
  } catch (error) {
    return accessErrorResponse(error);
  }
  const jobId = new URL(request.url).searchParams.get("job_id")?.trim();
  if (jobId) {
    const storedJob = await jobStore.getJob(jobId);
    const isLegacyOwner = storedJob?.workspaceId === storedJob?.userId
      && storedJob?.userId === principal.userId;
    if (!storedJob || (storedJob.workspaceId !== principal.workspaceId && !isLegacyOwner)) {
      return Response.json({ error: "AI job not found.", code: "AI_JOB_NOT_FOUND" }, { status: 404 });
    }
    const job = await failStaleGrowthAdvisorJob(storedJob, jobStore);
    return Response.json({ ok: true, ...growthAdvisorJobPayload(job) }, {
      headers: { "Cache-Control": "no-store" }
    });
  }
  return Response.json({
    configured: Boolean(configuredApiKey()),
    provider: "gemini",
    model: growthAdvisorModel()
  });
}

export async function POST(request) {
  let principal;
  try {
    principal = await authorizeApiCapability("scraping.analyze");
  } catch (error) {
    return accessErrorResponse(error);
  }

  const apiKey = configuredApiKey();
  if (!apiKey) {
    return Response.json({
      error: "AI is not configured yet. Add GEMINI_API_KEY to the server environment.",
      code: "AI_NOT_CONFIGURED"
    }, { status: 503 });
  }

  if (!consumeRateLimit(principal.userId)) {
    return Response.json({
      error: "Too many AI requests. Wait a few minutes and try again.",
      code: "AI_APP_RATE_LIMITED"
    }, { status: 429 });
  }

  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BYTES) {
      throw new GrowthAdvisorError("The comparison report is too large.", "REQUEST_TOO_LARGE", 413);
    }
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new GrowthAdvisorError("The AI request is not valid JSON.", "INVALID_REQUEST", 400);
    }
    const input = validateAdvisorRequest(body);
    const job = await jobStore.createJob(
      principal.userId,
      input,
      growthAdvisorModel(),
      principal.workspaceId
    );
    return Response.json({ ok: true, ...growthAdvisorJobPayload(job) }, {
      status: 201,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    if (error instanceof GrowthAdvisorError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("Instagram growth advisor failed", error);
    return Response.json({ error: "AI advice could not be generated right now.", code: "AI_ERROR" }, { status: 500 });
  }
}
