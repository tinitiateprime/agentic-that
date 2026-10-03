import assert from "node:assert/strict";
import test from "node:test";
import { TELEGRAM_UPLOAD_CHUNK_BYTES, uploadTelegramDeviceFile } from "./media-upload.js";

test("device files are staged in ordered chunks and completed for the selected account", async () => {
  const bytes = new Uint8Array(TELEGRAM_UPLOAD_CHUNK_BYTES + 3).fill(7);
  const file = {
    name: "video.mp4",
    type: "video/mp4",
    size: bytes.byteLength,
    slice: (start, end) => new Blob([bytes.slice(start, end)]),
  };
  const calls = [];
  const progress = [];
  const upload = await uploadTelegramDeviceFile({
    file,
    accountId: "account-one",
    requestJson: async (url, options) => {
      calls.push({ kind: "json", url, options });
      if (url === "/v1/media/uploads") return { upload: { id: "telegram_media_123" } };
      return { upload: { id: "telegram_media_123", fileName: "video.mp4", size: file.size } };
    },
    requestBinary: async (url, options) => {
      calls.push({ kind: "binary", url, options });
      const offset = Number(options.headers["x-upload-offset"]);
      return { upload: { offset: offset + options.body.size } };
    },
    onProgress: (sent, total) => progress.push([sent, total]),
  });
  assert.equal(upload.fileName, "video.mp4");
  assert.deepEqual(calls.filter(call => call.kind === "binary").map(call => call.options.headers["x-upload-offset"]), ["0", String(TELEGRAM_UPLOAD_CHUNK_BYTES)]);
  assert.deepEqual(progress.at(-1), [file.size, file.size]);
  assert.match(calls.at(-1).url, /\/complete$/);
});

test("a failed device upload is removed from private server staging", async () => {
  const calls = [];
  await assert.rejects(uploadTelegramDeviceFile({
    file: { name: "broken.mp4", type: "video/mp4", size: 2, slice: () => new Blob(["xx"]) },
    accountId: "account-one",
    requestJson: async () => ({ upload: { id: "telegram_media_failed" } }),
    requestBinary: async (url, options) => {
      calls.push({ url, method: options.method });
      if (options.method === "PUT") throw new Error("network failed");
      return { ok: true };
    },
  }), /network failed/);
  assert.equal(calls.at(-1).method, "DELETE");
});
