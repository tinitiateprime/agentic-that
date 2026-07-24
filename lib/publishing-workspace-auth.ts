export type PublishingWorkspaceIdentity = {
  sub: string;
  workspaceId: string;
  workspaceKey: string;
  name: string;
  email: string;
  businessName: string;
  exp: number;
};

export function signPublishingWorkspaceIdentity(
  identity: Omit<PublishingWorkspaceIdentity, "exp">,
  ttlSeconds = 5 * 60
) {
  return Buffer.from(JSON.stringify({
    ...identity,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  })).toString("base64url");
}

export function verifyPublishingWorkspaceIdentity(token: string): PublishingWorkspaceIdentity | null {
  try {
    const identity = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as PublishingWorkspaceIdentity;
    if (
      !identity.sub || !identity.workspaceId || !identity.workspaceKey || identity.workspaceKey.length < 32 ||
      !identity.name || !identity.email ||
      !Number.isInteger(identity.exp) || identity.exp <= Math.floor(Date.now() / 1000)
    ) return null;
    return identity;
  } catch {
    return null;
  }
}
