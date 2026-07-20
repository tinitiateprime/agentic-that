import { z } from "zod";

export const platforms = ["instagram", "x", "linkedin", "facebook", "youtube"] as const;
export const uploadStatuses = ["queued", "processing", "posted", "failed"] as const;
export const scheduleFrequencies = ["daily", "weekly", "biweekly", "monthly", "yearly", "custom", "onetime"] as const;
export const scheduleStatuses = ["active", "inactive"] as const;
export const userRoles = ["operations_manager", "post_uploader", "scheduler", "viewer"] as const;
export const storageSourceTypes = ["local_drive", "google_drive"] as const;
export const storageConnectionStatuses = ["connected", "syncing", "pending_auth", "error", "disabled"] as const;

export const platformSchema = z.enum(platforms);
export const uploadStatusSchema = z.enum(uploadStatuses);
export const scheduleFrequencySchema = z.enum(scheduleFrequencies);
export const scheduleStatusSchema = z.enum(scheduleStatuses);
export const userRoleSchema = z.enum(userRoles);
export const storageSourceTypeSchema = z.enum(storageSourceTypes);
export const storageConnectionStatusSchema = z.enum(storageConnectionStatuses);
export const scheduleIdSchema = z.coerce.number().int().positive();

export type Platform = (typeof platforms)[number];
export type UploadStatus = (typeof uploadStatuses)[number];
export type ScheduleFrequency = (typeof scheduleFrequencies)[number];
export type ScheduleStatus = (typeof scheduleStatuses)[number];
export type UserRole = (typeof userRoles)[number];
export type StorageSourceType = (typeof storageSourceTypes)[number];
export type StorageConnectionStatus = (typeof storageConnectionStatuses)[number];

export const scheduleFrequencyLabels: Record<ScheduleFrequency, string> = {
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
  yearly: "Yearly",
  custom: "Custom",
  onetime: "One time"
};

export const userRoleLabels: Record<UserRole, string> = {
  operations_manager: "Operations Manager",
  post_uploader: "Post Uploader",
  scheduler: "Scheduler",
  viewer: "Viewer"
};

export const storageSourceTypeLabels: Record<StorageSourceType, string> = {
  local_drive: "Local Drive",
  google_drive: "Google Drive"
};

export const loginInputSchema = z.object({
  username: z.string().trim().min(1, "Username is required"),
  password: z.string().min(1, "Password is required")
});

export const userProfileSchema = z.object({
  id: z.string(),
  username: z.string(),
  fullName: z.string(),
  email: z.string().optional(),
  role: userRoleSchema,
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastLoginAt: z.string().optional()
});

export const createUserProfileSchema = z.object({
  username: z.string().trim().min(3, "Username must be at least 3 characters").max(80),
  fullName: z.string().trim().min(2, "Full name is required").max(120),
  email: z.string().trim().email("Use a valid email").optional().or(z.literal("")),
  role: userRoleSchema,
  isActive: z.boolean().optional(),
  password: z.string().min(8, "Password must be at least 8 characters")
});

export const updateUserProfileSchema = z.object({
  username: z.string().trim().min(3, "Username must be at least 3 characters").max(80).optional(),
  fullName: z.string().trim().min(2, "Full name is required").max(120).optional(),
  email: z.string().trim().email("Use a valid email").optional().or(z.literal("")),
  role: userRoleSchema.optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8, "Password must be at least 8 characters").optional()
});

