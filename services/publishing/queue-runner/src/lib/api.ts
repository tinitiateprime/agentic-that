import type {
  ActivityLog,
  AutomationInput,
  ContentSubmission,
  CreateUserProfileInput,
  DashboardSummary,
  LoginInput,
  Platform,
  PlatformAccount,
  PlatformUpload,
  PlatformOptions,
  PostFormat,
  PublishingSchedule,
  SocialMediaSchedule,
  UpdateUploadDetailsInput,
  UpdateUploadStatusInput,
  UpdateUserProfileInput,
  UpsertPlatformAccountInput,
  UpsertPublishingScheduleInput,
  UnifiedPostDestinationInput,
  UserProfile
} from "../../shared/schema.ts";
import { isPublishingExtensionActive, publishingAssetUrl, publishingFetch } from "../../../../../lib/publishing-endpoint.ts";
import { detectPublishingExtension } from "../../../../../lib/publishing-extension-bridge.ts";
import { getClientServiceToken } from "../../../../../src/platform/client-service-token.js";

let authToken: string | null = null;
let centralIdentitySeed: string | null = null;

export type AuthResponse = {
  user: UserProfile;
  token: string;
};

export type ContentPreflightApiIssue = {
  code: string;
  severity: "block" | "warning";
  message: string;
  accountId?: string;
};

export class ContentPreflightApiError extends Error {
  readonly code: "CONTENT_PREFLIGHT_BLOCKED" | "CONTENT_PREFLIGHT_WARNINGS";
  readonly issues: ContentPreflightApiIssue[];

  constructor(payload: { message?: string; code: "CONTENT_PREFLIGHT_BLOCKED" | "CONTENT_PREFLIGHT_WARNINGS"; issues?: ContentPreflightApiIssue[] }) {
    super(payload.message || "Content pre-flight check failed.");
    this.name = "ContentPreflightApiError";
    this.code = payload.code;
    this.issues = payload.issues ?? [];
  }
}

export type PublishingSafetyApiIssue = {
  accountId: string;
  platform: Platform;
  accountName: string;
  requestedAt: string;
  earliestAt: string;
  message: string;
};

export type MediaPreparationProgress = {
  phase: "uploading" | "finalizing";
  loaded: number;
  total: number;
  percent: number;
};

type PublishingHealth = {
  ok: boolean;
  automationReady: boolean;
  automationRunning: boolean;
  chromeInstalled?: boolean;
  embeddedBrowser?: boolean;
  engines?: {
    companion: { available: boolean };
    external_browser: { available: boolean };
  };
  extensionBridge?: boolean;
  platforms?: Platform[];
};

export type PublishingWorkspaceSnapshot = {
  health: PublishingHealth & { transport: "central" | "desktop" | "extension" | "direct" };
  uploads: PlatformUpload[];
  submissions: ContentSubmission[];
  accounts: PlatformAccount[];
  schedules: PublishingSchedule[];
  users: UserProfile[];
  activityLogs: ActivityLog[];
};

type StagedUploadSession = {
  id: string;
  offset: number;
  chunkSize: number;
  uploadStrategy?: "signed_parts";
};

type SignedUploadPart = {
  signedUrl: string;
  index: number;
  offset: number;
  byteSize: number;
};

export class PublishingSafetyApiError extends Error {
  readonly code = "PUBLISHING_SAFETY_SCHEDULE" as const;
  readonly issues: PublishingSafetyApiIssue[];

  constructor(payload: { message?: string; issues?: PublishingSafetyApiIssue[] }) {
    super(payload.message || "The selected publishing time is inside an account safety window.");
    this.name = "PublishingSafetyApiError";
    this.issues = payload.issues ?? [];
  }
}

class PublishingApiRequestError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(message: string, status: number, path: string) {
    super(message);
    this.name = "PublishingApiRequestError";
    this.status = status;
    this.path = path;
  }
}

function isLegacyMissingRoute(error: unknown) {
  return error instanceof PublishingApiRequestError && error.status === 404;
}

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function setCentralAuthToken(token: string | null) {
  centralIdentitySeed = token;
  authToken = token;
}

