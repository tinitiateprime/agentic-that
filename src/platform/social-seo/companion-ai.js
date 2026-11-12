// Browser client for the free local AI that runs inside the AgenticThat
// Companion. Media is resized in the browser and sent only to 127.0.0.1.

const COMPANION_AI = "http://127.0.0.1:8792/api/social-seo/ai";
// Every 32x32 pixels costs the AI one token of reading time, so images are kept
// just big enough to read text: one photo 768 px, carousel slides and video frames smaller.
const MAX_IMAGE_SIDE = 768;
const MULTI_IMAGE_SIDE = 512;
const VIDEO_FRAMES = 5;

let cachedToken = null;

async function companionToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;
  const response = await fetch("/api/social-seo/companion-token", { method: "POST", credentials: "same-origin", cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.token) throw new Error(data.error || "Sign in again to use the free AI.");
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

/** AI status from the Companion, or null when the Companion is not running. */
export async function companionAiStatus() {
  try {
    return await call("/status", { timeoutMs: 2500 });
  } catch {
    return null;
  }
}

export function installCompanionAi(tier) {
  return call("/install", { method: "POST", body: { tier }, auth: true, timeoutMs: 15_000 });
}

/** Step 1: the AI looks at the media once. Slow computers can take a few minutes. */
export function analyzeWithCompanionAi(payload) {
  return call("/analyze", { method: "POST", body: payload, auth: true, timeoutMs: 15 * 60 * 1000 });
}

/**
 * Step 2: write a ready-to-post result for one app, with the latest description,
 * brand and location. onLive(text) receives the caption while it is written.
 */
export async function writeWithCompanionAi(analysisId, platform, details = {}, onLive) {
  if (!onLive) return call("/write", { method: "POST", body: { analysisId, platform, ...details }, auth: true, timeoutMs: 15 * 60 * 1000 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15 * 60 * 1000);
  try {
    const response = await fetch(`${COMPANION_AI}/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await companionToken()}` },
      body: JSON.stringify({ analysisId, platform, ...details, live: true }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || `The Companion returned ${response.status}.`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let final = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const event = JSON.parse(line);
        if (typeof event.live === "string") onLive(event.live);
        else final = event;
      }
    }
    if (!final) throw new Error("The Companion stopped before the post was finished. Please try again.");
    if (!final.ok) throw new Error(final.message || "The local AI could not finish.");
    return final;
  } finally {
    clearTimeout(timer);
  }
}

/** Load the model in the background when the page opens, so the first post does not wait for it. */
export function warmCompanionAi() {
  return call("/warm", { method: "POST", auth: true, timeoutMs: 10_000 }).catch(() => null);
}

export function generateWithCompanionAi(payload) {
  // A first run loads the model; allow generous time on slower computers.
  return call("/generate", { method: "POST", body: payload, auth: true, timeoutMs: 6 * 60 * 1000 });
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

/** Turn the uploaded media into small JPEGs the local AI can look at. */
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
