import "./env.js";
import cors from "cors";
import express from "express";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { ZodError, z } from "zod";
import { verifyPublishingWorkspaceIdentity } from "../../../../lib/publishing-workspace-auth.js";
import {
  createUserProfileSchema,
  loginInputSchema,
  platformLabels,
  platformPostRules,
  platforms,
  platformSchema,
  scheduleIdSchema,
  updateUploadDetailsSchema,
  updateUploadStatusSchema,
  updateUserProfileSchema,
  upsertPlatformAccountSchema,
  upsertPublishingScheduleSchema,
  unifiedPostDestinationsSchema,
  type Platform,
  type PostFormat,
  type PublishingSchedule,
  type PlatformUpload,
  type UserProfile,
  type UserRole
} from "../shared/schema.js";
import {
  automationInput,
  createPlatformAccount,
  createContentSubmission,
  createPublishingSchedule,
  createUpload,
  createUserProfile,
  deactivateUserProfile,
  dashboardSummary,
  deletePlatformAccount,
  deletePublishingSchedule,
  deleteUpload,
  completeContentSubmission,
  getContentSubmission,
  getPlatformAccount,
  getUserProfile,
  listPlatformAccounts,
  listContentSubmissions,
  listPublishingSchedules,
  listSocialMediaSchedules,
  listActivityLogs,
  listUploads,
  listUserProfiles,
  loginPlatformWorkspaceManager,
  localStorageHealth,
  logActivity,
  loginUser,
  platformWorkspaceManagerStatus,
  recoverInterruptedPublishingWork,
  setupPlatformWorkspaceManager,
  updatePublishingSchedule,
  updatePlatformAccount,
  updateUploadDetails,
  updateUploadStatus,
  updateUserProfile,
} from "./local-storage.js";
import {
  isAutomationRunning,
  publishingBrowserRuntimeHealth,
  reconcileSavedAccountSessions,
  removeSavedAccountProfile,
  runAutomation,
  startManualAccountSession,
} from "./services/publisher.js";
import { startScheduler, stopScheduler } from "./services/scheduler.js";
import { publishingUploadDirectory } from "./runtime-paths.js";

