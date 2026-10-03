import { AccessDeniedError, accessErrorResponse, authorizeApiCapability, principalHasAccess } from "@platform/server/access-control";
import {
  cancelSupabaseJob,
  createSupabaseJob,
  getSupabaseJob,
  latestSupabaseCompanion,
  listSupabaseJobs,
} from "@platform/server/supabase-job-control";

export const runtime = "nodejs";

const PLATFORMS = new Set(["instagram", "facebook"]);
const MAX_PAYLOAD_BYTES = 512 * 1024;

function fail(error) {
  try {
    return accessErrorResponse(error);
  } catch {
    return Response.json({ message: error instanceof Error ? error.message : "The scraping job request failed." }, { status: 400 });
  }
}

async function routeParts(context) {
  const params = await context.params;
  return (params?.path || []).map((value) => decodeURIComponent(String(value)));
}

function requirePlatform(principal, value, level = "view") {
  const platform = String(value || "").toLowerCase();
  if (!PLATFORMS.has(platform)) throw new Error("Choose a supported Companion scraper.");
  if (!principalHasAccess(principal, `scraping.${platform}`, level)) {
    throw new AccessDeniedError(403, "ACCESS_DENIED", `Your role does not include ${level} access to scraping.${platform}.`);
  }
  return platform;
}

function assertSafeJobPayload(value, depth = 0) {
  if (depth > 12) throw new Error("The scraping request is too deeply nested.");
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(password|passphrase|secret|apiKey|authorization|cookie|cookies|credential|credentials|storageState|accessToken|refreshToken|session|sessionToken)$/i.test(key)) {
      throw new Error("Social login sessions and credentials must remain inside Companion.");
    }
    assertSafeJobPayload(child, depth + 1);
  }
}

function clientResponse(remote) {
  if (!remote) return null;
  const stored = remote.result?.result && typeof remote.result.result === "object" ? remote.result.result : {};
  const status = remote.status === "success"
    ? "complete"
    : remote.status === "cancel_requested" ? "running"
      : ["claimed", "running"].includes(remote.status) ? "running"
        : remote.status === "cancelled" ? "cancelled"
          : remote.status === "failed" || remote.status === "uncertain" ? "failed" : "queued";
  return {
    ...stored,
    job: {
      ...(stored.job || {}),
      id: remote.id,
      engine: "companion",
      status,
      progress: remote.progress || stored.job?.progress || { stage: status, message: remote.message || "" },
      error: remote.error || remote.result?.error || stored.job?.error,
      createdAt: remote.createdAt,
      updatedAt: remote.updatedAt,
      startedAt: remote.startedAt,
      completedAt: remote.completedAt,
    },
  };
}

export async function GET(_request, context) {
  try {
    const [platformValue, resource, jobId] = await routeParts(context);
    const principal = await authorizeApiCapability("scraping.view");
    const platform = requirePlatform(principal, platformValue, "view");
    if (resource === "status" && !jobId) {
      const companion = await latestSupabaseCompanion(principal.workspaceId);
      const ready = Boolean(companion);
      return Response.json({
        ready,
        companion,
        message: companion?.status === "online"
          ? "Ready on the paired Companion"
          : ready ? "Companion is offline; new jobs will remain safely queued." : "No Companion is paired yet.",
      });
    }
    if (resource === "runs" && !jobId) {
      const jobs = await listSupabaseJobs(principal.workspaceId, { type: `scrape.${platform}`, limit: 50 });
      const completed = jobs.filter((job) => job.status === "success").slice(0, 30);
      const results = await Promise.all(completed.map((job) => getSupabaseJob(principal.workspaceId, job.id)));
      return Response.json({
        runs: results.map((job) => {
          const stored = job?.result?.result || {};
          return stored.run ? { ...stored.run, id: job.id, createdAt: job.completedAt || stored.run.createdAt } : null;
        }).filter(Boolean),
      });
    }
    if (resource !== "jobs" || !jobId) return Response.json({ message: "Scraping job endpoint was not found." }, { status: 404 });
    const remote = await getSupabaseJob(principal.workspaceId, jobId);
    if (!remote || remote.type !== `scrape.${platform}`) return Response.json({ message: "Scraping job was not found." }, { status: 404 });
    return Response.json(clientResponse(remote));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request, context) {
  try {
    const [platformValue, resource] = await routeParts(context);
    const principal = await authorizeApiCapability("scraping.run");
    const platform = requirePlatform(principal, platformValue, "operate");
    if (resource !== "jobs") return Response.json({ message: "Scraping job endpoint was not found." }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("The scraping request must be a JSON object.");
    if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_PAYLOAD_BYTES) throw new Error("The scraping request is too large.");
    assertSafeJobPayload(body);
    const job = await createSupabaseJob({
      workspaceId: principal.workspaceId,
      userId: principal.userId,
      type: `scrape.${platform}`,
      platform,
      idempotencyKey: request.headers.get("idempotency-key") || undefined,
      payload: body,
      priority: 100,
      maxAttempts: 3,
    });
    return Response.json(clientResponse(job), { status: 202 });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request, context) {
  try {
    const [platformValue, resource, jobId] = await routeParts(context);
    const principal = await authorizeApiCapability("scraping.run");
    const platform = requirePlatform(principal, platformValue, "operate");
    if (resource !== "jobs" || !jobId) return Response.json({ message: "Scraping job endpoint was not found." }, { status: 404 });
    const existing = await getSupabaseJob(principal.workspaceId, jobId);
    if (!existing || existing.type !== `scrape.${platform}`) return Response.json({ message: "Scraping job was not found." }, { status: 404 });
    return Response.json(clientResponse(await cancelSupabaseJob(principal.workspaceId, jobId)));
  } catch (error) {
    return fail(error);
  }
}
