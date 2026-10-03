import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  optimizePublishingPreviewBytes,
  publishingMediaPreviewTestHelpers,
} from "./publishing-media-preview.js";

test("publishing previews are small WebP renditions that preserve aspect ratio", async () => {
  const source = await sharp({
    create: { width: 1_920, height: 1_080, channels: 3, background: "#17345c" },
  }).png().toBuffer();
  const preview = await optimizePublishingPreviewBytes(source);
  const metadata = await sharp(preview).metadata();

  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, publishingMediaPreviewTestHelpers.maxPreviewDimension);
  assert.equal(metadata.height, 540);
  assert.ok(preview.length < 250_000);
});

test("publishing preview input accepts bounded browser images and rejects malformed data", () => {
  const bytes = Buffer.from("browser-preview");
  assert.deepEqual(
    publishingMediaPreviewTestHelpers.decodePublishingPreviewInput({
      mimeType: "image/webp",
      base64: bytes.toString("base64"),
    }),
    bytes,
  );
  assert.throws(() => publishingMediaPreviewTestHelpers.decodePublishingPreviewInput({
    mimeType: "text/html",
    base64: bytes.toString("base64"),
  }), /invalid/i);
  assert.throws(() => publishingMediaPreviewTestHelpers.decodePublishingPreviewInput({
    mimeType: "image/webp",
    base64: "not base64!",
  }), /invalid/i);
});
