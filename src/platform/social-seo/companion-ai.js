// Browser client for Social SEO with the user's own ChatGPT, Claude and Gemini
// logins in the AgenticThat Companion. Media is resized in the browser and sent
// only to 127.0.0.1; the Companion passes it to the AI apps the user connected.

const COMPANION_AI = "http://127.0.0.1:8792/api/social-seo/ai";
// Big enough for ChatGPT, Claude and Gemini to read small text on posters.
const MAX_IMAGE_SIDE = 1600;
const MULTI_IMAGE_SIDE = 1024;
const MOMENTS_PER_SHEET = 4;
const MAX_MOMENTS = 24;
const SHEET_CELL_SIDE = 960;
const MAX_TRANSCRIPT_CHARS = 40_000;
// Larger files can't be held in the browser's memory to read their audio.
const MAX_LISTEN_BYTES = 1.5 * 1024 * 1024 * 1024;
const MAX_LISTEN_SECONDS = 3 * 60 * 60;
const SPEECH_RATE = 16_000;

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

export function formatTimestamp(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** The biggest on-screen change in each equal part of the video, so every part is seen. */
export function pickMoments(changes, count) {
  if (!changes.length) return [];
  const wanted = Math.min(count, changes.length);
  return Array.from({ length: wanted }, (_, part) => {
    const from = Math.floor((part * changes.length) / wanted);
    const to = Math.max(from + 1, Math.floor(((part + 1) * changes.length) / wanted));
    let best = from;
    for (let index = from; index < to; index += 1) if (changes[index] > changes[best]) best = index;
    return best;
  });
}

/** One "[m:ss] words" line per part, thinned evenly if a very long video would not fit. */
export function transcriptText(segments, limit = MAX_TRANSCRIPT_CHARS) {
  const lines = segments.map((segment) => `[${formatTimestamp(segment.start)}] ${segment.text}`);
  const size = lines.reduce((sum, line) => sum + line.length + 1, 0);
  if (size <= limit) return lines.join("\n");
  const keep = limit / size;
  return lines.filter((_, index) => Math.floor((index + 1) * keep) > Math.floor(index * keep)).join("\n").slice(0, limit);
}

/** Sheets of labelled moments: far more of the video in the few images an AI app accepts. */
async function momentSheets(video, duration, onProgress) {
  const landscape = video.videoWidth >= video.videoHeight;
  const scale = SHEET_CELL_SIDE / Math.max(video.videoWidth, video.videoHeight, 1);
  const cellWidth = Math.round(video.videoWidth * scale);
  const cellHeight = Math.round(video.videoHeight * scale);
  const columns = landscape ? 2 : MOMENTS_PER_SHEET;
  const rows = Math.ceil(MOMENTS_PER_SHEET / columns);

  const count = Math.max(MOMENTS_PER_SHEET, Math.min(MAX_MOMENTS, Math.ceil(duration / 4)));
  const samples = Math.max(count, Math.min(count * 3, Math.floor(duration)));
  const probe = document.createElement("canvas");
  probe.width = 48;
  probe.height = 27;
  const probeContext = probe.getContext("2d", { willReadFrequently: true });
  const times = Array.from({ length: samples }, (_, index) => Math.min(Math.max(0, duration - 0.1), (duration * (index + 0.5)) / samples));
  const changes = [];
  let previous = null;
  for (const [index, time] of times.entries()) {
    await seek(video, time);
    probeContext.drawImage(video, 0, 0, probe.width, probe.height);
    const pixels = probeContext.getImageData(0, 0, probe.width, probe.height).data;
    let change = 0;
    if (previous) for (let at = 0; at < pixels.length; at += 4) change += Math.abs(pixels[at] - previous[at]) + Math.abs(pixels[at + 1] - previous[at + 1]) + Math.abs(pixels[at + 2] - previous[at + 2]);
    changes.push(change);
    previous = pixels;
    onProgress?.(`Looking through the video… ${Math.round(((index + 1) / samples) * 100)}%`);
  }

  const moments = pickMoments(changes, count).map((index) => times[index]);
  const sheets = [];
  for (let start = 0; start < moments.length; start += MOMENTS_PER_SHEET) {
    const canvas = document.createElement("canvas");
    canvas.width = cellWidth * columns;
    canvas.height = cellHeight * rows;
    const context = canvas.getContext("2d");
    context.fillStyle = "#000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (const [slot, time] of moments.slice(start, start + MOMENTS_PER_SHEET).entries()) {
      await seek(video, time);
      const x = (slot % columns) * cellWidth;
      const y = Math.floor(slot / columns) * cellHeight;
      context.drawImage(video, x, y, cellWidth, cellHeight);
      const label = formatTimestamp(time);
      context.font = "bold 30px Arial, sans-serif";
      context.fillStyle = "rgba(0,0,0,.78)";
      context.fillRect(x + 10, y + 10, context.measureText(label).width + 20, 44);
      context.fillStyle = "#fff";
      context.fillText(label, x + 20, y + 43);
    }
    sheets.push(canvas.toDataURL("image/jpeg", 0.82));
  }
  return sheets;
}

