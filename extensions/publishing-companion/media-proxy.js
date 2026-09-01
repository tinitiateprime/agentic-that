const COMPANION_ORIGIN = "http://127.0.0.1:8792";
const TRUSTED_ORIGINS_KEY = "trustedDashboardOrigins";
const PRODUCTION_ORIGIN = "https://agentic-that.netlify.app";
const container = document.querySelector("#media");

async function assertTrustedParent() {
  let origin = "";
  try { origin = new URL(document.referrer).origin; } catch { /* handled below */ }
  const { normalizeDashboardOrigin, hasStaticBridgeForOrigin } = globalThis.AgenticThatTrustedOrigins;
  if (origin === PRODUCTION_ORIGIN || hasStaticBridgeForOrigin(origin)) return;
  const stored = await chrome.storage.local.get(TRUSTED_ORIGINS_KEY);
  const trusted = Array.isArray(stored[TRUSTED_ORIGINS_KEY])
    ? stored[TRUSTED_ORIGINS_KEY].flatMap(value => {
        try { return [normalizeDashboardOrigin(value)]; } catch { return []; }
      })
    : [];
  if (!trusted.includes(origin)) throw new Error("This dashboard is not trusted for local media previews.");
}

async function load() {
  await assertTrustedParent();
  const params = new URLSearchParams(window.location.search);
  const path = params.get("path") || "";
  const compact = params.get("compact") === "1";
  const controls = params.get("controls") === "1";
  if (!path.startsWith("/uploads/") || path.includes("..")) throw new Error("Invalid media path.");

  const response = await fetch(`${COMPANION_ORIGIN}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Preview unavailable (${response.status}).`);
  const contentType = response.headers.get("content-type") || "";
  const objectUrl = URL.createObjectURL(await response.blob());
  const media = document.createElement(contentType.startsWith("video/") ? "video" : "img");
  media.src = objectUrl;
  media.setAttribute("aria-label", "Post media preview");
  if (media instanceof HTMLVideoElement) {
    media.muted = true;
    media.playsInline = true;
    media.controls = controls;
    media.loop = compact;
    media.autoplay = compact;
  }
  media.addEventListener("load", () => URL.revokeObjectURL(objectUrl), { once: true });
  media.addEventListener("loadeddata", () => {
    if (!(media instanceof HTMLVideoElement) || !compact) return;
    void media.play().catch(() => undefined);
  }, { once: true });
  container.replaceChildren(media);
}

load().catch((error) => {
  const message = document.createElement("span");
  message.className = "error";
  message.textContent = error instanceof Error ? error.message : "Preview unavailable.";
  container.replaceChildren(message);
});
