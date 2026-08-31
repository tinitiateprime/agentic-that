import { timingSafeEqual } from "node:crypto";
import {
  automationServerBridgeConfig,
  automationServerRequest,
} from "@platform/server/automation-server-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request, expected) {
  const supplied = String(request.headers.get("x-agenticthat-deployment-token") || "");
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request) {
  const config = automationServerBridgeConfig();
  if (!config || !authorized(request, config.internalToken)) {
    return Response.json({ error: "Not authorized." }, { status: 401 });
  }
  const response = await automationServerRequest(config, "/v1/admin/drain", { method: "POST" });
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
