import { accessErrorResponse, authorizeApiCapabilityForRequest } from "@platform/server/access-control";
import {
  automationServerBridgeConfig,
  automationServerRequest,
} from "@platform/server/automation-server-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
const SERVER_MEDIA_LIMITS = new Map([
  ["image/jpeg", MAX_IMAGE_BYTES],
  ["image/png", MAX_IMAGE_BYTES],
  ["video/mp4", MAX_VIDEO_BYTES],
  ["video/quicktime", MAX_VIDEO_BYTES],
]);

function unavailable() {
  return Response.json({ message: "Server automation integration is disabled." }, { status: 404 });
}

function failure(error) {
  try {
    return accessErrorResponse(error);
  } catch {
    return Response.json({ message: error instanceof Error ? error.message : "The server publishing request failed." }, { status: 400 });
  }
}

async function parts(context) {
  const params = await context.params;
  return (params?.path || []).map(value => decodeURIComponent(String(value)));
}

function upstreamResponse(response) {
  const headers = new Headers();
  const contentType = response.headers.get("content-type");
  const cacheControl = response.headers.get("cache-control");
  if (contentType) headers.set("content-type", contentType);
  if (cacheControl) headers.set("cache-control", cacheControl);
  else headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, headers });
}

async function jsonBody(request) {
  return request.json().catch(() => ({}));
}

function workspaceQuery(workspaceId, values = {}) {
  const query = new URLSearchParams({ workspaceId, ...values });
  return query.toString();
}

