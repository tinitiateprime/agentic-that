export const TELEGRAM_UPLOAD_POST_TYPES = new Set([
  "image",
  "video",
  "animation",
  "audio",
  "voice",
  "video_note",
  "document",
]);

export function inferTelegramUploadPostType(file, selectedType = "") {
  const current = String(selectedType || "").trim().toLowerCase();
  const mimeType = String(file?.type || "").trim().toLowerCase();
  const fileName = String(file?.name || "").trim().toLowerCase();

  // Voice messages, video notes, and documents are intentional delivery
  // choices; MIME alone cannot distinguish them from ordinary audio/video.
  if (["voice", "video_note", "document"].includes(current)) return current;
  if (mimeType === "image/gif" || fileName.endsWith(".gif")) return "animation";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return current === "animation" ? "animation" : "video";
  if (mimeType.startsWith("audio/")) return current === "voice" ? "voice" : "audio";
  return "document";
}

export function telegramUploadTypeHint(type) {
  switch (type) {
    case "image": return "Sent as a Telegram photo.";
    case "video": return "Sent as a streamable Telegram video.";
    case "animation": return "Sent as a Telegram GIF/animation.";
    case "audio": return "Sent as a Telegram audio track.";
    case "voice": return "Sent as a Telegram voice message. OGG/Opus is recommended.";
    case "video_note": return "Sent as a Telegram video note. Use a short square video.";
    case "document": return "Sent as a Telegram document without media conversion.";
    default: return "Choose any image, video, audio, voice, animation, or document file.";
  }
}
