import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { formatVideoLength, videoFit } from "../shared/video-limits.js";
import { mp4DurationSeconds } from "./services/video-duration.js";

const lesson = { durationSeconds: 1031, sizeBytes: 53_466_179 };

test("a 17-minute lesson is judged per app before anything is uploaded", () => {
  assert.equal(videoFit("instagram", lesson).status, "fits");
  assert.equal(videoFit("facebook", lesson).status, "fits");
  assert.equal(videoFit("youtube", lesson).status, "warning");
  assert.match(videoFit("youtube", lesson).message, /youtube\.com\/verify/);
  assert.equal(videoFit("x", lesson).status, "warning");
  assert.match(videoFit("x", lesson).message, /Premium/);
  assert.equal(videoFit("linkedin", lesson).status, "blocked");
  assert.match(videoFit("linkedin", lesson).message, /15:00.*17:11/);
  assert.equal(videoFit("reddit", lesson).status, "blocked");
});

test("limits apply exactly at the edge, and size is checked too", () => {
  assert.equal(videoFit("linkedin", { durationSeconds: 900, sizeBytes: 1 }).status, "fits");
  assert.equal(videoFit("linkedin", { durationSeconds: 901, sizeBytes: 1 }).status, "blocked");
  assert.equal(videoFit("x", { durationSeconds: 140, sizeBytes: 1 }).status, "fits");
  assert.equal(videoFit("reddit", { durationSeconds: 60, sizeBytes: 2 * 1024 ** 3 }).status, "blocked");
  assert.equal(videoFit("youtube", { durationSeconds: 13 * 3600, sizeBytes: 1 }).status, "blocked");
  assert.equal(videoFit("youtube", { durationSeconds: 0, sizeBytes: 0 }).status, "fits");
  assert.equal(formatVideoLength(3725), "1:02:05");
});

test("a video's length is read from its MP4 header, wherever the header sits", async context => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "video-length-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const box = (type: string, body: Buffer) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(body.length + 8, 0);
    header.write(type, 4, "latin1");
    return Buffer.concat([header, body]);
  };
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(1_031_067, 16);
  const file = path.join(directory, "lesson.mp4");
  await writeFile(file, Buffer.concat([box("ftyp", Buffer.alloc(16)), box("mdat", Buffer.alloc(4096)), box("moov", box("mvhd", mvhd))]));
  assert.equal(Math.round(mp4DurationSeconds(file)), 1031);

  const notVideo = path.join(directory, "notes.txt");
  await writeFile(notVideo, "plain text that is not a video");
  assert.equal(mp4DurationSeconds(notVideo), 0);
  assert.equal(mp4DurationSeconds(path.join(directory, "missing.mp4")), 0);
});
