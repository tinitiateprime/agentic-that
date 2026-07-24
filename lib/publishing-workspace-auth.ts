import { createHmac, timingSafeEqual } from "node:crypto";

export type PublishingWorkspaceIdentity = {
  sub: string;
  workspaceId: string;
  name: string;
  email: string;
  businessName: string;
  exp: number;
};

function secret() {
  const value = process.env.PUBLISH_QUEUE_PLATFORM_AUTH_SECRET?.trim()
    || process.env.PUBLISH_QUEUE_AUTH_TOKEN_SECRET?.trim()
    || process.env.PUBLISH_QUEUE_OPERATIONS_MANAGER_PASSWORD?.trim()
    || process.env.ADMIN_PASSWORD?.trim();
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error("Configure PUBLISH_QUEUE_PLATFORM_AUTH_SECRET.");
  }
  return "agenticthat-local-publishing-workspace-auth";
}

function signature(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function signPublishingWorkspaceIdentity(
  identity: Omit<PublishingWorkspaceIdentity, "exp">,
  ttlSeconds = 5 * 60
) {
  const payload = Buffer.from(JSON.stringify({
    ...identity,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifyPublishingWorkspaceIdentity(token: string): PublishingWorkspaceIdentity | null {
  try {
    const [payload, provided] = token.split(".");
    if (!payload || !provided) return null;
    const expectedBuffer = Buffer.from(signature(payload), "base64url");
    const providedBuffer = Buffer.from(provided, "base64url");
    if (expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) return null;
    const identity = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as PublishingWorkspaceIdentity;
    if (
      !identity.sub || !identity.workspaceId || !identity.name || !identity.email ||
      !Number.isInteger(identity.exp) || identity.exp <= Math.floor(Date.now() / 1000)
    ) return null;
    return identity;
  } catch {
    return null;
  }
}
