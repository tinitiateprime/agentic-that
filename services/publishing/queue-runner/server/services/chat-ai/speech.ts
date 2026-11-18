// Turns a video's speech into text on the user's own computer. The speech engine
// and model are downloaded once, checked against fixed hashes, and kept in the
// Companion's data folder. Audio never leaves this computer.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { publishingUploadDirectory } from "../../runtime-paths.js";

const ENGINE_VERSION = "2.0.1";

const ENGINE_PACKAGES: Record<string, string> = {
  "sherpa-onnx-node": "1PSACfQgPXAD7ExwCv1QW09EXTjcNlpZKBqDY+jxSdIzlyOSq0M13SILBoUQUfeJqiTTXnqp6Ha9jjMUQ6efXg==",
  "sherpa-onnx-win-x64": "7vwdAw9PGEb0JLSpK7UFxAdp1vabBHK9Nhw2jFRBWSFgtslUPHIB0T6syJfRgiUGyCeNW9fJvcFAk2F2u7hBEw==",
  "sherpa-onnx-win-arm64": "Mb9iqy2Zp7GC5a99dk5E8EQJsEBnapf+IcwHLVCgtIf5mxYHO9Q8YptnAoOHZOD0Zi+R+MblFyG9qv0Q6tin4Q==",
  "sherpa-onnx-darwin-x64": "SBnHa3LDOSI/5/rpBHGxKQDFq+yIdxowYY0InLzfojTUx+yGgqu7cYBrRxjzvHOiOKi0O4rmlFVZboyhIqpDgA==",
  "sherpa-onnx-darwin-arm64": "agXmbbwiVPUSMViMhWhYAt59iG21ui7x6HxQFU35XzHOfQe9x6Pg9V160Pzak/66x0ePMjixsLUtMaaUrLfCwQ==",
  "sherpa-onnx-linux-x64": "w5mRRrIvPvcNWac7rQ8AN/t/cwElPGoRpH+ceCRBV7XfjCIQ9Rcr3Ig/kXcJLNOxgK4bGmef+Y47lIWiesDODw==",
  "sherpa-onnx-linux-arm64": "5CJvLjFYIg23oELCsT7l07fMLT3PdquZ3tqh7KZK3Pzi+c2YiPKRe1DDUxoNdtCaw3ZiS4aQSQPBblB9JStuDA==",
};

const MODEL_BASE_URL = "https://huggingface.co/csukuangfj/sherpa-onnx-whisper-base/resolve/main";
const MODEL_FILES = [
  { name: "base-encoder.int8.onnx", bytes: 29_120_534, sha256: "0b8fb1304b6109976038efff5ace81720e00386f3ff6b54ee8c75291ca0a1e11" },
  { name: "base-decoder.int8.onnx", bytes: 130_672_026, sha256: "9759d217388a01b3a4c7c15533201067b48ae819c4daafc8624e64b9409dc02d" },
  { name: "base-tokens.txt", bytes: 816_730, sha256: "b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126" },
];

export type SpeechSegment = { start: number; text: string };
export type SpeechProgress = { stage: "downloading" | "listening"; percent: number };

const speechRoot = () => path.join(path.dirname(publishingUploadDirectory()), "speech");
const engineDirectory = () => path.join(speechRoot(), `engine-${ENGINE_VERSION}`);
const modelDirectory = () => path.join(speechRoot(), "model-base");

export function enginePackageForPlatform(platform: string = process.platform, arch: string = process.arch) {
  const name = `sherpa-onnx-${platform === "win32" ? "win" : platform}-${arch}`;
  return ENGINE_PACKAGES[name] ? name : null;
}

/** Unpacks an npm package archive into a folder, refusing any path that escapes it. */
export function extractNpmPackage(archive: Buffer, destination: string) {
  const tar = gunzipSync(archive);
  const root = path.resolve(destination);
  let longName = "";
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const text = (from: number, length: number) => header.toString("utf8", from, from + length).replace(/\0.*$/s, "");
    const size = Number.parseInt(text(124, 12).trim() || "0", 8);
    const type = text(156, 1) || "0";
    const body = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === "L") { longName = body.toString("utf8").replace(/\0.*$/s, ""); continue; }
    const prefix = text(345, 155);
    const name = longName || (prefix ? `${prefix}/${text(0, 100)}` : text(0, 100));
    longName = "";
    if (type !== "0") continue;
    const relative = name.replace(/^[^/]+\//, "");
    const target = path.resolve(root, relative);
    if (!relative || !target.startsWith(root + path.sep)) throw new Error("The speech engine download is not valid.");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
}

