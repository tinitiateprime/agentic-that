import { getCurrentUser, whatsappAccessErrorResponse } from "@whatsapp/lib/auth";
import { getMessage } from "@whatsapp/lib/data";
import { credsForProvider } from "@whatsapp/lib/tenant";
import { metaDownloadMedia } from "@whatsapp/lib/wa/provider";
import { isInlineSafeMime } from "@whatsapp/lib/wa/media";

// The file behind an inbound WhatsApp media message (document, photo, voice
// note, video, sticker). Only users who can view WhatsApp in the message's
// workspace can open it; the file is fetched from Meta on request.
//   GET /api/messages/:id/media            show inline when the type is safe
//   GET /api/messages/:id/media?download=1 always download

const EXTENSIONS = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "text/plain": "txt",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/zip": "zip",
};

function cleanMime(value) {
  const mime = String(value || "").toLowerCase().split(";")[0].trim();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime) ? mime : "application/octet-stream";
}

function fileNameFor(message, mime) {
  const given = String(message.media_filename || "")
    .replace(/[\\/\r\n"]/g, "_")
    .trim()
    .slice(0, 200);
  if (given) return given;
  const ext = EXTENSIONS[mime] || mime.split("/")[1]?.replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
  return `whatsapp-${message.media_type || "file"}-${message.id}.${ext}`;
}

function contentDisposition(type, fileName) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/[%;]/g, "_");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(req, { params }) {
  const user = await getCurrentUser("view");
  if (!user) return whatsappAccessErrorResponse("view");

  const { id } = await params;
  const messageId = Number(id);
  if (!Number.isInteger(messageId) || messageId <= 0) {
    return Response.json({ error: "Message not found" }, { status: 404 });
  }

  // Scoped to the signed-in workspace, so ids from other workspaces 404.
  const message = await getMessage(user.business_id, messageId);
  if (!message?.media_id) return Response.json({ error: "This message has no file" }, { status: 404 });
  if (String(message.provider || "meta").toLowerCase() !== "meta") {
    return Response.json({ error: "Files are only available for Meta WhatsApp messages" }, { status: 404 });
  }

  const creds = await credsForProvider(user.business_id, "meta");
  if (!creds) return Response.json({ error: "The Meta WhatsApp channel is no longer connected." }, { status: 409 });

  let file;
  try {
    file = await metaDownloadMedia({ mediaId: message.media_id, creds });
  } catch (err) {
    const status = err?.status === 404 ? 410 : err?.status || 502;
    const error = status === 410
      ? "WhatsApp no longer has this file. Meta only keeps received files for a limited time."
      : err?.message || "Couldn't load this file from WhatsApp.";
    return Response.json({ error }, { status });
  }

  const mime = cleanMime(message.media_mime || file.mimeType);
  const wantsDownload = new URL(req.url).searchParams.get("download") === "1";
  const inline = !wantsDownload && isInlineSafeMime(mime);
  const headers = {
    "Content-Type": mime,
    "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", fileNameFor(message, mime)),
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  };
  // Browsers' PDF viewers don't run in a sandboxed document; every other
  // type is locked down so nothing served here can run scripts.
  if (mime !== "application/pdf") headers["Content-Security-Policy"] = "sandbox; default-src 'none'; img-src 'self'; media-src 'self'";

  return new Response(file.body, { status: 200, headers });
}
