const tokenCache = new Map();

function tokenExpiry(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return 0;
    const rawPayload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = rawPayload.padEnd(Math.ceil(rawPayload.length / 4) * 4, "=");
    return Number(JSON.parse(atob(payload)).exp || 0);
  } catch {
    return 0;
  }
}

function isFresh(token) {
  return tokenExpiry(token) > Math.floor(Date.now() / 1000) + 30;
}

export async function getClientServiceToken(audience, initialToken = "", force = false) {
  const cached = tokenCache.get(audience);
  if (!force && cached?.seed === initialToken && isFresh(cached.token)) return cached.token;
  if (!force && isFresh(initialToken)) {
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
  tokenCache.set(audience, { seed: initialToken, token: data.token });
  return data.token;
}
