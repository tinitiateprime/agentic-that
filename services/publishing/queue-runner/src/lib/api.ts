import type {
  ActivityLog,
  AutomationInput,
  CreateUserProfileInput,
  DashboardSummary,
  LoginInput,
  Platform,
  PlatformAccount,
  PlatformUpload,
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

let authToken: string | null = null;

export type AuthResponse = {
  user: UserProfile;
  token: string;
};

export function setAuthToken(token: string | null) {
  authToken = token;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (authToken) {
    headers.set("Authorization", `Bearer ${authToken}`);
  }

  let response: Response;
  try {
    response = await publishingFetch(path, {
      ...init,
      headers
    });
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
      const error = JSON.parse(payload) as { message?: string };
      message = error?.message ?? message;
    } catch {
      // Keep the plain response text when the server did not return JSON.
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function assetUrl(url: string, options: { compact?: boolean; controls?: boolean } = {}) {
  return publishingAssetUrl(url, options);
}

export const api = {
  health: async () => {
    const health = await request<{
      ok: boolean;
      automationReady: boolean;
      automationRunning: boolean;
      chromeInstalled?: boolean;
      extensionBridge?: boolean;
      platforms?: Platform[];
    }>("/api/health");
    if (isPublishingExtensionActive() && !health.extensionBridge) {
      throw new Error("Restart Start Publishing Companion.cmd to load the extension-compatible publishing service.");
    }
    return { ...health, transport: isPublishingExtensionActive() ? "extension" as const : "direct" as const };
  },

  login: (payload: LoginInput) =>
    request<AuthResponse>("/api/auth/login", { method: "POST", body: JSON.stringify(payload) }),

  platformLogin: (token: string) =>
    request<AuthResponse>("/api/auth/platform", { method: "POST", body: JSON.stringify({ token }) }),

  me: () => request<UserProfile>("/api/auth/me"),

  dashboard: () => request<DashboardSummary>("/api/dashboard"),
  
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
    description: string;
    destinations: UnifiedPostDestinationInput[];
  }) => {
    if (payload.postFormat === "text") {
      return request<PlatformUpload[]>("/api/posts/unified/text", {
        method: "POST",
        body: JSON.stringify({
          description: payload.description,
          destinations: payload.destinations,
        }),
      });
    }

    if (!payload.file) throw new Error(`Choose a ${payload.postFormat} file.`);
    let stagedUploadId: string | null = null;
    try {
      const session = await request<{ id: string; offset: number; chunkSize: number }>("/api/staged-uploads", {
        method: "POST",
        body: JSON.stringify({
          originalName: payload.file.name,
          mimeType: payload.file.type,
          size: payload.file.size,
        }),
      });
      stagedUploadId = session.id;
      const chunkSize = Math.min(2 * 1024 * 1024, Math.max(64 * 1024, session.chunkSize || 2 * 1024 * 1024));
      let offset = session.offset;
      while (offset < payload.file.size) {
        const chunk = payload.file.slice(offset, Math.min(payload.file.size, offset + chunkSize));
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
      }

      const uploads = await request<PlatformUpload[]>("/api/posts/unified/staged", {
        method: "POST",
        body: JSON.stringify({
          stagedUploadId: session.id,
          title: payload.title,
          description: payload.description,
          destinations: payload.destinations,
        }),
      });
      stagedUploadId = null;
      return uploads;
    } finally {
      if (stagedUploadId) {
        await request<void>(`/api/staged-uploads/${stagedUploadId}`, { method: "DELETE" }).catch(() => undefined);
      }
    }
  },

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

  startManualLogin: (accountId: string) =>
    request<{ message: string; started: boolean }>(`/api/accounts/${accountId}/manual-login`, { method: "POST" }),

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
  })
};
