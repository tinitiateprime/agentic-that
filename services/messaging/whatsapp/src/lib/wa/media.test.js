import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inboundMediaFromMeta, isInlineSafeMime, mediaLabel, mediaUrl, metaMessageText } from "./media.js";

const root = new URL("../../../../../../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("a document webhook message keeps its media id, type and file name", () => {
  const msg = {
    type: "document",
    document: { id: "1234567890", mime_type: "application/pdf", filename: "Invoice 42.pdf", sha256: "x" },
  };
  const media = inboundMediaFromMeta(msg);
  assert.deepEqual(media, {
    type: "document",
    id: "1234567890",
    mimeType: "application/pdf",
    filename: "Invoice 42.pdf",
    caption: null,
    voice: false,
  });
  assert.equal(metaMessageText(msg, media), "Invoice 42.pdf");
});

test("captions become the message text; files without one get a label", () => {
  const photo = { type: "image", image: { id: "9", mime_type: "image/jpeg", caption: "Damaged box" } };
  assert.equal(metaMessageText(photo), "Damaged box");
  const voice = { type: "audio", audio: { id: "8", mime_type: "audio/ogg; codecs=opus", voice: true } };
  assert.equal(metaMessageText(voice), "🎤 Voice message");
  assert.equal(metaMessageText({ type: "video", video: { id: "7" } }), "🎬 Video");
  assert.equal(mediaLabel("sticker"), "Sticker");
});

test("non-media types are described instead of '(unsupported message)'", () => {
  assert.equal(inboundMediaFromMeta({ type: "text", text: { body: "hi" } }), null);
  assert.equal(inboundMediaFromMeta({ type: "document", document: {} }), null);
  assert.match(
    metaMessageText({ type: "location", location: { latitude: 12.97, longitude: 77.59, name: "Office" } }),
    /^📍 Location: Office \(12\.97, 77\.59\)$/
  );
  assert.match(
    metaMessageText({ type: "contacts", contacts: [{ name: { formatted_name: "Ravi" }, phones: [{ phone: "+91 98450 11223" }] }] }),
    /^👤 Shared contact: Ravi \(\+91 98450 11223\)$/
  );
  assert.match(
    metaMessageText({ type: "unsupported", errors: [{ code: 131051, title: "Message type unknown" }] }),
    /didn't pass this message on \(Message type unknown\)/
  );
});

test("only images, audio, video and PDFs are ever shown inline", () => {
  for (const mime of ["image/jpeg", "image/webp", "audio/ogg; codecs=opus", "video/mp4", "application/pdf"]) {
    assert.equal(isInlineSafeMime(mime), true, mime);
  }
  for (const mime of ["image/svg+xml", "text/html", "application/vnd.ms-excel", "", null]) {
    assert.equal(isInlineSafeMime(mime), false, String(mime));
  }
  assert.equal(mediaUrl(42), "/api/messages/42/media");
  assert.equal(mediaUrl(42, { download: true }), "/api/messages/42/media?download=1");
});

test("the webhook stores media and the route serves it only within the workspace", async () => {
  const webhook = await source("app/api/webhooks/meta/route.js");
  assert.match(webhook, /const media = buttonText \? null : inboundMediaFromMeta\(msg\);/);
  assert.match(webhook, /metaMessageText\(msg, media\)/);
  assert.match(webhook, /provider: "meta",\s*media,/);

  const messaging = await source("services/messaging/whatsapp/src/lib/wa/messaging.js");
  assert.match(messaging, /media_type, media_id, media_mime, media_filename\)/);

  const route = await source("app/api/messages/[id]/media/route.js");
  assert.match(route, /getCurrentUser\("view"\)/);
  assert.match(route, /getMessage\(user\.business_id, messageId\)/);
  assert.match(route, /"X-Content-Type-Options": "nosniff"/);
  assert.match(route, /Content-Security-Policy"\] = "sandbox;/);

  const provider = await source("services/messaging/whatsapp/src/lib/wa/provider.js");
  assert.match(provider, /export async function metaDownloadMedia/);
  assert.match(provider, /if \(!isMetaMediaHost\(info\.url\)\)/);

  const bubble = await source("services/messaging/whatsapp/src/components/MessageBubble.jsx");
  assert.match(bubble, /<MediaAttachment m=\{m\} \/>/);
});
