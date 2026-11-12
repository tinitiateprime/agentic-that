// Companion endpoints for free local AI Post SEO. The website calls these on
// 127.0.0.1 with a short-lived signed "social-seo" token from AgenticThat.

import { randomUUID } from "node:crypto";
import express from "express";
import { z } from "zod";
import { verifyServiceAccessToken } from "../../../../../../lib/service-access-token.js";
import { localAi } from "./ai-engine.js";
import { SEO_PLATFORMS, analyzeMedia, generatePostSeo, writeForPlatform, type Analysis } from "./post-seo.js";

const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

const generateSchema = z.object({
  platforms: z.array(z.enum(SEO_PLATFORMS)).min(1).max(SEO_PLATFORMS.length),
  images: z.array(z.string().max(3_000_000).regex(IMAGE_DATA_URL, "Images must be JPEG, PNG or WebP data URLs.")).min(1).max(6),
  mediaKind: z.enum(["image", "carousel", "video"]),
  durationSeconds: z.number().min(0).max(36_000).optional(),
  orientation: z.enum(["vertical", "square", "landscape"]).optional(),
  description: z.string().max(2200).optional(),
  brandName: z.string().max(80).optional(),
  location: z.string().max(160).optional(),
  businessDetails: z.string().max(400).optional(),
});

// Analyses are kept for 30 minutes so each app can be written on its own.
const ANALYSIS_TTL_MS = 30 * 60 * 1000;
const analyses = new Map<string, { analysis: Analysis; context: Omit<z.infer<typeof generateSchema>, "platforms" | "images">; expires: number }>();

function rememberAnalysis(analysis: Analysis, context: Omit<z.infer<typeof generateSchema>, "platforms" | "images">) {
  const now = Date.now();
  for (const [key, entry] of analyses) if (entry.expires < now) analyses.delete(key);
  while (analyses.size >= 50) analyses.delete(analyses.keys().next().value!);
  const id = randomUUID();
  analyses.set(id, { analysis, context, expires: now + ANALYSIS_TTL_MS });
  return id;
}

function requireSeoToken(req: express.Request, res: express.Response, next: express.NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const identity = token ? verifyServiceAccessToken(token, "social-seo") : null;
  if (!identity) {
    res.status(401).json({ message: "Sign in to AgenticThat to use the free local AI." });
    return;
  }
  next();
}

export function registerAiRoutes(app: express.Express) {
  const router = express.Router();
  router.use(express.json({ limit: "12mb" }));

  // Status is safe to read without a token: it only says whether AI is set up.
  router.get("/status", async (_req, res, next) => {
    try {
      res.json({ ok: true, ...(await localAi.status()) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/install", requireSeoToken, async (req, res) => {
    const tier = z.object({ tier: z.enum(["lite", "standard", "quality"]).optional() }).safeParse(req.body || {});
    if (!tier.success) {
      res.status(400).json({ message: "Unknown AI model." });
      return;
    }
    // Downloads run in the background; the website polls /status for progress.
    localAi.install(tier.data.tier).catch(() => undefined);
    res.status(202).json({ ok: true, ...(await localAi.status()) });
  });

  // Load the model in the background so the first post does not wait for it.
  router.post("/warm", requireSeoToken, async (_req, res) => {
    const status = await localAi.status();
    if (status.phase === "installed" || status.phase === "ready") void localAi.warm();
    res.status(202).json({ ok: true, phase: status.phase });
  });

  router.post("/generate", requireSeoToken, async (req, res) => {
    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid request." });
      return;
    }
    try {
      const result = await generatePostSeo(parsed.data);
      res.json({ ok: true, engine: (await localAi.status()).tier, ...result });
    } catch (error) {
      res.status(503).json({ message: error instanceof Error ? error.message : "The local AI could not finish." });
    }
  });

  // Progressive flow: analyse once, then write each app as the user needs it.
  router.post("/analyze", requireSeoToken, async (req, res) => {
    const parsed = generateSchema.omit({ platforms: true }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid request." });
      return;
    }
    try {
      const started = Date.now();
      const { images, ...context } = parsed.data;
      const analysis = await analyzeMedia(parsed.data);
      res.json({ ok: true, analysisId: rememberAnalysis(analysis, context), analysis, engine: (await localAi.status()).tier, ms: Date.now() - started, images: images.length });
    } catch (error) {
      res.status(503).json({ message: error instanceof Error ? error.message : "The local AI could not finish." });
    }
  });

  router.post("/write", requireSeoToken, async (req, res) => {
    // The media can be studied as soon as it is uploaded, so the description,
    // brand and location typed afterwards are sent with each write.
    const parsed = z.object({
      analysisId: z.string().uuid(),
      platform: z.enum(SEO_PLATFORMS),
      description: z.string().max(2200).optional(),
      brandName: z.string().max(80).optional(),
      location: z.string().max(160).optional(),
      businessDetails: z.string().max(400).optional(),
      live: z.boolean().optional(),
    }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Choose an app and analyse the media first." });
      return;
    }
    const entry = analyses.get(parsed.data.analysisId);
    if (!entry || entry.expires < Date.now()) {
      res.status(404).json({ message: "This analysis expired. Create the posts again." });
      return;
    }
    const started = Date.now();
    const { analysisId: _id, platform, live, ...latest } = parsed.data;
    const context = { ...entry.context, ...Object.fromEntries(Object.entries(latest).filter(([, value]) => value !== undefined)) };
    if (!live) {
      try {
        const result = await writeForPlatform(platform, context, entry.analysis);
        res.json({ ok: true, platform, result, ms: Date.now() - started });
      } catch (error) {
        res.status(503).json({ message: error instanceof Error ? error.message : "The local AI could not finish." });
      }
      return;
    }
    // Live: one JSON line per update ({"live": "caption so far"}), then the finished post.
    res.status(200).setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    let sent = "";
    let lastSent = 0;
    const send = (line: object) => res.write(`${JSON.stringify(line)}\n`);
    try {
      const result = await writeForPlatform(platform, context, entry.analysis, (text) => {
        // A few updates a second are plenty for reading along.
        if (text === sent || Date.now() - lastSent < 250) return;
        sent = text;
        lastSent = Date.now();
        send({ live: text });
      });
      send({ ok: true, platform, result, ms: Date.now() - started });
    } catch (error) {
      send({ ok: false, message: error instanceof Error ? error.message : "The local AI could not finish." });
    }
    res.end();
  });

  app.use("/api/social-seo/ai", router);
}
