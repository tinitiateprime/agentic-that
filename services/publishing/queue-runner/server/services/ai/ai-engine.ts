// Local AI engine for the Companion: installs llama.cpp and a vision model on
// first use, runs `llama-server` bound to 127.0.0.1 only, and shuts it down
// when idle. Nothing leaves the computer except the one-time downloads.

import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { LLAMA_BUILD, cpuBuildUsesGpu, engineAssetFor, gpuEngineAssetFor, recommendedTier, tierById, type DownloadFile, type ModelTier } from "./ai-catalog.js";

export type AiPhase = "not-installed" | "downloading" | "installed" | "starting" | "ready" | "error" | "unsupported";

type Progress = { file: string; receivedBytes: number; totalBytes: number; overallReceived: number; overallTotal: number };

const IDLE_SHUTDOWN_MS = 10 * 60 * 1000;
const START_TIMEOUT_MS = 4 * 60 * 1000;

function aiRoot() {
  const configured = process.env.PUBLISH_QUEUE_AI_DIR?.trim();
  return path.resolve(configured || path.join(process.cwd(), "ai-data"));
}

const paths = {
  engineDir: () => path.join(aiRoot(), "engine", LLAMA_BUILD),
  gpuEngineDir: () => path.join(aiRoot(), "engine", `${LLAMA_BUILD}-gpu`),
  modelDir: () => path.join(aiRoot(), "models"),
  downloads: () => path.join(aiRoot(), "downloads"),
  settings: () => path.join(aiRoot(), "ai-settings.json"),
};

async function fileExists(file: string) {
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}

async function sha256Of(file: string) {
  const hash = createHash("sha256");
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest("hex");
}

/** Download to a .part file, verify SHA-256, then move into place. */
async function download(file: DownloadFile, destination: string, onProgress: (received: number, total: number) => void, signal?: AbortSignal) {
  if (await fileExists(destination)) return;
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const partial = `${destination}.part`;
  const response = await fetch(file.url, { redirect: "follow", signal });
  if (!response.ok || !response.body) throw new Error(`Download failed for ${file.name} (${response.status}).`);
  const total = Number(response.headers.get("content-length")) || file.bytes;
  let received = 0;
  const hash = createHash("sha256");
  const source = Readable.fromWeb(response.body as never);
  source.on("data", (chunk: Buffer) => {
    received += chunk.length;
    hash.update(chunk);
    onProgress(received, total);
  });
  await pipeline(source, fs.createWriteStream(partial));
  const digest = hash.digest("hex");
  if (digest !== file.sha256) {
    await fsp.rm(partial, { force: true });
    throw new Error(`${file.name} failed its integrity check and was removed. Please try again.`);
  }
  await fsp.rename(partial, destination);
}

