import "./env.js";
import cors from "cors";
import express from "express";
import multer from "multer";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError, z } from "zod";
import {
  createUserProfileSchema,
  createGoogleDriveStorageConnectionSchema,
  loginInputSchema,
  platformLabels,
  platformPostRules,
  platformSchema,
  scheduleIdSchema,
  updateUploadDetailsSchema,
  updateUploadStatusSchema,
  updateUserProfileSchema,
  upsertPlatformAccountSchema,
  upsertPublishingScheduleSchema,
  unifiedPostDestinationsSchema,
  type Platform,
  type PublishingSchedule,
  type PlatformUpload,
  type UserProfile,
  type UserRole
} from "../shared/schema.js";
import {
  automationInput,
  createGoogleDriveStorageConnection,
  createPlatformAccount,
  createPublishingSchedule,
  createUpload,
  createUserProfile,
  deactivateUserProfile,
  dashboardSummary,
  deletePlatformAccount,
  deletePublishingSchedule,
  deleteUpload,
  getStorageConnection,
  getUserProfile,
  listPlatformAccounts,
  listPublishingSchedules,
  listSocialMediaSchedules,
  listActivityLogs,
  listStorageConnections,
  listUploads,
  listUserProfiles,
  localStorageHealth,
  logActivity,
  loginUser,
  deleteStorageConnection,
  updatePublishingSchedule,
  updatePlatformAccount,
  updateStorageConnectionSyncState,
  updateUploadDetails,
  updateUploadStatus,
  updateUserProfile,
} from "./local-storage.js";
import {
  isAutomationRunning,
  reconcileSavedAccountSessions,
  runAutomation,
  startManualAccountSession,
} from "./services/publisher.js";
import { startScheduler, stopScheduler } from "./services/scheduler.js";
import { disconnectPlatformFolder } from "./services/folder-sync.js";

const app = express();
const port = Number(process.env.PUBLISH_QUEUE_SERVICE_PORT ?? process.env.PORT ?? 8792);
const host = process.env.PUBLISH_QUEUE_SERVICE_HOST?.trim() || "127.0.0.1";
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uploadDir = resolveFromRoot(process.env.PUBLISH_QUEUE_UPLOAD_DIR ?? process.env.UPLOAD_DIR ?? "./uploads");
const allowedUploadExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"]);
const allowedUploadMimePrefixes = ["image/", "video/"];
const maxUploadFileSize = Number(process.env.UPLOAD_MAX_FILE_BYTES ?? 500 * 1024 * 1024);

fs.mkdirSync(uploadDir, { recursive: true });

function resolveFromRoot(candidate: string) {
  return path.isAbsolute(candidate) ? candidate : path.resolve(rootDir, candidate);
}

function normalizeScheduledAt(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error("Scheduled date and time must be a string.");

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("Scheduled date and time is invalid.");
  if (timestamp <= Date.now()) throw new Error("Scheduled date and time must be in the future.");

  return new Date(timestamp).toISOString();
}

function localTemplateDateTime(dateValue: string | undefined, time: string) {
  if (!dateValue) return null;
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (!year || !month || !day || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function assertScheduleCanReceivePosts(schedule: PublishingSchedule) {
  if (schedule.status !== "active") throw new Error(`${schedule.name} is inactive. Choose an active schedule.`);
  if (schedule.frequency !== "onetime") return;
  const runAt = localTemplateDateTime(schedule.endDate, schedule.time);
  if (!runAt || runAt.getTime() <= Date.now()) {
    throw new Error(`${schedule.name} is a past one-time schedule. Create a future schedule or choose Queue now.`);
  }
}

function defaultPostText(fileName: string) {
  const extension = path.extname(fileName);
  return path.basename(fileName, extension).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() || "New post";
}

function safeUploadFileName(originalName: string) {
  const extension = path.extname(originalName).toLowerCase();
  const safeBase = path.basename(originalName, extension)
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "local-post";
  return `${Date.now()}-${randomUUID().slice(0, 8)}-${safeBase}${extension}`;
}

function isAllowedUpload(file: Express.Multer.File) {
  const extension = path.extname(file.originalname).toLowerCase();
  return allowedUploadExtensions.has(extension) && allowedUploadMimePrefixes.some(prefix => file.mimetype.startsWith(prefix));
}

async function removeStoredUploadFile(fileName: string) {
  const resolvedUploadDir = path.resolve(uploadDir);
  const storedFilePath = path.resolve(resolvedUploadDir, fileName);
  if (!storedFilePath.startsWith(`${resolvedUploadDir}${path.sep}`)) return;
  await fs.promises.unlink(storedFilePath).catch(() => undefined);
}

const localPostUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, uploadDir),
    filename: (_req, file, callback) => callback(null, safeUploadFileName(file.originalname))
  }),
  limits: {
    files: 25,
    fileSize: Number.isFinite(maxUploadFileSize) ? Math.max(1024 * 1024, maxUploadFileSize) : 500 * 1024 * 1024
  },
  fileFilter: (_req, file, callback) => {
    if (!isAllowedUpload(file)) {
      callback(new Error("Upload images or videos only."));
      return;
    }
    callback(null, true);
  }
});

