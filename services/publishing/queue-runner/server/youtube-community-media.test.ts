import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  prepareYouTubeCommunityMedia,
  youtubeCommunityImageNeedsOptimization,
  youtubeCommunityImagePreviewTimeout,
} from "./services/publishers/youtube-community-media.js";

test("YouTube Community gives large images enough time to render a preview", () => {
  assert.equal(youtubeCommunityImagePreviewTimeout(512 * 1024), 90_000);
  assert.equal(youtubeCommunityImagePreviewTimeout(9_838_239), 180_000);
  assert.equal(youtubeCommunityImagePreviewTimeout(16 * 1024 * 1024), 240_000);
});

test("YouTube Community optimization detects the failed poster dimensions and size", () => {
  assert.equal(youtubeCommunityImageNeedsOptimization(9_838_239, 3_600, 4_800), true);
  assert.equal(youtubeCommunityImageNeedsOptimization(2_453_766, 1_630, 965), false);
});

test("YouTube Community prepares a large poster without cropping it", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-youtube-community-"));
  const sourcePath = path.join(directory, "poster.png");
  try {
    await sharp({
      create: { width: 1_800, height: 2_700, channels: 3, background: "#163b67" },
    }).png({ compressionLevel: 0 }).toFile(sourcePath);
    const sourceStats = await stat(sourcePath);
    const prepared = await prepareYouTubeCommunityMedia(sourcePath, "image/png");
    try {
      assert.equal(prepared.normalized, true);
      assert.equal(prepared.width, 1_707);
      assert.equal(prepared.height, 2_560);
      assert.ok(prepared.byteSize < sourceStats.size);
      const metadata = await sharp(prepared.filePath).metadata();
      assert.equal(metadata.width, 1_707);
      assert.equal(metadata.height, 2_560);
    } finally {
      await prepared.cleanup();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
