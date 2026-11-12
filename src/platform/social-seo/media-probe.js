// Browser-only media inspection for Social SEO. Files never leave the device:
// we read dimensions, duration, size, a best cover frame and photo GPS, and
// send only those numbers to the server.

const FRAME_SAMPLES = 8;
const ANALYSIS_WIDTH = 160;

export function mediaKind(file) {
  if (String(file?.type).startsWith("video/")) return "video";
  if (String(file?.type).startsWith("image/")) return "image";
  return "";
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("This image could not be read."));
    image.src = url;
  });
}

function loadVideo(url) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    const timer = setTimeout(() => reject(new Error("This video took too long to read.")), 15000);
    video.onloadeddata = () => { clearTimeout(timer); resolve(video); };
    video.onerror = () => { clearTimeout(timer); reject(new Error("This video format can't be read in the browser.")); };
    video.src = url;
  });
}

// Recorded WebM files often report an infinite duration until the browser
// has scanned to the end. Seeking far past the end makes it compute the real one.
function resolveDuration(video) {
  if (Number.isFinite(video.duration)) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      video.removeEventListener("durationchange", check);
      video.currentTime = 0;
      resolve();
    };
    const check = () => { if (Number.isFinite(video.duration)) finish(); };
    const timer = setTimeout(finish, 5000);
    video.addEventListener("durationchange", check);
    video.currentTime = Number.MAX_SAFE_INTEGER;
  });
}

function seek(video, time) {
  return new Promise((resolve) => {
    const done = () => { video.removeEventListener("seeked", done); clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, 3000);
    video.addEventListener("seeked", done);
    video.currentTime = time;
  });
}

/**
 * Score a frame for use as a cover: sharp (variance of the Laplacian), well
 * exposed (mean brightness away from black or white) and with some contrast.
 */
export function scoreFrame(pixels, width, height) {
  const gray = new Float32Array(width * height);
  let sum = 0;
  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
    const value = 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
    gray[i] = value;
    sum += value;
  }
  const mean = sum / gray.length;
  let contrast = 0;
  for (let i = 0; i < gray.length; i += 1) contrast += (gray[i] - mean) ** 2;
  contrast = Math.sqrt(contrast / gray.length);

  let lapSum = 0;
  let lapSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const lap = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      lapSum += lap;
      lapSq += lap * lap;
      count += 1;
    }
  }
  const sharpness = count ? lapSq / count - (lapSum / count) ** 2 : 0;
  const exposure = Math.max(0, 1 - Math.abs(mean - 128) / 128);
  return Math.log1p(sharpness) * (0.35 + exposure) * (0.5 + Math.min(contrast, 80) / 80);
}

async function bestCoverFrame(video) {
  const duration = Number(video.duration) || 0;
  if (!duration || !Number.isFinite(duration)) return null;
  const width = ANALYSIS_WIDTH;
  const height = Math.max(1, Math.round((video.videoHeight / Math.max(1, video.videoWidth)) * width));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  let best = null;
  for (let index = 0; index < FRAME_SAMPLES; index += 1) {
    // Skip the very first and last moments, which are often fades or black.
    const time = Math.min(duration - 0.05, duration * (0.06 + (0.88 * index) / (FRAME_SAMPLES - 1)));
    await seek(video, Math.max(0, time));
    context.drawImage(video, 0, 0, width, height);
    const score = scoreFrame(context.getImageData(0, 0, width, height).data, width, height);
    if (!best || score > best.score) best = { time: Number(time.toFixed(2)), score, preview: canvas.toDataURL("image/jpeg", 0.8) };
  }
  return best;
}

// ---- Minimal EXIF GPS reader for JPEG files --------------------------------

export function readJpegGps(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    const length = view.getUint16(offset + 2);
    if (marker === 0xffe1 && view.getUint32(offset + 4) === 0x45786966) return readTiffGps(view, offset + 10);
    if ((marker & 0xff00) !== 0xff00 || length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

function readTiffGps(view, start) {
  if (start + 8 > view.byteLength) return null;
  const little = view.getUint16(start) === 0x4949;
  const u16 = (at) => view.getUint16(at, little);
  const u32 = (at) => view.getUint32(at, little);
  const entries = (ifd) => {
    if (ifd + 2 > view.byteLength) return [];
    const count = u16(ifd);
    const list = [];
    for (let i = 0; i < count; i += 1) {
      const at = ifd + 2 + i * 12;
      if (at + 12 > view.byteLength) break;
      list.push({ tag: u16(at), type: u16(at + 2), count: u32(at + 4), valueAt: at + 8 });
    }
    return list;
  };
  const ifd0 = start + u32(start + 4);
  const gpsPointer = entries(ifd0).find((entry) => entry.tag === 0x8825);
  if (!gpsPointer) return null;
  const gps = entries(start + u32(gpsPointer.valueAt));
  const ref = (tag) => {
    const entry = gps.find((item) => item.tag === tag);
    return entry ? String.fromCharCode(view.getUint8(entry.valueAt)) : "";
  };
  const coordinate = (tag) => {
    const entry = gps.find((item) => item.tag === tag);
    if (!entry || entry.type !== 5 || entry.count < 3) return null;
    const at = start + u32(entry.valueAt);
    if (at + 24 > view.byteLength) return null;
    const part = (n) => {
      const denominator = u32(at + n * 8 + 4);
      return denominator ? u32(at + n * 8) / denominator : 0;
    };
    return part(0) + part(1) / 60 + part(2) / 3600;
  };
  const latitude = coordinate(2);
  const longitude = coordinate(4);
  if (latitude === null || longitude === null || (latitude === 0 && longitude === 0)) return null;
  return {
    latitude: Number(((ref(1) === "S" ? -1 : 1) * latitude).toFixed(2)),
    longitude: Number(((ref(3) === "W" ? -1 : 1) * longitude).toFixed(2)),
  };
}

// ---------------------------------------------------------------------------

export async function probeMediaFile(file) {
  const kind = mediaKind(file);
  if (!kind) throw new Error(`${file.name} is not a photo or video.`);
  const url = URL.createObjectURL(file);
  const base = { kind, name: file.name, sizeBytes: file.size, mimeType: file.type, previewUrl: url };
  if (kind === "image") {
    const image = await loadImage(url);
    let gps = null;
    if (/jpe?g/i.test(file.type)) {
      try { gps = readJpegGps(await file.slice(0, 256 * 1024).arrayBuffer()); } catch { gps = null; }
    }
    return { ...base, width: image.naturalWidth, height: image.naturalHeight, gps };
  }
  const video = await loadVideo(url);
  await resolveDuration(video);
  let cover = null;
  try { cover = await bestCoverFrame(video); } catch { cover = null; }
  const result = {
    ...base,
    width: video.videoWidth,
    height: video.videoHeight,
    durationSeconds: Number.isFinite(video.duration) ? video.duration : 0,
    coverFrame: cover ? { time: cover.time } : null,
    coverPreview: cover?.preview || "",
    gps: null,
  };
  video.removeAttribute("src");
  video.load();
  return result;
}