function centralPublishingPath(path: string) {
  const normalized = path.startsWith("/api/") ? path.slice(4) : `/${path.replace(/^\//, "")}`;
  return `/api/publishing${normalized}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (centralIdentitySeed) {
    authToken = await getClientServiceToken("publishing", centralIdentitySeed);
  }
  if (authToken) {
    headers.set("Authorization", `Bearer ${authToken}`);
  }

  let response: Response;
  try {
    response = centralIdentitySeed
      ? await fetch(centralPublishingPath(path), { ...init, headers, credentials: "same-origin" })
      : await publishingFetch(path, { ...init, headers });
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` (${error.message})` : "";
    throw new Error(`Publish Queue Runner is unavailable. Confirm the publishing service is running and try again.${detail}`);
  }

  if (!response.ok) {
    const payload = await response.text().catch(() => "");
    const isJson = response.headers.get("content-type")?.includes("application/json");
    let message = isJson || !payload.trim()
      ? payload.trim() || `Request failed with ${response.status}`
      : `The publishing API returned ${response.status} instead of JSON. Refresh the page or check the service connection.`;
    try {
      const error = JSON.parse(payload) as {
        message?: string;
        code?: string;
        issues?: ContentPreflightApiIssue[] | PublishingSafetyApiIssue[];
      };
      message = error?.message ?? message;
      if (error.code === "CONTENT_PREFLIGHT_BLOCKED" || error.code === "CONTENT_PREFLIGHT_WARNINGS") {
        throw new ContentPreflightApiError({
          message,
          code: error.code,
          issues: error.issues as ContentPreflightApiIssue[] | undefined,
        });
      }
      if (error.code === "PUBLISHING_SAFETY_SCHEDULE") {
        throw new PublishingSafetyApiError({
          message,
          issues: error.issues as PublishingSafetyApiIssue[] | undefined,
        });
      }
    } catch (error) {
      if (error instanceof ContentPreflightApiError || error instanceof PublishingSafetyApiError) throw error;
      // Keep the plain response text when the server did not return JSON.
    }
    throw new PublishingApiRequestError(message, response.status, path);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function mediaProgress(phase: MediaPreparationProgress["phase"], loaded: number, total: number): MediaPreparationProgress {
  const boundedLoaded = Math.max(0, Math.min(loaded, total));
  return {
    phase,
    loaded: boundedLoaded,
    total,
    percent: total > 0 ? Math.min(100, Math.round((boundedLoaded / total) * 100)) : 100,
  };
}

function retryableUploadError(error: unknown) {
  return !(error instanceof PublishingApiRequestError) || error.status === 408 || error.status === 409 || error.status === 429 || error.status >= 500;
}

async function retryUploadStep<T>(operation: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!retryableUploadError(error) || attempt === attempts - 1) throw error;
      await new Promise(resolve => globalThis.setTimeout(resolve, 600 * (2 ** attempt)));
    }
  }
  throw lastError;
}

function uploadSignedMediaPart(
  signedUrl: string,
  body: Blob,
  mimeType: string,
  onProgress: (loaded: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(signedUrl);
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
      if (parsed.username || parsed.password || (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local))) {
        throw new Error("invalid");
      }
    } catch {
      reject(new Error("The private media upload URL is invalid."));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", parsed.toString(), true);
    xhr.timeout = 180_000;
    xhr.setRequestHeader("Content-Type", mimeType || "application/octet-stream");
    xhr.setRequestHeader("Cache-Control", "max-age=3600");
    xhr.setRequestHeader("X-Upsert", "true");
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress(Math.min(event.loaded, body.size));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(body.size);
        resolve();
        return;
      }
      const detail = String(xhr.responseText || "").trim().slice(0, 400);
      reject(new Error(detail || `Private media upload failed (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("The private media upload connection was interrupted."));
    xhr.ontimeout = () => reject(new Error("The private media upload timed out."));
    xhr.onabort = () => reject(new Error("The private media upload was cancelled."));
    xhr.send(body);
  });
}

