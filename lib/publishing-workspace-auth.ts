import { signServiceAccessToken, verifyServiceAccessToken } from "./service-access-token.js";

export type PublishingWorkspaceIdentity = {
  sub: string;
  workspaceId: string;
  name: string;
  email: string;
  businessName?: string;
  grants: Record<string, "none" | "view" | "operate" | "configure">;
  capabilities: string[];
  exp: number;
};

const publishingResources = ["instagram", "youtube", "facebook", "x", "linkedin"]
  .map(platform => `publishing.${platform}`);

export function signPublishingWorkspaceIdentity(
  identity: Omit<PublishingWorkspaceIdentity, "exp" | "grants" | "capabilities"> & {
    grants?: PublishingWorkspaceIdentity["grants"];
    capabilities?: string[];
    workspaceKey?: string;
  },
  ttlSeconds = 5 * 60
) {
  return signServiceAccessToken({
    audience: "publishing",
    subject: identity.sub,
    workspaceId: identity.workspaceId,
    grants: identity.grants || Object.fromEntries(publishingResources.map(resource => [resource, "configure"])),
    capabilities: identity.capabilities || ([] as string[]),
    name: identity.name,
    email: identity.email,
  }, ttlSeconds);
}

export function verifyPublishingWorkspaceIdentity(token: string): PublishingWorkspaceIdentity | null {
  const payload = verifyServiceAccessToken(token, "publishing");
  if (!payload) return null;
  return {
    sub: String(payload.sub),
    workspaceId: String(payload.workspaceId),
    name: String(payload.name || payload.email || "AgenticThat user"),
    email: String(payload.email || ""),
    grants: payload.grants && typeof payload.grants === "object" ? payload.grants : {},
    capabilities: Array.isArray(payload.capabilities) ? payload.capabilities.map(String) : [],
    exp: Number(payload.exp),
  } as PublishingWorkspaceIdentity;
}
