import { timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import { loginBrowserInputSchema, loginSurfaceSchema } from "./contracts.ts";
import type { AutomationConfig } from "./config.ts";
import type { AutomationJobStore } from "./job-store.ts";
import type { AutomationLoginManager } from "./login-manager.ts";
import { developmentConnectPage } from "./development-ui.ts";
import { isLoopbackHost } from "./config.ts";
import type { AutomationFileStore } from "./profile-store.ts";

type AppDependencies = {
  config: AutomationConfig;
  databaseReady: boolean;
  store: AutomationJobStore | null;
  loginManager: AutomationLoginManager | null;
  files?: AutomationFileStore;
};

function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function createAutomationApp({ config, databaseReady, store, loginManager, files }: AppDependencies) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "128kb" }));

  app.get("/", (_req, res) => {
    res.redirect("/development/connect");
  });

  app.get("/development/connect", (_req, res) => {
    if (!isLoopbackHost(config.host)) {
      res.status(404).send("Not found");
      return;
    }
    res.type("html").send(developmentConnectPage({
      internalToken: config.internalToken,
      loginEnabled: config.loginEnabled,
      publishingDryRunEnabled: config.publishingDryRunEnabled,
    }));
  });

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "agenticthat-automation-server",
      architectureVersion: 1,
      databaseConfigured: true,
      databaseReady,
      databaseEngine: "sqlite",
      storage: "local-development-only",
      features: {
        publishing: config.executionEnabled,
        publishingDryRun: config.publishingDryRunEnabled,
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

  app.post("/v1/accounts/:accountId/login-sessions", requireInternalToken, requireStore, async (req, res) => {
    if (!config.loginEnabled || !loginManager) {
      res.status(409).json({ error: "Server login is disabled. Current Companion behavior remains active." });
      return;
    }
    const workspaceId = String(req.body?.workspaceId || "").trim();
    if (!workspaceId) {
      res.status(400).json({ error: "workspaceId is required." });
      return;
    }
    const surface = loginSurfaceSchema.parse(req.body?.surface || "website");
    const session = loginManager.start(workspaceId, String(req.params.accountId), surface);
    res.status(202).json({ session });
  });

  app.get("/v1/login-sessions/:sessionId/frame", requireInternalToken, requireStore, async (req, res) => {
    if (!loginManager) {
      res.status(503).json({ error: "The server login manager is unavailable." });
      return;
    }
    const workspaceId = String(req.query.workspaceId || "").trim();
    if (!workspaceId) {
      res.status(400).json({ error: "workspaceId is required." });
      return;
    }
    const frame = await loginManager.captureFrame(workspaceId, String(req.params.sessionId));
    res.set({
      "Content-Type": "image/jpeg",
      "Cache-Control": "no-store, private",
      "Content-Length": String(frame.length),
    });
    res.send(frame);
  });

  app.post("/v1/login-sessions/:sessionId/input", requireInternalToken, requireStore, async (req, res) => {
    if (!loginManager) {
      res.status(503).json({ error: "The server login manager is unavailable." });
      return;
    }
    const workspaceId = String(req.body?.workspaceId || "").trim();
    if (!workspaceId) {
      res.status(400).json({ error: "workspaceId is required." });
      return;
    }
    const input = loginBrowserInputSchema.parse(req.body?.input);
    await loginManager.dispatchInput(workspaceId, String(req.params.sessionId), input);
    res.status(204).end();
  });

  app.get("/v1/login-sessions/:sessionId", requireInternalToken, requireStore, async (req, res) => {
    if (!loginManager) {
      res.status(503).json({ error: "The server login manager is unavailable." });
      return;
    }
    const workspaceId = String(req.query.workspaceId || "").trim();
    if (!workspaceId) {
      res.status(400).json({ error: "workspaceId is required." });
      return;
    }
    const session = loginManager.get(workspaceId, String(req.params.sessionId));
    if (!session) {
      res.status(404).json({ error: "Login session not found." });
      return;
    }
    res.json({ session });
  });

  app.delete("/v1/login-sessions/:sessionId", requireInternalToken, requireStore, async (req, res) => {
    if (!loginManager) {
      res.status(503).json({ error: "The server login manager is unavailable." });
      return;
    }
    const workspaceId = String(req.query.workspaceId || "").trim();
    if (!workspaceId) {
      res.status(400).json({ error: "workspaceId is required." });
      return;
    }
    const session = await loginManager.cancel(workspaceId, String(req.params.sessionId));
    if (!session) {
      res.status(404).json({ error: "Login session not found." });
      return;
    }
    res.json({ session });
  });

  app.post("/v1/publishing/jobs", requireInternalToken, requireStore, async (req, res) => {
    if (!config.executionEnabled) {
      res.status(409).json({ error: "Server publishing is disabled. Current Companion behavior remains active." });
      return;
    }
    const job = await store!.createPublishingJob(req.body);
    res.status(201).json({ job });
  });

  app.post("/v1/publishing/dry-runs", requireInternalToken, requireStore, async (req, res) => {
    if (!config.publishingDryRunEnabled) {
      res.status(409).json({ error: "Publishing dry-run validation is disabled." });
      return;
    }
    const job = await store!.createPublishingJob(req.body, "DRY_RUN");
    res.status(201).json({ job });
  });

  app.post(
    "/v1/media",
    requireInternalToken,
    requireStore,
    express.raw({ type: () => true, limit: "25mb" }),
    async (req, res) => {
      if (!config.publishingDryRunEnabled || !files) {
        res.status(409).json({ error: "Publishing dry-run media storage is disabled." });
        return;
      }
      if (!Buffer.isBuffer(req.body)) {
        res.status(400).json({ error: "A binary media body is required." });
        return;
      }
      const workspaceId = String(req.headers["x-agenticthat-workspace-id"] || "").trim();
      const encodedFileName = String(req.headers["x-agenticthat-file-name"] || "").trim();
      let fileName = "";
      try {
        fileName = decodeURIComponent(encodedFileName);
      } catch {
        res.status(400).json({ error: "The media filename header is invalid." });
        return;
      }
      const mimeType = String(req.headers["content-type"] || "").split(";", 1)[0]!.trim();
      if (!workspaceId || !fileName) {
        res.status(400).json({ error: "Workspace and filename headers are required." });
        return;
      }
      const media = await files.storeDevelopmentMedia(req.body, fileName, mimeType);
      res.status(201).json({ media });
    },
  );

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
