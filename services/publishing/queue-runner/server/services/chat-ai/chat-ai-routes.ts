// Companion endpoints for Social SEO with the user's own ChatGPT, Claude and
// Gemini logins. The website calls these on 127.0.0.1 with a short-lived signed
// "social-seo" token from AgenticThat.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import express from "express";
import { z } from "zod";
import { verifyServiceAccessToken } from "../../../../../../lib/service-access-token.js";
import { aiStatus, askAi, connectAi, disconnectAi, showAiWindow } from "./chat-ai.js";
import { SEO_PLATFORMS, masterPrompt, parseAnswer } from "./master-prompt.js";
import { AI_PROVIDERS, type AiProviderId } from "./providers.js";
import { transcribeAudioFile } from "./speech.js";
import { MAX_STAGED_VIDEO_BYTES, removeStagedVideo, stageVideo, stagedVideo, stagedVideoExtension } from "./staged-video.js";

// Three hours of 16 kHz mono 16-bit audio.
const MAX_SPEECH_AUDIO_BYTES = 3 * 60 * 60 * 16_000 * 2;
let listening = false;

const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;

const generateSchema = z.object({
  platforms: z.array(z.enum(SEO_PLATFORMS)).min(1).max(SEO_PLATFORMS.length),
  providers: z.array(z.enum(AI_PROVIDERS)).max(AI_PROVIDERS.length).optional(),
  images: z.array(z.string().max(4_000_000).regex(IMAGE_DATA_URL, "Images must be JPEG, PNG or WebP data URLs.")).max(6),
  /** A video already saved through /video, offered to each AI as the whole file. */
  videoId: z.string().uuid().optional(),
  mediaKind: z.enum(["image", "carousel", "video"]),
  durationSeconds: z.number().min(0).max(36_000).optional(),
  transcript: z.string().max(45_000).optional(),
  description: z.string().max(2200).optional(),
  brandName: z.string().max(80).optional(),
  location: z.string().max(160).optional(),
  businessDetails: z.string().max(400).optional(),
}).refine((post) => post.images.length > 0 || Boolean(post.videoId), { message: "Add a photo or video first." });

const providerSchema = z.object({ provider: z.enum(AI_PROVIDERS) });

function requireSeoToken(req: express.Request, res: express.Response, next: express.NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || !verifyServiceAccessToken(token, "social-seo")) {
    res.status(401).json({ message: "Sign in to AgenticThat to use your AI accounts." });
    return;
  }
  next();
}

/** Writes the post images to a private temporary folder so the browser can attach them. */
async function writeImages(images: string[]) {
  const folder = path.join(os.tmpdir(), "agenticthat-social-seo", randomUUID());
  await fsp.mkdir(folder, { recursive: true });
  const files: string[] = [];
  for (const [index, image] of images.entries()) {
    const [, type, data] = image.match(IMAGE_DATA_URL)!;
    const file = path.join(folder, `post-${index + 1}.${type === "jpeg" ? "jpg" : type}`);
    await fsp.writeFile(file, Buffer.from(data, "base64"));
    files.push(file);
  }
  return { folder, files };
}

