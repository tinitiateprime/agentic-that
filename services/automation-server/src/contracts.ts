import { randomUUID } from "node:crypto";
import { z } from "zod";

export const socialPlatformSchema = z.enum(["instagram", "facebook", "x", "linkedin", "youtube"]);
export type SocialPlatform = z.infer<typeof socialPlatformSchema>;

export const accountStatusSchema = z.enum([
  "PENDING_LOGIN",
  "CONNECTED",
  "LOGIN_REQUIRED",
  "PAUSED",
  "DISABLED",
]);
export type AccountStatus = z.infer<typeof accountStatusSchema>;

export const loginSessionStateSchema = z.enum([
  "STARTING",
  "AWAITING_USER",
  "CONNECTED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
]);
export type LoginSessionState = z.infer<typeof loginSessionStateSchema>;

export const loginSurfaceSchema = z.enum(["visible", "website"]);
export type LoginSurface = z.infer<typeof loginSurfaceSchema>;

export const loginBrowserInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("click"),
    x: z.number().finite().min(0).max(4096),
    y: z.number().finite().min(0).max(4096),
    button: z.enum(["left", "middle", "right"]).default("left"),
  }),
  z.object({
    type: z.literal("key"),
    key: z.enum(["Tab", "Enter", "Escape", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Space"]),
  }),
  z.object({
    type: z.literal("text"),
    text: z.string().min(1).max(64),
  }),
  z.object({
    type: z.literal("wheel"),
    deltaX: z.number().finite().min(-2000).max(2000),
    deltaY: z.number().finite().min(-2000).max(2000),
  }),
]);
export type LoginBrowserInput = z.infer<typeof loginBrowserInputSchema>;
export const loginBrowserInputBatchSchema = z.array(loginBrowserInputSchema).min(1).max(32);

export const publishingJobStateSchema = z.enum([
  "SCHEDULED",
  "PUBLISHING",
  "VERIFYING",
  "PUBLISHED",
  "FAILED",
  "LOGIN_REQUIRED",
  "UNCERTAIN",
  "CANCELLED",
]);
export type PublishingJobState = z.infer<typeof publishingJobStateSchema>;

export const createAccountSchema = z.object({
  workspaceId: z.string().trim().min(1).max(160),
  platform: socialPlatformSchema,
  displayName: z.string().trim().min(1).max(200),
});

export const updateAccountSchema = z.object({
  workspaceId: z.string().trim().min(1).max(160),
  displayName: z.string().trim().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
}).refine(value => value.displayName !== undefined || value.enabled !== undefined, {
  message: "Enter an account change.",
});

export const mediaReferenceSchema = z.object({
  storageKey: z.string().trim().min(1).max(500),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(160),
});

export const createPublishingJobSchema = z.object({
  workspaceId: z.string().trim().min(1).max(160),
  accountId: z.string().trim().min(1).max(160),
  scheduledAt: z.string().datetime({ offset: true }),
  originalTimezone: z.string().trim().min(1).max(100).default("UTC"),
  caption: z.string().max(63_206).default(""),
  media: z.array(mediaReferenceSchema).max(20).default([]),
  idempotencyKey: z.string().trim().min(8).max(200),
}).refine(value => value.caption.trim() || value.media.length > 0, {
  message: "A publishing job requires a caption or media.",
});

const allowedTransitions: Record<PublishingJobState, ReadonlySet<PublishingJobState>> = {
  SCHEDULED: new Set(["PUBLISHING", "CANCELLED"]),
  PUBLISHING: new Set(["VERIFYING", "PUBLISHED", "FAILED", "LOGIN_REQUIRED", "UNCERTAIN"]),
  VERIFYING: new Set(["PUBLISHED", "FAILED", "LOGIN_REQUIRED", "UNCERTAIN"]),
  PUBLISHED: new Set(),
  FAILED: new Set(["SCHEDULED", "CANCELLED"]),
  LOGIN_REQUIRED: new Set(["SCHEDULED", "CANCELLED"]),
  UNCERTAIN: new Set(["VERIFYING", "PUBLISHED", "FAILED", "CANCELLED"]),
  CANCELLED: new Set(),
};

export function assertPublishingJobTransition(from: PublishingJobState, to: PublishingJobState) {
  if (!allowedTransitions[from].has(to)) {
    throw new Error(`Publishing job cannot move from ${from} to ${to}.`);
  }
}

export function automationId(prefix: "account" | "login" | "job" | "attempt" | "scrape" | "event") {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}