async function uploadStagedFile(
  file: File,
  session: StagedUploadSession,
  onProgress?: (progress: MediaPreparationProgress) => void,
) {
  const maximumChunkSize = session.uploadStrategy === "signed_parts" ? 5 * 1024 * 1024 : 2 * 1024 * 1024;
  const chunkSize = Math.min(maximumChunkSize, Math.max(64 * 1024, session.chunkSize || maximumChunkSize));
  let offset = session.offset;
  onProgress?.(mediaProgress("uploading", offset, file.size));
  while (offset < file.size) {
    if (session.uploadStrategy === "signed_parts") {
      const batchStart = offset;
      const batch = Array.from({ length: 4 }, (_, batchIndex) => {
        const partOffset = batchStart + batchIndex * chunkSize;
        if (partOffset >= file.size) return null;
        const chunk = file.slice(partOffset, Math.min(file.size, partOffset + chunkSize));
        return { index: Math.floor(partOffset / chunkSize), offset: partOffset, chunk };
      }).filter((part): part is { index: number; offset: number; chunk: Blob } => Boolean(part));
      const requestedParts = batch.map(({ index, offset: partOffset, chunk }) => ({
        index,
        offset: partOffset,
        byteSize: chunk.size,
      }));
      const authorizedParts = await retryUploadStep(() => request<SignedUploadPart[]>(`/api/staged-uploads/${session.id}/parts/authorize`, {
        method: "POST",
        body: JSON.stringify({ parts: requestedParts }),
      }));
      if (!Array.isArray(authorizedParts) || authorizedParts.length !== batch.length) {
        throw new Error("The server returned an invalid private media upload batch.");
      }
      const authorizedByIndex = new Map(authorizedParts.map(part => [part.index, part]));
      const uploadedByPart = new Map(batch.map(part => [part.index, 0]));
      const uploadResults = await Promise.allSettled(batch.map(async ({ index, offset: partOffset, chunk }) => {
        const part = authorizedByIndex.get(index);
        if (!part) throw new Error("The server omitted a private media upload authorization.");
        if (part.index !== index || part.offset !== partOffset || part.byteSize !== chunk.size || !part.signedUrl) {
          throw new Error("The server returned an invalid private media upload authorization.");
        }
        await retryUploadStep(() => uploadSignedMediaPart(part.signedUrl, chunk, file.type, loaded => {
          uploadedByPart.set(index, loaded);
          const batchLoaded = [...uploadedByPart.values()].reduce((total, value) => total + value, 0);
          onProgress?.(mediaProgress("uploading", batchStart + batchLoaded, file.size));
        }));
      }));
      const failedUpload = uploadResults.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failedUpload) throw failedUpload.reason;
      const result = await retryUploadStep(() => request<{ offset: number }>(`/api/staged-uploads/${session.id}/parts/complete`, {
        method: "POST",
        body: JSON.stringify({ parts: requestedParts }),
      }));
      if (!Number.isInteger(result.offset) || result.offset <= offset) {
        throw new Error("The server returned an invalid direct upload offset.");
      }
      offset = result.offset;
      onProgress?.(mediaProgress("uploading", offset, file.size));
    } else {
      const chunk = file.slice(offset, Math.min(file.size, offset + chunkSize));
      const result = await request<{ offset: number }>(`/api/staged-uploads/${session.id}/chunks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Upload-Offset": String(offset),
        },
        body: await chunk.arrayBuffer(),
      });
      if (!Number.isInteger(result.offset) || result.offset <= offset) {
        throw new Error("The companion returned an invalid upload offset.");
      }
      offset = result.offset;
      onProgress?.(mediaProgress("uploading", offset, file.size));
    }
  }
  onProgress?.(mediaProgress("finalizing", file.size, file.size));
}

async function mediaBlob(fileName: string) {
  if (centralIdentitySeed) authToken = await getClientServiceToken("publishing", centralIdentitySeed);
  const headers = new Headers();
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
  const response = centralIdentitySeed
    ? await fetch(`/api/publishing/media/${encodeURIComponent(fileName)}`, { headers, credentials: "same-origin" })
    : await publishingFetch(`/api/media/${encodeURIComponent(fileName)}`, { headers });
  if (!response.ok) throw new Error(response.status === 404 ? "Publishing media is unavailable." : "Unable to load publishing media.");
  return response.blob();
}

export function assetUrl(url: string, options: { compact?: boolean; controls?: boolean } = {}) {
  return publishingAssetUrl(url, options);
}

async function publishingHealth(): Promise<PublishingWorkspaceSnapshot["health"]> {
  const health = await request<PublishingHealth>("/api/health");
  if (!centralIdentitySeed && isPublishingExtensionActive() && !health.extensionBridge) {
    throw new Error("Restart Start Publishing Companion.cmd to load the extension-compatible publishing service.");
  }
  if (centralIdentitySeed) return { ...health, transport: "central" };
  const bridge = await detectPublishingExtension();
  return {
    ...health,
    transport: bridge?.version === "desktop"
      ? "desktop"
      : isPublishingExtensionActive()
        ? "extension"
        : "direct",
  };
}

export const api = {
  media: mediaBlob,
  health: publishingHealth,

  workspaceSnapshot: async (includeUsers = false): Promise<PublishingWorkspaceSnapshot> => {
    if (centralIdentitySeed) {
      const snapshot = await request<Omit<PublishingWorkspaceSnapshot, "health"> & { health: PublishingHealth }>("/api/workspace-snapshot");
      return { ...snapshot, health: { ...snapshot.health, transport: "central" } };
    }
    const [health, uploads, submissions, accounts, schedules] = await Promise.all([
      publishingHealth(),
      request<PlatformUpload[]>("/api/uploads"),
      request<ContentSubmission[]>("/api/submissions"),
      request<PlatformAccount[]>("/api/accounts"),
      request<PublishingSchedule[]>("/api/schedules"),
    ]);
    const [users, activityLogs] = includeUsers
      ? await Promise.all([
        request<UserProfile[]>("/api/users"),
        request<ActivityLog[]>("/api/activity-logs?limit=100"),
      ])
      : [[], []];
    return { health, uploads, submissions, accounts, schedules, users, activityLogs };
  },

  assessPublishingSafety: async (postFormat: PostFormat, destinations: UnifiedPostDestinationInput[]) => {
    try {
      return await request<{
        allowed: boolean;
        issues: PublishingSafetyApiIssue[];
        assessments: Array<{
          accountId: string;
          platform: Platform;
          allowed: boolean;
          requestedAt: string;
          earliestAt: string;
        }>;
      }>("/api/publishing-safety/assess", {
        method: "POST",
        body: JSON.stringify({ postFormat, destinations }),
      });
    } catch (error) {
      // Public Companion 1.3.0 predates the separate safety-assessment route.
      // Its scheduling endpoint still performs the content checks it supports,
      // so allow that endpoint to decide until the signed update is installed.
      if (isLegacyMissingRoute(error)) {
        return { allowed: true, issues: [], assessments: [] };
      }
      throw error;
    }
  },

  authorizePublishing: async () => {
    try {
      return await request<{ granted: boolean; message: string }>("/api/automation/consent", {
        method: "POST",
      });
    } catch (error) {
      // Companion 1.3.0 has no desktop-consent handshake. Preserve its existing
      // scheduling flow while newer Companions continue to require consent.
      if (isLegacyMissingRoute(error)) {
        return {
          granted: true,
          message: "Publishing authorization is managed by this Companion version.",
        };
      }
      throw error;
    }
  },

  login: (payload: LoginInput) =>
    request<AuthResponse>("/api/auth/login", { method: "POST", body: JSON.stringify(payload) }),

  platformStatus: (token: string) =>
    request<{ configured: boolean; username: string; workspaceId: string }>("/api/auth/platform/status", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),

  setupPlatformManager: (token: string, password: string) =>
    request<AuthResponse>("/api/auth/platform/setup", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    }),

  loginPlatformManager: (token: string, password: string) =>
    request<AuthResponse>("/api/auth/platform/login", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    }),

  me: () => request<UserProfile>("/api/auth/me"),

  dashboard: () => request<DashboardSummary>("/api/dashboard"),

  submissions: () => request<ContentSubmission[]>("/api/submissions"),
  
  uploads: (platform?: Platform, accountId?: string) => {
    const query = new URLSearchParams();
    if (platform) query.set("platform", platform);
    if (accountId) query.set("accountId", accountId);
    return request<PlatformUpload[]>(`/api/uploads${query.size ? `?${query}` : ""}`);
  },
  
  updateUploadStatus: (id: string, payload: UpdateUploadStatusInput) =>
    request<PlatformUpload>(`/api/uploads/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),

  updateUploadDetails: (id: string, payload: UpdateUploadDetailsInput) =>
    request<PlatformUpload>(`/api/uploads/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),

  deleteUpload: (id: string) =>
    request<void>(`/api/uploads/${id}`, {
      method: "DELETE"
    }),

  createUnifiedPost: async (payload: {
    postFormat: PostFormat;
    file: File | null;
    title: string;
    platformOptions?: PlatformOptions;
    description: string;
    destinations: UnifiedPostDestinationInput[];
    rightsConfirmed: boolean;
    confirmWarnings?: boolean;
    onProgress?: (progress: MediaPreparationProgress) => void;
  }) => {
    if (payload.postFormat === "text") {
      return request<PlatformUpload[]>("/api/posts/unified/text", {
        method: "POST",
        body: JSON.stringify({
          description: payload.description,
          destinations: payload.destinations,
          confirmWarnings: payload.confirmWarnings,
        }),
      });
    }

    if (!payload.file) throw new Error(`Choose a ${payload.postFormat} file.`);
    let stagedUploadId: string | null = null;
    let finalizationStarted = false;
    try {
      const session = await request<StagedUploadSession>("/api/staged-uploads", {
        method: "POST",
        body: JSON.stringify({
          originalName: payload.file.name,
          mimeType: payload.file.type,
          size: payload.file.size,
        }),
      });
      stagedUploadId = session.id;
      await uploadStagedFile(payload.file, session, payload.onProgress);

      finalizationStarted = true;
      await retryUploadStep(() => request<{ id: string; finalized: boolean }>(`/api/staged-uploads/${session.id}/finalize`, {
        method: "POST",
        body: "{}",
      }), 3);

      const uploads = await retryUploadStep(() => request<PlatformUpload[]>("/api/posts/unified/staged", {
        method: "POST",
        body: JSON.stringify({
          stagedUploadId: session.id,
          title: payload.title,
          platformOptions: payload.platformOptions,
          description: payload.description,
          destinations: payload.destinations,
          rightsConfirmed: payload.rightsConfirmed,
          confirmWarnings: payload.confirmWarnings,
        }),
      }), 3);
      stagedUploadId = null;
      return uploads;
    } finally {
      if (stagedUploadId && !finalizationStarted) {
        await request<void>(`/api/staged-uploads/${stagedUploadId}`, { method: "DELETE" }).catch(() => undefined);
      }
    }
  },

  createSubmission: async (payload: {
    postFormat: PostFormat;
    file: File | null;
    title: string;
    platformOptions?: PlatformOptions;
    description: string;
    rightsConfirmed: boolean;
    destinations: UnifiedPostDestinationInput[];
    confirmWarnings?: boolean;
    onProgress?: (progress: MediaPreparationProgress) => void;
  }) => {
    if (payload.postFormat === "text") {
      return request<ContentSubmission>("/api/submissions/text", {
        method: "POST",
        body: JSON.stringify({
          description: payload.description,
          selectedAccountIds: payload.destinations.map(destination => destination.accountId),
          confirmWarnings: payload.confirmWarnings,
        }),
      });
    }

    if (!payload.file) throw new Error(`Choose a ${payload.postFormat} file.`);
    let stagedUploadId: string | null = null;
    let finalizationStarted = false;
    try {
      const session = await request<StagedUploadSession>("/api/staged-uploads", {
        method: "POST",
        body: JSON.stringify({
          originalName: payload.file.name,
          mimeType: payload.file.type,
          size: payload.file.size,
        }),
      });
      stagedUploadId = session.id;
      await uploadStagedFile(payload.file, session, payload.onProgress);

      finalizationStarted = true;
      await retryUploadStep(() => request<{ id: string; finalized: boolean }>(`/api/staged-uploads/${session.id}/finalize`, {
        method: "POST",
        body: "{}",
      }), 3);

      const submission = await retryUploadStep(() => request<ContentSubmission>("/api/submissions/staged", {
        method: "POST",
        body: JSON.stringify({
          stagedUploadId: session.id,
          title: payload.title,
          platformOptions: payload.platformOptions,
          description: payload.description,
          selectedAccountIds: payload.destinations.map(destination => destination.accountId),
          rightsConfirmed: payload.rightsConfirmed,
          confirmWarnings: payload.confirmWarnings,
        }),
      }), 3);
      stagedUploadId = null;
      return submission;
    } finally {
      if (stagedUploadId && !finalizationStarted) {
        await request<void>(`/api/staged-uploads/${stagedUploadId}`, { method: "DELETE" }).catch(() => undefined);
      }
    }
  },

  scheduleSubmission: (submissionId: string, destinations: UnifiedPostDestinationInput[], confirmWarnings = false) =>
    request<{ submission: ContentSubmission; uploads: PlatformUpload[] }>(`/api/submissions/${submissionId}/schedule`, {
      method: "POST",
      body: JSON.stringify({ destinations, confirmWarnings }),
    }),

  accounts: (platform?: Platform) => request<PlatformAccount[]>(`/api/accounts${platform ? `?platform=${platform}` : ""}`),

  schedules: () => request<PublishingSchedule[]>("/api/schedules"),

  socialMediaSchedules: () => request<SocialMediaSchedule[]>("/api/social-media-schedules"),

  createSchedule: (payload: UpsertPublishingScheduleInput) =>
    request<PublishingSchedule>("/api/schedules", { method: "POST", body: JSON.stringify(payload) }),

  updateSchedule: (scheduleId: number, payload: UpsertPublishingScheduleInput) =>
    request<PublishingSchedule>(`/api/schedules/${scheduleId}`, { method: "PATCH", body: JSON.stringify(payload) }),

  deleteSchedule: (scheduleId: number) =>
    request<void>(`/api/schedules/${scheduleId}`, { method: "DELETE" }),

  createAccount: (platform: Platform, payload: UpsertPlatformAccountInput) =>
    request<PlatformAccount>(`/api/platforms/${platform}/accounts`, { method: "POST", body: JSON.stringify(payload) }),

  updateAccount: (accountId: string, payload: UpsertPlatformAccountInput) =>
    request<PlatformAccount>(`/api/accounts/${accountId}`, { method: "PATCH", body: JSON.stringify(payload) }),

  deleteAccount: (accountId: string) =>
    request<void>(`/api/accounts/${accountId}`, { method: "DELETE" }),

  startManualLogin: (accountId: string, surface: "engine" | "embedded" | "external" = "engine") =>
    request<{ message: string; started: boolean; surface: "embedded" | "external"; executionEngine: "companion" | "external_browser" }>(`/api/accounts/${accountId}/manual-login`, {
      method: "POST",
      body: JSON.stringify({ surface }),
    }),

  users: () => request<UserProfile[]>("/api/users"),

  createUser: (payload: CreateUserProfileInput) =>
    request<UserProfile>("/api/users", { method: "POST", body: JSON.stringify(payload) }),

  updateUser: (userId: string, payload: UpdateUserProfileInput) =>
    request<UserProfile>(`/api/users/${userId}`, { method: "PATCH", body: JSON.stringify(payload) }),

  deactivateUser: (userId: string) =>
    request<void>(`/api/users/${userId}`, { method: "DELETE" }),

  activityLogs: (limit = 100) => request<ActivityLog[]>(`/api/activity-logs?limit=${limit}`),
    
  automationInput: () => request<AutomationInput>("/api/automation/input"),
  
  runAutomation: (uploadIds?: string[]) => request<{ message: string; uploadIds: string[] }>("/api/automation/run", {
    method: "POST",
    body: JSON.stringify({ uploadIds: uploadIds?.length ? uploadIds : undefined })
  }),

  stopAutomation: () => request<{ stopped: boolean; message: string }>("/api/automation/stop", {
    method: "POST"
  })
};
