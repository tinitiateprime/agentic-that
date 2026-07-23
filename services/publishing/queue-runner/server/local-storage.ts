import { promises as fs } from "node:fs";
import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import nodeCron from "node-cron";
import {
  type ActivityLog,
  type AutomationInput,
  type CreateUserProfileInput,
  type DashboardSummary,
  type Platform,
  type PlatformAccount,
  type PlatformUpload,
  type PostFormat,
  type PublishingSchedule,
  type SocialMediaSchedule,
  type UpdateUploadDetailsInput,
  type UpdateUserProfileInput,
  type UploadStatus,
  type UpsertPlatformAccountInput,
  type UpsertPublishingScheduleInput,
  type UserProfile,
  type UserRole,
  platformHandles,
  platformLabels,
  platformSurfaces,
  platforms
} from "../shared/schema.js";

type StoredUser = UserProfile & { passwordHash: string };

type BlobStore = {
  get: (key: string, options?: { type?: "json"; consistency?: string }) => Promise<unknown>;
  setJSON: (key: string, value: unknown, options?: { onlyIfNew?: boolean }) => Promise<unknown>;
};

type StoredFileInput = {
  originalName: string;
  fileName: string;
  mimeType: string;
  postFormat: PostFormat;
  size: number;
  url: string;
  title?: string;
  caption: string;
  scheduledAt?: string;
  scheduleId?: number;
};

type BootstrapUser = {
  username: string;
  fullName: string;
  email: string;
  role: UserRole;
  password: string;
  passwordConfigured: boolean;
};

type AutomationRunRecord = {
  id: string;
  trigger: AutomationRunTrigger;
  status: AutomationRunStatus;
  startedByUserId?: string;
  startedAt: string;
  finishedAt?: string;
  errorMessage?: string;
};

type AutomationRunPostRecord = {
  id: string;
  automationRunId: string;
  uploadId: string;
  accountId: string;
  platform: Platform;
  status: AutomationPostStatus;
  startedAt: string;
  finishedAt?: string;
  failureMessage?: string;
};

type Store = {
  version: 1;
  users: StoredUser[];
  accounts: PlatformAccount[];
  schedules: PublishingSchedule[];
  socialMediaSchedules: SocialMediaSchedule[];
  uploads: PlatformUpload[];
  activityLogs: ActivityLog[];
  automationRuns: AutomationRunRecord[];
  automationRunPosts: AutomationRunPostRecord[];
};

export type AutomationInputMode = "ready" | "scheduledOnly";
export type PublishingAccount = PlatformAccount;
export type AutomationRunTrigger = "manual" | "scheduler";
export type AutomationRunStatus = "running" | "completed" | "failed";
export type AutomationPostStatus = "processing" | "posted" | "failed";

const passwordIterations = 120_000;
const passwordAlgorithm = "pbkdf2_sha256";
const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localStoreFile = resolveFromRoot(process.env.PUBLISH_QUEUE_DATA_PATH ?? "./data/store.json");
const useNetlifyBlobs = (
  process.env.DATA_STORE === "netlify-blobs" ||
  process.env.NETLIFY === "true" ||
  Boolean(process.env.NETLIFY_BLOBS_CONTEXT)
);
let blobStorePromise: Promise<BlobStore> | null = null;
let storeMutationQueue: Promise<void> = Promise.resolve();
let storeReadyPromise: Promise<void> | null = null;