const localPostUploadMiddleware: express.RequestHandler = (req, res, next) => {
  localPostUpload.array("files", 25)(req, res, async (error) => {
    if (error) {
      const files = Array.isArray(req.files) ? req.files as Express.Multer.File[] : [];
      await Promise.all(files.map(file => removeStoredUploadFile(file.filename)));
      next(error);
      return;
    }
    next();
  });
};

const unifiedPostUploadMiddleware: express.RequestHandler = (req, res, next) => {
  localPostUpload.single("file")(req, res, async (error) => {
    if (error) {
      if (req.file) await removeStoredUploadFile(req.file.filename);
      next(error);
      return;
    }
    next();
  });
};

function mediaKind(file: Express.Multer.File) {
  if (file.mimetype.startsWith("image/")) return "image" as const;
  if (file.mimetype.startsWith("video/")) return "video" as const;
  throw new Error("Upload an image or video.");
}

function assertPlatformPostCompatible(platform: Platform, file: Express.Multer.File, title: string, description: string) {
  const rules = platformPostRules[platform];
  const kind = mediaKind(file);
  if (!rules.media.includes(kind)) {
    throw new Error(`${platformLabels[platform]} does not support ${kind} posts in this publishing flow.`);
  }
  const titleRequired = rules.titleRequired || rules.titleRequiredFor?.includes(kind);
  if (titleRequired && !title) throw new Error(`${platformLabels[platform]} requires a title.`);
  if (rules.titleLimit && title.length > rules.titleLimit) {
    throw new Error(`${platformLabels[platform]} titles must be ${rules.titleLimit} characters or fewer.`);
  }
  if (description.length > rules.descriptionLimit) {
    throw new Error(`${platformLabels[platform]} descriptions must be ${rules.descriptionLimit.toLocaleString()} characters or fewer.`);
  }
}

type RequestWithUser = express.Request & { user?: UserProfile };

const tokenPayloadSchema = z.object({
  sub: z.string(),
  exp: z.number().int().positive()
});

const scheduleOnlyUpdateSchema = z.object({
  scheduledAt: z.string().nullable().optional(),
  scheduleId: scheduleIdSchema.nullable().optional()
});

const automationRunRequestSchema = z.object({
  uploadIds: z.array(z.string().trim().min(1)).max(100).optional()
});

function authSecret() {
  return process.env.PUBLISH_QUEUE_AUTH_TOKEN_SECRET?.trim()
    || process.env.AUTH_TOKEN_SECRET?.trim()
    || process.env.LOCAL_ACCOUNT_SECRET_KEY?.trim()
    || "local-development-auth-token-secret";
}

function encodeBase64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function signPart(value: string) {
  return createHmac("sha256", authSecret()).update(value).digest("base64url");
}

function signAuthToken(user: UserProfile) {
  const lifetimeSeconds = Number(process.env.AUTH_TOKEN_TTL_SECONDS ?? 60 * 60 * 12);
  const payload = encodeBase64Url(JSON.stringify({
    sub: user.id,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + lifetimeSeconds
  }));
  return `${payload}.${signPart(payload)}`;
}

