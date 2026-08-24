import { timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import type { AutomationConfig } from "./config.ts";
import type { AutomationJobStore } from "./job-store.ts";

type AppDependencies = {
  config: AutomationConfig;
  databaseReady: boolean;
  store: AutomationJobStore | null;
};

function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function createAutomationApp({ config, databaseReady, store }: AppDependencies) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "128kb" }));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "agenticthat-automation-server",
      architectureVersion: 1,
      databaseConfigured: Boolean(config.databaseUrl),
      databaseReady,
      storage: "local-development-only",
      features: {
        publishing: config.executionEnabled,
        login: config.loginEnabled,
        scraping: config.scrapingEnabled,
      },
    });
  });

  const requireInternalToken = (req: Request, res: Response, next: NextFunction) => {
    if (!config.internalToken) {
      res.status(503).json({ error: "The local automation internal token is not configured." });
      return;
    }
    const supplied = String(req.headers["x-agenticthat-internal-token"] || "");
    if (!safeEqual(supplied, config.internalToken)) {
      res.status(401).json({ error: "The automation request is not authorized." });
      return;
    }
    next();
  };

  const requireStore = (_req: Request, res: Response, next: NextFunction) => {
    if (!store || !databaseReady) {
      res.status(503).json({ error: "The isolated automation database has not been migrated." });
      return;
    }
    next();
  };

  app.get("/v1/accounts", requireInternalToken, requireStore, async (req, res) => {
    const workspaceId = String(req.query.workspaceId || "").trim();
    if (!workspaceId) {
      res.status(400).json({ error: "workspaceId is required." });
      return;
    }
    res.json({ accounts: await store!.listAccounts(workspaceId) });
  });

  app.post("/v1/accounts", requireInternalToken, requireStore, async (req, res) => {
    if (!config.loginEnabled) {
      res.status(409).json({ error: "Server login is disabled. Current Companion behavior remains active." });
      return;
    }
    const account = await store!.createAccount(req.body);
    res.status(201).json({ account });
  });

  app.post("/v1/publishing/jobs", requireInternalToken, requireStore, async (req, res) => {
    if (!config.executionEnabled) {
      res.status(409).json({ error: "Server publishing is disabled. Current Companion behavior remains active." });
      return;
    }
    const job = await store!.createPublishingJob(req.body);
    res.status(201).json({ job });
  });

  app.get("/v1/publishing/jobs/:jobId", requireInternalToken, requireStore, async (req, res) => {
    const workspaceId = String(req.query.workspaceId || "").trim();
    if (!workspaceId) {
      res.status(400).json({ error: "workspaceId is required." });
      return;
    }
    const job = await store!.getPublishingJob(workspaceId, String(req.params.jobId));
    if (!job) {
      res.status(404).json({ error: "Publishing job not found." });
      return;
    }
    res.json({ job });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      res.status(400).json({ error: error.issues[0]?.message || "The automation request is invalid." });
      return;
    }
    const message = error instanceof Error ? error.message : "The automation request failed.";
    res.status(500).json({ error: message });
  });

  return app;
}