async function extract(archive: string, destination: string) {
  await fsp.mkdir(destination, { recursive: true });
  // Windows 10+, macOS and Linux all ship a tar that reads both .zip and .tar.gz.
  // On Windows use the system copy explicitly: other tars on PATH (Git's, for
  // example) cannot read zip files or drive-letter paths.
  const systemTar = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
  const tar = process.platform === "win32" && !(await fileExists(systemTar)) ? "tar" : systemTar;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(tar, ["-xf", archive, "-C", destination], { stdio: "ignore", windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Could not unpack the AI engine (tar exited with ${code}).`))));
  });
}

async function findFile(directory: string, name: string): Promise<string | null> {
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === name) return full;
    if (entry.isDirectory()) {
      const found = await findFile(full, name);
      if (found) return found;
    }
  }
  return null;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (address && typeof address === "object" ? resolve(address.port) : reject(new Error("No free port."))));
    });
  });
}

class LocalAiEngine {
  private phase: AiPhase = "not-installed";
  private error = "";
  private progress: Progress | null = null;
  private tier: ModelTier | null = null;
  private child: ChildProcess | null = null;
  private port = 0;
  private idleTimer: NodeJS.Timeout | null = null;
  private installing: Promise<void> | null = null;
  private starting: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private stderrTail: string[] = [];
  /** Speed of the last request, as reported by llama.cpp. */
  lastTimings: { prompt_n: number; prompt_ms: number; predicted_n: number; predicted_ms: number } | null = null;

  async status() {
    const asset = engineAssetFor();
    if (!asset) this.phase = "unsupported";
    if (this.phase === "not-installed" || this.phase === "installed") {
      const settings = await this.readSettings();
      const tier = tierById(settings.tier);
      if (tier && await this.isInstalled(tier)) {
        this.tier = tier;
        this.phase = this.child ? this.phase : "installed";
      } else {
        this.phase = "not-installed";
      }
    }
    const recommended = recommendedTier(os.totalmem());
    return {
      phase: this.phase,
      error: this.error,
      progress: this.progress,
      tier: this.tier ? { id: this.tier.id, label: this.tier.label, licence: this.tier.licence, licenceUrl: this.tier.licenceUrl } : null,
      recommendedTier: recommended.id,
      memoryGb: Math.round(os.totalmem() / 1024 ** 3),
      // Too little free memory right now: the page suggests closing other apps for speed.
      lowMemory: this.tier ? os.freemem() < this.tier.model.bytes + this.tier.projector.bytes + 1.0e9 : false,
      freeMemoryGb: Math.round((os.freemem() / 1024 ** 3) * 10) / 10,
      tiers: [recommended, ...["standard", "quality", "lite"].map((id) => tierById(id)!).filter((tier) => tier.id !== recommended.id)].map((tier) => ({
        id: tier.id,
        label: tier.label,
        description: tier.description,
        downloadGb: Number(((tier.model.bytes + tier.projector.bytes + (asset?.bytes || 0)) / 1e9).toFixed(1)),
        minimumRamGb: tier.minimumRamGb,
        licence: tier.licence,
        licenceUrl: tier.licenceUrl,
      })),
    };
  }

  private async writeSettings(update: Record<string, unknown>) {
    await fsp.mkdir(aiRoot(), { recursive: true });
    await fsp.writeFile(paths.settings(), JSON.stringify({ ...(await this.readSettings()), ...update }, null, 2));
  }

  private async readSettings(): Promise<{ tier?: string; backend?: "gpu" | "cpu"; backendMeasured?: boolean }> {
    try {
      return JSON.parse(await fsp.readFile(paths.settings(), "utf8"));
    } catch {
      return {};
    }
  }

  private async isInstalled(tier: ModelTier) {
    const binary = await this.serverBinary();
    return Boolean(binary)
      && await fileExists(path.join(paths.modelDir(), tier.model.name))
      && await fileExists(path.join(paths.modelDir(), tier.projector.name));
  }

  /**
   * Quality first: the chosen model is always used. Little free memory only makes
   * it slower (the page then suggests closing other apps), it never swaps in a
   * weaker model. A smaller one is used only if the computer's total memory
   * cannot hold the chosen model at all.
   */
  private async tierThatFits(chosen: ModelTier) {
    const need = (tier: ModelTier) => tier.model.bytes + tier.projector.bytes + 1.0e9;
    this.lowMemory = os.freemem() < need(chosen);
    if (os.totalmem() * 0.75 >= need(chosen)) return chosen;
    for (const id of ["standard", "lite"]) {
      const tier = tierById(id)!;
      if (need(tier) < need(chosen) && os.totalmem() * 0.75 >= need(tier) && await this.isInstalled(tier)) return tier;
    }
    return chosen;
  }

  /** True when the last start found too little free memory for full speed. */
  lowMemory = false;

  private async serverBinary(variant: "cpu" | "gpu" = "cpu") {
    const directory = variant === "gpu" ? paths.gpuEngineDir() : paths.engineDir();
    if (!(await fileExists(directory))) return null;
    return findFile(directory, process.platform === "win32" ? "llama-server.exe" : "llama-server");
  }

  /** One-time setup: engine + model + vision projector, each verified. */
  install(tierId?: string) {
    if (this.installing) return this.installing;
    const asset = engineAssetFor();
    if (!asset) {
      this.phase = "unsupported";
      return Promise.reject(new Error("Local AI is not available for this computer type yet."));
    }
    const tier = tierById(tierId) || recommendedTier(os.totalmem());
    this.installing = (async () => {
      try {
        this.phase = "downloading";
        this.error = "";
        const files = [
          { file: asset, destination: path.join(paths.downloads(), asset.name) },
          { file: tier.projector, destination: path.join(paths.modelDir(), tier.projector.name) },
          { file: tier.model, destination: path.join(paths.modelDir(), tier.model.name) },
        ];
        const overallTotal = files.reduce((sum, entry) => sum + entry.file.bytes, 0);
        let completed = 0;
        for (const { file, destination } of files) {
          await download(file, destination, (received, total) => {
            this.progress = { file: file.name, receivedBytes: received, totalBytes: total, overallReceived: completed + received, overallTotal };
          });
          completed += file.bytes;
        }
        if (!(await this.serverBinary())) await extract(path.join(paths.downloads(), asset.name), paths.engineDir());
        if (!(await this.serverBinary())) throw new Error("The AI engine was downloaded but its server program was not found.");
        if (process.platform !== "win32") await fsp.chmod((await this.serverBinary())!, 0o755);
        // The graphics-card build is optional: if it cannot be fetched, the CPU build is used.
        const gpuAsset = gpuEngineAssetFor();
        if (gpuAsset && !(await this.serverBinary("gpu"))) {
          try {
            await download(gpuAsset, path.join(paths.downloads(), gpuAsset.name), () => undefined);
            await extract(path.join(paths.downloads(), gpuAsset.name), paths.gpuEngineDir());
            if (process.platform !== "win32" && await this.serverBinary("gpu")) await fsp.chmod((await this.serverBinary("gpu"))!, 0o755);
          } catch {
            // Optional.
          }
        }
        await this.writeSettings({ tier: tier.id, installedAt: new Date().toISOString() });
        await this.stop();
        this.tier = tier;
        this.phase = "installed";
        this.progress = null;
        // Quietly add the small model too, so a busy computer can switch to it
        // instead of running a model that does not fit in free memory.
        const lite = tierById("lite")!;
        if (tier.id !== lite.id) {
          void (async () => {
            for (const file of [lite.projector, lite.model]) await download(file, path.join(paths.modelDir(), file.name), () => undefined);
          })().catch(() => undefined);
        }
      } catch (error) {
        this.phase = "error";
        this.error = error instanceof Error ? error.message : "AI setup failed.";
        throw error;
      } finally {
        this.installing = null;
      }
    })();
    return this.installing;
  }

  private async start() {
    if (this.child && this.phase === "ready") return;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const settings = await this.readSettings();
      const tier = tierById(settings.tier);
      if (!tier || !(await this.isInstalled(tier))) throw new Error("Set up the free local AI first.");
      const active = await this.tierThatFits(tier);
      this.tier = active;
      this.phase = "starting";
      // Integrated graphics can be slower than the processor (and a gaming GPU far
      // faster), so the first start measures both once and keeps the faster one.
      if (!settings.backendMeasured && !cpuBuildUsesGpu()) {
        const gpu = await this.serverBinary("gpu");
        if (gpu) {
          settings.backend = await this.calibrate(gpu, active);
          await this.writeSettings({ backend: settings.backend, backendMeasured: true });
        }
      }
      const gpuBinary = settings.backend !== "cpu" ? await this.serverBinary("gpu") : null;
      if (gpuBinary) {
        try {
          await this.launch(gpuBinary, active, true, 90_000);
          if (settings.backend !== "gpu") await this.writeSettings({ backend: "gpu" });
          this.backend = "gpu";
          return;
        } catch {
          await this.stop();
          await this.writeSettings({ backend: "cpu" });
        }
      }
      await this.launch((await this.serverBinary())!, active, cpuBuildUsesGpu(), START_TIMEOUT_MS);
      this.backend = cpuBuildUsesGpu() ? "gpu" : "cpu";
    })();
    try {
      await this.starting;
    } catch (error) {
      this.phase = "error";
      this.error = error instanceof Error ? error.message : "The AI engine could not start.";
      throw error;
    } finally {
      this.starting = null;
    }
  }

  backend: "gpu" | "cpu" | "" = "";

  /** Times the graphics and the processor engine on the same short job and returns the faster. */
  private async calibrate(gpuBinary: string, tier: ModelTier): Promise<"gpu" | "cpu"> {
    const timeOne = async (binary: string, useGpu: boolean) => {
      try {
        await this.launch(binary, tier, useGpu, useGpu ? 90_000 : START_TIMEOUT_MS);
        return await this.typicalPostSeconds();
      } catch {
        return Number.POSITIVE_INFINITY;
      } finally {
        await this.stop();
      }
    };
    const gpu = await timeOne(gpuBinary, true);
    const cpuBinary = await this.serverBinary();
    const cpu = cpuBinary ? await timeOne(cpuBinary, false) : Number.POSITIVE_INFINITY;
    return gpu < cpu ? "gpu" : "cpu";
  }

  /** Estimated seconds for a typical post (about 2,000 words read and 700 written), from a short test. */
  private async typicalPostSeconds() {
    const response = await fetch(`http://127.0.0.1:${this.port}/completion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Social media SEO helps the right people find a post through search. ".repeat(30), n_predict: 32, temperature: 0, cache_prompt: false }),
    });
    const data = await response.json() as { timings?: { prompt_n: number; prompt_ms: number; predicted_n: number; predicted_ms: number } };
    const t = data.timings;
    if (!response.ok || !t?.prompt_n || !t.predicted_n) return Number.POSITIVE_INFINITY;
    return 2000 / (t.prompt_n / (t.prompt_ms / 1000)) + 700 / (t.predicted_n / (t.predicted_ms / 1000));
  }

  private async launch(binary: string, tier: ModelTier, useGpu: boolean, timeoutMs: number) {
    {
      this.port = await freePort();
      this.phase = "starting";
      this.stderrTail = [];
      const threads = Math.max(2, Math.min(8, os.cpus().length - 1));
      const args = [
        "-m", path.join(paths.modelDir(), tier.model.name),
        "--mmproj", path.join(paths.modelDir(), tier.projector.name),
        "--host", "127.0.0.1",
        "--port", String(this.port),
        "-c", "4096",
        "-t", String(threads),
        "--jinja",
        "--no-webui",
        // A slow computer can need many minutes for one post: allow up to an hour.
        "--timeout", "3600",
        // One request at a time keeps memory low: less memory means less swapping,
        // which is what makes local AI slow on busy laptops.
        "-np", "1",
        // Remember recently read instructions (so the next post only reads its own
        // details), capped so it never crowds out the model on a busy computer.
        "--cache-ram", "1024",
        // Measured on a laptop processor: plain attention with a full-precision cache
        // reads 45% and writes 30% faster than flash attention with a compressed
        // cache (and is exact). Graphics engines keep flash attention.
        "-fa", useGpu ? "on" : "off",
        ...(useGpu ? ["-ngl", "99"] : []),
      ];
      const child = spawn(binary, args, { cwd: path.dirname(binary), stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
      this.child = child;
      child.stderr?.on("data", (chunk: Buffer) => {
        this.stderrTail.push(chunk.toString());
        if (this.stderrTail.length > 40) this.stderrTail.shift();
      });
      child.on("exit", () => {
        if (this.child === child) {
          this.child = null;
          if (this.phase !== "error") this.phase = "installed";
        }
      });
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (!this.child) throw new Error(`The AI engine stopped while starting. ${this.stderrTail.join("").slice(-400)}`);
        try {
          const response = await fetch(`http://127.0.0.1:${this.port}/health`);
          if (response.ok) {
            this.phase = "ready";
            return;
          }
        } catch {
          // Still loading.
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      await this.stop();
      throw new Error("The AI engine took too long to start.");
    }
  }

  async stop() {
    const child = this.child;
    this.child = null;
    if (child && !child.killed) child.kill();
    if (this.phase === "ready" || this.phase === "starting") this.phase = "installed";
  }

  /** Requests in progress: the engine is never shut down for being idle while one runs. */
  private busy = 0;

  private touch() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => (this.busy > 0 ? this.touch() : void this.stop()), IDLE_SHUTDOWN_MS);
    this.idleTimer.unref?.();
  }

  /**
   * Load the model ahead of time (the website calls this when the Social SEO
   * page opens), so the first request does not wait for it.
   */
  warm() {
    if (this.child && this.phase === "ready") {
      this.touch();
      return Promise.resolve();
    }
    return this.start().then(() => this.touch(), () => undefined);
  }

  /** Chat completion with an enforced JSON schema. Jobs run one at a time. */
  chat<T>(request: { messages: unknown[]; schema: object; maxTokens?: number; temperature?: number; onText?: (soFar: string) => void }): Promise<T> {
    const job = this.queue.then(async () => {
      this.busy += 1;
      try {
        return await this.run<T>(request);
      } finally {
        this.busy -= 1;
        this.touch();
      }
    });
    this.queue = job.catch(() => undefined);
    return job;
  }

  private async run<T>(request: { messages: unknown[]; schema: object; maxTokens?: number; temperature?: number; onText?: (soFar: string) => void }): Promise<T> {
    {
      await this.start();
      this.touch();
      // Streamed, so slow computers never hit an HTTP timeout and progress is visible.
      const response = await fetch(`http://127.0.0.1:${this.port}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: request.messages,
          temperature: request.temperature ?? 0.6,
          top_p: 0.9,
          // Stop repetition loops (small models can otherwise repeat a phrase forever).
          repeat_penalty: 1.08,
          dry_multiplier: 0.8,
          dry_base: 1.75,
          dry_allowed_length: 2,
          max_tokens: request.maxTokens ?? 1200,
          response_format: { type: "json_schema", json_schema: { name: "result", strict: true, schema: request.schema } },
          cache_prompt: true,
          stream: true,
          timings_per_token: false,
        }),
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(payload.error?.message || `The AI engine returned ${response.status}.`);
      }
      let content = "";
      let finishReason = "";
      let buffer = "";
      const decoder = new TextDecoder();
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        // Still working: the idle shutdown must never stop the engine mid-post on a slow computer.
        this.touch();
        buffer += decoder.decode(chunk, { stream: true });
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const event = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
              timings?: { prompt_n: number; prompt_ms: number; predicted_n: number; predicted_ms: number };
              error?: { message?: string };
            };
            if (event.error) throw new Error(event.error.message || "The AI engine failed.");
            const delta = event.choices?.[0]?.delta?.content || "";
            content += delta;
            // Live text for the page, so people watch the post being written.
            if (delta && request.onText) {
              try { request.onText(content); } catch { /* a slow listener never stops the AI */ }
            }
            if (event.choices?.[0]?.finish_reason) finishReason = event.choices[0].finish_reason;
            if (event.timings) this.lastTimings = event.timings;
          } catch (error) {
            if (error instanceof Error && !(error instanceof SyntaxError)) throw error;
          }
        }
      }
      this.touch();
      try {
        return JSON.parse(content) as T;
      } catch {
        if (finishReason === "length") throw new Error("The AI answer was cut off by its length limit. Please try again.");
        throw new Error(`The AI returned an unreadable answer. Please try again. (${content.slice(0, 160).replace(/\s+/g, " ")})`);
      }
    }
  }
}

export const localAi = new LocalAiEngine();

// Never leave the engine running after the Companion exits. (Only "exit" is
// used: adding SIGINT/SIGTERM listeners would replace Node's default shutdown.)
process.once("exit", () => {
  void localAi.stop();
});
