const tokenCache = new Map();

function tokenClaims(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return null;
    const rawPayload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = rawPayload.padEnd(Math.ceil(rawPayload.length / 4) * 4, "=");
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}

export function serviceTokenMatchesAudience(token, audience) {
  const claims = tokenClaims(token);
  return claims?.aud === audience
    && Number(claims?.exp || 0) > Math.floor(Date.now() / 1000) + 30;
}

export async function getClientServiceToken(audience, initialToken = "", force = false) {
  const cached = tokenCache.get(audience);
  if (!force && cached?.seed === initialToken && serviceTokenMatchesAudience(cached.token, audience)) return cached.token;
  if (!force && serviceTokenMatchesAudience(initialToken, audience)) {
    tokenCache.set(audience, { seed: initialToken, token: initialToken });
    return initialToken;
  }

  const response = await fetch("/api/platform-auth/service-token", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ audience }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.token) {
    const error = new Error(data.error || "Unable to refresh service access.");
    error.status = response.status;
    throw error;
  }
  if (!serviceTokenMatchesAudience(data.token, audience)) {
    const error = new Error("The refreshed service token is invalid. Refresh the page and try again.");
    error.status = 401;
    throw error;
  }
  tokenCache.set(audience, { seed: initialToken, token: data.token });
  return data.token;
}