export const publishingApp = express();
const app = publishingApp;
const port = Number(process.env.PUBLISH_QUEUE_SERVICE_PORT ?? process.env.PORT ?? 8792);
const host = process.env.PUBLISH_QUEUE_SERVICE_HOST?.trim() || "127.0.0.1";
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uploadDir = publishingUploadDirectory();
const stagedUploadDir = path.join(uploadDir, ".staged");
const allowedUploadExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"]);
const allowedUploadMimePrefixes = ["image/", "video/"];
const imageUploadExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const videoUploadExtensions = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"]);
const maxUploadFileSize = Number(process.env.UPLOAD_MAX_FILE_BYTES ?? 500 * 1024 * 1024);
const configuredWebOrigins = new Set(
  (process.env.PUBLISH_QUEUE_WEB_ORIGIN ?? process.env.WEB_ORIGIN ?? "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean),
);

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(stagedUploadDir, { recursive: true });

app.use((req, res, next) => {
  if (req.headers["access-control-request-private-network"] === "true") {
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
  next();
});

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

function safeUploadFileName(originalName: string) {
  const extension = path.extname(originalName).toLowerCase();
  const safeBase = path.basename(originalName, extension)
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "local-post";
  return `${Date.now()}-${randomUUID().slice(0, 8)}-${safeBase}${extension}`;
}

async function removeStoredUploadFile(fileName: string) {
  const resolvedUploadDir = path.resolve(uploadDir);
  const storedFilePath = path.resolve(resolvedUploadDir, fileName);
  if (!storedFilePath.startsWith(`${resolvedUploadDir}${path.sep}`)) return;
  await fs.promises.unlink(storedFilePath).catch(() => undefined);
}

type StoredUploadFile = {
  originalname: string;
  filename: string;
  mimetype: string;
  size: number;
};

function postFormatForFile(file: StoredUploadFile): PostFormat {
  if (file.mimetype.startsWith("image/")) return "image" as const;
  if (file.mimetype.startsWith("video/")) return "video" as const;
  if (file.mimetype === "text/plain") return "text" as const;
  throw new Error("Upload an image or video.");
}

function assertPlatformPostCompatible(platform: Platform, file: StoredUploadFile, title: string, description: string) {
  const rules = platformPostRules[platform];
  const postFormat = postFormatForFile(file);
  if (!rules.formats.includes(postFormat)) {
    throw new Error(`${platformLabels[platform]} does not support ${postFormat} posts in this publishing flow.`);
  }
  const titleRequired = rules.titleRequired || rules.titleRequiredFor?.includes(postFormat);
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

const platformPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});

const stagedUploadCreateSchema = z.object({
  originalName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(120),
  size: z.number().int().positive()
});

const stagedUploadIdSchema = z.string().regex(/^stage_[A-Za-z0-9_-]{12,}$/, "The staged upload ID is invalid.");

const stagedUnifiedPostSchema = z.object({
  stagedUploadId: stagedUploadIdSchema,
  title: z.string().max(500).optional().default(""),
  description: z.string().trim().min(1, "Enter a post description."),
  destinations: unifiedPostDestinationsSchema
});

const textUnifiedPostSchema = z.object({
  description: z.string().trim().min(1, "Write your post text."),
  destinations: unifiedPostDestinationsSchema
});

const stagedSubmissionSchema = z.object({
  stagedUploadId: stagedUploadIdSchema,
  title: z.string().trim().max(500).optional().default(""),
  description: z.string().trim().min(1, "Enter a post description.")
});

const textSubmissionSchema = z.object({
  description: z.string().trim().min(1, "Write your post text.")
});

const scheduleSubmissionSchema = z.object({
  destinations: unifiedPostDestinationsSchema
}).superRefine((value, context) => {
  value.destinations.forEach((destination, index) => {
    if (!destination.scheduledAt && !destination.scheduleId) {
      context.addIssue({
        code: "custom",
        path: ["destinations", index],
        message: "Choose an exact time or schedule template for every destination."
      });
    }
  });
});

type StagedUploadRecord = {
  id: string;
  userId: string;
  workspaceId: string;
  originalName: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
};

function authSecret() {
  const configured = process.env.PUBLISH_QUEUE_AUTH_TOKEN_SECRET?.trim()
    || process.env.AUTH_TOKEN_SECRET?.trim()
    || process.env.LOCAL_ACCOUNT_SECRET_KEY?.trim();
  if (configured) return configured;
  if (process.env.SERVERLESS === "true" || process.env.NETLIFY === "true") {
    return "local-development-auth-token-secret";
  }

  const configuredStorePath = resolveFromRoot(process.env.PUBLISH_QUEUE_DATA_PATH ?? "./data/store.json");
  const secretPath = resolveFromRoot(
    process.env.PUBLISH_QUEUE_LOCAL_AUTH_SECRET_PATH ?? path.join(path.dirname(configuredStorePath), ".auth-token-secret"),
  );
  try {
    const saved = fs.readFileSync(secretPath, "utf8").trim();
    if (saved.length >= 32) return saved;
  } catch {
    // Create a local-only secret below.
  }

  const generated = randomBytes(48).toString("base64url");
  fs.mkdirSync(path.dirname(secretPath), { recursive: true });
  fs.writeFileSync(secretPath, generated, { encoding: "utf8", mode: 0o600 });
  return generated;
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

async function findUploadOrThrow(uploadId: string, workspaceId?: string): Promise<PlatformUpload> {
  const uploads = await listUploads(undefined, undefined, workspaceId);
  const upload = uploads.find(item => item.id === uploadId);
  if (!upload) throw new Error("Upload not found");
  return upload;
}

function stagedMetadataPath(stagedUploadId: string) {
  return path.join(stagedUploadDir, `${stagedUploadId}.json`);
}

function stagedContentPath(stagedUploadId: string) {
  return path.join(stagedUploadDir, `${stagedUploadId}.part`);
}

async function readStagedUpload(stagedUploadId: string) {
  const parsed = JSON.parse(await fs.promises.readFile(stagedMetadataPath(stagedUploadId), "utf8")) as StagedUploadRecord;
  if (parsed.id !== stagedUploadId) throw new Error("The staged upload metadata is invalid.");
  return parsed;
}

async function removeStagedUpload(stagedUploadId: string) {
  await Promise.all([
    fs.promises.unlink(stagedMetadataPath(stagedUploadId)).catch(() => undefined),
    fs.promises.unlink(stagedContentPath(stagedUploadId)).catch(() => undefined),
  ]);
}

async function cleanExpiredStagedUploads() {
  const expiry = Date.now() - 24 * 60 * 60 * 1000;
  const entries = await fs.promises.readdir(stagedUploadDir, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.filter(entry => entry.isFile()).map(async (entry) => {
    const entryPath = path.join(stagedUploadDir, entry.name);
    const stat = await fs.promises.stat(entryPath).catch(() => null);
    if (stat && stat.mtimeMs < expiry) await fs.promises.unlink(entryPath).catch(() => undefined);
  }));
}

async function assertStagedMediaSignature(record: StagedUploadRecord, contentPath: string) {
  const extension = path.extname(record.originalName).toLowerCase();
  const handle = await fs.promises.open(contentPath, "r");
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const bytes = header.subarray(0, bytesRead);
    const ascii = bytes.toString("ascii");
    const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isGif = ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a");
    const isWebp = ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP";
    const isMp4Family = ascii.slice(4, 8) === "ftyp";
    const isAvi = ascii.startsWith("RIFF") && ascii.slice(8, 11) === "AVI";
    const isEbml = bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    const signatureValid = extension === ".jpg" || extension === ".jpeg" ? isJpeg
      : extension === ".png" ? isPng
        : extension === ".gif" ? isGif
          : extension === ".webp" ? isWebp
            : extension === ".avi" ? isAvi
              : extension === ".webm" || extension === ".mkv" ? isEbml
                : isMp4Family;
    if (!signatureValid) throw new Error("The uploaded file content does not match its image or video extension.");
  } finally {
    await handle.close();
  }
}

async function createUnifiedPosts(
  file: StoredUploadFile,
  user: UserProfile,
  titleInput: string,
  descriptionInput: string,
  destinationsInput: unknown,
) {
  const createdUploads: PlatformUpload[] = [];
  const title = titleInput.trim();
  const description = descriptionInput.trim();
  if (!description) throw new Error("Enter a post description.");
  const postFormat = postFormatForFile(file);

  try {
    const destinations = unifiedPostDestinationsSchema.parse(destinationsInput);
    const uniqueAccountIds = new Set(destinations.map(destination => destination.accountId));
    if (uniqueAccountIds.size !== destinations.length) throw new Error("Each publishing account can be selected only once.");
    if (user.role === "post_uploader" && destinations.some(destination => destination.scheduledAt || destination.scheduleId)) {
      throw new Error("Post uploaders can create queued posts but cannot assign schedules.");
    }

    const [allAccounts, allSchedules] = await Promise.all([
      listPlatformAccounts(undefined, user.workspaceId),
      listPublishingSchedules(user.workspaceId),
    ]);
    const accountById = new Map(allAccounts.map(account => [account.id, account]));
    const scheduleById = new Map(allSchedules.map(schedule => [schedule.id, schedule]));
    const destinationAccounts = destinations.map(destination => {
      const account = accountById.get(destination.accountId);
      if (!account) throw new Error("One of the selected publishing accounts no longer exists.");
      return { destination, account };
    });

    const youtubeVideoSelected = postFormat === "video" && destinationAccounts.some(({ account }) => account.platform === "youtube");
    if (youtubeVideoSelected && !title) throw new Error("YouTube requires a title.");

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
        postFormat,
        size: file.size,
        url: postFormat === "text" ? "" : `/uploads/${file.filename}`,
        title: account.platform === "youtube" && postFormat === "video" ? title : undefined,
        caption: destination.description?.trim() || description,
        scheduledAt,
        scheduleId: destination.scheduleId,
      }, user.id, user.workspaceId));
    }

    await logActivity(user.id, "post.unified_created", "post_group", createdUploads[0]?.id, `${title || file.originalname} was prepared for ${createdUploads.length} publishing ${createdUploads.length === 1 ? "destination" : "destinations"}.`, {
      title,
      uploadIds: createdUploads.map(upload => upload.id),
      accountIds: destinations.map(destination => destination.accountId),
      platforms: [...new Set(createdUploads.map(upload => upload.platform))],
    });
    return createdUploads;
  } catch (error) {
    await Promise.all(createdUploads.map(upload => deleteUpload(upload.id, user.workspaceId).catch(() => undefined)));
    throw error;
  }
}

