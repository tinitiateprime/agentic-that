import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AddressInfo } from "node:net";

test("publishing API supports login, chunked media upload, queue scheduling, and failure details", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agenticthat-publishing-api-"));
  const uploadDir = path.join(temporaryRoot, "uploads");
  process.env.NODE_ENV = "test";
  process.env.PUBLISH_QUEUE_DATA_PATH = path.join(temporaryRoot, "store.json");
  process.env.PUBLISH_QUEUE_UPLOAD_DIR = uploadDir;
  process.env.PUBLISH_QUEUE_AUTH_TOKEN_SECRET = "test-auth-secret-that-is-longer-than-thirty-two-characters";
  process.env.PUBLISH_QUEUE_OPERATIONS_MANAGER_USERNAME = "operations.manager";
  process.env.PUBLISH_QUEUE_OPERATIONS_MANAGER_PASSWORD = "Testing@2026";
  process.env.PUBLISH_QUEUE_SCHEDULER_ENABLED = "false";
  process.env.PUBLISH_QUEUE_INTERRUPTED_POST_RECOVERY = "review";

  const { createPublishingHttpServer } = await import("./index.js");
  const server = createPublishingHttpServer({ host: "127.0.0.1", port: 0, startBackgroundServices: false });
  await new Promise<void>((resolve, reject) => {
    if (server.listening) return resolve();
    server.once("listening", resolve);
    server.once("error", reject);
  });
  context.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;
  const loginResponse = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "operations.manager", password: "Testing@2026" }),
  });
  assert.equal(loginResponse.status, 200);
  const login = await loginResponse.json() as { token: string };
  assert.ok(login.token);

  async function api(route: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${login.token}`);
    if (typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    return fetch(`${origin}${route}`, { ...init, headers });
  }

  const accountResponse = await api("/api/platforms/facebook/accounts", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Facebook test account",
      handle: "@agenticthat-test",
      enabled: true,
    }),
  });
  assert.equal(accountResponse.status, 201);
  const account = await accountResponse.json() as { id: string };

  const media = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const stagedResponse = await api("/api/staged-uploads", {
    method: "POST",
    body: JSON.stringify({ originalName: "test-post.png", mimeType: "image/png", size: media.length }),
  });
  assert.equal(stagedResponse.status, 201);
  const staged = await stagedResponse.json() as { id: string };

  const invalidStagedIdResponse = await api("/api/staged-uploads/not-a-stage/chunks", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "X-Upload-Offset": "0" },
    body: media,
  });
  assert.equal(invalidStagedIdResponse.status, 400);

  const wrongOffsetResponse = await api(`/api/staged-uploads/${staged.id}/chunks`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "X-Upload-Offset": "4" },
    body: media,
  });
  assert.equal(wrongOffsetResponse.status, 409);

  const chunkResponse = await api(`/api/staged-uploads/${staged.id}/chunks`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "X-Upload-Offset": "0" },
    body: media,
  });
  assert.equal(chunkResponse.status, 200);

  const postResponse = await api("/api/posts/unified/staged", {
    method: "POST",
    body: JSON.stringify({
      stagedUploadId: staged.id,
      title: "",
      description: "Publishing integration test",
      destinations: [{ accountId: account.id }],
    }),
  });
  assert.equal(postResponse.status, 201);
  const posts = await postResponse.json() as Array<{ id: string; fileName: string; status: string; attemptCount: number }>;
  assert.equal(posts.length, 1);
  assert.equal(posts[0].status, "queued");
  assert.equal(posts[0].attemptCount, 0);
  await fs.access(path.join(uploadDir, posts[0].fileName));

  const scheduleResponse = await api("/api/schedules", {
    method: "POST",
    body: JSON.stringify({ name: "Daily test schedule", time: "09:30", frequency: "daily", status: "active" }),
  });
  assert.equal(scheduleResponse.status, 201);
  const schedule = await scheduleResponse.json() as { id: number };

  const scheduledAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const scheduledResponse = await api(`/api/uploads/${posts[0].id}`, {
    method: "PATCH",
    body: JSON.stringify({
      caption: "Publishing integration test",
      scheduledAt,
    }),
  });
  assert.equal(scheduledResponse.status, 200);
  const scheduledPost = await scheduledResponse.json() as { scheduledAt?: string; scheduleId?: number; status: string };
  assert.equal(scheduledPost.status, "queued");
  assert.equal(scheduledPost.scheduledAt, scheduledAt);
  assert.equal(scheduledPost.scheduleId, undefined);

  const { isUploadReadyForAutomation } = await import("./local-storage.js");
  assert.equal(isUploadReadyForAutomation(scheduledPost as never, Date.now()), false);
  assert.equal(isUploadReadyForAutomation(scheduledPost as never, Date.parse(scheduledAt) + 1), true);

  const reusableScheduleResponse = await api(`/api/uploads/${posts[0].id}`, {
    method: "PATCH",
    body: JSON.stringify({
      caption: "Publishing integration test",
      scheduledAt: null,
      scheduleId: schedule.id,
    }),
  });
  assert.equal(reusableScheduleResponse.status, 200);
  const reusableScheduledPost = await reusableScheduleResponse.json() as { scheduledAt?: string; scheduleId?: number };
  assert.equal(reusableScheduledPost.scheduledAt, undefined);
  assert.equal(reusableScheduledPost.scheduleId, schedule.id);

  const processingResponse = await api(`/api/uploads/${posts[0].id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "processing" }),
  });
  assert.equal(processingResponse.status, 200);
  const { recoverInterruptedPublishingWork } = await import("./local-storage.js");
  const recovery = await recoverInterruptedPublishingWork();
  assert.equal(recovery.recoveredUploads, 1);
  assert.equal(recovery.recoveryMode, "review");
  const recoveredUploadsResponse = await api("/api/uploads");
  const recoveredUploads = await recoveredUploadsResponse.json() as Array<{ id: string; status: string; failureReason?: string; attemptCount?: number }>;
  const recoveredPost = recoveredUploads.find(upload => upload.id === posts[0].id);
  assert.equal(recoveredPost?.status, "failed");
  assert.equal(recoveredPost?.attemptCount, 1);
  assert.match(recoveredPost?.failureReason || "", /stopped during publishing/i);
  assert.match(recoveredPost?.failureReason || "", /prevent a duplicate/i);

  const failedResponse = await api(`/api/uploads/${posts[0].id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "failed", failureReason: "Test failure details" }),
  });
  assert.equal(failedResponse.status, 200);
  const failedPost = await failedResponse.json() as { status: string; failureReason?: string };
  assert.equal(failedPost.status, "failed");
  assert.match(failedPost.failureReason || "", /Test failure details/);
});