export function registerAiRoutes(app: express.Express) {
  const router = express.Router();
  router.use(express.json({ limit: "24mb" }));

  // Safe without a token: it only says which apps are connected.
  router.get("/status", (_req, res) => {
    res.json({ ok: true, ...aiStatus() });
  });

  router.post("/connect", requireSeoToken, async (req, res) => {
    const parsed = providerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Choose ChatGPT, Claude or Gemini." });
      return;
    }
    try {
      await connectAi(parsed.data.provider);
      res.json({ ok: true, ...aiStatus() });
    } catch (error) {
      res.status(503).json({ message: error instanceof Error ? error.message : "The login window could not open." });
    }
  });

  router.post("/disconnect", requireSeoToken, async (req, res) => {
    const parsed = providerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Choose ChatGPT, Claude or Gemini." });
      return;
    }
    await disconnectAi(parsed.data.provider);
    res.json({ ok: true, ...aiStatus() });
  });

  router.post("/show", requireSeoToken, async (req, res) => {
    const parsed = providerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Choose ChatGPT, Claude or Gemini." });
      return;
    }
    await showAiWindow(parsed.data.provider);
    res.json({ ok: true });
  });

  // Listens to a video's audio on this computer. One JSON line per update:
  // { stage, percent }, then { segments } or { message }.
  router.post("/transcribe", requireSeoToken, async (req, res) => {
    const size = Number(req.headers["content-length"] || 0);
    if (!size || size > MAX_SPEECH_AUDIO_BYTES) {
      res.status(413).json({ message: "This video is too long to listen to." });
      return;
    }
    if (listening) {
      res.status(409).json({ message: "The Companion is already listening to another video." });
      return;
    }
    listening = true;
    const folder = path.join(os.tmpdir(), "agenticthat-social-seo", randomUUID());
    const stop = new AbortController();
    res.on("close", () => { if (!res.writableFinished) stop.abort(); });
    const send = (line: object) => { if (!res.writableEnded) res.write(`${JSON.stringify(line)}\n`); };
    try {
      await fsp.mkdir(folder, { recursive: true });
      const audio = path.join(folder, "audio.pcm");
      await pipeline(req, fs.createWriteStream(audio));
      res.status(200).setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      send(await transcribeAudioFile(audio, send, stop.signal).then((segments) => ({ segments })));
    } catch (error) {
      if (!res.headersSent) res.status(200).setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      send({ message: error instanceof Error ? error.message : "The video could not be listened to." });
    } finally {
      listening = false;
      res.end();
      await fsp.rm(folder, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  // Saves the whole video on this computer so each AI app can be offered the file.
  router.post("/video", requireSeoToken, async (req, res) => {
    const size = Number(req.headers["content-length"] || 0);
    const extension = stagedVideoExtension(req.headers["content-type"]);
    if (!size || size > MAX_STAGED_VIDEO_BYTES || !extension) {
      res.status(413).json({ message: "This video can't be offered to the AI apps as a file." });
      return;
    }
    const stop = new AbortController();
    res.on("close", () => { if (!res.writableFinished) stop.abort(); });
    try {
      const video = await stageVideo(req, extension, stop.signal);
      res.json({ ok: true, videoId: video.id });
    } catch {
      if (!res.headersSent) res.status(500).json({ message: "The video could not be saved for the AI apps." });
    }
  });

  // Every connected app writes the posts at the same time. One JSON line per
  // update: { provider, state, detail | live }, then { provider, ok, results },
  // and finally { done: true }. With a video file, an app that can't take it answers
  // { provider, ok: false, videoRefused: true } so it can use speech and pictures.
  router.post("/generate", requireSeoToken, async (req, res) => {
    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid request." });
      return;
    }
    const connected = aiStatus().providers.filter((entry) => entry.connected).map((entry) => entry.id as AiProviderId);
    const providers = parsed.data.providers?.length ? connected.filter((id) => parsed.data.providers!.includes(id)) : connected;
    if (!providers.length) {
      res.status(409).json({ message: "Connect ChatGPT, Claude or Gemini in the Companion first." });
      return;
    }
    const { images, platforms, videoId, ...details } = parsed.data;
    const video = videoId ? stagedVideo(videoId) : null;
    if (videoId && !video) {
      res.status(409).json({ message: "The video is no longer saved on this computer." });
      return;
    }
    const prompt = masterPrompt({ ...details, platforms, imageCount: images.length, videoAttached: Boolean(video) });
    const { folder, files } = await writeImages(images);

    res.status(200).setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    const send = (line: object) => {
      if (!res.writableEnded) res.write(`${JSON.stringify(line)}\n`);
    };
    send({ started: true, providers });
    try {
      await Promise.all(providers.map(async (provider) => {
        const started = Date.now();
        let lastLive = 0;
        try {
          const answer = await askAi(provider, prompt, files, (event) => {
            // A few live updates a second are plenty for reading along.
            if (event.state === "writing") {
              if (Date.now() - lastLive < 400) return;
              lastLive = Date.now();
            }
            send({ provider, ...event });
          }, video ?? undefined);
          const { results, complete } = parseAnswer(answer, platforms, { realTimes: Boolean(details.transcript || video), durationSeconds: details.durationSeconds });
          send({ provider, ok: true, results, complete, raw: answer, ms: Date.now() - started, watchedVideo: Boolean(video) });
        } catch (error) {
          const limit = (error as { limit?: boolean })?.limit === true;
          send({ provider, ok: false, limit, videoRefused: Boolean(video) && !limit, message: error instanceof Error ? error.message : "This AI could not finish." });
        }
      }));
    } finally {
      send({ done: true });
      res.end();
      await fsp.rm(folder, { recursive: true, force: true }).catch(() => undefined);
      if (videoId) await removeStagedVideo(videoId);
    }
  });

  app.use("/api/social-seo/ai", router);
}