async function scheduleContentSubmission(
  submissionId: string,
  user: UserProfile,
  destinationsInput: unknown,
) {
  const createdUploads: PlatformUpload[] = [];
  const submission = await getContentSubmission(submissionId, user.workspaceId);
  if (!submission) throw new Error("Content submission not found.");
  if (submission.status !== "awaiting_schedule") throw new Error("This content submission has already been scheduled.");

  const file: StoredUploadFile = {
    originalname: submission.originalName,
    filename: submission.fileName,
    mimetype: submission.mimeType,
    size: submission.size,
  };
  const title = submission.title?.trim() || "";
  const destinations = scheduleSubmissionSchema.parse({ destinations: destinationsInput }).destinations;
  const uniqueAccountIds = new Set(destinations.map(destination => destination.accountId));
  if (uniqueAccountIds.size !== destinations.length) throw new Error("Each publishing account can be selected only once.");

  try {
    const [allAccounts, allSchedules] = await Promise.all([
      listPlatformAccounts(undefined, user.workspaceId),
      listPublishingSchedules(user.workspaceId),
    ]);
    const accountById = new Map(allAccounts.map(account => [account.id, account]));
    const scheduleById = new Map(allSchedules.map(schedule => [schedule.id, schedule]));
    const destinationAccounts = destinations.map(destination => {
      const account = accountById.get(destination.accountId);
      if (!account) throw new Error("One of the selected publishing accounts no longer exists.");
      return { destination, account };
    });

    for (const { destination, account } of destinationAccounts) {
      if (!account.enabled) throw new Error(`${account.displayName} is disabled and cannot receive new posts.`);
      assertPlatformPostCompatible(account.platform, file, title, submission.description);
      if (destination.scheduleId) {
        const schedule = scheduleById.get(destination.scheduleId);
        if (!schedule) throw new Error(`Schedule #${destination.scheduleId} was not found.`);
        assertScheduleCanReceivePosts(schedule);
      }
    }

    for (const { destination, account } of destinationAccounts) {
      const scheduledAt = destination.scheduledAt ? normalizeScheduledAt(destination.scheduledAt) : undefined;
      createdUploads.push(await createUpload(destination.accountId, {
        originalName: submission.originalName,
        fileName: submission.fileName,
        mimeType: submission.mimeType,
        postFormat: submission.postFormat,
        size: submission.size,
        url: submission.url,
        title: account.platform === "youtube" && submission.postFormat === "video" ? title : undefined,
        caption: submission.description,
        scheduledAt,
        scheduleId: destination.scheduleId,
      }, user.id, user.workspaceId));
    }

    const completed = await completeContentSubmission(
      submission.id,
      createdUploads.map(upload => upload.id),
      user.id,
      user.workspaceId,
    );
    if (!completed) throw new Error("Content submission not found.");
    return { submission: completed, uploads: createdUploads };
  } catch (error) {
    await Promise.all(createdUploads.map(upload => deleteUpload(upload.id, user.workspaceId).catch(() => undefined)));
    throw error;
  }
}

