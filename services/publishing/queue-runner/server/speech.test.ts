import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { formatTimestamp, pickMoments, transcriptText } from "../../../../src/platform/social-seo/companion-ai.js";
import { masterPrompt, parseAnswer, withRealChapters, withoutLinkBlanks } from "./services/chat-ai/master-prompt.js";
import { enginePackageForPlatform, extractNpmPackage } from "./services/chat-ai/speech.js";

const require = createRequire(import.meta.url);
const { speechPieces, spokenText } = require("./services/chat-ai/speech-worker.cjs");

function tarEntry(name: string, content: string) {
  const body = Buffer.from(content);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  header.write("0000644\0", 100);
  header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124);
  header.write("0", 156);
  return Buffer.concat([header, body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
}

test("the speech engine unpacks inside its own folder and nowhere else", async context => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "speech-engine-"));
  context.after(() => rm(folder, { recursive: true, force: true }));
  extractNpmPackage(gzipSync(Buffer.concat([tarEntry("package/lib/addon.js", "ok"), Buffer.alloc(1024)])), folder);
  assert.equal(await readFile(path.join(folder, "lib", "addon.js"), "utf8"), "ok");
  assert.throws(() => extractNpmPackage(gzipSync(Buffer.concat([tarEntry("package/../../evil.js", "no"), Buffer.alloc(1024)])), folder), /not valid/);
  assert.equal(enginePackageForPlatform("win32", "x64"), "sherpa-onnx-win-x64");
  assert.equal(enginePackageForPlatform("darwin", "arm64"), "sherpa-onnx-darwin-arm64");
  assert.equal(enginePackageForPlatform("freebsd", "x64"), null);
});

test("long audio is cut at quiet moments into pieces the speech model can read", () => {
  const rate = 16000;
  const pcm = new Int16Array(rate * 70).fill(4000);
  pcm.fill(0, rate * 20, rate * 21);
  const pieces = speechPieces(pcm, rate);
  assert.equal(pieces[0][0], 0);
  assert.ok(pieces[0][1] >= rate * 20 && pieces[0][1] <= rate * 21, "cut inside the silence");
  assert.equal(pieces.at(-1)[1], pcm.length);
  for (const [from, to] of pieces) assert.ok(to - from <= rate * 28);
  pieces.slice(1).forEach(([from]: number[], index: number) => assert.equal(from, pieces[index][1]));
  assert.equal(spokenText("[Music]"), "");
  assert.equal(spokenText("(applause) Welcome to the lesson"), "Welcome to the lesson");
});

test("every part of a video is represented by its biggest on-screen change", () => {
  assert.deepEqual(pickMoments([0, 9, 1, 2, 8, 3, 7, 1], 4), [1, 3, 4, 6]);
  assert.deepEqual(pickMoments([5, 1], 4), [0, 1]);
  assert.deepEqual(pickMoments([], 4), []);
  assert.equal(formatTimestamp(1031), "17:11");
  assert.equal(formatTimestamp(3725), "1:02:05");
});

test("the transcript carries real times and stays within what an AI app can take", () => {
  assert.equal(transcriptText([{ start: 0, text: "Welcome" }, { start: 75, text: "Nested lists" }]), "[0:00] Welcome\n[1:15] Nested lists");
  const long = Array.from({ length: 2000 }, (_, index) => ({ start: index * 20, text: "word ".repeat(20) }));
  const thinned = transcriptText(long, 10_000);
  assert.ok(thinned.length <= 10_000);
  assert.match(thinned.split("\n").at(-1)!, /^\[\d+:\d{2}(?::\d{2})?\]/);
  assert.ok(thinned.split("\n").length > 50, "thinned evenly, not cut off at the start");
});

test("the AI gets the transcript, and real chapters survive only when YouTube would accept them", () => {
  const prompt = masterPrompt({ platforms: ["youtube"], mediaKind: "video", imageCount: 6, durationSeconds: 1031, transcript: "[0:00] Welcome" });
  assert.match(prompt, /moments from it, each labelled with its time/);
  assert.match(prompt, /\[0:00\] Welcome/);
  assert.match(prompt, /chapters in the YouTube description/);
  assert.match(prompt, /don't leave blanks such as \[VIDEO LINK\]/);

  const chapters = "Learn lists.\n\n**0:00** Intro\n- 2:15 - Nested lists\n5:40 Indexing";
  assert.equal(withRealChapters(chapters, 1031), "Learn lists.\n\n0:00 Intro\n2:15 - Nested lists\n5:40 Indexing".replace("2:15 - Nested", "2:15 Nested"));
  assert.doesNotMatch(withRealChapters("About\n1:00 Late start\n2:00 Next\n3:00 Last", 1031), /1:00/);
  assert.doesNotMatch(withRealChapters("About\n0:00 Intro\n2:00 Next\n99:00 Past the end", 1031), /99:00/);

  const answer = "=== YOUTUBE TITLE ===\nLists\n=== YOUTUBE DESCRIPTION ===\nAbout\n0:00 Intro\n2:00 Next\n4:00 End\n=== YOUTUBE TAGS ===\npython";
  assert.match(parseAnswer(answer, ["youtube"], { realTimes: true, durationSeconds: 1031 }).results.youtube!.description as string, /2:00 Next/);
  assert.doesNotMatch(parseAnswer(answer, ["youtube"]).results.youtube!.description as string, /2:00/);
});

test("blanks like [VIDEO LINK] never reach a published post", () => {
  assert.equal(withoutLinkBlanks("Learn Python.\n\n▶️ Watch the full lesson: [VIDEO LINK]\n\nWhich topic next?"), "Learn Python.\n\nWhich topic next?");
  assert.equal(withoutLinkBlanks("[VIDEO LINK]\nHello"), "Hello");
  assert.equal(withoutLinkBlanks("We explain indexing, slicing and nesting in depth [link] today"), "We explain indexing, slicing and nesting in depth  today");
  assert.equal(withoutLinkBlanks("nested_list[1][0] returns 3"), "nested_list[1][0] returns 3");
});
