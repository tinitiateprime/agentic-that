import { accessErrorResponse, authorizeGlobalAdminApi } from "@platform/server/access-control";
import { attachPublishingAdminPreview, publishingAdminMediaRecord } from "@platform/server/publishing-central-store";
import { storePublishingPreview } from "@platform/server/publishing-media-preview";
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
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

async function readOriginalBytes(media) {
  if (media.artifact) {
    return readSupabaseJobArtifactBytes(media.artifact, MAX_INLINE_IMAGE_BYTES)
      .catch((artifactError) => readPublishingMedia(media.fileName, media.workspaceId)
        .catch(() => { throw artifactError; }));
  }
  return readPublishingMedia(media.fileName, media.workspaceId);
}

async function readOriginalRange(media, start, end) {
  if (media.artifact) {
    return readSupabaseJobArtifactRange(media.artifact, start, end, MAX_RANGE_BYTES)
      .catch((artifactError) => readPublishingMediaRange(media.fileName, media.workspaceId, start, end)
        .catch(() => { throw artifactError; }));
  }
  return readPublishingMediaRange(media.fileName, media.workspaceId, start, end);
}

function previewResponse(bytes) {
  return new Response(bytes, {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=86400, stale-while-revalidate=604800",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

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
    const wantsPreview = new URL(request.url).searchParams.get("variant") === "preview";
    if (wantsPreview) {
      if (media.previewArtifact) {
        const stored = await readSupabaseJobArtifactBytes(media.previewArtifact, MAX_PREVIEW_BYTES).catch(() => null);
        if (stored) return previewResponse(stored);
      }
      if (!mimeType.startsWith("image/")) {
        return Response.json({ error: "A video preview is not available for this older post." }, { status: 404 });
      }
      const originalBytes = await readOriginalBytes(media);
      const generated = await storePublishingPreview({
        workspaceId: media.workspaceId,
        fileName: media.fileName,
        originalName: media.originalName,
        inputBytes: originalBytes,
      });
      await attachPublishingAdminPreview(media.workspaceId, params?.id, generated.artifact);
      return previewResponse(generated.bytes);
    }
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
      const bytes = await readOriginalRange(media, range.start, range.end);
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
    const bytes = await readOriginalBytes(media);
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
