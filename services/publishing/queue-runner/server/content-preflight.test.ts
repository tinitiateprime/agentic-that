import assert from "node:assert/strict";
import test from "node:test";
import type { PlatformUpload } from "../shared/schema.js";
import {
  assertContentPreflight,
  ContentPreflightError,
  evaluateContentPreflight,
  type ContentPreflightInput,
} from "./services/content-preflight.js";

function input(overrides: Partial<ContentPreflightInput> = {}): ContentPreflightInput {
  return {
    postFormat: "text",
    title: "",
    description: "A useful product update",
    originalName: "Text post",
    size: 23,
    rightsConfirmed: true,
    destinations: [{ accountId: "facebook-1", platform: "facebook", description: "A useful product update" }],
    ...overrides,
  };
}

function upload(overrides: Partial<PlatformUpload> = {}): PlatformUpload {
  return {
    id: "upload-1",
    workspaceId: "workspace-1",
    platform: "facebook",
    postFormat: "text",
    accountId: "facebook-1",
    originalName: "Text post",
    fileName: "",
    mimeType: "text/plain",
    extension: "unknown",
    size: 23,
    url: "",
    title: "Text post: A useful product update",
    caption: "A useful product update",
    status: "queued",
    uploadedAt: "2026-07-28T09:00:00.000Z",
    updatedAt: "2026-07-28T09:00:00.000Z",
    automation: {
      schemaVersion: "autopost.upload.v1",
      n8nInputKey: "facebook",
      playwright: {
        platform: "facebook",
        accountId: "facebook-1",
        browserProfileName: "facebook-1",
        publishSurface: "https://facebook.com",
        sourceFileUrl: "",
      },
    },
    ...overrides,
  };
}

test("the same post across different apps does not create a broadcast warning", () => {
  const issues = evaluateContentPreflight(input({
    destinations: [
      { accountId: "facebook-1", platform: "facebook", description: "A useful product update" },
      { accountId: "linkedin-1", platform: "linkedin", description: "A useful product update" },
    ],
  }));
  assert.equal(issues.some(issue => issue.code === "same_platform_broadcast"), false);
});

test("the same content to multiple accounts on one app requires confirmation", () => {
  const issues = evaluateContentPreflight(input({
    destinations: [
      { accountId: "facebook-1", platform: "facebook", description: "A useful product update" },
      { accountId: "facebook-2", platform: "facebook", description: "A useful product update" },
    ],
  }));
  assert.equal(issues.some(issue => issue.code === "same_platform_broadcast"), true);
  assert.throws(() => assertContentPreflight(issues, false), ContentPreflightError);
  assert.doesNotThrow(() => assertContentPreflight(issues, true));
});

test("media needs a rights confirmation", () => {
  const issues = evaluateContentPreflight(input({ postFormat: "image", originalName: "launch.png", size: 100, rightsConfirmed: false }));
  assert.equal(issues.find(issue => issue.code === "media_rights_required")?.severity, "block");
});

test("private-network and credential links are blocked", () => {
  const issues = evaluateContentPreflight(input({ description: "Open http://admin:secret@192.168.1.5/setup" }));
  assert.equal(issues.some(issue => issue.code === "private_link" && issue.severity === "block"), true);
  assert.equal(issues.some(issue => issue.code === "credential_link" && issue.severity === "block"), true);
});

test("an identical queued post for the same account and timing is blocked", () => {
  const issues = evaluateContentPreflight(input(), [upload()]);
  assert.equal(issues.find(issue => issue.code === "exact_queued_duplicate")?.severity, "block");
});

test("a recent published repeat is a warning rather than a block", () => {
  const now = Date.parse("2026-07-28T10:00:00.000Z");
  const issues = evaluateContentPreflight(input(), [upload({ status: "posted", postedAt: "2026-07-28T09:30:00.000Z" })], now);
  assert.equal(issues.find(issue => issue.code === "recent_account_repeat")?.severity, "warning");
  assert.doesNotThrow(() => assertContentPreflight(issues, true));
});
