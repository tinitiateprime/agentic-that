import type {
  ActivityLog,
  AutomationInput,
  CreateUserProfileInput,
  DashboardSummary,
  CreateGoogleDriveStorageConnectionInput,
  LoginInput,
  Platform,
  PlatformAccount,
  PlatformUpload,
  PublishingSchedule,
  SocialMediaSchedule,
  StorageConnection,
  UpdateUploadDetailsInput,
  UpdateUploadStatusInput,
  UpdateUserProfileInput,
  UpsertPlatformAccountInput,
  UpsertPublishingScheduleInput,
  UnifiedPostDestinationInput,
  UserProfile
} from "../../shared/schema.ts";

const API_BASE = process.env.NEXT_PUBLIC_PUBLISH_QUEUE_API_URL?.replace(/\/$/, "") ?? "";
let authToken: string | null = null;

export type AuthResponse = {
  user: UserProfile;
  token: string;
};

export type LocalDriveConnectionResponse = {
  connection: StorageConnection;
  sync: {
    added: number;
    updated: number;
    removed: number;
    retainedHistory?: number;
  };
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

  const requestPath = API_BASE
    ? API_BASE + path
    : "/api/publishing" + path.replace(/^\/api/, "");
  let response: Response;
  try {
    response = await fetch(requestPath, {
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

export function assetUrl(url: string) {
  if (url.startsWith("http") || url.startsWith("data:")) return url;
  const assetPath = !API_BASE && url.startsWith("/uploads/") ? `/publishing${url}` : url;
  return `${API_BASE}${assetPath}`;
}

export const api = {
  login: (payload: LoginInput) =>
    request<AuthResponse>("/api/auth/login", { method: "POST", body: JSON.stringify(payload) }),

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

  uploadLocalPosts: (platform: Platform, payload: { accountId: string; files: File[] | FileList }) => {
    const formData = new FormData();
    formData.set("accountId", payload.accountId);
    Array.from(payload.files).forEach(file => formData.append("files", file));
    return request<PlatformUpload[]>(`/api/platforms/${platform}/uploads`, {
      method: "POST",
      body: formData
    });
  },

  createUnifiedPost: (payload: {
    file: File;
    title: string;
    description: string;
    destinations: UnifiedPostDestinationInput[];
  }) => {
    const formData = new FormData();
    formData.set("file", payload.file);
    formData.set("title", payload.title);
    formData.set("description", payload.description);
    formData.set("destinations", JSON.stringify(payload.destinations));
    return request<PlatformUpload[]>("/api/posts/unified", {
      method: "POST",
      body: formData
    });
  },

  storageConnections: () => request<StorageConnection[]>("/api/storage-connections"),

  createGoogleDriveConnection: (payload: CreateGoogleDriveStorageConnectionInput) =>
    request<StorageConnection>("/api/storage-connections/google-drive", {
      method: "POST",
      body: JSON.stringify(payload)
    }),

  syncStorageConnection: (connectionId: string) =>
    request<LocalDriveConnectionResponse>(`/api/storage-connections/${connectionId}/sync`, {
      method: "POST"
    }),

  deleteStorageConnection: (connectionId: string) =>
    request<void>(`/api/storage-connections/${connectionId}`, { method: "DELETE" }),

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
