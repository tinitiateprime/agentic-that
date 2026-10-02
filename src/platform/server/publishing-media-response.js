import { readPublishingMedia, readPublishingMediaRange } from "../../../services/publishing/queue-runner/server/media-storage.ts";
import { readSupabaseJobArtifactBytes, readSupabaseJobArtifactRange } from "./supabase-job-control.js";
import { optimizePublishingPreviewBytes } from "./publishing-media-preview.js";

// A bounded range also fits Amplify's response payload after binary encoding.
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

export function requestedPublishingMediaRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(value).trim());
  if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(size) || size < 1) throw new RangeError("Invalid media range.");
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) throw new RangeError("Invalid media range.");
    start = Math.max(0, size - Math.min(suffix, MAX_RESPONSE_BYTES));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : Math.min(size - 1, start + MAX_RESPONSE_BYTES - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) throw new RangeError("Invalid media range.");
  return { start, end: Math.min(end, size - 1, start + MAX_RESPONSE_BYTES - 1) };
}

export async function readOriginalPublishingMediaBytes(media) {
  return media.artifact
    ? readSupabaseJobArtifactBytes(media.artifact, MAX_IMAGE_BYTES)
    : readPublishingMedia(media.fileName, media.workspaceId);
}

// Call only after resolving workspace ownership and the platform capability.
export async function publishingMediaResponse(request, media) {
  const size = Number(media.size || media.artifact?.byteSize || 0);
  const requestedType = String(media.mimeType || "").toLowerCase();
  let mimeType = /^(image|video)\/[a-z0-9.+-]+$/.test(requestedType) ? requestedType : "application/octet-stream";
  let range;
  try { range = requestedPublishingMediaRange(request.headers.get("range"), size); }
  catch { return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } }); }
  if (!range && mimeType.startsWith("video/") && size > MAX_RESPONSE_BYTES) {
    range = { start: 0, end: MAX_RESPONSE_BYTES - 1 };
  }
  let bytes;
  if (range) {
    bytes = media.artifact
      ? await readSupabaseJobArtifactRange(media.artifact, range.start, range.end, MAX_RESPONSE_BYTES)
      : await readPublishingMediaRange(media.fileName, media.workspaceId, range.start, range.end);
  } else {
    bytes = await readOriginalPublishingMediaBytes(media);
    if (mimeType.startsWith("image/") && bytes.length > MAX_RESPONSE_BYTES) {
      bytes = await optimizePublishingPreviewBytes(bytes);
      mimeType = "image/webp";
    }
  }
  return new Response(bytes, {
    status: range ? 206 : 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(bytes.length),
      ...(range ? { "Content-Range": `bytes ${range.start}-${range.start + bytes.length - 1}/${size}` } : {}),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
