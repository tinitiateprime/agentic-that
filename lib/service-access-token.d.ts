export type ServiceAccessTokenInput = {
  audience: string;
  subject: string;
  workspaceId: string;
  grants?: Record<string, "none" | "view" | "operate" | "configure">;
  capabilities?: string[];
  name?: string;
  email?: string;
  billingStatus?: string;
  trialStartsAt?: string | null;
  trialEndsAt?: string | null;
};

export type ServiceAccessTokenPayload = {
  iss: string;
  aud: string;
  sub: string;
  workspaceId: string;
  grants: Record<string, "none" | "view" | "operate" | "configure">;
  capabilities: string[];
  name: string;
  email: string;
  billingStatus: string;
  trialStartsAt: string | null;
  trialEndsAt: string | null;
  iat: number;
  exp: number;
  jti: string;
};

export function signServiceAccessToken(input: ServiceAccessTokenInput, ttlSeconds?: number): string;
export function verifyServiceAccessToken(token: string, expectedAudience: string): ServiceAccessTokenPayload | null;
export function serviceTokenPublicKeyPem(): string;