export async function GET(request, context) {
  try {
    const config = automationServerBridgeConfig();
    if (!config) return unavailable();
    const route = await parts(context);
    let endpoint;
    if (route.length === 1 && route[0] === "health") {
      await authorizeApiCapabilityForRequest(request, "publishing.view", "publishing");
      endpoint = "/health";
    } else if (route.length >= 1 && route[0] === "scraping") {
      const principal = await authorizeApiCapabilityForRequest(request, "scraping.view", "scraping");
      if (route.length === 1) endpoint = `/v1/scraping/jobs?${workspaceQuery(principal.workspaceId, { limit: "50" })}`;
      else if (route.length === 2) endpoint = `/v1/scraping/jobs/${encodeURIComponent(route[1])}?${workspaceQuery(principal.workspaceId)}`;
      else if (route.length === 3 && route[2] === "result") {
        await authorizeApiCapabilityForRequest(request, "scraping.analyze", "scraping");
        endpoint = `/v1/scraping/jobs/${encodeURIComponent(route[1])}/result?${workspaceQuery(principal.workspaceId)}`;
      }
    } else {
      const principal = await authorizeApiCapabilityForRequest(request, "publishing.view", "publishing");
      if (route.length === 1 && route[0] === "accounts") endpoint = `/v1/accounts?${workspaceQuery(principal.workspaceId)}`;
      else if (route.length === 1 && route[0] === "jobs") endpoint = `/v1/publishing/jobs?${workspaceQuery(principal.workspaceId, { limit: "50" })}`;
      else if (route.length === 2 && route[0] === "sessions") {
        await authorizeApiCapabilityForRequest(request, "publishing.accounts.configure", "publishing");
        endpoint = `/v1/login-sessions/${encodeURIComponent(route[1])}?${workspaceQuery(principal.workspaceId)}`;
      } else if (route.length === 3 && route[0] === "sessions" && route[2] === "frame") {
        await authorizeApiCapabilityForRequest(request, "publishing.accounts.configure", "publishing");
        endpoint = `/v1/login-sessions/${encodeURIComponent(route[1])}/frame?${workspaceQuery(principal.workspaceId)}`;
      } else if (route.length === 3 && route[0] === "jobs" && route[2] === "diagnostic-frame") {
        endpoint = `/v1/publishing/jobs/${encodeURIComponent(route[1])}/diagnostic-frame?${workspaceQuery(principal.workspaceId)}`;
      }
    }
    if (!endpoint) return unavailable();
    return upstreamResponse(await automationServerRequest(config, endpoint));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request, context) {
  try {
    const config = automationServerBridgeConfig();
    if (!config) return unavailable();
    const route = await parts(context);
    if (route.length === 1 && route[0] === "scraping") {
      const principal = await authorizeApiCapabilityForRequest(request, "scraping.run", "scraping");
      const body = await jsonBody(request);
      return upstreamResponse(await automationServerRequest(config, "/v1/scraping/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: principal.workspaceId,
          platform: body.platform,
          input: body.input,
          idempotencyKey: body.idempotencyKey,
        }),
      }));
    }
    if (route.length === 1 && route[0] === "accounts") {
      const principal = await authorizeApiCapabilityForRequest(request, "publishing.accounts.configure", "publishing");
      const body = await jsonBody(request);
      return upstreamResponse(await automationServerRequest(config, "/v1/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: principal.workspaceId, platform: body.platform, displayName: body.displayName }),
      }));
    }
    if (route.length === 3 && route[0] === "accounts" && route[2] === "login") {
      const principal = await authorizeApiCapabilityForRequest(request, "publishing.accounts.configure", "publishing");
      return upstreamResponse(await automationServerRequest(config, `/v1/accounts/${encodeURIComponent(route[1])}/login-sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: principal.workspaceId, surface: "website" }),
      }));
    }
    if (route.length === 3 && route[0] === "sessions" && route[2] === "input") {
      const principal = await authorizeApiCapabilityForRequest(request, "publishing.accounts.configure", "publishing");
      const body = await jsonBody(request);
      const inputs = Array.isArray(body.inputs) ? body.inputs : [body.input];
      if (!inputs.length || inputs.length > 32) throw new Error("Browser input batches must contain between 1 and 32 actions.");
      return upstreamResponse(await automationServerRequest(config, `/v1/login-sessions/${encodeURIComponent(route[1])}/input`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: principal.workspaceId, inputs }),
      }));
    }
    if (route.length === 2 && route[0] === "media" && route[1] === "uploads") {
      const principal = await authorizeApiCapabilityForRequest(request, "publishing.content.create", "publishing");
      const body = await jsonBody(request);
      return upstreamResponse(await automationServerRequest(config, "/v1/media/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: principal.workspaceId,
          fileName: body.fileName,
          mimeType: body.mimeType,
          size: body.size,
        }),
      }));
    }
    if (route.length === 4 && route[0] === "media" && route[1] === "uploads" && route[3] === "complete") {
      const principal = await authorizeApiCapabilityForRequest(request, "publishing.content.create", "publishing");
      return upstreamResponse(await automationServerRequest(config, `/v1/media/uploads/${encodeURIComponent(route[2])}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: principal.workspaceId }),
      }));
    }
    if (route.length === 1 && route[0] === "media") {
      const principal = await authorizeApiCapabilityForRequest(request, "publishing.content.create", "publishing");
      const mimeType = String(request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
      const limit = SERVER_MEDIA_LIMITS.get(mimeType);
      if (!limit) throw new Error("Choose one JPEG, PNG, MP4, or MOV file.");
      const contentLength = Number(request.headers.get("content-length") || 0);
      if (contentLength > limit) throw new Error(`Server publishing ${mimeType.startsWith("video/") ? "videos" : "images"} must be ${limit / 1024 / 1024} MB or smaller.`);
      const bytes = Buffer.from(await request.arrayBuffer());
      if (!bytes.length || bytes.length > limit) throw new Error(`Server publishing media must be between 1 byte and ${limit / 1024 / 1024} MB.`);
      const fileName = String(request.headers.get("x-file-name") || "").trim();
      if (!fileName) throw new Error("The media filename is required.");
      return upstreamResponse(await automationServerRequest(config, "/v1/media", {
        method: "POST",
        headers: {
          "content-type": mimeType,
          "x-agenticthat-workspace-id": principal.workspaceId,
          "x-agenticthat-file-name": encodeURIComponent(fileName),
        },
        body: bytes,
      }));
    }
    if (route.length === 1 && route[0] === "jobs") {
      const principal = await authorizeApiCapabilityForRequest(request, "publishing.execute", "publishing");
      const body = await jsonBody(request);
      if (body.liveConfirmation !== "PUBLISH") throw new Error("Explicit PUBLISH confirmation is required.");
      return upstreamResponse(await automationServerRequest(config, "/v1/publishing/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: principal.workspaceId,
          accountId: body.accountId,
          scheduledAt: body.scheduledAt,
          originalTimezone: body.originalTimezone,
          caption: body.caption,
          media: body.media,
          platformOptions: body.platformOptions,
          idempotencyKey: body.idempotencyKey,
          liveConfirmation: "PUBLISH",
        }),
      }));
    }
    if (route.length === 3 && route[0] === "jobs" && route[2] === "resolve") {
      const principal = await authorizeApiCapabilityForRequest(request, "publishing.schedule.manage", "publishing");
      const body = await jsonBody(request);
      return upstreamResponse(await automationServerRequest(
        config,
        `/v1/publishing/jobs/${encodeURIComponent(route[1])}/resolve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workspaceId: principal.workspaceId,
            resolvedBy: principal.userId,
            resolution: body.resolution,
            note: body.note,
            platformPostId: body.platformPostId,
            platformPostUrl: body.platformPostUrl,
          }),
        },
      ));
    }
    return unavailable();
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request, context) {
  try {
    const config = automationServerBridgeConfig();
    if (!config) return unavailable();
    const route = await parts(context);
    if (route.length !== 3 || route[0] !== "media" || route[1] !== "uploads") return unavailable();
    const principal = await authorizeApiCapabilityForRequest(request, "publishing.content.create", "publishing");
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 4 * 1024 * 1024) throw new Error("Media upload chunks must be 4 MB or smaller.");
    const bytes = Buffer.from(await request.arrayBuffer());
    if (!bytes.length || bytes.length > 4 * 1024 * 1024) throw new Error("Media upload chunks must be between 1 byte and 4 MB.");
    const offset = Number(request.headers.get("x-upload-offset"));
    return upstreamResponse(await automationServerRequest(config, `/v1/media/uploads/${encodeURIComponent(route[2])}`, {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        "x-agenticthat-workspace-id": principal.workspaceId,
        "x-agenticthat-upload-offset": String(offset),
      },
      body: bytes,
    }));
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request, context) {
  try {
    const config = automationServerBridgeConfig();
    if (!config) return unavailable();
    const route = await parts(context);
    if (route.length === 2 && route[0] === "accounts") {
      const principal = await authorizeApiCapabilityForRequest(request, "publishing.accounts.configure", "publishing");
      const body = await jsonBody(request);
      return upstreamResponse(await automationServerRequest(config, `/v1/accounts/${encodeURIComponent(route[1])}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: principal.workspaceId, displayName: body.displayName, enabled: body.enabled }),
      }));
    }
    return unavailable();
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request, context) {
  try {
    const config = automationServerBridgeConfig();
    if (!config) return unavailable();
    const route = await parts(context);
    if (route.length === 3 && route[0] === "media" && route[1] === "uploads") {
      const principal = await authorizeApiCapabilityForRequest(request, "publishing.content.create", "publishing");
      return upstreamResponse(await automationServerRequest(
        config,
        `/v1/media/uploads/${encodeURIComponent(route[2])}?${workspaceQuery(principal.workspaceId)}`,
        { method: "DELETE" },
      ));
    }
    if (route.length === 2 && route[0] === "accounts") {
      const principal = await authorizeApiCapabilityForRequest(request, "publishing.accounts.configure", "publishing");
      return upstreamResponse(await automationServerRequest(
        config,
        `/v1/accounts/${encodeURIComponent(route[1])}?${workspaceQuery(principal.workspaceId)}`,
        { method: "DELETE" },
      ));
    }
    if (route.length === 2 && route[0] === "sessions") {
      const principal = await authorizeApiCapabilityForRequest(request, "publishing.accounts.configure", "publishing");
      return upstreamResponse(await automationServerRequest(
        config,
        `/v1/login-sessions/${encodeURIComponent(route[1])}?${workspaceQuery(principal.workspaceId)}`,
        { method: "DELETE" },
      ));
    }
    if (route.length === 2 && route[0] === "jobs") {
      const principal = await authorizeApiCapabilityForRequest(request, "publishing.schedule.manage", "publishing");
      return upstreamResponse(await automationServerRequest(
        config,
        `/v1/publishing/jobs/${encodeURIComponent(route[1])}?${workspaceQuery(principal.workspaceId)}`,
        { method: "DELETE" },
      ));
    }
    return unavailable();
  } catch (error) {
    return failure(error);
  }
}
