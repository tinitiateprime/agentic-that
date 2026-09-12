import { accessErrorResponse, authorizeGlobalAdminApi } from "@platform/server/access-control";
import { publishingAdminMediaRecord } from "@platform/server/publishing-central-store";
import { readSupabaseJobArtifactBytes, readSupabaseJobArtifactRange } from "@platform/server/supabase-job-control";
import { readPublishingMedia, readPublishingMediaRange } from "../../../../../../services/publishing/queue-runner/server/media-storage.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeMediaType(value) {
  const mimeType = String(value || "").toLowerCase();
  return /^(image|video)\/[a-z0-9.+-]+$/.test(mimeType) ? mimeType : "application/octet-stream";
}

const MAX_RANGE_BYTES = 5 * 1024 * 1024;
const MAX_INLINE_IMAGE_BYTES = 64 * 1024 * 1024;

function requestedMediaRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(value).trim());
  if (!match || (!match[1] && !match[2]) || !Number.isInteger(size) || size < 1) throw new RangeError("Invalid media range.");
  let start;
  let end;
  if (!match[1]) {
    const suffixSize = Number(match[2]);
    if (!Number.isInteger(suffixSize) || suffixSize < 1) throw new RangeError("Invalid media range.");
    start = Math.max(0, size - Math.min(suffixSize, MAX_RANGE_BYTES));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : Math.min(size - 1, start + MAX_RANGE_BYTES - 1);
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start) throw new RangeError("Invalid media range.");
  return { start, end: Math.min(end, size - 1, start + MAX_RANGE_BYTES - 1) };
}

export async function GET(request, context) {
  try {
    await authorizeGlobalAdminApi();
    const params = await context.params;
    const media = await publishingAdminMediaRecord(params?.id);
    const mimeType = safeMediaType(media.mimeType);
    let range;
    try {
      range = requestedMediaRange(request.headers.get("range"), media.size);
    } catch (rangeError) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${media.size}` } });
    }
    if (!range && mimeType.startsWith("video/") && media.size > MAX_RANGE_BYTES) {
      range = { start: 0, end: Math.min(media.size - 1, MAX_RANGE_BYTES - 1) };
    }
    if (range) {
      const bytes = await readPublishingMediaRange(media.fileName, media.workspaceId, range.start, range.end).catch((localError) => {
        if (!media.artifact) throw localError;
        return readSupabaseJobArtifactRange(media.artifact, range.start, range.end, MAX_RANGE_BYTES);
      });
      return new Response(bytes, {
        status: 206,
        headers: {
          "Content-Type": mimeType,
          "Content-Length": String(bytes.length),
          "Content-Range": `bytes ${range.start}-${range.start + bytes.length - 1}/${media.size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=300",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const bytes = await readPublishingMedia(media.fileName, media.workspaceId).catch((localError) => {
      if (!media.artifact) throw localError;
      return readSupabaseJobArtifactBytes(media.artifact, MAX_INLINE_IMAGE_BYTES);
    });
    return new Response(bytes, {
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(bytes.length),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      const notFound = error instanceof Error && /not found|enoent/i.test(error.message);
      if (!notFound) console.error("Publishing monitor media failed", error);
      return Response.json(
        { error: notFound ? "Publishing media was not found." : "Unable to load publishing media." },
        { status: notFound ? 404 : 500 },
      );
    }
  }
}
