import assert from "node:assert/strict";
import test from "node:test";
import type { PlatformUpload } from "../shared/schema.js";
import { assessPublishingSafety, assessScheduledPublishingSafety, publishingSafetyPacingEnabled, publishingSafetyRule } from "./services/safety-governor.js";

function upload(overrides: Partial<PlatformUpload> = {}): PlatformUpload {
  return {
    id: "upload_test",
    workspaceId: "workspace_test",
    platform: "instagram",
    postFormat: "image",
    accountId: "account_test",
    originalName: "post.jpg",
    fileName: "post.jpg",
    mimeType: "image/jpeg",
    extension: "jpg",
    size: 10,
    url: "/uploads/post.jpg",
    caption: "Test post",
    status: "queued",
    uploadedAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
    automation: {
      schemaVersion: "autopost.upload.v1",
      n8nInputKey: "test",
      playwright: {
        platform: "instagram",
        accountId: "account_test",
        browserProfileName: "test",
        publishSurface: "https://example.com",
        sourceFileUrl: "/uploads/post.jpg",
      },
    },
    ...overrides,
  };
}

test("publishing safety rules use the approved platform defaults", () => {
  assert.deepEqual(publishingSafetyRule(upload()), {
    hourlyLimit: 1,
    dailyLimit: 6,
    minimumGapMs: 60 * 60 * 1000,
  });
  assert.deepEqual(publishingSafetyRule(upload({ platform: "x", automation: {
    ...upload().automation,
    playwright: { ...upload().automation.playwright, platform: "x" },
  } })), {
    hourlyLimit: 4,
    dailyLimit: 30,
    minimumGapMs: 15 * 60 * 1000,
  });
  assert.equal(publishingSafetyRule(upload({ platform: "youtube", postFormat: "video" })).dailyLimit, 3);
  assert.equal(publishingSafetyRule(upload({ platform: "youtube", postFormat: "text" })).dailyLimit, 6);
});

test("protected mode lowers pace without blocking an account from publishing", () => {
  assert.deepEqual(publishingSafetyRule(upload({ platform: "facebook" }), "protected"), {
    hourlyLimit: 1,
    dailyLimit: 5,
    minimumGapMs: 60 * 60 * 1000,
  });
  assert.equal(assessPublishingSafety(upload({ platform: "facebook" }), [], Date.now(), "protected", true).allowed, true);
});

test("testing builds disable pacing while keeping it available for later", () => {
  assert.equal(publishingSafetyPacingEnabled({}), false);
  assert.equal(publishingSafetyPacingEnabled({ PUBLISHING_SAFETY_PACING_ENABLED: "true" }), true);
  const now = Date.parse("2026-07-28T12:00:00.000Z");
  const previous = upload({ id: "posted", status: "posted", postedAt: "2026-07-28T11:59:00.000Z" });
  assert.equal(assessPublishingSafety(upload(), [previous], now, "standard", false).allowed, true);
});

test("publishing safety defers bursts until the minimum gap expires", () => {
  const now = Date.parse("2026-07-28T12:00:00.000Z");
  const previous = upload({
    id: "posted",
    status: "posted",
    postedAt: "2026-07-28T11:30:00.000Z",
  });
  const assessment = assessPublishingSafety(upload(), [previous], now, "standard", true);
  assert.equal(assessment.allowed, false);
  assert.equal(assessment.retryAt, "2026-07-28T12:30:00.000Z");
});

test("publishing safety enforces rolling daily limits", () => {
  const now = Date.parse("2026-07-28T12:00:00.000Z");
  const history = Array.from({ length: 6 }, (_, index) => upload({
    id: `posted_${index}`,
    status: "posted",
    postedAt: new Date(now - (23 - index * 2) * 60 * 60 * 1000).toISOString(),
  }));
  const assessment = assessPublishingSafety(upload(), history, now, "standard", true);
  assert.equal(assessment.allowed, false);
  assert.equal(assessment.postsLastDay, 6);
  assert.match(assessment.reason ?? "", /daily safety limit/i);
});

test("schedule safety rejects a time inside the account gap and returns the earliest safe time", () => {
  const requestedAt = Date.parse("2026-07-28T12:00:00.000Z");
  const previous = upload({
    id: "posted",
    status: "posted",
    postedAt: "2026-07-28T11:30:00.000Z",
  });
  const assessment = assessScheduledPublishingSafety(upload(), [previous], requestedAt, "standard", true);
  assert.equal(assessment.allowed, false);
  assert.equal(assessment.earliestAt, "2026-07-28T12:30:00.000Z");
  assert.match(assessment.reason ?? "", /minimum spacing/i);
});

test("schedule safety reserves future jobs so accepted schedules cannot collide", () => {
  const reserved = upload({
    id: "reserved",
    status: "queued",
    scheduledAt: "2026-07-28T13:00:00.000Z",
  });
  const assessment = assessScheduledPublishingSafety(
    upload(),
    [reserved],
    Date.parse("2026-07-28T12:30:00.000Z"),
    "standard",
    true,
  );
  assert.equal(assessment.allowed, false);
  assert.equal(assessment.earliestAt, "2026-07-28T14:00:00.000Z");
});