export const platformAccountSchema = z.object({
  id: z.string(),
  platform: platformSchema,
  displayName: z.string(),
  handle: z.string(),
  loginIdentifier: z.string(),
  loginConfirmation: z.string().optional(),
  credentialConfigured: z.boolean(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const upsertPlatformAccountSchema = z.object({
  displayName: z.string().trim().min(1, "Account name is required"),
  handle: z.string().trim().min(1, "Account handle is required"),
  loginIdentifier: z.string().trim().min(1, "Login email or username is required"),
  loginConfirmation: z.string().trim().optional(),
  enabled: z.boolean().optional()
});

export const publishingScheduleSchema = z.object({
  id: scheduleIdSchema,
  name: z.string(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MI time"),
  frequency: scheduleFrequencySchema,
  endDate: z.string().optional(),
  status: scheduleStatusSchema,
  customCronExpression: z.string().optional(),
  lastRunAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const upsertPublishingScheduleSchema = z.object({
  name: z.string().trim().min(1, "Schedule name is required"),
  time: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MI time"),
  frequency: scheduleFrequencySchema,
  endDate: z.string().trim().optional(),
  status: scheduleStatusSchema.optional(),
  customCronExpression: z.string().trim().optional()
}).superRefine((value, context) => {
  if (value.frequency === "onetime" && !value.endDate) {
    context.addIssue({ code: "custom", message: "One-time schedules need a date.", path: ["endDate"] });
  }
  if (value.frequency === "custom" && !value.customCronExpression) {
    context.addIssue({ code: "custom", message: "Custom schedules need a cron expression.", path: ["customCronExpression"] });
  }
});

export const socialMediaScheduleSchema = z.object({
  id: z.number().int().positive(),
  scheduleId: scheduleIdSchema,
  accountId: z.string(),
  platform: platformSchema,
  createdAt: z.string(),
  updatedAt: z.string()
});

export const storageConnectionSchema = z.object({
  id: z.string(),
  storageType: storageSourceTypeSchema,
  displayName: z.string(),
  platform: platformSchema,
  accountId: z.string(),
  connectedByUserId: z.string().optional(),
  localFolderPath: z.string().optional(),
  googleDriveFolderId: z.string().optional(),
  googleDriveFolderUrl: z.string().optional(),
  googleDriveFolderName: z.string().optional(),
  legacyConnectedFolderId: z.string().optional(),
  status: storageConnectionStatusSchema,
  active: z.boolean(),
  lastSyncedAt: z.string().optional(),
  lastError: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const createLocalDriveStorageConnectionSchema = z.object({
  displayName: z.string().trim().optional(),
  accountId: z.string().trim().min(1, "Choose a publishing account"),
  folderPath: z.string().trim().min(1, "Legacy source path is required")
});

export const createGoogleDriveStorageConnectionSchema = z.object({
  displayName: z.string().trim().min(1, "Connection name is required"),
  accountId: z.string().trim().min(1, "Choose a publishing account"),
  googleDriveFolderId: z.string().trim().optional(),
  googleDriveFolderUrl: z.string().trim().url("Use a valid Google Drive folder URL").optional().or(z.literal("")),
  googleDriveFolderName: z.string().trim().optional()
}).superRefine((value, context) => {
  if (!value.googleDriveFolderId && !value.googleDriveFolderUrl) {
    context.addIssue({ code: "custom", message: "Google Drive folder id or URL is required.", path: ["googleDriveFolderId"] });
  }
});

export const folderConnectionSchema = z.object({
  id: z.string(),
  platform: platformSchema,
  accountId: z.string(),
  folderPath: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastScannedAt: z.string().optional(),
  lastError: z.string().optional()
});

export const folderSourceSchema = z.object({
  connectionId: z.string(),
  relativePath: z.string(),
  fingerprint: z.string(),
  present: z.boolean()
});

export const platformLabels: Record<Platform, string> = {
  instagram: "Instagram",
  x: "X",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  youtube: "YouTube"
};

export type PostMediaKind = "image" | "video";

export const platformPostRules: Record<Platform, {
  media: readonly PostMediaKind[];
  descriptionLimit: number;
  titleLimit?: number;
  titleRequired?: boolean;
  titleRequiredFor?: readonly PostMediaKind[];
}> = {
  instagram: { media: ["image", "video"], descriptionLimit: 2_200 },
  x: { media: ["image", "video"], descriptionLimit: 280 },
  linkedin: { media: ["image", "video"], descriptionLimit: 3_000 },
  facebook: { media: ["image", "video"], descriptionLimit: 63_206 },
  youtube: { media: ["image", "video"], descriptionLimit: 5_000, titleLimit: 100, titleRequiredFor: ["video"] }
};

export const unifiedPostDestinationSchema = z.object({
  accountId: z.string().trim().min(1, "Choose a publishing account"),
  description: z.string().trim().max(100_000).optional(),
  scheduledAt: z.string().trim().optional(),
  scheduleId: scheduleIdSchema.optional()
}).superRefine((value, context) => {
  if (value.scheduledAt && value.scheduleId) {
    context.addIssue({ code: "custom", message: "Choose an exact time or a schedule template, not both." });
  }
});

export const unifiedPostDestinationsSchema = z.array(unifiedPostDestinationSchema)
  .min(1, "Choose at least one publishing destination")
  .max(100, "Choose no more than 100 publishing destinations");

export const platformHandles: Record<Platform, string> = {
  instagram: "@instagram",
  x: "@x",
  linkedin: "LinkedIn Page",
  facebook: "Facebook Page",
  youtube: "YouTube Channel"
};

export const platformSurfaces: Record<Platform, string> = {
  instagram: "https://www.instagram.com/",
  x: "https://x.com/compose/post",
  linkedin: "https://www.linkedin.com/feed/",
  facebook: "https://www.facebook.com/",
  youtube: "https://www.youtube.com/"
};

export const uploadAutomationSchema = z.object({
  schemaVersion: z.literal("autopost.upload.v1"),
  n8nInputKey: z.string(),
  playwright: z.object({
    platform: platformSchema,
    accountId: z.string(),
    browserProfileName: z.string(),
    publishSurface: z.string(),
    sourceFileUrl: z.string()
  })
});

export const platformUploadSchema = z.object({
  id: z.string(),
  platform: platformSchema,
  accountId: z.string(),
  originalName: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  extension: z.string(),
  size: z.number(),
  url: z.string(),
  title: z.string().optional(), // 👈 NEW TITLE FIELD
  caption: z.string().min(1, "Caption is required"),
  status: uploadStatusSchema,
  uploadedAt: z.string(),
  updatedAt: z.string(),
  scheduledAt: z.string().optional(),
  scheduleId: scheduleIdSchema.optional(),
  createdByUserId: z.string().optional(),
  scheduledByUserId: z.string().optional(),
  lastUpdatedByUserId: z.string().optional(),
  folderSource: folderSourceSchema.optional(),
  automation: uploadAutomationSchema
});

export const updateUploadDetailsSchema = z.object({
  title: z.string().trim().optional(),
  caption: z.string().trim().min(1, "Caption is required"),
  scheduledAt: z.string().nullable().optional(),
  scheduleId: scheduleIdSchema.nullable().optional(),
  accountId: z.string().optional()
});

export const updateUploadStatusSchema = z.object({
  status: uploadStatusSchema,
  failureReason: z.string().optional()
});

export const activityLogSchema = z.object({
  id: z.string(),
  actorUserId: z.string().optional(),
  actorName: z.string().optional(),
  actorUsername: z.string().optional(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().optional(),
  summary: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string()
});

export type PlatformUpload = z.infer<typeof platformUploadSchema>;
export type PlatformAccount = z.infer<typeof platformAccountSchema>;
export type PublishingSchedule = z.infer<typeof publishingScheduleSchema>;
export type SocialMediaSchedule = z.infer<typeof socialMediaScheduleSchema>;
export type StorageConnection = z.infer<typeof storageConnectionSchema>;
export type FolderConnection = z.infer<typeof folderConnectionSchema>;
export type UploadAutomation = z.infer<typeof uploadAutomationSchema>;
export type UserProfile = z.infer<typeof userProfileSchema>;
export type ActivityLog = z.infer<typeof activityLogSchema>;
export type LoginInput = z.input<typeof loginInputSchema>;
export type CreateUserProfileInput = z.input<typeof createUserProfileSchema>;
export type UpdateUserProfileInput = z.input<typeof updateUserProfileSchema>;
export type CreateLocalDriveStorageConnectionInput = z.input<typeof createLocalDriveStorageConnectionSchema>;
export type CreateGoogleDriveStorageConnectionInput = z.input<typeof createGoogleDriveStorageConnectionSchema>;
export type UpdateUploadStatusInput = z.input<typeof updateUploadStatusSchema>;
export type UpdateUploadDetailsInput = z.input<typeof updateUploadDetailsSchema>;
export type UpsertPlatformAccountInput = z.input<typeof upsertPlatformAccountSchema>;
export type UpsertPublishingScheduleInput = z.input<typeof upsertPublishingScheduleSchema>;
export type UnifiedPostDestinationInput = z.input<typeof unifiedPostDestinationSchema>;

export type DashboardSummary = {
  totalUploads: number;
  readyForAutomation: number;
  processing: number;
  posted: number;
  failed: number;
  channels: Array<{
    platform: Platform;
    label: string;
    handle: string;
    total: number;
    queued: number;
    latestUploadAt: string | null;
  }>;
};

export type AutomationInput = {
  generatedAt: string;
  officialPlatformApisRequired: false;
  intakeSource: "tinitiatebot_autopost";
  channels: Record<Platform, PlatformUpload[]>;
};
