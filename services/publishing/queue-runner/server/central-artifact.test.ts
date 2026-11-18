import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { downloadCentralArtifact, validateCentralArtifactParts, type CentralJobArtifact } from "./central-artifact.js";

test("video pieces download side by side, retry a passing failure and land in the right order", async context => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "central-parallel-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const pieces = Array.from({ length: 12 }, (_, index) => Buffer.alloc(1000 + index, 65 + index));
  const whole = Buffer.concat(pieces);
  let offset = 0;
  const parts = pieces.map((piece, index) => {
    const part = { index, offset, byteSize: piece.length, downloadUrl: `https://media.example/part/${index}` };
    offset += piece.length;
    return part;
  });
  let active = 0;
  let mostAtOnce = 0;
  let failedOnce = false;
  const progress: number[] = [];
  const localPath = path.join(directory, "lesson.mp4");
  await downloadCentralArtifact({
    artifact: { bucket: "b", path: "p", fileName: "lesson.mp4", byteSize: whole.length, sha256: createHash("sha256").update(whole).digest("hex"), parts },
    fileName: "lesson.mp4",
    localPath,
    supabaseUrl: "https://media.example",
    retryDelayMs: 1,
    onProgress: (percent) => progress.push(percent),
    fetchImplementation: (async (url: URL) => {
      active += 1;
      mostAtOnce = Math.max(mostAtOnce, active);
      await new Promise((resolve) => setTimeout(resolve, (12 - Number(String(url).split("/").pop())) * 2));
      active -= 1;
      if (String(url).endsWith("/3") && !failedOnce) {
        failedOnce = true;
        return new Response("busy", { status: 503 });
      }
      return new Response(pieces[Number(String(url).split("/").pop())]);
    }) as typeof fetch,
  });
  assert.deepEqual(await fs.readFile(localPath), whole);
  assert.ok(mostAtOnce > 1 && mostAtOnce <= 6, `ran ${mostAtOnce} at once`);
  assert.equal(failedOnce, true);
  assert.equal(progress.at(-1), 100);
});

test("Companion assembles and verifies chunked private publishing media", async () => {
  const chunks = [Buffer.from("large "), Buffer.from("media")];
  const artifact: CentralJobArtifact = {
    bucket: "job-artifacts",
    path: "workspace/file.parts",
    fileName: "file.mp4",
    byteSize: chunks.reduce((total, chunk) => total + chunk.length, 0),
    parts: chunks.map((chunk, index) => ({
      index,
      offset: index === 0 ? 0 : chunks[0].length,
      byteSize: chunk.length,
      sha256: createHash("sha256").update(chunk).digest("hex"),
      downloadUrl: `https://project.supabase.co/storage/v1/object/sign/job-artifacts/file/${index}`,
    })),
  };
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentic-that-artifact-"));
  const localPath = path.join(directory, artifact.fileName);
  try {
    let request = 0;
    await downloadCentralArtifact({
      artifact,
      fileName: artifact.fileName,
      localPath,
      supabaseUrl: "https://project.supabase.co",
      fetchImplementation: async () => new Response(chunks[request++]),
    });
    assert.equal(await fs.readFile(localPath, "utf8"), "large media");
    assert.equal(request, 2);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("Companion rejects incomplete or out-of-order private media parts", () => {
  assert.throws(() => validateCentralArtifactParts({
    bucket: "job-artifacts",
    path: "workspace/file.parts",
    fileName: "file.mp4",
    parts: [{ index: 1, offset: 0, byteSize: 10, downloadUrl: "https://project.supabase.co/part" }],
  }), /part list is invalid/i);
});