/** The video's sound as 16 kHz mono audio, or null when it has none to listen to. */
async function videoSpeechAudio(item) {
  const bytes = await (await fetch(item.previewUrl)).arrayBuffer();
  const context = new OfflineAudioContext(1, SPEECH_RATE, SPEECH_RATE);
  const audio = await context.decodeAudioData(bytes).catch(() => null);
  if (!audio) return null;
  const pcm = new Int16Array(audio.length);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index));
  let loudest = 0;
  for (let index = 0; index < audio.length; index += 1) {
    let sample = 0;
    for (const channel of channels) sample += channel[index];
    sample = Math.max(-1, Math.min(1, sample / channels.length));
    loudest = Math.max(loudest, Math.abs(sample));
    pcm[index] = sample * 32767;
  }
  return loudest > 0.01 ? pcm : null;
}

/** Reads the Companion's line-by-line answer, passing each line to onLine. */
async function readJsonLines(response, onLine) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onLine(JSON.parse(line));
    }
  }
}

const listenedVideos = new Map();

/** What is said in the video, heard by the Companion on this computer. Empty when there is no speech. */
async function listenToVideo(item, onProgress) {
  if (listenedVideos.has(item.previewUrl)) return listenedVideos.get(item.previewUrl);
  onProgress?.("Listening to the video…");
  const pcm = await videoSpeechAudio(item);
  if (!pcm) return "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2 * 60 * 60 * 1000);
  try {
    const response = await fetch(`${COMPANION_AI}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", Authorization: `Bearer ${await companionToken()}` },
      body: new Blob([pcm.buffer]),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || "Update the Companion to listen to videos.");
    }
    let segments = null;
    let failure = "";
    await readJsonLines(response, (line) => {
      if (line.stage === "downloading") onProgress?.(`Getting the speech tool ready (first time only)… ${line.percent}%`);
      if (line.stage === "listening") onProgress?.(`Listening to the video… ${line.percent}%`);
      if (line.segments) segments = line.segments;
      if (line.message) failure = line.message;
    });
    if (!segments) throw new Error(failure || "The video could not be listened to.");
    const transcript = transcriptText(segments);
    listenedVideos.set(item.previewUrl, transcript);
    return transcript;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turn the uploaded media into what the connected AI apps can read. A video
 * becomes labelled moments plus everything said in it; if the speech can't be
 * read, the moments alone are used and speechNote says why.
 */
export async function prepareMediaForAi(media, onProgress) {
  const first = media[0];
  if (first?.kind === "video") {
    const video = await loadVideo(first.previewUrl);
    const duration = Number.isFinite(video.duration) ? video.duration : first.durationSeconds || 0;
    const images = await momentSheets(video, duration, onProgress);
    let transcript = "";
    let speechNote = "";
    if (first.sizeBytes > MAX_LISTEN_BYTES || duration > MAX_LISTEN_SECONDS) {
      speechNote = "This video is too large to listen to, so the AI worked from its pictures only.";
    } else {
      try {
        transcript = await listenToVideo(first, onProgress);
      } catch (failure) {
        speechNote = `The AI worked from the video's pictures only. ${failure?.message || "Its speech couldn't be read."}`;
      }
    }
    return { images, transcript: transcript || undefined, speechNote, mediaKind: "video", durationSeconds: duration, orientation: orientationOf(video.videoWidth, video.videoHeight) };
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
