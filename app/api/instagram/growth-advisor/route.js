import { getCurrentPlatformUser } from "@platform/server/auth-store";
import {
  GrowthAdvisorError,
  growthAdvisorModel,
  requestGeminiGrowthAdvice,
  validateAdvisorRequest
} from "@instagram/src/growth-advisor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 300_000;
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_LIMIT = 12;
const DEFAULT_AI_TIMEOUT_MS = 25_000;
const rateBuckets = globalThis.__agenticThatGrowthAdvisorRateBuckets || new Map();
globalThis.__agenticThatGrowthAdvisorRateBuckets = rateBuckets;

const configuredApiKey = () => process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || "";

const configuredTimeoutMs = () => {
  const value = Number(process.env.GEMINI_TIMEOUT_MS);
  return Number.isFinite(value) && value >= 5_000
    ? Math.min(Math.round(value), 50_000)
    : DEFAULT_AI_TIMEOUT_MS;
};

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

export async function GET() {
  const user = await getCurrentPlatformUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({
    configured: Boolean(configuredApiKey()),
    provider: "gemini",
    model: growthAdvisorModel()
  });
}

export async function POST(request) {
  const user = await getCurrentPlatformUser();
  if (!user) return Response.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });

  const apiKey = configuredApiKey();
  if (!apiKey) {
    return Response.json({
      error: "AI is not configured yet. Add GEMINI_API_KEY to the server environment.",
      code: "AI_NOT_CONFIGURED"
    }, { status: 503 });
  }

  if (!consumeRateLimit(user.id)) {
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), configuredTimeoutMs());
    try {
      const result = await requestGeminiGrowthAdvice({
        ...input,
        apiKey,
        model: growthAdvisorModel(),
        signal: controller.signal,
        onTelemetry: (event) => console.info("Instagram growth advisor Gemini", event)
      });
      return Response.json({ ok: true, result, provider: "gemini", model: growthAdvisorModel() });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      console.warn("Instagram growth advisor Gemini timed out", { timeoutMs: configuredTimeoutMs() });
      return Response.json({ error: "AI took too long. Please try again.", code: "AI_TIMEOUT" }, { status: 504 });
    }
    if (error instanceof GrowthAdvisorError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("Instagram growth advisor failed", error);
    return Response.json({ error: "AI advice could not be generated right now.", code: "AI_ERROR" }, { status: 500 });
  }
}