async function userFromAuthToken(token: string) {
  const [payloadPart, signaturePart] = token.split(".");
  if (!payloadPart || !signaturePart) return null;

  const expectedSignature = Buffer.from(signPart(payloadPart), "base64url");
  const providedSignature = Buffer.from(signaturePart, "base64url");
  if (expectedSignature.length !== providedSignature.length || !timingSafeEqual(expectedSignature, providedSignature)) {
    return null;
  }

  const payload = tokenPayloadSchema.parse(JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")));
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null;

  const user = await getUserProfile(payload.sub);
  return user?.isActive ? user : null;
}

async function authenticateApi(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const request = req as RequestWithUser;
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    if (!token) {
      res.status(401).json({ message: "Sign in to continue." });
      return;
    }

    const user = await userFromAuthToken(token);
    if (!user) {
      res.status(401).json({ message: "Session expired. Sign in again." });
      return;
    }

    request.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

function requireRoles(...roles: UserRole[]): express.RequestHandler {
  return (req, res, next) => {
    const user = (req as RequestWithUser).user;
    if (!user) {
      res.status(401).json({ message: "Sign in to continue." });
      return;
    }
    if (!roles.includes(user.role)) {
      res.status(403).json({ message: "Your role cannot perform this action." });
      return;
    }
    next();
  };
}

function currentUser(req: RequestWithUser) {
  if (!req.user) throw new Error("Sign in to continue.");
  return req.user;
}

function pathParam(value: string | string[] | undefined, name: string) {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) return value[0];
  throw new Error(`${name} path parameter is required.`);
}

function canEditContent(role: UserRole) {
  return role === "operations_manager" || role === "post_uploader";
}

function canEditSchedule(role: UserRole) {
  return role === "operations_manager" || role === "scheduler";
}

async function findUploadOrThrow(uploadId: string): Promise<PlatformUpload> {
  const uploads = await listUploads();
  const upload = uploads.find(item => item.id === uploadId);
  if (!upload) throw new Error("Upload not found");
  return upload;
}

app.use(
  cors({
    origin: (process.env.PUBLISH_QUEUE_WEB_ORIGIN ?? process.env.WEB_ORIGIN)?.split(",") ?? true
  })
);
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(uploadDir));

// --- HEALTH ---
app.get("/api/health", async (_req, res) => {
  try {
    await localStorageHealth();
    res.json({
      ok: true,
      service: "agenticthat-publish-queue-runner",
      storage: "local-json",
      automationReady: true,
      automationRunning: isAutomationRunning()
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      service: "agenticthat-publish-queue-runner",
      storage: "unavailable",
      message: error instanceof Error ? error.message : "Local storage unavailable"
    });
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const payload = loginInputSchema.parse(req.body);
    const user = await loginUser(payload.username, payload.password);
    if (!user) {
      res.status(401).json({ message: "Invalid username or password." });
      return;
    }

    res.json({ user, token: signAuthToken(user) });
  } catch (error) {
    next(error);
  }
});

app.use("/api", authenticateApi);

app.get("/api/auth/me", (req: RequestWithUser, res) => {
  res.json(currentUser(req));
});

app.get("/api/users", requireRoles("operations_manager"), async (_req, res, next) => {
  try {
    res.json(await listUserProfiles());
  } catch (error) {
    next(error);
  }
});

