import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { instagramImageCanvas, prepareInstagramMedia } from "./services/publishers/instagram-media.js";

test("Instagram image canvas preserves content while fitting feed ratios", () => {
  assert.deepEqual(instagramImageCanvas(776, 370), { width: 776, height: 407 });
  assert.deepEqual(instagramImageCanvas(400, 1000), { width: 800, height: 1000 });
  assert.deepEqual(instagramImageCanvas(1080, 1080), { width: 1080, height: 1080 });
});

test("Instagram media preparation pads a wide image without cropping it", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-instagram-media-"));
  const sourcePath = path.join(directory, "wide.png");
  try {
    await sharp({ create: { width: 776, height: 370, channels: 3, background: "#126b4e" } }).png().toFile(sourcePath);
    const prepared = await prepareInstagramMedia(sourcePath, "image/png");
    try {
      assert.equal(prepared.normalized, true);
      const metadata = await sharp(await readFile(prepared.filePath)).metadata();
      assert.equal(metadata.width, 776);
      assert.equal(metadata.height, 407);
      assert.ok((metadata.width || 0) / (metadata.height || 1) <= 1.91);
    } finally {
      await prepared.cleanup();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
