// Inbound WhatsApp media (documents, photos, voice notes, videos, stickers)
// and the other non-text message types Meta's webhook delivers. Pure helpers,
// safe to import from both the webhook and the chat UI.
//
// Meta's webhook only carries a media id, not the file. The id is stored on
// the message (messages.media_*) and the file is fetched from Meta when someone
// opens it, through GET /api/messages/:id/media. Meta keeps inbound media for
// a limited time (about 30 days), after which the link stops working.

export const MEDIA_TYPES = ["document", "image", "audio", "video", "sticker"];

export function mediaLabel(type, { voice = false } = {}) {
  switch (type) {
    case "document": return "📄 Document";
    case "image": return "📷 Photo";
    case "audio": return voice ? "🎤 Voice message" : "🎵 Audio";
    case "video": return "🎬 Video";
    case "sticker": return "Sticker";
    default: return "Attachment";
  }
}

// { type, id, mimeType, filename, caption, voice } for a media message, else null.
export function inboundMediaFromMeta(msg) {
  const type = msg?.type;
  if (!MEDIA_TYPES.includes(type)) return null;
  const part = msg[type] || {};
  if (!part.id) return null;
  return {
    type,
    id: String(part.id),
    mimeType: part.mime_type ? String(part.mime_type) : null,
    filename: part.filename ? String(part.filename).slice(0, 255) : null,
    caption: part.caption ? String(part.caption) : null,
    voice: Boolean(part.voice),
  };
}

// The text stored as the message body (chat bubble text and inbox preview)
// for anything that isn't a plain text message or a button tap.
export function metaMessageText(msg, media = inboundMediaFromMeta(msg)) {
  if (media) return media.caption || media.filename || mediaLabel(media.type, media);

  if (msg?.type === "location" && msg.location) {
    const { name, address, latitude, longitude } = msg.location;
    const place = [name, address].filter(Boolean).join(", ");
    const coords = latitude != null && longitude != null ? `${latitude}, ${longitude}` : "";
    return `📍 Location${place ? `: ${place}` : ""}${coords ? ` (${coords})` : ""}`;
  }

  if (msg?.type === "contacts" && Array.isArray(msg.contacts)) {
    const people = msg.contacts.map((contact) => {
      const name = contact?.name?.formatted_name || contact?.name?.first_name || "Contact";
      const phone = contact?.phones?.[0]?.phone || contact?.phones?.[0]?.wa_id || "";
      return phone ? `${name} (${phone})` : name;
    });
    return `👤 Shared contact${people.length > 1 ? "s" : ""}: ${people.join(", ")}`;
  }

  // Meta sends type "unsupported" for things the Cloud API can't deliver
  // (view-once media, polls, some newer message kinds).
  if (msg?.type === "unsupported") {
    const reason = msg.errors?.[0]?.error_data?.details || msg.errors?.[0]?.title;
    return `⚠️ WhatsApp didn't pass this message on${reason ? ` (${reason})` : ""}. Ask the sender to send it again as a normal message.`;
  }

  return `(unsupported message: ${msg?.type || "unknown"})`;
}

// Where the chat loads a message's file from.
export function mediaUrl(messageId, { download = false } = {}) {
  return `/api/messages/${encodeURIComponent(messageId)}/media${download ? "?download=1" : ""}`;
}

// Types safe to show inline from our own origin. Anything else (HTML, SVG,
// office files, unknown) is only ever offered as a download.
export function isInlineSafeMime(mimeType) {
  const mime = String(mimeType || "").toLowerCase().split(";")[0].trim();
  if (mime === "image/svg+xml") return false;
  return /^(image|audio|video)\//.test(mime) || mime === "application/pdf";
}
