import { timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import { loginBrowserInputBatchSchema, loginSurfaceSchema } from "./contracts.ts";
import type { AutomationConfig } from "./config.ts";
import type { AutomationJobStore } from "./job-store.ts";
import type { AutomationLoginManager } from "./login-manager.ts";
import { developmentConnectPage } from "./development-ui.ts";
import { isLoopbackHost } from "./config.ts";
import { detectServerBrowserExecutable } from "./login-browser.ts";
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
  app.use((_req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    next();
  });
  app.use(express.json({ limit: "128kb" }));

  const browserRequired = config.loginEnabled
    || config.publishingPreviewEnabled
    || (config.executionEnabled && config.instagramPublishingEnabled);
  let browserReady = !browserRequired;
  let browserReadinessError = "";
  if (browserRequired) {
    try {
      browserReady = Boolean(detectServerBrowserExecutable(config.browserExecutablePath));
      if (!browserReady) browserReadinessError = "A supported Chromium browser is not installed.";
    } catch (error) {
      browserReadinessError = error instanceof Error ? error.message : "The browser configuration is invalid.";
    }
  }

  const readiness = () => {
    const issues: string[] = [];
    if (!databaseReady || !store) issues.push("database");
    if (!config.internalToken) issues.push("internal-token");
    if (!browserReady) issues.push("browser");
    return { ready: issues.length === 0, issues };
  };

  app.get("/", (_req, res) => {
    if (config.deploymentMode === "development") {
      res.redirect("/development/connect");
      return;
    }
    res.status(404).json({ error: "Not found." });
  });

  app.get("/development/connect", (_req, res) => {
    if (config.deploymentMode !== "development" || !isLoopbackHost(config.host)) {
      res.status(404).send("Not found");
      return;
    }
    res.type("html").send(developmentConnectPage({
      internalToken: config.internalToken,
      loginEnabled: config.loginEnabled,
      publishingDryRunEnabled: config.publishingDryRunEnabled,
      publishingPreviewEnabled: config.publishingPreviewEnabled,
      publishingLiveEnabled: config.executionEnabled && config.instagramPublishingEnabled,
    }));
  });

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "agenticthat-automation-server",
      architectureVersion: 1,
      deploymentMode: config.deploymentMode,
      databaseConfigured: true,
      databaseReady,
      databaseEngine: "sqlite",
      storage: config.deploymentMode === "development" ? "local-development-only" : "local-single-server-staging",
      browserReady,
      livePublishingWorkerCount: config.executionEnabled && config.instagramPublishingEnabled
        ? config.liveWorkerCount
        : 0,
      features: {
        publishing: config.executionEnabled && config.instagramPublishingEnabled,
        instagramPublishing: config.instagramPublishingEnabled,
        publishingDryRun: config.publishingDryRunEnabled,
        publishingPreview: config.publishingPreviewEnabled,
        login: config.loginEnabled,
        scraping: config.scrapingEnabled,
      },
    });
  });

  app.get("/ready", (_req, res) => {
    const state = readiness();
    res.status(state.ready ? 200 : 503).json({
      ok: state.ready,
      service: "agenticthat-automation-server",
      deploymentMode: config.deploymentMode,
      checks: {
        database: databaseReady && Boolean(store),
        internalToken: Boolean(config.internalToken),
        browser: browserReady,
      },
      issues: state.issues,
      ...(browserReadinessError ? { browserError: browserReadinessError } : {}),
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

  app.patch("/v1/accounts/:accountId", requireInternalToken, requireStore, async (req, res) => {
    const account = store!.updateAccount(String(req.params.accountId), req.body);
    res.json({ account });
  });

  app.delete("/v1/accounts/:accountId", requireInternalToken, requireStore, async (req, res) => {
    const workspaceId = String(req.query.workspaceId || "").trim();
    if (!workspaceId) {
      res.status(400).json({ error: "workspaceId is required." });
      return;
    }
    res.json(await store!.removeAccount(workspaceId, String(req.params.accountId)));
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
    const inputs = loginBrowserInputBatchSchema.parse(
      Array.isArray(req.body?.inputs) ? req.body.inputs : [req.body?.input],
    );
    for (const input of inputs) {
      await loginManager.dispatchInput(workspaceId, String(req.params.sessionId), input);
    }
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

  app.get("/v1/publishing/jobs", requireInternalToken, requireStore, async (req, res) => {
    if (!config.executionEnabled || !config.instagramPublishingEnabled) {
      res.status(409).json({ error: "Server publishing is disabled. Current Companion behavior remains active." });
      return;
    }
    const workspaceId = String(req.query.workspaceId || "").trim();
    const limit = Number(req.query.limit || 30);
    if (!workspaceId) {
      res.status(400).json({ error: "workspaceId is required." });
      return;
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      res.status(400).json({ error: "limit must be an integer between 1 and 100." });
      return;
    }
    res.json({ jobs: store!.listPublishingJobs(workspaceId, limit) });
  });

  app.post("/v1/publishing/jobs", requireInternalToken, requireStore, async (req, res) => {
    if (!config.executionEnabled || !config.instagramPublishingEnabled) {
      res.status(409).json({ error: "Server publishing is disabled. Current Companion behavior remains active." });
      return;
    }
    if (req.body?.liveConfirmation !== "PUBLISH") {
      res.status(400).json({ error: "Type PUBLISH to authorize Instagram's final Share action." });
      return;
    }
    const job = await store!.createPublishingJob(req.body, "LIVE", "LOCAL", true);
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

  app.post("/v1/publishing/previews", requireInternalToken, requireStore, async (req, res) => {
    if (!config.publishingPreviewEnabled) {
      res.status(409).json({ error: "Instagram publishing previews are disabled." });
      return;
    }
    const job = await store!.createPublishingJob(req.body, "DRY_RUN", "INSTAGRAM_PREVIEW");
    res.status(201).json({ job });
  });

  app.post(
    "/v1/media",
    requireInternalToken,
    requireStore,
    express.raw({ type: () => true, limit: "25mb" }),
    async (req, res) => {
      const livePublishingEnabled = config.executionEnabled && config.instagramPublishingEnabled;
      if ((!config.publishingDryRunEnabled && !config.publishingPreviewEnabled && !livePublishingEnabled) || !files) {
        res.status(409).json({ error: "Publishing media storage is disabled." });
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

  app.delete("/v1/publishing/jobs/:jobId", requireInternalToken, requireStore, async (req, res) => {
    if (!config.executionEnabled || !config.instagramPublishingEnabled) {
      res.status(409).json({ error: "Server publishing is disabled. Current Companion behavior remains active." });
      return;
    }
    const workspaceId = String(req.query.workspaceId || "").trim();
    if (!workspaceId) {
      res.status(400).json({ error: "workspaceId is required." });
      return;
    }
    const result = store!.cancelScheduledPublishingJob(workspaceId, String(req.params.jobId));
    if (result.status === "NOT_FOUND") {
      res.status(404).json({ error: "Scheduled publishing job not found." });
      return;
    }
    if (result.status === "CONFLICT") {
      res.status(409).json({
        error: "Only a post that is still SCHEDULED can be cancelled.",
        job: result.job,
      });
      return;
    }
    res.json({ job: result.job });
  });

  app.get("/v1/publishing/previews/:jobId/frame", requireInternalToken, requireStore, async (req, res) => {
    if (!config.publishingPreviewEnabled || !files) {
      res.status(409).json({ error: "Instagram publishing previews are disabled." });
      return;
    }
    const workspaceId = String(req.query.workspaceId || "").trim();
    if (!workspaceId) {
      res.status(400).json({ error: "workspaceId is required." });
      return;
    }
    const job = await store!.getPublishingJob(workspaceId, String(req.params.jobId));
    if (!job || job.validationStage !== "INSTAGRAM_PREVIEW" || !job.errorCode?.startsWith("PREVIEW_")) {
      res.status(404).json({ error: "Publishing preview not found." });
      return;
    }
    try {
      const screenshot = await files.readPublishingPreview(job.id);
      res.set("cache-control", "no-store");
      res.type("jpeg").send(screenshot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        res.status(404).json({ error: "Publishing preview screenshot not found." });
        return;
      }
      throw error;
    }
  });

  app.get("/v1/publishing/jobs/:jobId/diagnostic-frame", requireInternalToken, requireStore, async (req, res) => {
    if (!config.executionEnabled || !config.instagramPublishingEnabled || !files) {
      res.status(409).json({ error: "Server publishing is disabled." });
      return;
    }
    const workspaceId = String(req.query.workspaceId || "").trim();
    if (!workspaceId) {
      res.status(400).json({ error: "workspaceId is required." });
      return;
    }
    const job = await store!.getPublishingJob(workspaceId, String(req.params.jobId));
    if (!job || job.executionMode !== "LIVE" || !["FAILED", "UNCERTAIN"].includes(job.state)) {
      res.status(404).json({ error: "Publishing diagnostic not found." });
      return;
    }
    try {
      const screenshot = await files.readPublishingPreview(job.id);
      res.set("cache-control", "no-store");
      res.type("jpeg").send(screenshot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        res.status(404).json({ error: "Publishing diagnostic screenshot not found." });
        return;
      }
      throw error;
    }
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
