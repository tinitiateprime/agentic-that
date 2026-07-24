import { z } from "zod";

export const platforms = ["instagram", "x", "linkedin", "facebook", "youtube"] as const;
export const postFormats = ["image", "video", "text"] as const;
export const uploadStatuses = ["queued", "processing", "posted", "failed"] as const;
export const submissionStatuses = ["awaiting_schedule", "scheduled"] as const;
export const scheduleFrequencies = ["daily", "weekly", "biweekly", "monthly", "yearly", "custom", "onetime"] as const;
export const scheduleStatuses = ["active", "inactive"] as const;
export const userRoles = ["operations_manager", "post_uploader", "scheduler", "viewer"] as const;

export const platformSchema = z.enum(platforms);
export const postFormatSchema = z.enum(postFormats);
export const uploadStatusSchema = z.enum(uploadStatuses);
export const submissionStatusSchema = z.enum(submissionStatuses);
export const scheduleFrequencySchema = z.enum(scheduleFrequencies);
export const scheduleStatusSchema = z.enum(scheduleStatuses);
export const userRoleSchema = z.enum(userRoles);
export const scheduleIdSchema = z.coerce.number().int().positive();

export type Platform = (typeof platforms)[number];
export type PostFormat = (typeof postFormats)[number];
export type UploadStatus = (typeof uploadStatuses)[number];
export type SubmissionStatus = (typeof submissionStatuses)[number];
export type ScheduleFrequency = (typeof scheduleFrequencies)[number];
export type ScheduleStatus = (typeof scheduleStatuses)[number];
export type UserRole = (typeof userRoles)[number];

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


export const loginInputSchema = z.object({
  username: z.string().trim().min(1, "Username is required"),
  password: z.string().min(1, "Password is required")
});

export const userProfileSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  platformUserId: z.string().optional(),
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
  workspaceId: z.string(),
  platform: platformSchema,
  displayName: z.string(),
  handle: z.string(),
  loginIdentifier: z.string(),
  credentialConfigured: z.boolean(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const upsertPlatformAccountSchema = z.object({
  displayName: z.string().trim().min(1, "Account name is required"),
  handle: z.string().trim().min(1, "Account handle is required"),
  loginIdentifier: z.string().trim().max(254).optional().default(""),
  enabled: z.boolean().optional()
});

export const publishingScheduleSchema = z.object({
  id: scheduleIdSchema,
  workspaceId: z.string(),
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
  workspaceId: z.string(),
  scheduleId: scheduleIdSchema,
  accountId: z.string(),
  platform: platformSchema,
  createdAt: z.string(),
  updatedAt: z.string()
});


export const platformLabels: Record<Platform, string> = {
  instagram: "Instagram",
  x: "X",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  youtube: "YouTube"
};

export const platformPostRules: Record<Platform, {
  formats: readonly PostFormat[];
  descriptionLimit: number;
  titleLimit?: number;
  titleRequired?: boolean;
  titleRequiredFor?: readonly PostFormat[];
}> = {
  instagram: { formats: ["image", "video"], descriptionLimit: 2_200 },
  x: { formats: ["image", "video", "text"], descriptionLimit: 280 },
  linkedin: { formats: ["image", "video", "text"], descriptionLimit: 3_000 },
  facebook: { formats: ["image", "video", "text"], descriptionLimit: 63_206 },
  youtube: { formats: ["image", "video", "text"], descriptionLimit: 5_000, titleLimit: 100, titleRequiredFor: ["video"] }
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
  workspaceId: z.string(),
  platform: platformSchema,
  postFormat: postFormatSchema.optional(),
  accountId: z.string(),
  originalName: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  extension: z.string(),
  size: z.number(),
  url: z.string(),
  title: z.string().optional(),
  caption: z.string().min(1, "Caption is required"),
  status: uploadStatusSchema,
  failureReason: z.string().optional(),
  attemptCount: z.number().int().nonnegative().optional(),
  lastAttemptAt: z.string().optional(),
  postedAt: z.string().optional(),
  uploadedAt: z.string(),
  updatedAt: z.string(),
  scheduledAt: z.string().optional(),
  scheduleId: scheduleIdSchema.optional(),
  createdByUserId: z.string().optional(),
  scheduledByUserId: z.string().optional(),
  lastUpdatedByUserId: z.string().optional(),
  automation: uploadAutomationSchema
});

export const contentSubmissionSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  postFormat: postFormatSchema,
  originalName: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number(),
  url: z.string(),
  title: z.string().optional(),
  description: z.string().min(1),
  status: submissionStatusSchema,
  createdByUserId: z.string(),
  scheduledByUserId: z.string().optional(),
  destinationUploadIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string()
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
  workspaceId: z.string(),
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
export type ContentSubmission = z.infer<typeof contentSubmissionSchema>;
export type PlatformAccount = z.infer<typeof platformAccountSchema>;
export type PublishingSchedule = z.infer<typeof publishingScheduleSchema>;
export type SocialMediaSchedule = z.infer<typeof socialMediaScheduleSchema>;
export type UploadAutomation = z.infer<typeof uploadAutomationSchema>;
export type UserProfile = z.infer<typeof userProfileSchema>;
export type ActivityLog = z.infer<typeof activityLogSchema>;
export type LoginInput = z.input<typeof loginInputSchema>;
export type CreateUserProfileInput = z.input<typeof createUserProfileSchema>;
export type UpdateUserProfileInput = z.input<typeof updateUserProfileSchema>;
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
