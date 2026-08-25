import { accessErrorResponse, authorizeApiCapability } from "@platform/server/access-control";
import {
  automationServerBridgeConfig,
  automationServerRequest,
} from "@platform/server/automation-server-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

function unavailable() {
  return Response.json({ message: "Server publishing integration is disabled." }, { status: 404 });
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

export async function GET(_request, context) {
  try {
    const config = automationServerBridgeConfig();
    if (!config) return unavailable();
    const route = await parts(context);
    const principal = await authorizeApiCapability("publishing.view");
    let endpoint;
    if (route.length === 1 && route[0] === "health") endpoint = "/health";
    else if (route.length === 1 && route[0] === "accounts") endpoint = `/v1/accounts?${workspaceQuery(principal.workspaceId)}`;
    else if (route.length === 1 && route[0] === "jobs") endpoint = `/v1/publishing/jobs?${workspaceQuery(principal.workspaceId, { limit: "50" })}`;
    else if (route.length === 2 && route[0] === "sessions") {
      await authorizeApiCapability("publishing.accounts.configure");
      endpoint = `/v1/login-sessions/${encodeURIComponent(route[1])}?${workspaceQuery(principal.workspaceId)}`;
    } else if (route.length === 3 && route[0] === "sessions" && route[2] === "frame") {
      await authorizeApiCapability("publishing.accounts.configure");
      endpoint = `/v1/login-sessions/${encodeURIComponent(route[1])}/frame?${workspaceQuery(principal.workspaceId)}`;
    } else if (route.length === 3 && route[0] === "jobs" && route[2] === "diagnostic-frame") {
      endpoint = `/v1/publishing/jobs/${encodeURIComponent(route[1])}/diagnostic-frame?${workspaceQuery(principal.workspaceId)}`;
    } else return unavailable();
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
    if (route.length === 1 && route[0] === "accounts") {
      const principal = await authorizeApiCapability("publishing.accounts.configure");
      const body = await jsonBody(request);
      return upstreamResponse(await automationServerRequest(config, "/v1/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: principal.workspaceId, platform: "instagram", displayName: body.displayName }),
      }));
    }
    if (route.length === 3 && route[0] === "accounts" && route[2] === "login") {
      const principal = await authorizeApiCapability("publishing.accounts.configure");
      return upstreamResponse(await automationServerRequest(config, `/v1/accounts/${encodeURIComponent(route[1])}/login-sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: principal.workspaceId, surface: "website" }),
      }));
    }
    if (route.length === 3 && route[0] === "sessions" && route[2] === "input") {
      const principal = await authorizeApiCapability("publishing.accounts.configure");
      const body = await jsonBody(request);
      return upstreamResponse(await automationServerRequest(config, `/v1/login-sessions/${encodeURIComponent(route[1])}/input`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: principal.workspaceId, input: body.input }),
      }));
    }
    if (route.length === 1 && route[0] === "media") {
      const principal = await authorizeApiCapability("publishing.content.create");
      const contentLength = Number(request.headers.get("content-length") || 0);
      if (contentLength > MAX_MEDIA_BYTES) throw new Error("Server publishing images must be 25 MB or smaller.");
      const bytes = Buffer.from(await request.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_MEDIA_BYTES) throw new Error("Server publishing images must be between 1 byte and 25 MB.");
      const fileName = String(request.headers.get("x-file-name") || "").trim();
      const mimeType = String(request.headers.get("content-type") || "").split(";", 1)[0].trim();
      if (!fileName || !["image/jpeg", "image/png"].includes(mimeType)) throw new Error("Choose one JPEG or PNG image.");
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
      const principal = await authorizeApiCapability("publishing.execute");
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
          idempotencyKey: body.idempotencyKey,
          liveConfirmation: "PUBLISH",
        }),
      }));
    }
    return unavailable();
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(_request, context) {
  try {
    const config = automationServerBridgeConfig();
    if (!config) return unavailable();
    const route = await parts(context);
    if (route.length === 2 && route[0] === "sessions") {
      const principal = await authorizeApiCapability("publishing.accounts.configure");
      return upstreamResponse(await automationServerRequest(
        config,
        `/v1/login-sessions/${encodeURIComponent(route[1])}?${workspaceQuery(principal.workspaceId)}`,
        { method: "DELETE" },
      ));
    }
    if (route.length === 2 && route[0] === "jobs") {
      const principal = await authorizeApiCapability("publishing.schedule.manage");
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
