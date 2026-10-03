import { verifyServiceAccessToken } from "./service-access-token.js";

const rank: Record<string, number> = { none: 0, view: 1, operate: 2, configure: 3 };

export class ScrapingServiceAuthError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function requireScrapingServiceAccess(
  request: Request,
  resource: "scraping.instagram" | "scraping.facebook",
  requiredLevel: "view" | "operate" | "configure",
  requiredCapability = requiredLevel === "view" ? "scraping.view" : requiredLevel === "configure" ? "scraping.configure" : "scraping.run"
) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new ScrapingServiceAuthError("Authentication required.", 401);

  let identity;
  try {
    identity = verifyServiceAccessToken(token, "scraping");
  } catch {
    throw new ScrapingServiceAuthError("The service token is invalid or expired.", 401);
  }

  if (!identity) throw new ScrapingServiceAuthError("The service token is invalid or expired.", 401);

  const granted = String(identity.grants?.[resource] || "none");
  const tokenCapabilities = Array.isArray(identity.capabilities) ? identity.capabilities.map(String) : [];
  if ((rank[granted] || 0) < rank[requiredLevel] || !tokenCapabilities.includes(requiredCapability)) {
    throw new ScrapingServiceAuthError(`Requires ${requiredLevel} access to ${resource}.`, 403);
  }
  if (!identity.workspaceId) throw new ScrapingServiceAuthError("The token has no workspace.", 403);
  return identity;
}
