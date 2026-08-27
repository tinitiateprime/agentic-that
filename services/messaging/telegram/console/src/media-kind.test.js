import assert from "node:assert/strict";
import test from "node:test";
import { inferTelegramUploadPostType, telegramUploadTypeHint } from "./media-kind.js";

test("Telegram device uploads infer native media types", () => {
  assert.equal(inferTelegramUploadPostType({ name: "photo.jpg", type: "image/jpeg" }), "image");
  assert.equal(inferTelegramUploadPostType({ name: "clip.mp4", type: "video/mp4" }), "video");
  assert.equal(inferTelegramUploadPostType({ name: "motion.gif", type: "image/gif" }), "animation");
  assert.equal(inferTelegramUploadPostType({ name: "song.mp3", type: "audio/mpeg" }), "audio");
  assert.equal(inferTelegramUploadPostType({ name: "archive.bin", type: "" }), "document");
});

test("Telegram device uploads retain intentional voice, video-note, and document modes", () => {
  assert.equal(inferTelegramUploadPostType({ name: "voice.ogg", type: "audio/ogg" }, "voice"), "voice");
  assert.equal(inferTelegramUploadPostType({ name: "note.mp4", type: "video/mp4" }, "video_note"), "video_note");
  assert.equal(inferTelegramUploadPostType({ name: "photo.jpg", type: "image/jpeg" }, "document"), "document");
  assert.match(telegramUploadTypeHint("voice"), /voice message/i);
});
