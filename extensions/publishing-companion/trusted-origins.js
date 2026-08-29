(() => {
  const PRODUCTION_ORIGIN = "https://agentic-that.netlify.app";

  function normalizeDashboardOrigin(value) {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("The dashboard address must use HTTP or HTTPS.");
    }
    return url.origin;
  }

  function hasStaticBridgeForOrigin(value) {
    try {
      const origin = normalizeDashboardOrigin(value);
      const url = new URL(origin);
      if (origin === PRODUCTION_ORIGIN) return true;
      if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return true;
      return url.protocol === "https:" && url.hostname.endsWith(".trycloudflare.com");
    } catch {
      return false;
    }
  }

  function trustedScriptId(origin) {
    let hash = 2166136261;
    for (const character of normalizeDashboardOrigin(origin)) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return `agenticthat-dashboard-${(hash >>> 0).toString(16)}`;
  }

  globalThis.AgenticThatTrustedOrigins = Object.freeze({
    normalizeDashboardOrigin,
    hasStaticBridgeForOrigin,
    trustedScriptId,
  });
})();