app.post("/api/users", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const payload = createUserProfileSchema.parse(req.body);
    res.status(201).json(await createUserProfile(payload, currentUser(req).id));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/users/:id", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const payload = updateUserProfileSchema.parse(req.body);
    const user = await updateUserProfile(pathParam(req.params.id, "id"), payload, currentUser(req).id);
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    res.json(user);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/users/:id", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const user = await deactivateUserProfile(pathParam(req.params.id, "id"), currentUser(req).id);
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.get("/api/activity-logs", requireRoles("operations_manager"), async (req, res, next) => {
  try {
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 100;
    res.json(await listActivityLogs(limit));
  } catch (error) {
    next(error);
  }
});

// --- DASHBOARD ---
app.get("/api/dashboard", async (_req, res, next) => {
  try {
    res.json(await dashboardSummary());
  } catch (error) {
    next(error);
  }
});

// --- LIST UPLOADS ---
app.get("/api/uploads", async (req, res, next) => {
  try {
    const platform = req.query.platform ? platformSchema.parse(req.query.platform) : undefined;
    const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;
    res.json(await listUploads(platform, accountId));
  } catch (error) {
    next(error);
  }
});

app.get("/api/platforms/:platform/uploads", async (req, res, next) => {
  try {
    const platform = platformSchema.parse(req.params.platform);
    const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;
    res.json(await listUploads(platform, accountId));
  } catch (error) {
    next(error);
  }
});

// --- PUBLISHING ACCOUNTS ---
app.get("/api/accounts", async (req, res, next) => {
  try {
    const platform = req.query.platform ? platformSchema.parse(req.query.platform) : undefined;
    res.json(await listPlatformAccounts(platform));
  } catch (error) {
    next(error);
  }
});

app.post("/api/platforms/:platform/accounts", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const platform = platformSchema.parse(req.params.platform);
    const payload = upsertPlatformAccountSchema.parse(req.body);
    const account = await createPlatformAccount(platform, payload);
    await logActivity(currentUser(req).id, "account.created", "publishing_account", account.id, `${account.displayName} account was added for ${platform}.`, { platform, handle: account.handle });
    res.status(201).json(account);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/accounts/:id", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const payload = upsertPlatformAccountSchema.parse(req.body);
    const account = await updatePlatformAccount(pathParam(req.params.id, "id"), payload);
    if (!account) {
      res.status(404).json({ message: "Publishing account not found" });
      return;
    }
    await logActivity(currentUser(req).id, "account.updated", "publishing_account", account.id, `${account.displayName} account was updated.`, { platform: account.platform, handle: account.handle });
    res.json(account);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/accounts/:id", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const account = await deletePlatformAccount(pathParam(req.params.id, "id"));
    if (!account) {
      res.status(404).json({ message: "Publishing account not found" });
      return;
    }
    await logActivity(currentUser(req).id, "account.deleted", "publishing_account", account.id, `${account.displayName} account was deleted.`, { platform: account.platform, handle: account.handle });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.post("/api/accounts/:id/manual-login", requireRoles("operations_manager", "post_uploader"), async (req: RequestWithUser, res, next) => {
  try {
    const user = currentUser(req);
    const { account, started } = await startManualAccountSession(pathParam(req.params.id, "id"));
    await logActivity(
      user.id,
      started ? "account.manual_login_started" : "account.manual_login_already_running",
      "publishing_account",
      account.id,
      started
        ? `${account.displayName} manual login session was opened.`
        : `${account.displayName} manual login session is already open.`,
      { platform: account.platform, handle: account.handle },
    );
    res.status(202).json({
      message: started
        ? "Manual login window opened. Complete login in Chrome; the session will be saved and the window will close."
        : "Manual login is already running for this account.",
      started,
    });
  } catch (error) {
    next(error);
  }
});

// --- STORAGE ACCESS ---
app.get("/api/storage-connections", requireRoles("operations_manager", "post_uploader"), async (_req, res, next) => {
  try {
    res.json(await listStorageConnections());
  } catch (error) {
    next(error);
  }
});

app.post("/api/storage-connections/local-drive", requireRoles("operations_manager", "post_uploader"), (_req, res) => {
  res.status(410).json({ message: "Local Drive folder syncing was replaced by uploading posts from your device." });
});

app.post("/api/storage-connections/google-drive", requireRoles("operations_manager", "post_uploader"), async (req: RequestWithUser, res, next) => {
  try {
    const user = currentUser(req);
    const payload = createGoogleDriveStorageConnectionSchema.parse(req.body);
    const storageConnection = await createGoogleDriveStorageConnection(payload, user.id);
    await logActivity(user.id, "storage.google_drive_connected", "storage_connection", storageConnection.id, `${storageConnection.displayName} Google Drive connection was added.`, {
      accountId: storageConnection.accountId,
      platform: storageConnection.platform,
      folderId: storageConnection.googleDriveFolderId
    });
    res.status(201).json(storageConnection);
  } catch (error) {
    next(error);
  }
});

app.post("/api/storage-connections/:id/sync", requireRoles("operations_manager", "post_uploader"), async (req: RequestWithUser, res, next) => {
  try {
    const user = currentUser(req);
    const storageConnection = await getStorageConnection(pathParam(req.params.id, "id"));
    if (!storageConnection) {
      res.status(404).json({ message: "Storage connection not found" });
      return;
    }
    if (storageConnection.storageType === "google_drive") {
      await updateStorageConnectionSyncState(storageConnection.id, "pending_auth", "Google Drive sync needs OAuth/API credentials before imports can run.");
      res.status(400).json({ message: "Google Drive sync needs OAuth/API credentials before imports can run." });
      return;
    }
    res.status(410).json({ message: "Local Drive folder syncing was replaced by uploading posts from your device." });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/storage-connections/:id", requireRoles("operations_manager", "post_uploader"), async (req: RequestWithUser, res, next) => {
  try {
    const user = currentUser(req);
    const storageConnection = await getStorageConnection(pathParam(req.params.id, "id"));
    if (!storageConnection) {
      res.status(404).json({ message: "Storage connection not found" });
      return;
    }
    if (storageConnection.storageType === "local_drive" && storageConnection.legacyConnectedFolderId) {
      await disconnectPlatformFolder(storageConnection.legacyConnectedFolderId);
    }
    await deleteStorageConnection(storageConnection.id);
    await logActivity(user.id, "storage.deleted", "storage_connection", storageConnection.id, `${storageConnection.displayName} storage access was removed.`, {
      storageType: storageConnection.storageType,
      accountId: storageConnection.accountId
    });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// --- REUSABLE SCHEDULES ---
app.get("/api/schedules", async (_req, res, next) => {
  try {
    res.json(await listPublishingSchedules());
  } catch (error) {
    next(error);
  }
});

app.post("/api/schedules", requireRoles("operations_manager", "scheduler"), async (req: RequestWithUser, res, next) => {
  try {
    const payload = upsertPublishingScheduleSchema.parse(req.body);
    const schedule = await createPublishingSchedule(payload);
    await logActivity(currentUser(req).id, "schedule.created", "schedule_template", schedule.id, `${schedule.name} schedule was created.`, { frequency: schedule.frequency, time: schedule.time });
    res.status(201).json(schedule);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/schedules/:id", requireRoles("operations_manager", "scheduler"), async (req: RequestWithUser, res, next) => {
  try {
    const scheduleId = scheduleIdSchema.parse(req.params.id);
    const payload = upsertPublishingScheduleSchema.parse(req.body);
    const schedule = await updatePublishingSchedule(scheduleId, payload);
    if (!schedule) {
      res.status(404).json({ message: "Schedule not found" });
      return;
    }
    await logActivity(currentUser(req).id, "schedule.updated", "schedule_template", schedule.id, `${schedule.name} schedule was updated.`, { frequency: schedule.frequency, time: schedule.time, status: schedule.status });
    res.json(schedule);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/schedules/:id", requireRoles("operations_manager", "scheduler"), async (req: RequestWithUser, res, next) => {
  try {
    const scheduleId = scheduleIdSchema.parse(req.params.id);
    const schedule = await deletePublishingSchedule(scheduleId);
    if (!schedule) {
      res.status(404).json({ message: "Schedule not found" });
      return;
    }
    await logActivity(currentUser(req).id, "schedule.deleted", "schedule_template", schedule.id, `${schedule.name} schedule was deleted.`, { frequency: schedule.frequency, time: schedule.time });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.get("/api/social-media-schedules", async (_req, res, next) => {
  try {
    res.json(await listSocialMediaSchedules());
  } catch (error) {
    next(error);
  }
});

// --- LOCAL DEVICE UPLOADS ---
app.post("/api/posts/unified", requireRoles("operations_manager", "post_uploader"), unifiedPostUploadMiddleware, async (req: RequestWithUser, res, next) => {
  const file = req.file;
  const createdUploads: PlatformUpload[] = [];

  try {
    if (!file) throw new Error("Choose one image or video to upload.");
    const user = currentUser(req);
    const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
    const description = typeof req.body.description === "string" ? req.body.description.trim() : "";
    if (!description) throw new Error("Enter a post description.");

    let rawDestinations: unknown;
    try {
      rawDestinations = JSON.parse(typeof req.body.destinations === "string" ? req.body.destinations : "[]");
    } catch {
      throw new Error("Publishing destinations are invalid.");
    }
    const destinations = unifiedPostDestinationsSchema.parse(rawDestinations);
    const uniqueAccountIds = new Set(destinations.map(destination => destination.accountId));
    if (uniqueAccountIds.size !== destinations.length) throw new Error("Each publishing account can be selected only once.");
    if (user.role === "post_uploader" && destinations.some(destination => destination.scheduledAt || destination.scheduleId)) {
      throw new Error("Post uploaders can create queued posts but cannot assign schedules.");
    }

    const [allAccounts, allSchedules] = await Promise.all([
      listPlatformAccounts(),
      listPublishingSchedules(),
    ]);
    const accountById = new Map(allAccounts.map(account => [account.id, account]));
    const scheduleById = new Map(allSchedules.map(schedule => [schedule.id, schedule]));
    const destinationAccounts = destinations.map(destination => {
      const account = accountById.get(destination.accountId);
      if (!account) throw new Error("One of the selected publishing accounts no longer exists.");
      return { destination, account };
    });

    const youtubeVideoSelected = file.mimetype.startsWith("video/") && destinationAccounts.some(({ account }) => account.platform === "youtube");
    if (youtubeVideoSelected && !title) {
      throw new Error("YouTube requires a title.");
    }

    for (const { destination, account } of destinationAccounts) {
      const platformDescription = destination.description?.trim() || description;
      if (!account.enabled) throw new Error(`${account.displayName} is disabled and cannot receive new posts.`);
      assertPlatformPostCompatible(account.platform, file, title, platformDescription);
      if (destination.scheduleId) {
        const schedule = scheduleById.get(destination.scheduleId);
        if (!schedule) throw new Error(`Schedule #${destination.scheduleId} was not found.`);
        assertScheduleCanReceivePosts(schedule);
      }
    }

    for (const { destination, account } of destinationAccounts) {
      const scheduledAt = destination.scheduledAt ? normalizeScheduledAt(destination.scheduledAt) : undefined;
      createdUploads.push(await createUpload(destination.accountId, {
        originalName: file.originalname,
        fileName: file.filename,
        mimeType: file.mimetype,
        size: file.size,
        url: `/uploads/${file.filename}`,
        title: account.platform === "youtube" && file.mimetype.startsWith("video/") ? title : undefined,
        caption: destination.description?.trim() || description,
        scheduledAt,
        scheduleId: destination.scheduleId,
      }, user.id));
    }

    await logActivity(user.id, "post.unified_created", "post_group", createdUploads[0]?.id, `${title} was prepared for ${createdUploads.length} publishing ${createdUploads.length === 1 ? "destination" : "destinations"}.`, {
      title,
      uploadIds: createdUploads.map(upload => upload.id),
      accountIds: destinations.map(destination => destination.accountId),
      platforms: [...new Set(createdUploads.map(upload => upload.platform))],
    });
    res.status(201).json(createdUploads);
  } catch (error) {
    await Promise.all(createdUploads.map(upload => deleteUpload(upload.id).catch(() => undefined)));
    if (file) await removeStoredUploadFile(file.filename);
    next(error);
  }
});

app.post("/api/platforms/:platform/uploads", requireRoles("operations_manager", "post_uploader"), localPostUploadMiddleware, async (req: RequestWithUser, res, next) => {
  const files = Array.isArray(req.files) ? req.files as Express.Multer.File[] : [];
  const createdUploads: PlatformUpload[] = [];

  try {
    const user = currentUser(req);
    const platform = platformSchema.parse(req.params.platform);
    const accountId = typeof req.body.accountId === "string" ? req.body.accountId.trim() : "";
    if (!accountId) throw new Error("Choose a publishing account.");
    if (files.length === 0) throw new Error("Choose at least one image or video to upload.");

    const account = (await listPlatformAccounts(platform)).find(item => item.id === accountId);
    if (!account) throw new Error(`Choose a ${platform} publishing account.`);
    if (!account.enabled) throw new Error("Choose an enabled publishing account.");

    for (const file of files) {
      const caption = defaultPostText(file.originalname);
      const upload = await createUpload(account.id, {
        originalName: file.originalname,
        fileName: file.filename,
        mimeType: file.mimetype,
        size: file.size,
        url: `/uploads/${file.filename}`,
        title: caption,
        caption
      }, user.id);
      createdUploads.push(upload);
    }

    await logActivity(user.id, "post.uploaded", "post", createdUploads.length === 1 ? createdUploads[0].id : null, `${createdUploads.length} local ${createdUploads.length === 1 ? "post was" : "posts were"} uploaded.`, {
      platform,
      accountId: account.id,
      uploadIds: createdUploads.map(upload => upload.id)
    });

    res.status(201).json(createdUploads);
  } catch (error) {
    await Promise.all(createdUploads.map(async (upload) => {
      await deleteUpload(upload.id).catch(() => undefined);
      await removeStoredUploadFile(upload.fileName);
    }));
    await Promise.all(files.map(file => removeStoredUploadFile(file.filename)));
    next(error);
  }
});

// --- UPDATE STATUS ---
app.patch("/api/uploads/:id/status", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const user = currentUser(req);
    const payload = updateUploadStatusSchema.parse(req.body);
    const uploadId = pathParam(req.params.id, "id");
    const item = await updateUploadStatus(uploadId, payload.status, payload.failureReason ?? "Post status updated", user.id);

    if (!item) {
      res.status(404).json({ message: "Upload not found" });
      return;
    }

    await logActivity(user.id, "post.status_updated", "post", item.id, `${item.title || item.originalName} status changed to ${item.status}.`, { status: item.status });
    res.json(item);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/uploads/:id", requireRoles("operations_manager", "post_uploader", "scheduler"), async (req: RequestWithUser, res, next) => {
  try {
    const user = currentUser(req);
    const uploadId = pathParam(req.params.id, "id");
    const existing = await findUploadOrThrow(uploadId);
    let payload;
    let action = "post.updated";
    let summaryDetail = "details";

    if (user.role === "scheduler") {
      const schedulePayload = scheduleOnlyUpdateSchema.parse(req.body);
      const scheduledAt = schedulePayload.scheduledAt ? normalizeScheduledAt(schedulePayload.scheduledAt) : schedulePayload.scheduledAt;
      payload = {
        title: existing.title,
        caption: existing.caption,
        accountId: existing.accountId,
        scheduledAt,
        scheduleId: schedulePayload.scheduleId
      };
      action = "post.scheduled";
      summaryDetail = "schedule";
    } else {
      const contentPayload = updateUploadDetailsSchema.parse(req.body);
      if (user.role === "post_uploader" && ("scheduledAt" in req.body || "scheduleId" in req.body)) {
        res.status(403).json({ message: "Post uploaders can edit content but cannot schedule posts." });
        return;
      }
      const scheduledAt = contentPayload.scheduledAt ? normalizeScheduledAt(contentPayload.scheduledAt) : contentPayload.scheduledAt;
      payload = {
        ...contentPayload,
        scheduledAt,
        scheduleId: user.role === "operations_manager" ? contentPayload.scheduleId : undefined
      };
      action = scheduledAt || contentPayload.scheduleId ? "post.scheduled" : "post.updated";
      summaryDetail = scheduledAt || contentPayload.scheduleId ? "schedule" : "content";
    }

    if (!canEditContent(user.role) && !canEditSchedule(user.role)) {
      res.status(403).json({ message: "Your role cannot edit posts." });
      return;
    }

    if (payload.scheduleId) {
      const schedule = (await listPublishingSchedules()).find(item => item.id === payload.scheduleId);
      if (!schedule) throw new Error(`Schedule #${payload.scheduleId} was not found.`);
      assertScheduleCanReceivePosts(schedule);
    }

    const item = await updateUploadDetails(uploadId, payload, user.id);

    if (!item) {
      res.status(404).json({ message: "Upload not found" });
      return;
    }

    await logActivity(user.id, action, "post", item.id, `${item.title || item.originalName} ${summaryDetail} was updated.`, { platform: item.platform, accountId: item.accountId, scheduledAt: item.scheduledAt, scheduleId: item.scheduleId });
    res.json(item);
  } catch (error) {
    next(error);
  }
});

// --- DELETE UPLOAD ---
app.delete("/api/uploads/:id", requireRoles("operations_manager", "post_uploader"), async (req: RequestWithUser, res, next) => {
  try {
    const user = currentUser(req);
    const deleted = await deleteUpload(pathParam(req.params.id, "id"));

    if (!deleted) {
      res.status(404).json({ message: "Upload not found" });
      return;
    }

    const fileStillUsed = (await listUploads()).some(upload => upload.fileName === deleted.fileName);
    if (!fileStillUsed) await removeStoredUploadFile(deleted.fileName);

    await logActivity(user.id, "post.deleted", "post", deleted.id, `${deleted.title || deleted.originalName} was deleted.`, { platform: deleted.platform, accountId: deleted.accountId });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// --- OLD FOLDER API REMOVED ---
app.get("/api/folder-connections", requireRoles("operations_manager", "post_uploader"), (_req, res) => {
  res.status(410).json({ message: "Folder connections were replaced by Storage Access. Use /api/storage-connections." });
});

app.post("/api/accounts/:accountId/folder-connection", requireRoles("operations_manager", "post_uploader"), (_req, res) => {
  res.status(410).json({ message: "Folder connections were replaced by Storage Access. Add a Local Drive source instead." });
});

app.delete("/api/folder-connections/:id", requireRoles("operations_manager", "post_uploader"), (_req, res) => {
  res.status(410).json({ message: "Folder connections were replaced by Storage Access. Remove the Storage Access connection instead." });
});

// --- AUTOMATION INPUT ---
app.get("/api/automation/input", requireRoles("operations_manager"), async (_req, res, next) => {
  try {
    res.json(await automationInput());
  } catch (error) {
    next(error);
  }
});

app.get("/api/automation/platforms/:platform/input", requireRoles("operations_manager"), async (req, res, next) => {
  try {
    const platform = platformSchema.parse(req.params.platform);
    res.json(await automationInput(platform));
  } catch (error) {
    next(error);
  }
});

// --- TRIGGER AUTOMATION ---
app.post("/api/automation/run", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const user = currentUser(req);
    const payload = automationRunRequestSchema.parse(req.body ?? {});
    await logActivity(user.id, "automation.started", "automation_run", null, "Manual publisher automation was started.", {});
    runAutomation({ trigger: "manual", startedByUserId: user.id, uploadIds: payload.uploadIds })
      .catch(err => console.error("Background error:", err));
    res.status(202).json({
      message: payload.uploadIds?.length
        ? `Publishing started for ${payload.uploadIds.length} ${payload.uploadIds.length === 1 ? "post" : "posts"}.`
        : "Publisher automation started.",
      uploadIds: payload.uploadIds ?? []
    });
  } catch (error) {
    next(error);
  }
});

// --- ERROR HANDLER ---
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE"
      ? `The selected media exceeds the ${Math.floor(maxUploadFileSize / (1024 * 1024))} MB upload limit.`
      : error.message;
    res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ message });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      message: "Validation failed",
      issues: error.issues
    });
    return;
  }

  if (error instanceof Error) {
    res.status(400).json({ message: error.message });
    return;
  }

  res.status(500).json({ message: "Unexpected server error" });
});

if (process.env.NODE_ENV === "production" && authSecret() === "local-development-auth-token-secret") {
  throw new Error("PUBLISH_QUEUE_AUTH_TOKEN_SECRET is required in production.");
}

if (process.env.NODE_ENV === "production") {
  const missingRolePasswords = [
    "OPERATIONS_MANAGER_PASSWORD",
    "POST_UPLOADER_PASSWORD",
    "SCHEDULER_PASSWORD",
    "VIEWER_PASSWORD",
  ].filter(name => !(process.env[`PUBLISH_QUEUE_${name}`]?.trim() || process.env[name]?.trim()));
  if (missingRolePasswords.length > 0) {
    throw new Error(`Publishing role passwords are required in production: ${missingRolePasswords.join(", ")}.`);
  }
}

const server = app.listen(port, host, () => {
  console.log(`Publish Queue Runner API listening on http://${host}:${port}`);
  void reconcileSavedAccountSessions().catch(error => {
    console.warn("Could not reconcile saved publishing sessions:", error instanceof Error ? error.message : error);
  });
  startScheduler();
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopScheduler();
  server.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
