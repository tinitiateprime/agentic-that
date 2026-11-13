// Browser client for Social SEO with the user's own ChatGPT, Claude and Gemini
// logins in the AgenticThat Companion. Media is resized in the browser and sent
// only to 127.0.0.1; the Companion passes it to the AI apps the user connected.

const COMPANION_AI = "http://127.0.0.1:8792/api/social-seo/ai";
// Big enough for ChatGPT, Claude and Gemini to read small text on posters.
const MAX_IMAGE_SIDE = 1600;
const MULTI_IMAGE_SIDE = 1024;
const VIDEO_FRAMES = 5;

let cachedToken = null;

async function companionToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;
  const response = await fetch("/api/social-seo/companion-token", { method: "POST", credentials: "same-origin", cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.token) throw new Error(data.error || "Sign in again to use your AI accounts.");
  cachedToken = { token: data.token, expiresAt: Date.now() + (data.expiresInSeconds || 300) * 1000 };
  return cachedToken.token;
}

async function call(path, { method = "GET", body, timeoutMs = 4000, auth = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { "Content-Type": "application/json" };
    if (auth) headers.Authorization = `Bearer ${await companionToken()}`;
    const response = await fetch(`${COMPANION_AI}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || `The Companion returned ${response.status}.`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** Which AI apps are connected in the Companion, or null when the Companion is not running. */
export async function companionAiStatus() {
  try {
    return await call("/status", { timeoutMs: 2500 });
  } catch {
    return null;
  }
}

/** Opens the AI app's own login window on this computer. */
export function connectCompanionAi(provider) {
  return call("/connect", { method: "POST", body: { provider }, auth: true, timeoutMs: 60_000 });
}

export function disconnectCompanionAi(provider) {
  return call("/disconnect", { method: "POST", body: { provider }, auth: true, timeoutMs: 20_000 });
}

/** Brings the AI app's window to the front (when it needs the user). */
export function showCompanionAiWindow(provider) {
  return call("/show", { method: "POST", body: { provider }, auth: true, timeoutMs: 10_000 }).catch(() => null);
}

/**
 * Sends the post to every connected AI app at once. onEvent receives each update:
 * { provider, state: "working" | "needs-you", detail }, { provider, state: "writing", live },
 * { provider, ok: true, results, complete, raw } or { provider, ok: false, message }.
 */
export async function generateWithCompanionAis(payload, onEvent) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20 * 60 * 1000);
  try {
    const response = await fetch(`${COMPANION_AI}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await companionToken()}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || `The Companion returned ${response.status}.`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let completed = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          const event = JSON.parse(line);
          if (event.done === true) completed = true;
          onEvent(event);
        }
      }
    }
    if (!completed) throw new Error("The Companion connection ended before every AI finished. Please try again.");
  } finally {
    clearTimeout(timer);
  }
}

// ---- Preparing media in the browser ---------------------------------------------

function canvasFrom(source, width, height, maxSide = MAX_IMAGE_SIDE) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("An image could not be read."));
    image.src = url;
  });
}

function loadVideo(url) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onloadeddata = () => resolve(video);
    video.onerror = () => reject(new Error("A video could not be read."));
    video.src = url;
  });
}

function seek(video, time) {
  return new Promise((resolve) => {
    const done = () => { video.removeEventListener("seeked", done); resolve(); };
    video.addEventListener("seeked", done);
    setTimeout(done, 3000);
    video.currentTime = time;
  });
}

function orientationOf(width, height) {
  if (!width || !height) return undefined;
  const ratio = width / height;
  return ratio < 0.9 ? "vertical" : ratio > 1.1 ? "landscape" : "square";
}

/** Turn the uploaded media into small JPEGs the connected AI apps can read. */
export async function prepareMediaForAi(media) {
  const first = media[0];
  if (first?.kind === "video") {
    const video = await loadVideo(first.previewUrl);
    const duration = Number.isFinite(video.duration) ? video.duration : first.durationSeconds || 0;
    const frames = [];
    for (let index = 0; index < VIDEO_FRAMES; index += 1) {
      await seek(video, Math.max(0, duration * (0.08 + (0.84 * index) / (VIDEO_FRAMES - 1))));
      frames.push(canvasFrom(video, video.videoWidth, video.videoHeight, MULTI_IMAGE_SIDE));
    }
    return { images: frames, mediaKind: "video", durationSeconds: duration, orientation: orientationOf(video.videoWidth, video.videoHeight) };
  }
  const images = [];
  const pictures = media.filter((entry) => entry.kind === "image").slice(0, 6);
  for (const item of pictures) {
    const image = await loadImage(item.previewUrl);
    images.push(canvasFrom(image, image.naturalWidth, image.naturalHeight, pictures.length > 1 ? MULTI_IMAGE_SIDE : MAX_IMAGE_SIDE));
  }
  return {
    images,
    mediaKind: images.length > 1 ? "carousel" : "image",
    orientation: orientationOf(first?.width, first?.height),
  };
}