function resolveFromRoot(candidate: string) {
  return path.isAbsolute(candidate) ? candidate : path.resolve(serviceRoot, candidate);
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

function normalizeEmail(value: string | undefined, username: string) {
  const trimmed = value?.trim();
  if (trimmed) return trimmed.toLowerCase();
  const localPart = normalizeUsername(username).replace(/[^a-z0-9._-]+/g, ".").replace(/^\.+|\.+$/g, "") || "user";
  return localPart + "@local.agenticthat";
}

function bootstrapEnvironment(name: string) {
  return process.env["PUBLISH_QUEUE_" + name]?.trim() || process.env[name]?.trim();
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const hash = pbkdf2Sync(password, salt, passwordIterations, 32, "sha256").toString("base64url");
  return [passwordAlgorithm, passwordIterations, salt, hash].join("$");
}

function verifyPassword(password: string, passwordHash?: string | null) {
  if (!passwordHash) return false;
  const [algorithm, iterationText, salt, expectedHash] = passwordHash.split("$");
  if (algorithm !== passwordAlgorithm || !salt || !expectedHash) return false;
  const iterations = Number(iterationText);
  if (!Number.isInteger(iterations) || iterations < 10_000) return false;
  try {
    const expected = Buffer.from(expectedHash, "base64url");
    const actual = pbkdf2Sync(password, salt, iterations, expected.length, "sha256");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function configuredBootstrapUsers(): BootstrapUser[] {
  const managerUsername = bootstrapEnvironment("OPERATIONS_MANAGER_USERNAME") || "operations.manager";
  const configuredManagerPassword = bootstrapEnvironment("OPERATIONS_MANAGER_PASSWORD");
  const managerPassword = configuredManagerPassword || process.env.ADMIN_PASSWORD?.trim();
  const uploaderUsername = bootstrapEnvironment("POST_UPLOADER_USERNAME") || "content.uploader";
  const uploaderPassword = bootstrapEnvironment("POST_UPLOADER_PASSWORD");
  const schedulerUsername = bootstrapEnvironment("SCHEDULER_USERNAME") || "post.scheduler";
  const schedulerPassword = bootstrapEnvironment("SCHEDULER_PASSWORD");
  const viewerUsername = bootstrapEnvironment("VIEWER_USERNAME") || "workspace.viewer";
  const viewerPassword = bootstrapEnvironment("VIEWER_PASSWORD");

  const users = [
    {
      username: managerUsername,
      fullName: bootstrapEnvironment("OPERATIONS_MANAGER_NAME") || "Operations Manager",
      email: normalizeEmail(bootstrapEnvironment("OPERATIONS_MANAGER_EMAIL"), managerUsername),
      role: "operations_manager",
      password: managerPassword || "Tinitiate@2026",
      // ADMIN_PASSWORD is an initial bootstrap fallback, not an authoritative
      // publishing password. Only the publishing-specific variable should
      // overwrite a password later changed through User management.
      passwordConfigured: Boolean(configuredManagerPassword)
    },
    {
      username: uploaderUsername,
      fullName: bootstrapEnvironment("POST_UPLOADER_NAME") || "Content Uploader",
      email: normalizeEmail(bootstrapEnvironment("POST_UPLOADER_EMAIL"), uploaderUsername),
      role: "post_uploader",
      password: uploaderPassword || "Uploader@2026",
      passwordConfigured: Boolean(uploaderPassword)
    },
    {
      username: schedulerUsername,
      fullName: bootstrapEnvironment("SCHEDULER_NAME") || "Post Scheduler",
      email: normalizeEmail(bootstrapEnvironment("SCHEDULER_EMAIL"), schedulerUsername),
      role: "scheduler",
      password: schedulerPassword || "Scheduler@2026",
      passwordConfigured: Boolean(schedulerPassword)
    },
    {
      username: viewerUsername,
      fullName: bootstrapEnvironment("VIEWER_NAME") || "Workspace Viewer",
      email: normalizeEmail(bootstrapEnvironment("VIEWER_EMAIL"), viewerUsername),
      role: "viewer",
      password: viewerPassword || "Viewer@2026",
      passwordConfigured: Boolean(viewerPassword)
    }
  ].map(user => ({
    ...user,
    username: normalizeUsername(user.username),
    email: normalizeEmail(user.email, user.username)
  })) as BootstrapUser[];

  const requireConfiguredPassword = process.env.NODE_ENV === "production" || process.env.SERVERLESS === "true" || process.env.NETLIFY === "true";
  return users.filter(user => user.role === "operations_manager" || user.passwordConfigured || !requireConfiguredPassword);
}

function createAutomation(platform: Platform, accountId: string, uploadId: string, sourceFileUrl: string) {
  return {
    schemaVersion: "autopost.upload.v1" as const,
    n8nInputKey: "accounts." + accountId + "." + uploadId,
    playwright: {
      platform,
      accountId,
      browserProfileName: platform + "-" + accountId + "-session",
      publishSurface: platformSurfaces[platform],
      sourceFileUrl
    }
  };
}

function emptyStore(): Store {
  return {
    version: 1,
    users: [],
    accounts: [],
    schedules: [],
    socialMediaSchedules: [],
    uploads: [],
    activityLogs: [],
    automationRuns: [],
    automationRunPosts: []
  };
}

function normalizeStore(value: unknown): Store {
  const input = value && typeof value === "object" ? value as Partial<Store> : {};
  return {
    version: 1,
    users: Array.isArray(input.users) ? input.users : [],
    accounts: Array.isArray(input.accounts) ? input.accounts : [],
    schedules: Array.isArray(input.schedules) ? input.schedules : [],
    socialMediaSchedules: Array.isArray(input.socialMediaSchedules) ? input.socialMediaSchedules : [],
    uploads: Array.isArray(input.uploads) ? input.uploads : [],
    activityLogs: Array.isArray(input.activityLogs) ? input.activityLogs : [],
    automationRuns: Array.isArray(input.automationRuns) ? input.automationRuns : [],
    automationRunPosts: Array.isArray(input.automationRunPosts) ? input.automationRunPosts : []
  };
}

function publicUser(user: StoredUser): UserProfile {
  const { passwordHash: _passwordHash, ...profile } = user;
  return profile;
}

function addBootstrapUsers(store: Store) {
  const needsManager = !store.users.some(user => user.role === "operations_manager" && user.isActive);
  let changed = false;

  for (const bootstrap of configuredBootstrapUsers()) {
    const index = store.users.findIndex(user => normalizeUsername(user.username) === bootstrap.username);
    if (index >= 0) {
      if (!needsManager && !bootstrap.passwordConfigured) continue;
      const existing = store.users[index];
      store.users[index] = {
        ...existing,
        username: bootstrap.username,
        fullName: bootstrap.fullName,
        email: bootstrap.email,
        role: bootstrap.role,
        isActive: true,
        passwordHash: hashPassword(bootstrap.password),
        updatedAt: nowIso()
      };
      changed = true;
      continue;
    }

    const timestamp = nowIso();
    store.users.push({
      id: "user_" + nanoid(12),
      username: bootstrap.username,
      fullName: bootstrap.fullName,
      email: bootstrap.email,
      role: bootstrap.role,
      isActive: true,
      passwordHash: hashPassword(bootstrap.password),
      createdAt: timestamp,
      updatedAt: timestamp
    });
    changed = true;
  }

  return changed;
}

async function writeStoreFile(store: Store) {
  if (useNetlifyBlobs) {
    const blobStore = await getBlobStore();
    await blobStore.setJSON("store", store);
    return;
  }

  await fs.mkdir(path.dirname(localStoreFile), { recursive: true });
  const temporaryFile = localStoreFile + "." + process.pid + "." + randomUUID() + ".tmp";
  await fs.writeFile(temporaryFile, JSON.stringify(store, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  try {
    await fs.rename(temporaryFile, localStoreFile);
  } catch (error) {
    await fs.unlink(temporaryFile).catch(() => undefined);
    throw error;
  }
}

async function readStoreFile() {
  if (useNetlifyBlobs) {
    const blobStore = await getBlobStore();
    return normalizeStore(await blobStore.get("store", { type: "json", consistency: "strong" }));
  }

  return normalizeStore(JSON.parse(await fs.readFile(localStoreFile, "utf8")));
}

function getBlobStore(): Promise<BlobStore> {
  blobStorePromise ??= import("@netlify/blobs")
    .then(({ getStore }) => getStore("agentic-that-publishing") as BlobStore);
  return blobStorePromise;
}

async function ensureStoreReady() {
  if (!storeReadyPromise) {
    storeReadyPromise = (async () => {
      if (!useNetlifyBlobs) await fs.mkdir(path.dirname(localStoreFile), { recursive: true });
      let store: Store;
      let mustWrite = false;
      try {
        store = await readStoreFile();
      } catch (error) {
        if (useNetlifyBlobs || (error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw new Error("Could not read local publish queue data: " + (error instanceof Error ? error.message : String(error)));
        }
        store = emptyStore();
        mustWrite = true;
      }
      if (useNetlifyBlobs && store.users.length === 0) mustWrite = true;
      if (addBootstrapUsers(store)) mustWrite = true;
      if (mustWrite) await writeStoreFile(store);
    })();
  }
  return storeReadyPromise;
}

async function readStore(): Promise<Store> {
  await ensureStoreReady();
  await storeMutationQueue;
  return readStoreFile();
}

async function mutateStore<T>(mutator: (store: Store) => T | Promise<T>) {
  await ensureStoreReady();
  const operation = storeMutationQueue.then(async () => {
    const store = await readStoreFile();
    const result = await mutator(store);
    await writeStoreFile(store);
    return result;
  });
  storeMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function localStorageHealth() {
  const store = await readStore();
  if (!useNetlifyBlobs) await fs.access(localStoreFile);
  return {
    path: useNetlifyBlobs ? "netlify-blobs://agentic-that-publishing/store" : localStoreFile,
    version: store.version,
    storage: useNetlifyBlobs ? "netlify-blobs" : "local-json"
  };
}

export async function logActivity(
  actorUserId: string | null | undefined,
  action: string,
  entityType: string,
  entityId: string | number | null | undefined,
  summary: string,
  metadata: Record<string, unknown> = {}
) {
  return mutateStore(store => {
    const actor = actorUserId ? store.users.find(user => user.id === actorUserId) : undefined;
    const log: ActivityLog = {
      id: "activity_" + nanoid(12),
      actorUserId: actorUserId || undefined,
      actorName: actor?.fullName,
      actorUsername: actor?.username,
      action,
      entityType,
      entityId: entityId === null || entityId === undefined ? undefined : String(entityId),
      summary,
      metadata: Object.keys(metadata).length ? metadata : undefined,
      createdAt: nowIso()
    };
    store.activityLogs.unshift(log);
    store.activityLogs = store.activityLogs.slice(0, 1000);
    return log;
  });
}

function assertUniqueUser(store: Store, username: string, email: string, exceptId?: string) {
  if (store.users.some(user => user.id !== exceptId && normalizeUsername(user.username) === username)) {
    throw new Error("That username is already in use.");
  }
  if (store.users.some(user => user.id !== exceptId && user.email?.toLowerCase() === email.toLowerCase())) {
    throw new Error("That email address is already in use.");
  }
}

function assertCanChangeManager(store: Store, existing: StoredUser, nextRole: UserRole, nextActive: boolean) {
  if (existing.role !== "operations_manager" || (nextRole === "operations_manager" && nextActive)) return;
  if (!store.users.some(user => user.id !== existing.id && user.role === "operations_manager" && user.isActive)) {
    throw new Error("At least one active operations manager must remain.");
  }
}

export async function listUserProfiles() {
  const store = await readStore();
  return store.users.map(publicUser).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getUserProfile(userId: string) {
  const store = await readStore();
  const user = store.users.find(item => item.id === userId);
  return user ? publicUser(user) : null;
}

export async function loginUser(username: string, password: string) {
  const normalized = normalizeUsername(username);
  const user = await mutateStore(store => {
    const index = store.users.findIndex(item => normalizeUsername(item.username) === normalized && item.isActive);
    if (index < 0 || !verifyPassword(password, store.users[index].passwordHash)) return null;
    const updated = { ...store.users[index], lastLoginAt: nowIso(), updatedAt: nowIso() };
    store.users[index] = updated;
    return publicUser(updated);
  });
  if (user) {
    await logActivity(user.id, "auth.login", "user_profile", user.id, user.fullName + " signed in.", { role: user.role });
  }
  return user;
}

export async function createUserProfile(input: CreateUserProfileInput, actorUserId?: string) {
  const user = await mutateStore(store => {
    const username = normalizeUsername(input.username);
    const email = normalizeEmail(input.email, username);
    assertUniqueUser(store, username, email);
    const timestamp = nowIso();
    const stored: StoredUser = {
      id: "user_" + nanoid(12),
      username,
      fullName: input.fullName.trim(),
      email,
      role: input.role,
      isActive: input.isActive ?? true,
      passwordHash: hashPassword(input.password),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    store.users.push(stored);
    return publicUser(stored);
  });
  await logActivity(actorUserId, "user.created", "user_profile", user.id, user.fullName + " was added as " + user.role + ".", { username: user.username, role: user.role });
  return user;
}

export async function updateUserProfile(userId: string, input: UpdateUserProfileInput, actorUserId?: string) {
  const user = await mutateStore(store => {
    const index = store.users.findIndex(item => item.id === userId);
    if (index < 0) return null;
    const existing = store.users[index];
    const username = input.username === undefined ? existing.username : normalizeUsername(input.username);
    const email = input.email === undefined ? existing.email! : normalizeEmail(input.email, username);
    const role = input.role ?? existing.role;
    const isActive = input.isActive ?? existing.isActive;
    assertUniqueUser(store, username, email, userId);
    assertCanChangeManager(store, existing, role, isActive);
    const updated: StoredUser = {
      ...existing,
      username,
      fullName: input.fullName?.trim() ?? existing.fullName,
      email,
      role,
      isActive,
      passwordHash: input.password ? hashPassword(input.password) : existing.passwordHash,
      updatedAt: nowIso()
    };
    store.users[index] = updated;
    return publicUser(updated);
  });
  if (user) {
    await logActivity(actorUserId, "user.updated", "user_profile", user.id, user.fullName + " profile was updated.", { username: user.username, role: user.role, isActive: user.isActive });
  }
  return user;
}

export async function deactivateUserProfile(userId: string, actorUserId?: string) {
  return updateUserProfile(userId, { isActive: false }, actorUserId);
}

export async function listActivityLogs(limit = 100) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 250);
  const store = await readStore();
  return [...store.activityLogs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, safeLimit);
}

async function insertPostStatusHistory(
  postId: string,
  oldStatus: UploadStatus | null,
  newStatus: UploadStatus,
  changeReason: string,
  changedAt = nowIso(),
  actorUserId?: string
) {
  await logActivity(actorUserId, "post.status_changed", "post", postId, changeReason, { oldStatus, newStatus, changedAt });
}

export async function createAutomationRun(trigger: AutomationRunTrigger, startedByUserId?: string) {
  return mutateStore(store => {
    const run: AutomationRunRecord = {
      id: "run_" + nanoid(12),
      trigger,
      status: "running",
      startedByUserId,
      startedAt: nowIso()
    };
    store.automationRuns.unshift(run);
    return run.id;
  });
}

export async function finishAutomationRun(
  automationRunId: string,
  status: Exclude<AutomationRunStatus, "running">,
  errorMessage?: string
) {
  await mutateStore(store => {
    const index = store.automationRuns.findIndex(run => run.id === automationRunId);
    if (index >= 0) {
      store.automationRuns[index] = { ...store.automationRuns[index], status, errorMessage, finishedAt: nowIso() };
    }
  });
}

export async function createAutomationRunPost(automationRunId: string, upload: PlatformUpload) {
  return mutateStore(store => {
    const post: AutomationRunPostRecord = {
      id: "run_post_" + nanoid(12),
      automationRunId,
      uploadId: upload.id,
      accountId: upload.accountId,
      platform: upload.platform,
      status: "processing",
      startedAt: nowIso()
    };
    store.automationRunPosts.unshift(post);
    return post.id;
  });
}

export async function finishAutomationRunPost(
  automationRunPostId: string,
  status: AutomationPostStatus,
  failureMessage?: string
) {
  await mutateStore(store => {
    const index = store.automationRunPosts.findIndex(post => post.id === automationRunPostId);
    if (index >= 0) {
      store.automationRunPosts[index] = { ...store.automationRunPosts[index], status, failureMessage, finishedAt: nowIso() };
    }
  });
}

export async function recoverInterruptedPublishingWork() {
  const recoveryMode = process.env.PUBLISH_QUEUE_INTERRUPTED_POST_RECOVERY?.trim().toLowerCase() === "retry"
    ? "retry"
    : "review";
  const recoveredAt = nowIso();

  return mutateStore(store => {
    let recoveredUploads = 0;
    let recoveredRuns = 0;

    store.uploads = store.uploads.map(upload => {
      if (upload.status !== "processing") return upload;
      recoveredUploads += 1;
      return {
        ...upload,
        status: recoveryMode === "retry" ? "queued" : "failed",
        failureReason: recoveryMode === "retry"
          ? undefined
          : "The companion stopped during publishing. Verify the platform before retrying to prevent a duplicate post.",
        updatedAt: recoveredAt,
      };
    });

    store.automationRuns = store.automationRuns.map(run => {
      if (run.status !== "running") return run;
      recoveredRuns += 1;
      return {
        ...run,
        status: "failed",
        finishedAt: recoveredAt,
        errorMessage: recoveryMode === "retry"
          ? "The companion stopped during publishing; unfinished posts were requeued."
          : "The companion stopped during publishing; verify the platform before retrying unfinished posts.",
      };
    });

    store.automationRunPosts = store.automationRunPosts.map(post => post.status === "processing"
      ? {
          ...post,
          status: "failed",
          finishedAt: recoveredAt,
          failureMessage: "The publishing companion stopped before completion was recorded.",
        }
      : post);

    return { recoveredUploads, recoveredRuns, recoveryMode };
  });
}

function scheduledTime(upload: PlatformUpload) {
  if (!upload.scheduledAt) return null;
  const timestamp = Date.parse(upload.scheduledAt);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function isUploadReadyForAutomation(upload: PlatformUpload, now = Date.now()) {
  if (upload.status !== "queued") return false;
  const scheduledAt = scheduledTime(upload);
  return scheduledAt === null ? !upload.scheduledAt : scheduledAt <= now;
}

export function isDueScheduledUpload(upload: PlatformUpload, now = Date.now()) {
  if (upload.status !== "queued" || !upload.scheduledAt) return false;
  const scheduledAt = scheduledTime(upload);
  return scheduledAt !== null && scheduledAt <= now;
}

export async function listPlatformAccounts(platform?: Platform) {
  const store = await readStore();
  return store.accounts
    .filter(account => !platform || account.platform === platform)
    .sort((a, b) => a.platform.localeCompare(b.platform) || a.displayName.localeCompare(b.displayName));
}

export async function getPlatformAccount(accountId: string) {
  const store = await readStore();
  return store.accounts.find(account => account.id === accountId) ?? null;
}

export async function getPublishingAccount(accountId: string): Promise<PublishingAccount | null> {
  return getPlatformAccount(accountId);
}

export async function createPlatformAccount(platform: Platform, input: UpsertPlatformAccountInput) {
  return mutateStore(store => {
    const duplicate = store.accounts.some(account => account.platform === platform && account.handle.toLowerCase() === input.handle.toLowerCase());
    if (duplicate) throw new Error(platformLabels[platform] + " account " + input.handle + " already exists.");
    const timestamp = nowIso();
    const account: PlatformAccount = {
      id: "account_" + nanoid(12),
      platform,
      displayName: input.displayName,
      handle: input.handle,
      loginIdentifier: input.loginIdentifier ?? "",
      credentialConfigured: false,
      enabled: input.enabled ?? true,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    store.accounts.push(account);
    return account;
  });
}

export async function updatePlatformAccount(accountId: string, input: UpsertPlatformAccountInput) {
  return mutateStore(store => {
    const index = store.accounts.findIndex(account => account.id === accountId);
    if (index < 0) return null;
    const existing = store.accounts[index];
    const duplicate = store.accounts.some(account => account.id !== accountId && account.platform === existing.platform && account.handle.toLowerCase() === input.handle.toLowerCase());
    if (duplicate) throw new Error(platformLabels[existing.platform] + " account " + input.handle + " already exists.");
    const updated: PlatformAccount = {
      ...existing,
      displayName: input.displayName,
      handle: input.handle,
      loginIdentifier: input.loginIdentifier ?? "",
      credentialConfigured: existing.credentialConfigured,
      enabled: input.enabled ?? existing.enabled,
      updatedAt: nowIso()
    };
    store.accounts[index] = updated;
    return updated;
  });
}

export async function updatePlatformAccountCredentialState(accountId: string, configured: boolean) {
  return mutateStore(store => {
    const index = store.accounts.findIndex(account => account.id === accountId);
    if (index < 0) return null;
    const updated: PlatformAccount = {
      ...store.accounts[index],
      credentialConfigured: configured,
      updatedAt: nowIso()
    };
    store.accounts[index] = updated;
    return updated;
  });
}

export async function deletePlatformAccount(accountId: string) {
  return mutateStore(store => {
    const existing = store.accounts.find(account => account.id === accountId);
    if (!existing) return null;
    if (store.uploads.some(upload => upload.accountId === accountId)) {
      throw new Error("This account has post history and cannot be deleted. Disable it instead.");
    }
    store.accounts = store.accounts.filter(account => account.id !== accountId);
    store.socialMediaSchedules = store.socialMediaSchedules.filter(item => item.accountId !== accountId);
    return existing;
  });
}

function normalizeEndDate(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function nextNumericId(items: Array<{ id: number }>) {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}

function normalizeScheduleId(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const scheduleId = Number(value);
  if (!Number.isInteger(scheduleId) || scheduleId <= 0) throw new Error("Selected schedule is invalid.");
  return scheduleId;
}

function localDateAt(date: Date, time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0);
}

function endOfLocalDate(dateValue?: string) {
  if (!dateValue) return null;
  const [year, month, day] = dateValue.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 23, 59, 59, 999);
}

function localDateFromValue(dateValue?: string) {
  if (!dateValue) return null;
  const [year, month, day] = dateValue.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function validateScheduleInput(input: UpsertPublishingScheduleInput) {
  if (input.frequency === "custom" && input.customCronExpression && !nodeCron.validate(input.customCronExpression)) {
    throw new Error("Custom schedule cron expression is invalid.");
  }
  if (input.frequency === "onetime") {
    const runDate = localDateFromValue(normalizeEndDate(input.endDate));
    if (!runDate) throw new Error("One-time schedules need a schedule date.");
    if (localDateAt(runDate, input.time).getTime() <= Date.now()) {
      throw new Error("One-time schedules must be set to a future date and time.");
    }
  }
}

export async function listPublishingSchedules() {
  const store = await readStore();
  return [...store.schedules].sort((a, b) => a.id - b.id);
}

export async function listSocialMediaSchedules() {
  const store = await readStore();
  return store.uploads
    .filter(upload => upload.scheduleId)
    .map((upload, index) => ({
      id: index + 1,
      scheduleId: upload.scheduleId!,
      accountId: upload.accountId,
      platform: upload.platform,
      createdAt: upload.uploadedAt,
      updatedAt: upload.updatedAt
    }))
    .sort((a, b) => a.id - b.id);
}

export async function createPublishingSchedule(input: UpsertPublishingScheduleInput) {
  validateScheduleInput(input);
  return mutateStore(store => {
    const timestamp = nowIso();
    const schedule: PublishingSchedule = {
      id: nextNumericId(store.schedules),
      name: input.name.trim(),
      time: input.time,
      frequency: input.frequency,
      endDate: normalizeEndDate(input.endDate),
      status: input.status ?? "active",
      customCronExpression: input.frequency === "custom" ? input.customCronExpression?.trim() : undefined,
      lastRunAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    store.schedules.push(schedule);
    return schedule;
  });
}

export async function updatePublishingSchedule(scheduleId: number, input: UpsertPublishingScheduleInput) {
  validateScheduleInput(input);
  return mutateStore(store => {
    const index = store.schedules.findIndex(schedule => schedule.id === scheduleId);
    if (index < 0) return null;
    const existing = store.schedules[index];
    const timestamp = nowIso();
    const updated: PublishingSchedule = {
      ...existing,
      name: input.name.trim(),
      time: input.time,
      frequency: input.frequency,
      endDate: normalizeEndDate(input.endDate),
      status: input.status ?? existing.status,
      customCronExpression: input.frequency === "custom" ? input.customCronExpression?.trim() : undefined,
      lastRunAt: timestamp,
      updatedAt: timestamp
    };
    store.schedules[index] = updated;
    return updated;
  });
}

export async function deletePublishingSchedule(scheduleId: number) {
  return mutateStore(store => {
    const existing = store.schedules.find(schedule => schedule.id === scheduleId);
    if (!existing) return null;
    if (store.uploads.some(upload => upload.scheduleId === scheduleId)) {
      throw new Error("Remove this schedule from posts before deleting it.");
    }
    store.schedules = store.schedules.filter(schedule => schedule.id !== scheduleId);
    store.socialMediaSchedules = store.socialMediaSchedules.filter(item => item.scheduleId !== scheduleId);
    return existing;
  });
}

function daysBetween(start: Date, end: Date) {
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  return Math.floor((endDay - startDay) / 86_400_000);
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function scheduleDateInMonth(year: number, month: number, anchorDay: number, time: string) {
  const day = Math.min(anchorDay, lastDayOfMonth(year, month));
  return localDateAt(new Date(year, month, day), time);
}

function previousScheduleOccurrence(schedule: PublishingSchedule, now: Date) {
  const createdAt = new Date(schedule.createdAt);
  const anchor = Number.isFinite(createdAt.getTime()) ? createdAt : now;

  if (schedule.frequency === "custom") {
    if (!schedule.customCronExpression || !nodeCron.validate(schedule.customCronExpression)) return null;
    const currentMinute = new Date(now);
    currentMinute.setSeconds(0, 0);
    const task = nodeCron.createTask(schedule.customCronExpression, () => undefined);
    try {
      return task.match(currentMinute) ? currentMinute : null;
    } finally {
      void task.destroy();
    }
  }

  if (schedule.frequency === "onetime") {
    const runDate = localDateFromValue(schedule.endDate);
    if (!runDate) return null;
    const occurrence = localDateAt(runDate, schedule.time);
    return occurrence.getTime() <= now.getTime() ? occurrence : null;
  }

  if (schedule.frequency === "daily") {
    const today = localDateAt(now, schedule.time);
    if (today.getTime() <= now.getTime()) return today;
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return localDateAt(yesterday, schedule.time);
  }

  if (schedule.frequency === "weekly") {
    const dayDiff = (now.getDay() - anchor.getDay() + 7) % 7;
    const candidateDay = new Date(now);
    candidateDay.setDate(candidateDay.getDate() - dayDiff);
    const candidate = localDateAt(candidateDay, schedule.time);
    if (candidate.getTime() <= now.getTime()) return candidate;
    candidateDay.setDate(candidateDay.getDate() - 7);
    return localDateAt(candidateDay, schedule.time);
  }

  if (schedule.frequency === "biweekly") {
    const elapsedDays = Math.max(0, daysBetween(anchor, now));
    const cycleStart = elapsedDays - (elapsedDays % 14);
    const candidateDay = new Date(anchor);
    candidateDay.setDate(candidateDay.getDate() + cycleStart);
    const candidate = localDateAt(candidateDay, schedule.time);
    if (candidate.getTime() <= now.getTime()) return candidate;
    candidateDay.setDate(candidateDay.getDate() - 14);
    return localDateAt(candidateDay, schedule.time);
  }

  if (schedule.frequency === "monthly") {
    const candidate = scheduleDateInMonth(now.getFullYear(), now.getMonth(), anchor.getDate(), schedule.time);
    if (candidate.getTime() <= now.getTime()) return candidate;
    const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return scheduleDateInMonth(previousMonth.getFullYear(), previousMonth.getMonth(), anchor.getDate(), schedule.time);
  }

  const candidate = scheduleDateInMonth(now.getFullYear(), anchor.getMonth(), anchor.getDate(), schedule.time);
  if (candidate.getTime() <= now.getTime()) return candidate;
  return scheduleDateInMonth(now.getFullYear() - 1, anchor.getMonth(), anchor.getDate(), schedule.time);
}

function isScheduleDue(schedule: PublishingSchedule, now = new Date()) {
  if (schedule.status !== "active") return false;
  const occurrence = previousScheduleOccurrence(schedule, now);
  if (!occurrence) return false;
  const endAt = endOfLocalDate(schedule.endDate);
  if (endAt && occurrence.getTime() > endAt.getTime()) return false;
  const lastRunAt = schedule.lastRunAt ? Date.parse(schedule.lastRunAt) : null;
  return !lastRunAt || !Number.isFinite(lastRunAt) || occurrence.getTime() > lastRunAt;
}

function dueScheduleIds(store: Store, now = new Date()) {
  return new Set(store.schedules.filter(schedule => isScheduleDue(schedule, now)).map(schedule => schedule.id));
}

function isDueByPostSchedule(upload: PlatformUpload, account: PlatformAccount | undefined, dueIds: Set<number>) {
  if (!account?.enabled || !upload.scheduleId) return false;
  if (upload.status !== "queued" || upload.scheduledAt) return false;
  return dueIds.has(upload.scheduleId);
}

function isStoreUploadReadyForAutomation(
  store: Store,
  upload: PlatformUpload,
  mode: AutomationInputMode,
  now = Date.now(),
  scheduledIds = dueScheduleIds(store, new Date(now))
) {
  const account = store.accounts.find(item => item.id === upload.accountId);
  if (!account?.enabled) return false;
  if (upload.scheduleId) return isDueByPostSchedule(upload, account, scheduledIds);
  if (mode === "scheduledOnly") return isDueScheduledUpload(upload, now);
  return isUploadReadyForAutomation(upload, now);
}

export async function listDueScheduleIdsWithQueuedUploads() {
  const store = await readStore();
  const dueIds = dueScheduleIds(store);
  const accountById = new Map(store.accounts.map(account => [account.id, account]));
  const ids = new Set<number>();
  for (const upload of store.uploads) {
    const account = accountById.get(upload.accountId);
    if (upload.scheduleId && isDueByPostSchedule(upload, account, dueIds)) ids.add(upload.scheduleId);
  }
  return [...ids];
}

export async function markSchedulesTriggered(scheduleIds: number[], triggeredAt = nowIso()) {
  if (scheduleIds.length === 0) return [];
  const uniqueIds = new Set(scheduleIds);
  return mutateStore(store => {
    const updated: PublishingSchedule[] = [];
    store.schedules = store.schedules.map(schedule => {
      if (!uniqueIds.has(schedule.id)) return schedule;
      const nextSchedule = { ...schedule, lastRunAt: triggeredAt, updatedAt: triggeredAt };
      updated.push(nextSchedule);
      return nextSchedule;
    });
    return updated;
  });
}

export async function dashboardSummary(): Promise<DashboardSummary> {
  const store = await readStore();
  const uploads = [...store.uploads].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  const scheduledIds = dueScheduleIds(store);
  return {
    totalUploads: uploads.length,
    readyForAutomation: uploads.filter(upload => isStoreUploadReadyForAutomation(store, upload, "ready", Date.now(), scheduledIds)).length,
    processing: uploads.filter(upload => upload.status === "processing").length,
    posted: uploads.filter(upload => upload.status === "posted").length,
    failed: uploads.filter(upload => upload.status === "failed").length,
    channels: platforms.map(platform => {
      const channelUploads = uploads.filter(upload => upload.platform === platform);
      return {
        platform,
        label: platformLabels[platform],
        handle: platformHandles[platform],
        total: channelUploads.length,
        queued: channelUploads.filter(upload => upload.status === "queued").length,
        latestUploadAt: channelUploads[0]?.uploadedAt ?? null
      };
    })
  };
}

export async function listUploads(platform?: Platform, accountId?: string) {
  const store = await readStore();
  return store.uploads
    .filter(upload => (!platform || upload.platform === platform) && (!accountId || upload.accountId === accountId))
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export async function createUpload(accountId: string, file: StoredFileInput, actorUserId?: string) {
  const upload = await mutateStore(store => {
    const account = store.accounts.find(item => item.id === accountId);
    if (!account) throw new Error("Publishing account not found.");
    if (!account.enabled) throw new Error("This publishing account is disabled.");
    if (file.scheduleId && !store.schedules.some(schedule => schedule.id === file.scheduleId)) {
      throw new Error("Selected schedule was not found.");
    }
    const timestamp = nowIso();
    const id = "upload_" + nanoid(12);
    const extension = path.extname(file.originalName).replace(".", "").toLowerCase() || "unknown";
    const displayTitle = file.postFormat === "text"
      ? `Text post: ${file.caption.replace(/\s+/g, " ").slice(0, 72)}${file.caption.length > 72 ? "…" : ""}`
      : file.title || file.caption;
    const created: PlatformUpload = {
      id,
      platform: account.platform,
      postFormat: file.postFormat,
      accountId,
      originalName: file.originalName,
      fileName: file.fileName,
      mimeType: file.mimeType || "application/octet-stream",
      extension,
      size: file.size,
      url: file.url,
      title: displayTitle,
      caption: file.caption,
      status: "queued",
      attemptCount: 0,
      uploadedAt: timestamp,
      updatedAt: timestamp,
      scheduledAt: file.scheduledAt || undefined,
      scheduleId: file.scheduleId,
      createdByUserId: actorUserId,
      scheduledByUserId: file.scheduledAt || file.scheduleId ? actorUserId : undefined,
      lastUpdatedByUserId: actorUserId,
      automation: createAutomation(account.platform, accountId, id, file.url)
    };
    store.uploads.unshift(created);
    return created;
  });
  await insertPostStatusHistory(upload.id, null, "queued", "Post created", upload.uploadedAt, actorUserId);
  return upload;
}

export async function updateUploadStatus(
  uploadId: string,
  status: UploadStatus,
  changeReason = "Post status updated",
  actorUserId?: string
) {
  let oldStatus: UploadStatus | null = null;
  let statusChanged = false;
  const changedAt = nowIso();
  const updated = await mutateStore(store => {
    const index = store.uploads.findIndex(upload => upload.id === uploadId);
    if (index < 0) return null;
    oldStatus = store.uploads[index].status;
    statusChanged = oldStatus !== status;
    const existing = store.uploads[index];
    const next: PlatformUpload = {
      ...existing,
      status,
      failureReason: status === "failed" ? changeReason : undefined,
      attemptCount: status === "processing" ? (existing.attemptCount ?? 0) + 1 : existing.attemptCount ?? 0,
      lastAttemptAt: status === "processing" ? changedAt : existing.lastAttemptAt,
      postedAt: status === "posted" ? changedAt : existing.postedAt,
      lastUpdatedByUserId: actorUserId ?? existing.lastUpdatedByUserId,
      updatedAt: changedAt,
    };
    store.uploads[index] = next;
    return next;
  });
  if (updated && statusChanged) {
    await insertPostStatusHistory(uploadId, oldStatus, status, changeReason, changedAt, actorUserId);
  }
  return updated;
}

export async function deleteUpload(uploadId: string) {
  return mutateStore(store => {
    const existing = store.uploads.find(upload => upload.id === uploadId);
    if (!existing) return null;
    store.uploads = store.uploads.filter(upload => upload.id !== uploadId);
    return existing;
  });
}

export async function updateUploadDetails(uploadId: string, input: UpdateUploadDetailsInput, actorUserId?: string) {
  const selectedScheduleId = input.scheduleId === null ? undefined : normalizeScheduleId(input.scheduleId);
  let oldStatus: UploadStatus | null = null;
  let statusChanged = false;
  const changedAt = nowIso();
  const scheduleTouched = input.scheduledAt !== undefined || input.scheduleId !== undefined;

  const updatedUpload = await mutateStore(store => {
    const index = store.uploads.findIndex(upload => upload.id === uploadId);
    if (index < 0) return null;
    const existing = store.uploads[index];
    if (existing.status === "processing" || existing.status === "posted") {
      throw new Error("Cannot edit a " + existing.status + " post.");
    }
    let accountId = existing.accountId;
    if (input.accountId && input.accountId !== accountId) {
      const account = store.accounts.find(item => item.id === input.accountId);
      if (!account || account.platform !== existing.platform) throw new Error("Choose an account from the same platform.");
      if (!account.enabled) throw new Error("Choose an enabled publishing account.");
      accountId = account.id;
    }
    if (selectedScheduleId && !store.schedules.some(schedule => schedule.id === selectedScheduleId)) {
      throw new Error("Selected schedule was not found.");
    }
    const nextScheduledAt = input.scheduledAt === null || selectedScheduleId ? undefined : input.scheduledAt ?? existing.scheduledAt;
    const nextScheduleId = input.scheduledAt ? undefined : input.scheduleId === undefined ? existing.scheduleId : selectedScheduleId;
    oldStatus = existing.status;
    statusChanged = oldStatus !== "queued";
    const updated: PlatformUpload = {
      ...existing,
      accountId,
      title: input.title?.trim() || input.caption.trim(),
      caption: input.caption.trim(),
      scheduledAt: nextScheduledAt,
      scheduleId: nextScheduleId,
      scheduledByUserId: scheduleTouched ? actorUserId : existing.scheduledByUserId,
      lastUpdatedByUserId: actorUserId,
      status: "queued",
      failureReason: undefined,
      updatedAt: changedAt,
      automation: createAutomation(existing.platform, accountId, existing.id, existing.url)
    };
    store.uploads[index] = updated;
    return updated;
  });

  if (updatedUpload && statusChanged) {
    await insertPostStatusHistory(uploadId, oldStatus, "queued", "Post details updated and requeued", changedAt, actorUserId);
  }
  return updatedUpload;
}

export async function listDueScheduledUploads() {
  const store = await readStore();
  const scheduledIds = dueScheduleIds(store);
  return store.uploads
    .filter(upload => isStoreUploadReadyForAutomation(store, upload, "scheduledOnly", Date.now(), scheduledIds))
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export async function automationInput(platform?: Platform, mode: AutomationInputMode = "ready"): Promise<AutomationInput> {
  const store = await readStore();
  const scheduledIds = dueScheduleIds(store);
  const uploads = store.uploads
    .filter(upload => !platform || upload.platform === platform)
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  const queued = uploads.filter(upload => isStoreUploadReadyForAutomation(store, upload, mode, Date.now(), scheduledIds));
  const channels = Object.fromEntries(platforms.map(channel => [
    channel,
    platform && platform !== channel ? [] : queued.filter(upload => upload.platform === channel)
  ])) as AutomationInput["channels"];
  return {
    generatedAt: nowIso(),
    officialPlatformApisRequired: false,
    intakeSource: "tinitiatebot_autopost",
    channels
  };
}
