import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { downloadCentralArtifact, validateCentralArtifactParts, type CentralJobArtifact } from "./central-artifact.js";

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