app.use(
  cors({
    origin(requestOrigin, callback) {
      if (!requestOrigin) {
        callback(null, true);
        return;
      }

      let loopbackOrigin = false;
      try {
        const hostname = new URL(requestOrigin).hostname.toLowerCase();
        loopbackOrigin = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
      } catch {
        loopbackOrigin = false;
      }

      callback(null, loopbackOrigin || configuredWebOrigins.has(requestOrigin));
    }
  })
);
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(uploadDir));

// --- HEALTH ---
app.get("/api/health", async (_req, res) => {
  try {
    const storage = await localStorageHealth();
    const serverless = process.env.SERVERLESS === "true" || process.env.NETLIFY === "true";
    const browser = publishingBrowserRuntimeHealth();
    res.json({
      ok: true,
      service: "agenticthat-publish-queue-runner",
      storage: storage.storage,
      automationReady: !serverless && browser.chromeInstalled,
      automationRunning: isAutomationRunning(),
      chromeInstalled: browser.chromeInstalled,
      companionInstanceId: process.env.PUBLISH_QUEUE_COMPANION_INSTANCE_ID?.trim() || null,
      extensionBridge: true,
      platforms,
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

function platformIdentity(token: string) {
  const identity = verifyPublishingWorkspaceIdentity(token);
  if (!identity) throw new Error("Your AgenticThat workspace session is invalid or expired.");
  return {
    platformUserId: identity.sub,
    workspaceId: identity.workspaceId,
    workspaceKey: identity.workspaceKey,
    fullName: identity.name,
    email: identity.email,
  };
}

app.post("/api/auth/platform/status", async (req, res, next) => {
  try {
    const token = z.object({ token: z.string().min(1) }).parse(req.body).token;
    res.json(await platformWorkspaceManagerStatus(platformIdentity(token)));
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/platform/setup", async (req, res, next) => {
  try {
    const payload = platformPasswordSchema.parse(req.body);
    const user = await setupPlatformWorkspaceManager(platformIdentity(payload.token), payload.password);
    res.json({ user, token: signAuthToken(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/platform/login", async (req, res, next) => {
  try {
    const payload = platformPasswordSchema.parse(req.body);
    const user = await loginPlatformWorkspaceManager(platformIdentity(payload.token), payload.password);
    if (!user) {
      res.status(401).json({ message: "Incorrect Operations Manager password." });
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
    res.json(await listUserProfiles(currentUser(_req as RequestWithUser).workspaceId));
  } catch (error) {
    next(error);
  }
});

app.post("/api/users", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const payload = createUserProfileSchema.parse(req.body);
    const user = currentUser(req);
    res.status(201).json(await createUserProfile(payload, user.id, user.workspaceId));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/users/:id", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const payload = updateUserProfileSchema.parse(req.body);
    const actor = currentUser(req);
    const user = await updateUserProfile(pathParam(req.params.id, "id"), payload, actor.id, actor.workspaceId);
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
    const actor = currentUser(req);
    const user = await deactivateUserProfile(pathParam(req.params.id, "id"), actor.id, actor.workspaceId);
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
    res.json(await listActivityLogs(limit, currentUser(req as RequestWithUser).workspaceId));
  } catch (error) {
    next(error);
  }
});

// --- DASHBOARD ---
app.get("/api/dashboard", async (req: RequestWithUser, res, next) => {
  try {
    res.json(await dashboardSummary(currentUser(req).workspaceId));
  } catch (error) {
    next(error);
  }
});

app.get("/api/submissions", async (req: RequestWithUser, res, next) => {
  try {
    res.json(await listContentSubmissions(currentUser(req).workspaceId));
  } catch (error) {
    next(error);
  }
});

// --- LIST UPLOADS ---
app.get("/api/uploads", async (req: RequestWithUser, res, next) => {
  try {
    const platform = req.query.platform ? platformSchema.parse(req.query.platform) : undefined;
    const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;
    res.json(await listUploads(platform, accountId, currentUser(req).workspaceId));
  } catch (error) {
    next(error);
  }
});

app.get("/api/platforms/:platform/uploads", async (req: RequestWithUser, res, next) => {
  try {
    const platform = platformSchema.parse(req.params.platform);
    const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;
    res.json(await listUploads(platform, accountId, currentUser(req).workspaceId));
  } catch (error) {
    next(error);
  }
});

// --- PUBLISHING ACCOUNTS ---
app.get("/api/accounts", async (req: RequestWithUser, res, next) => {
  try {
    const platform = req.query.platform ? platformSchema.parse(req.query.platform) : undefined;
    res.json(await listPlatformAccounts(platform, currentUser(req).workspaceId));
  } catch (error) {
    next(error);
  }
});

app.post("/api/platforms/:platform/accounts", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const platform = platformSchema.parse(req.params.platform);
    const payload = upsertPlatformAccountSchema.parse(req.body);
    const user = currentUser(req);
    const account = await createPlatformAccount(platform, payload, user.workspaceId);
    await logActivity(user.id, "account.created", "publishing_account", account.id, `${account.displayName} account was added for ${platform}.`, { platform, handle: account.handle });
    res.status(201).json(account);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/accounts/:id", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const payload = upsertPlatformAccountSchema.parse(req.body);
    const user = currentUser(req);
    const account = await updatePlatformAccount(pathParam(req.params.id, "id"), payload, user.workspaceId);
    if (!account) {
      res.status(404).json({ message: "Publishing account not found" });
      return;
    }
    await logActivity(user.id, "account.updated", "publishing_account", account.id, `${account.displayName} account was updated.`, { platform: account.platform, handle: account.handle });
    res.json(account);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/accounts/:id", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const user = currentUser(req);
    const account = await deletePlatformAccount(pathParam(req.params.id, "id"), user.workspaceId);
    if (!account) {
      res.status(404).json({ message: "Publishing account not found" });
      return;
    }
    await removeSavedAccountProfile(account).catch(error => {
      console.warn(`Could not remove the saved browser profile for ${account.handle}:`, error instanceof Error ? error.message : error);
    });
    await logActivity(user.id, "account.deleted", "publishing_account", account.id, `${account.displayName} account was deleted.`, { platform: account.platform, handle: account.handle });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.post("/api/accounts/:id/manual-login", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    if (process.env.SERVERLESS === "true" || process.env.NETLIFY === "true") {
      res.status(409).json({
        message: "Interactive browser login requires the persistent Publish Queue Runner. Configure PUBLISH_QUEUE_API_URL to that runner before opening a manual login session."
      });
      return;
    }
    const user = currentUser(req);
    const accountId = pathParam(req.params.id, "id");
    if (!(await getPlatformAccount(accountId, user.workspaceId))) {
      res.status(404).json({ message: "Publishing account not found" });
      return;
    }
    const { account, started } = await startManualAccountSession(accountId);
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

// --- REUSABLE SCHEDULES ---
app.get("/api/schedules", async (req: RequestWithUser, res, next) => {
  try {
    res.json(await listPublishingSchedules(currentUser(req).workspaceId));
  } catch (error) {
    next(error);
  }
});

app.post("/api/schedules", requireRoles("operations_manager", "scheduler"), async (req: RequestWithUser, res, next) => {
  try {
    const payload = upsertPublishingScheduleSchema.parse(req.body);
    const user = currentUser(req);
    const schedule = await createPublishingSchedule(payload, user.workspaceId);
    await logActivity(user.id, "schedule.created", "schedule_template", schedule.id, `${schedule.name} schedule was created.`, { frequency: schedule.frequency, time: schedule.time });
    res.status(201).json(schedule);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/schedules/:id", requireRoles("operations_manager", "scheduler"), async (req: RequestWithUser, res, next) => {
  try {
    const scheduleId = scheduleIdSchema.parse(req.params.id);
    const payload = upsertPublishingScheduleSchema.parse(req.body);
    const user = currentUser(req);
    const schedule = await updatePublishingSchedule(scheduleId, payload, user.workspaceId);
    if (!schedule) {
      res.status(404).json({ message: "Schedule not found" });
      return;
    }
    await logActivity(user.id, "schedule.updated", "schedule_template", schedule.id, `${schedule.name} schedule was updated.`, { frequency: schedule.frequency, time: schedule.time, status: schedule.status });
    res.json(schedule);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/schedules/:id", requireRoles("operations_manager", "scheduler"), async (req: RequestWithUser, res, next) => {
  try {
    const scheduleId = scheduleIdSchema.parse(req.params.id);
    const user = currentUser(req);
    const schedule = await deletePublishingSchedule(scheduleId, user.workspaceId);
    if (!schedule) {
      res.status(404).json({ message: "Schedule not found" });
      return;
    }
    await logActivity(user.id, "schedule.deleted", "schedule_template", schedule.id, `${schedule.name} schedule was deleted.`, { frequency: schedule.frequency, time: schedule.time });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.get("/api/social-media-schedules", async (req: RequestWithUser, res, next) => {
  try {
    res.json(await listSocialMediaSchedules(currentUser(req).workspaceId));
  } catch (error) {
    next(error);
  }
});

// --- LOCAL DEVICE UPLOADS ---
app.post("/api/staged-uploads", requireRoles("operations_manager", "post_uploader"), async (req: RequestWithUser, res, next) => {
  try {
    const user = currentUser(req);
    const payload = stagedUploadCreateSchema.parse(req.body);
    const extension = path.extname(payload.originalName).toLowerCase();
    if (!allowedUploadExtensions.has(extension) || !allowedUploadMimePrefixes.some(prefix => payload.mimeType.startsWith(prefix))) {
      throw new Error("Upload images or videos only.");
    }
    if ((payload.mimeType.startsWith("image/") && !imageUploadExtensions.has(extension))
      || (payload.mimeType.startsWith("video/") && !videoUploadExtensions.has(extension))) {
      throw new Error("The selected file extension does not match its media type.");
    }
    if (payload.size > maxUploadFileSize) {
      throw new Error(`The selected media exceeds the ${Math.floor(maxUploadFileSize / (1024 * 1024))} MB upload limit.`);
    }

    await cleanExpiredStagedUploads();
    const id = `stage_${randomUUID().replace(/-/g, "")}`;
    const record: StagedUploadRecord = {
      id,
      userId: user.id,
      workspaceId: user.workspaceId,
      originalName: payload.originalName,
      fileName: safeUploadFileName(payload.originalName),
      mimeType: payload.mimeType,
      size: payload.size,
      createdAt: new Date().toISOString(),
    };
    await fs.promises.writeFile(stagedMetadataPath(id), JSON.stringify(record), { encoding: "utf8", flag: "wx", mode: 0o600 });
    await fs.promises.writeFile(stagedContentPath(id), Buffer.alloc(0), { flag: "wx", mode: 0o600 });
    res.status(201).json({ id, offset: 0, chunkSize: 2 * 1024 * 1024 });
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/staged-uploads/:id/chunks",
  requireRoles("operations_manager", "post_uploader"),
  express.raw({ type: "application/octet-stream", limit: "3mb" }),
  async (req: RequestWithUser, res, next) => {
    try {
      const user = currentUser(req);
      const stagedUploadId = stagedUploadIdSchema.parse(pathParam(req.params.id, "id"));
      const record = await readStagedUpload(stagedUploadId);
      if (record.workspaceId !== user.workspaceId || (record.userId !== user.id && user.role !== "operations_manager")) {
        throw new Error("This staged upload belongs to another workspace.");
      }
      const requestedOffset = Number(req.headers["x-upload-offset"]);
      if (!Number.isInteger(requestedOffset) || requestedOffset < 0) throw new Error("The upload offset is invalid.");
      const content = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (content.length === 0) throw new Error("The upload chunk is empty.");
      const contentPath = stagedContentPath(stagedUploadId);
      const currentSize = (await fs.promises.stat(contentPath)).size;
      if (currentSize !== requestedOffset) {
        res.status(409).json({ message: "The upload offset is out of date.", offset: currentSize });
        return;
      }
      if (currentSize + content.length > record.size) throw new Error("The uploaded data exceeds the declared file size.");
      await fs.promises.appendFile(contentPath, content);
      res.json({ id: stagedUploadId, offset: currentSize + content.length });
    } catch (error) {
      next(error);
    }
  },
);

app.delete("/api/staged-uploads/:id", requireRoles("operations_manager", "post_uploader"), async (req: RequestWithUser, res, next) => {
  try {
    const user = currentUser(req);
    const stagedUploadId = stagedUploadIdSchema.parse(pathParam(req.params.id, "id"));
    const record = await readStagedUpload(stagedUploadId);
    if (record.workspaceId !== user.workspaceId || (record.userId !== user.id && user.role !== "operations_manager")) {
      throw new Error("This staged upload belongs to another workspace.");
    }
    await removeStagedUpload(stagedUploadId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.post("/api/submissions/text", requireRoles("operations_manager", "post_uploader"), async (req: RequestWithUser, res, next) => {
  try {
    const user = currentUser(req);
    const payload = textSubmissionSchema.parse(req.body);
    const submission = await createContentSubmission({
      originalName: "Text post",
      fileName: "",
      mimeType: "text/plain",
      postFormat: "text",
      size: Buffer.byteLength(payload.description, "utf8"),
      url: "",
      description: payload.description,
    }, user.workspaceId, user.id);
    res.status(201).json(submission);
  } catch (error) {
    next(error);
  }
});

app.post("/api/submissions/staged", requireRoles("operations_manager", "post_uploader"), async (req: RequestWithUser, res, next) => {
  let finalFileName: string | null = null;
  try {
    const user = currentUser(req);
    const payload = stagedSubmissionSchema.parse(req.body);
    const record = await readStagedUpload(payload.stagedUploadId);
    if (record.workspaceId !== user.workspaceId || (record.userId !== user.id && user.role !== "operations_manager")) {
      throw new Error("This staged upload belongs to another workspace.");
    }
    const stagedPath = stagedContentPath(record.id);
    const receivedSize = (await fs.promises.stat(stagedPath)).size;
    if (receivedSize !== record.size) throw new Error(`The media upload is incomplete (${receivedSize} of ${record.size} bytes received).`);
    await assertStagedMediaSignature(record, stagedPath);

    const postFormat = postFormatForFile({
      originalname: record.originalName,
      filename: record.fileName,
      mimetype: record.mimeType,
      size: record.size,
    });
    if (postFormat === "video" && !payload.title) {
      throw new Error("Enter a video title so the scheduler can choose any supported platform.");
    }

    finalFileName = record.fileName;
    await fs.promises.rename(stagedPath, path.join(uploadDir, record.fileName));
    const submission = await createContentSubmission({
      originalName: record.originalName,
      fileName: record.fileName,
      mimeType: record.mimeType,
      postFormat,
      size: record.size,
      url: `/uploads/${record.fileName}`,
      title: payload.title,
      description: payload.description,
    }, user.workspaceId, user.id);
    await fs.promises.unlink(stagedMetadataPath(record.id)).catch(() => undefined);
    res.status(201).json(submission);
  } catch (error) {
    if (finalFileName) await removeStoredUploadFile(finalFileName);
    next(error);
  }
});

app.post("/api/submissions/:id/schedule", requireRoles("operations_manager", "scheduler"), async (req: RequestWithUser, res, next) => {
  try {
    const payload = scheduleSubmissionSchema.parse(req.body);
    const result = await scheduleContentSubmission(
      pathParam(req.params.id, "id"),
      currentUser(req),
      payload.destinations,
    );
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/posts/unified/text", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const user = currentUser(req);
    const payload = textUnifiedPostSchema.parse(req.body);
    const createdUploads = await createUnifiedPosts({
      originalname: "Text post",
      filename: "",
      mimetype: "text/plain",
      size: Buffer.byteLength(payload.description, "utf8"),
    }, user, "", payload.description, payload.destinations);
    res.status(201).json(createdUploads);
  } catch (error) {
    next(error);
  }
});

app.post("/api/posts/unified/staged", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  let finalFileName: string | null = null;
  try {
    const user = currentUser(req);
    const payload = stagedUnifiedPostSchema.parse(req.body);
    const record = await readStagedUpload(payload.stagedUploadId);
    if (record.workspaceId !== user.workspaceId || (record.userId !== user.id && user.role !== "operations_manager")) {
      throw new Error("This staged upload belongs to another workspace.");
    }
    const stagedPath = stagedContentPath(record.id);
    const receivedSize = (await fs.promises.stat(stagedPath)).size;
    if (receivedSize !== record.size) throw new Error(`The media upload is incomplete (${receivedSize} of ${record.size} bytes received).`);
    await assertStagedMediaSignature(record, stagedPath);

    finalFileName = record.fileName;
    await fs.promises.rename(stagedPath, path.join(uploadDir, record.fileName));
    const createdUploads = await createUnifiedPosts({
      originalname: record.originalName,
      filename: record.fileName,
      mimetype: record.mimeType,
      size: record.size,
    }, user, payload.title, payload.description, payload.destinations);
    await fs.promises.unlink(stagedMetadataPath(record.id)).catch(() => undefined);
    res.status(201).json(createdUploads);
  } catch (error) {
    if (finalFileName) await removeStoredUploadFile(finalFileName);
    next(error);
  }
});

// --- UPDATE STATUS ---
app.patch("/api/uploads/:id/status", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const user = currentUser(req);
    const payload = updateUploadStatusSchema.parse(req.body);
    const uploadId = pathParam(req.params.id, "id");
    const item = await updateUploadStatus(uploadId, payload.status, payload.failureReason ?? "Post status updated", user.id, user.workspaceId);

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

app.patch("/api/uploads/:id", requireRoles("operations_manager", "scheduler"), async (req: RequestWithUser, res, next) => {
  try {
    const user = currentUser(req);
    const uploadId = pathParam(req.params.id, "id");
    const existing = await findUploadOrThrow(uploadId, user.workspaceId);
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
      const scheduledAt = contentPayload.scheduledAt ? normalizeScheduledAt(contentPayload.scheduledAt) : contentPayload.scheduledAt;
      payload = {
        ...contentPayload,
        scheduledAt,
        scheduleId: contentPayload.scheduleId
      };
      action = scheduledAt || contentPayload.scheduleId ? "post.scheduled" : "post.updated";
      summaryDetail = scheduledAt || contentPayload.scheduleId ? "schedule" : "content";
    }

    if (!canEditContent(user.role) && !canEditSchedule(user.role)) {
      res.status(403).json({ message: "Your role cannot edit posts." });
      return;
    }

    if (payload.scheduleId) {
      const schedule = (await listPublishingSchedules(user.workspaceId)).find(item => item.id === payload.scheduleId);
      if (!schedule) throw new Error(`Schedule #${payload.scheduleId} was not found.`);
      assertScheduleCanReceivePosts(schedule);
    }

    const item = await updateUploadDetails(uploadId, payload, user.id, user.workspaceId);

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
app.delete("/api/uploads/:id", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const user = currentUser(req);
    const deleted = await deleteUpload(pathParam(req.params.id, "id"), user.workspaceId);

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

// --- AUTOMATION INPUT ---
app.get("/api/automation/input", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    res.json(await automationInput(undefined, "ready", currentUser(req).workspaceId));
  } catch (error) {
    next(error);
  }
});

app.get("/api/automation/platforms/:platform/input", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    const platform = platformSchema.parse(req.params.platform);
    res.json(await automationInput(platform, "ready", currentUser(req).workspaceId));
  } catch (error) {
    next(error);
  }
});

// --- TRIGGER AUTOMATION ---
app.post("/api/automation/run", requireRoles("operations_manager"), async (req: RequestWithUser, res, next) => {
  try {
    if (process.env.SERVERLESS === "true" || process.env.NETLIFY === "true") {
      res.status(409).json({
        message: "Browser publishing requires the persistent Publish Queue Runner. Configure PUBLISH_QUEUE_API_URL to the runner and try again."
      });
      return;
    }
    const user = currentUser(req);
    const payload = automationRunRequestSchema.parse(req.body ?? {});
    await logActivity(user.id, "automation.started", "automation_run", null, "Manual publisher automation was started.", {});
    if (payload.uploadIds?.length) {
      const allowedIds = new Set((await listUploads(undefined, undefined, user.workspaceId)).map(upload => upload.id));
      if (payload.uploadIds.some(id => !allowedIds.has(id))) {
        res.status(404).json({ message: "One or more posts were not found in this workspace." });
        return;
      }
    }
    runAutomation({ trigger: "manual", startedByUserId: user.id, workspaceId: user.workspaceId, uploadIds: payload.uploadIds })
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
  const managerPassword = process.env.PUBLISH_QUEUE_OPERATIONS_MANAGER_PASSWORD?.trim()
    || process.env.OPERATIONS_MANAGER_PASSWORD?.trim()
    || process.env.ADMIN_PASSWORD?.trim();
  if (!managerPassword) {
    throw new Error("PUBLISH_QUEUE_OPERATIONS_MANAGER_PASSWORD or ADMIN_PASSWORD is required in production.");
  }
}

export type PublishingHttpServerOptions = {
  host?: string;
  port?: number;
  startBackgroundServices?: boolean;
};

export function createPublishingHttpServer(options: PublishingHttpServerOptions = {}): Server {
  const serverHost = options.host ?? host;
  const serverPort = options.port ?? port;
  const startBackgroundServices = options.startBackgroundServices ?? true;
  const server = app.listen(serverPort, serverHost, () => {
    const address = server.address();
    const resolvedPort = typeof address === "object" && address ? address.port : serverPort;
    console.log(`Publish Queue Runner API listening on http://${serverHost}:${resolvedPort}`);
    if (!startBackgroundServices) return;
    void (async () => {
      try {
        const recovery = await recoverInterruptedPublishingWork();
        if (recovery.recoveredUploads > 0) {
          console.warn(
            `Recovered ${recovery.recoveredUploads} interrupted post(s) in ${recovery.recoveryMode} mode.`,
          );
        }
      } catch (error) {
        console.error("Could not recover interrupted publishing work:", error instanceof Error ? error.message : error);
      }

      await reconcileSavedAccountSessions().catch(error => {
        console.warn("Could not reconcile saved publishing sessions:", error instanceof Error ? error.message : error);
      });
      startScheduler();
    })();
  });
  return server;
}

const isDirectExecution = Boolean(process.argv[1])
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

const server = isDirectExecution
  ? createPublishingHttpServer()
  : null;

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopScheduler();
  server?.close();
}

if (server) {
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