async function downloadChecked(url: string, target: string, algorithm: "sha256" | "sha512", expected: string, encoding: "hex" | "base64", onBytes: (bytes: number) => void) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`The speech tool could not be downloaded (${response.status}).`);
  const partial = `${target}.part`;
  const hash = createHash(algorithm);
  const body = Readable.fromWeb(response.body as never);
  body.on("data", (chunk: Buffer) => { hash.update(chunk); onBytes(chunk.length); });
  await pipeline(body, fs.createWriteStream(partial));
  if (hash.digest(encoding) !== expected) {
    await fsp.rm(partial, { force: true });
    throw new Error("The speech tool download was damaged. Please try again.");
  }
  await fsp.rename(partial, target);
}

async function fileHasSize(file: string, bytes: number) {
  return (await fsp.stat(file).catch(() => null))?.size === bytes;
}

/** Downloads the speech engine and model the first time they are needed. */
export async function ensureSpeechTools(onProgress: (percent: number) => void) {
  const platformPackage = enginePackageForPlatform();
  if (!platformPackage) throw new Error("Listening to videos isn't available on this computer yet.");
  await fsp.mkdir(modelDirectory(), { recursive: true });

  const missingModels = [];
  for (const file of MODEL_FILES) if (!(await fileHasSize(path.join(modelDirectory(), file.name), file.bytes))) missingModels.push(file);
  const engineReady = fs.existsSync(path.join(engineDirectory(), "ready"));
  const total = missingModels.reduce((sum, file) => sum + file.bytes, 0) + (engineReady ? 0 : 12_000_000);
  let received = 0;
  const onBytes = (bytes: number) => {
    received += bytes;
    onProgress(Math.min(99, Math.round((received / Math.max(1, total)) * 100)));
  };

  if (!engineReady) {
    await fsp.rm(engineDirectory(), { recursive: true, force: true });
    for (const name of ["sherpa-onnx-node", platformPackage]) {
      const archive = path.join(speechRoot(), `${name}.tgz`);
      await downloadChecked(`https://registry.npmjs.org/${name}/-/${name}-${ENGINE_VERSION}.tgz`, archive, "sha512", ENGINE_PACKAGES[name], "base64", onBytes);
      extractNpmPackage(await fsp.readFile(archive), path.join(engineDirectory(), "node_modules", name));
      await fsp.rm(archive, { force: true });
    }
    await fsp.writeFile(path.join(engineDirectory(), "ready"), ENGINE_VERSION);
  }
  for (const file of missingModels) {
    await downloadChecked(`${MODEL_BASE_URL}/${file.name}`, path.join(modelDirectory(), file.name), "sha256", file.sha256, "hex", onBytes);
  }
  return { engineDir: engineDirectory(), modelDir: modelDirectory(), platformPackage };
}

function workerPath() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "speech-worker.cjs");
}

/** Listens to 16 kHz mono 16-bit audio in a separate process and returns what was said. */
export async function transcribeAudioFile(pcmPath: string, onProgress: (progress: SpeechProgress) => void, signal: AbortSignal) {
  const { engineDir, modelDir, platformPackage } = await ensureSpeechTools((percent) => onProgress({ stage: "downloading", percent }));
  signal.throwIfAborted();
  const libraries = path.join(engineDir, "node_modules", platformPackage);
  const child = spawn(process.execPath, [workerPath(), JSON.stringify({ engineDir, modelDir, pcmPath })], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PATH: `${libraries}${path.delimiter}${process.env.PATH || ""}`,
      LD_LIBRARY_PATH: `${libraries}${path.delimiter}${process.env.LD_LIBRARY_PATH || ""}`,
      DYLD_LIBRARY_PATH: `${libraries}${path.delimiter}${process.env.DYLD_LIBRARY_PATH || ""}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  try { if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* runs at normal priority */ }
  const stop = () => child.kill();
  signal.addEventListener("abort", stop, { once: true });

  return new Promise<SpeechSegment[]>((resolve, reject) => {
    let buffer = "";
    let segments: SpeechSegment[] | null = null;
    let failure = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("{")) continue;
        const message = JSON.parse(line) as { progress?: number; segments?: SpeechSegment[]; error?: string };
        if (typeof message.progress === "number") onProgress({ stage: "listening", percent: Math.round(message.progress * 100) });
        if (message.segments) segments = message.segments;
        if (message.error) failure = message.error;
      }
    });
    child.stderr.resume();
    child.once("error", reject);
    child.once("close", () => {
      signal.removeEventListener("abort", stop);
      if (segments) resolve(segments);
      else reject(new Error(failure || "The speech tool stopped before it finished."));
    });
  });
}
