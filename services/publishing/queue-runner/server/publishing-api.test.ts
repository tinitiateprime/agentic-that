import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AddressInfo } from "node:net";

test("publishing API supports login, media and text posts, queue scheduling, and failure details", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agenticthat-publishing-api-"));
  const uploadDir = path.join(temporaryRoot, "uploads");
  (process.env as Record<string, string | undefined>).NODE_ENV = "test";
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
  const healthResponse = await fetch(`${origin}/api/health`);
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json() as {
    companionInstanceId?: string;
    capabilities?: { instagramScraping?: { available?: boolean; concurrency?: number } };
  };
  assert.equal(health.capabilities?.instagramScraping?.available, false);
  assert.equal(health.capabilities?.instagramScraping?.concurrency, 1);

  const unauthenticatedScrape = await fetch(`${origin}/api/scraping/instagram/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "profile", keyword: "instagram" }),
  });
  assert.equal(unauthenticatedScrape.status, 401);

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

  const unavailableCompanionScrape = await api("/api/scraping/instagram/jobs", {
    method: "POST",
    body: JSON.stringify({ mode: "profile", keyword: "instagram" }),
  });
  assert.equal(unavailableCompanionScrape.status, 503);
  assert.equal(
    ((await unavailableCompanionScrape.json()) as { code?: string }).code,
    "companion_unavailable",
  );

  const missingApiRoute = await api("/api/compatibility-route-that-does-not-exist", {
    method: "POST",
    body: "{}",
  });
  assert.equal(missingApiRoute.status, 404);
  assert.match(missingApiRoute.headers.get("content-type") ?? "", /application\/json/);
  assert.match(
    ((await missingApiRoute.json()) as { message: string }).message,
    /Publishing API route not found/,
  );

  const accountResponse = await api("/api/platforms/facebook/accounts", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Facebook test account",
      handle: "@agenticthat-test",
      enabled: true,
    }),
  });
  assert.equal(accountResponse.status, 201);
  const account = await accountResponse.json() as { id: string; executionEngine?: string; safetyMode?: string; twoFactorEnabled?: boolean };
  assert.equal(account.executionEngine, "companion");
  assert.equal(account.safetyMode, "protected");
  assert.equal(account.twoFactorEnabled, false);

  const { bindPublishingAccountsToCompanion, getPlatformAccount, pausePlatformAccountForSafety, updatePlatformAccountCredentialState } = await import("./local-storage.js");
  await updatePlatformAccountCredentialState(account.id, true);
  const binding = await bindPublishingAccountsToCompanion("companion_test_rebound");
  assert.ok(binding.rebound > 0);
  const reboundAccount = await getPlatformAccount(account.id);
  assert.equal(reboundAccount?.executionEngine, "companion");
  assert.equal(reboundAccount?.companionId, "companion_test_rebound");
  assert.equal(reboundAccount?.credentialConfigured, true);
  await bindPublishingAccountsToCompanion(health.companionInstanceId!);
  await pausePlatformAccountForSafety(account.id, "warning", "Uncertain publish result requires review.");
  const pausedAccounts = await (await api("/api/accounts?platform=facebook")).json() as Array<{
    id: string;
    enabled: boolean;
    safetyStatus?: string;
  }>;
  const pausedAccount = pausedAccounts.find(item => item.id === account.id);
  assert.equal(pausedAccount?.enabled, false);
  assert.equal(pausedAccount?.safetyStatus, "warning");

  const resumeResponse = await api(`/api/accounts/${account.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      displayName: "Facebook test account",
      handle: "@agenticthat-test",
      enabled: true,
      executionEngine: "external_browser",
      safetyMode: "standard",
      twoFactorEnabled: true,
    }),
  });
  assert.equal(resumeResponse.status, 200);
  const resumedAccount = await resumeResponse.json() as { enabled: boolean; credentialConfigured: boolean; executionEngine?: string; safetyStatus?: string; safetyReason?: string; safetyMode?: string; twoFactorEnabled?: boolean };
  assert.equal(resumedAccount.enabled, true);
  assert.equal(resumedAccount.executionEngine, "companion");
  assert.equal(resumedAccount.credentialConfigured, true);
  assert.equal(resumedAccount.safetyStatus, "healthy");
  assert.equal(resumedAccount.safetyReason, undefined);
  assert.equal(resumedAccount.safetyMode, "standard");
  assert.equal(resumedAccount.twoFactorEnabled, true);

  const unsafeLinkResponse = await api("/api/posts/unified/text", {
    method: "POST",
    body: JSON.stringify({
      description: "Internal setup: http://admin:secret@192.168.1.5/setup",
      destinations: [{ accountId: account.id }],
    }),
  });
  assert.equal(unsafeLinkResponse.status, 422);
  const unsafeLinkError = await unsafeLinkResponse.json() as { code?: string; issues?: Array<{ code: string }> };
  assert.equal(unsafeLinkError.code, "CONTENT_PREFLIGHT_BLOCKED");
  assert.equal(unsafeLinkError.issues?.some(issue => issue.code === "private_link"), true);

  const { signPublishingWorkspaceIdentity } = await import("../../../../lib/publishing-workspace-auth.js");
  const { signServiceAccessToken } = await import("../../../../lib/service-access-token.js");
  const scrapingIdentityToken = signServiceAccessToken({
    audience: "scraping",
    subject: "instagram-scraping-user",
    workspaceId: "instagram-scraping-workspace",
    name: "Instagram Scraping User",
    email: "scraping@example.test",
    grants: { "scraping.instagram": "operate", "scraping.facebook": "none" },
    capabilities: ["scraping.view", "scraping.run"],
  });
  const scrapingSessionResponse = await fetch(`${origin}/api/auth/platform/instagram-scraping`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: scrapingIdentityToken }),
  });
  assert.equal(scrapingSessionResponse.status, 200);
  const scrapingSession = await scrapingSessionResponse.json() as { token: string; expiresInSeconds: number };
  assert.ok(scrapingSession.token);
  assert.ok(scrapingSession.expiresInSeconds >= 300);
  const scopedScrapeResponse = await fetch(`${origin}/api/scraping/instagram/jobs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${scrapingSession.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ mode: "profile", keyword: "instagram" }),
  });
  assert.equal(scopedScrapeResponse.status, 503);
  const scopedPublishingResponse = await fetch(`${origin}/api/accounts`, {
    headers: { Authorization: `Bearer ${scrapingSession.token}` },
  });
  assert.equal(scopedPublishingResponse.status, 401);

  async function platformSession(platformUserId: string, workspaceId: string, email: string) {
    const identityToken = signPublishingWorkspaceIdentity({
      sub: platformUserId,
      workspaceId,
      workspaceKey: `workspace-key-${workspaceId}-that-is-long-enough`,
      name: platformUserId,
      email,
      businessName: workspaceId,
      capabilities: [
        "publishing.view",
        "publishing.content.create",
        "publishing.content.edit",
        "publishing.destinations.select",
        "publishing.submissions.create",
        "publishing.schedule.manage",
        "publishing.accounts.configure",
        "publishing.execute",
      ],
    });
    const statusResponse = await fetch(`${origin}/api/auth/platform/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: identityToken }),
    });
    assert.equal(statusResponse.status, 200);
    const initialStatus = await statusResponse.json() as { configured: boolean; username: string };
    assert.equal(initialStatus.configured, false);
    assert.equal(initialStatus.username, email);
    const setupResponse = await fetch(`${origin}/api/auth/platform/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: identityToken, password: "OwnerPassword@2026" }),
    });
    assert.equal(setupResponse.status, 200);
    const setupResult = await setupResponse.json() as { user: { username: string } };
    assert.equal(setupResult.user.username, email);
    const repeatedSetup = await fetch(`${origin}/api/auth/platform/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: identityToken, password: "Replacement@2026" }),
    });
    assert.equal(repeatedSetup.status, 400);
    const wrongLogin = await fetch(`${origin}/api/auth/platform/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: identityToken, password: "WrongPassword" }),
    });
    assert.equal(wrongLogin.status, 401);
    const loginResponse = await fetch(`${origin}/api/auth/platform/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: identityToken, password: "OwnerPassword@2026" }),
    });
    assert.equal(loginResponse.status, 200);
    return loginResponse.json() as Promise<{ token: string }>;
  }
  const [workspaceA, workspaceB] = await Promise.all([
    platformSession("Owner A", "workspace_a", "owner-a@example.com"),
    platformSession("Owner B", "workspace_b", "owner-b@example.com"),
  ]);
  const workspaceApi = (token: string, route: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (typeof init.body === "string") headers.set("Content-Type", "application/json");
    return fetch(`${origin}${route}`, { ...init, headers });
  };
  const workspaceAccountResponse = await workspaceApi(workspaceA.token, "/api/platforms/facebook/accounts", {
    method: "POST",
    body: JSON.stringify({ displayName: "Workspace A Facebook", handle: "@private-a", enabled: true }),
  });
  assert.equal(workspaceAccountResponse.status, 201);
  const workspaceAccount = await workspaceAccountResponse.json() as { id: string };
  const disabledWorkspaceAccountResponse = await workspaceApi(workspaceA.token, "/api/platforms/facebook/accounts", {
    method: "POST",
    body: JSON.stringify({ displayName: "Disabled Workspace A Facebook", handle: "@disabled-a", enabled: false }),
  });
  assert.equal(disabledWorkspaceAccountResponse.status, 201);
  const workspaceBAccounts = await (await workspaceApi(workspaceB.token, "/api/accounts")).json() as unknown[];
  assert.equal(workspaceBAccounts.length, 0);
  const crossWorkspaceUpdate = await workspaceApi(workspaceB.token, `/api/accounts/${workspaceAccount.id}`, {
    method: "PATCH",
    body: JSON.stringify({ displayName: "Should fail", handle: "@private-a", enabled: true }),
  });
  assert.equal(crossWorkspaceUpdate.status, 404);
  const workspaceAUsers = await (await workspaceApi(workspaceA.token, "/api/users")).json() as unknown[];
  const workspaceBUsers = await (await workspaceApi(workspaceB.token, "/api/users")).json() as unknown[];
  assert.equal(workspaceAUsers.length, 1);
  assert.equal(workspaceBUsers.length, 1);
  const workspaceASubmissionResponse = await workspaceApi(workspaceA.token, "/api/submissions/text", {
    method: "POST",
    body: JSON.stringify({ description: "Private Workspace A handoff", selectedAccountIds: [workspaceAccount.id] }),
  });
  assert.equal(workspaceASubmissionResponse.status, 201);
  const workspaceASubmissions = await (await workspaceApi(workspaceA.token, "/api/submissions")).json() as unknown[];
  const workspaceBSubmissions = await (await workspaceApi(workspaceB.token, "/api/submissions")).json() as unknown[];
  assert.equal(workspaceASubmissions.length, 1);
  assert.equal(workspaceBSubmissions.length, 0);

  const centralUploaderToken = signPublishingWorkspaceIdentity({
    sub: "central-uploader-a",
    workspaceId: "workspace_a",
    name: "Central Uploader A",
    email: "uploader-a@example.com",
    grants: { "publishing.facebook": "configure" },
    capabilities: [
      "publishing.view",
      "publishing.content.create",
      "publishing.content.edit",
      "publishing.destinations.select",
      "publishing.submissions.create",
    ],
  });
  const uploaderAccountsResponse = await workspaceApi(centralUploaderToken, "/api/accounts");
  assert.equal(uploaderAccountsResponse.status, 200);
  const uploaderAccounts = await uploaderAccountsResponse.json() as Array<{ id: string; enabled: boolean }>;
  assert.deepEqual(uploaderAccounts.map(account => account.id), [workspaceAccount.id]);
  assert.equal(uploaderAccounts.every(account => account.enabled), true);
  const noRoleToken = signPublishingWorkspaceIdentity({
    sub: "central-no-role-a",
    workspaceId: "workspace_a",
    name: "No Publishing Role",
    email: "no-role-a@example.com",
    grants: { "publishing.facebook": "configure" },
    capabilities: [],
  });
  assert.equal((await workspaceApi(noRoleToken, "/api/accounts")).status, 403);
  assert.equal((await workspaceApi(centralUploaderToken, "/api/platforms/facebook/accounts", {
    method: "POST",
    body: JSON.stringify({ displayName: "Uploader bypass", handle: "@uploader-bypass", enabled: true }),
  })).status, 403);
  assert.equal((await workspaceApi(centralUploaderToken, "/api/posts/unified/text", {
    method: "POST",
    body: JSON.stringify({ description: "Uploader direct publish bypass", destinations: [{ accountId: workspaceAccount.id }] }),
  })).status, 403);
  assert.equal((await workspaceApi(centralUploaderToken, "/api/users")).status, 403);
  const centralHandoffResponse = await workspaceApi(centralUploaderToken, "/api/submissions/text", {
    method: "POST",
    body: JSON.stringify({ description: "Central role handoff", selectedAccountIds: [workspaceAccount.id] }),
  });
  assert.equal(centralHandoffResponse.status, 201);
  const centralHandoff = await centralHandoffResponse.json() as { id: string };
  assert.equal((await workspaceApi(centralUploaderToken, `/api/submissions/${centralHandoff.id}/schedule`, {
    method: "POST",
    body: JSON.stringify({ destinations: [{ accountId: workspaceAccount.id, scheduledAt: new Date(Date.now() + 20 * 60_000).toISOString() }] }),
  })).status, 403);

  const centralSchedulerToken = signPublishingWorkspaceIdentity({
    sub: "central-scheduler-a",
    workspaceId: "workspace_a",
    name: "Central Scheduler A",
    email: "scheduler-a@example.com",
    grants: { "publishing.facebook": "configure" },
    capabilities: ["publishing.view", "publishing.schedule.manage"],
  });
  const centralScheduleResponse = await workspaceApi(centralSchedulerToken, `/api/submissions/${centralHandoff.id}/schedule`, {
    method: "POST",
    body: JSON.stringify({ destinations: [{ accountId: workspaceAccount.id, scheduledAt: new Date(Date.now() + 20 * 60_000).toISOString() }] }),
  });
  assert.equal(centralScheduleResponse.status, 201);

  const textPostResponse = await api("/api/posts/unified/text", {
    method: "POST",
    body: JSON.stringify({
      description: "Text-only publishing integration test",
      destinations: [{ accountId: account.id }],
    }),
  });
  assert.equal(textPostResponse.status, 201);
  const textPosts = await textPostResponse.json() as Array<{
    postFormat?: string;
    fileName: string;
    mimeType: string;
    url: string;
    status: string;
  }>;
  assert.equal(textPosts.length, 1);
  assert.equal(textPosts[0].postFormat, "text");
  assert.equal(textPosts[0].fileName, "");
  assert.equal(textPosts[0].mimeType, "text/plain");
  assert.equal(textPosts[0].url, "");
  assert.equal(textPosts[0].status, "queued");
  const { requeueAccountSessionFailures, updateUploadStatus: setStoredUploadStatus } = await import("./local-storage.js");
  await setStoredUploadStatus(textPosts[0].id, "processing", "Testing a failed saved session");
  await setStoredUploadStatus(textPosts[0].id, "failed", "Facebook saved browser session is not active. Login is required.");
  assert.deepEqual(await requeueAccountSessionFailures(account.id), [textPosts[0].id]);
  const recoveredTextPost = (await (await api("/api/uploads")).json() as Array<{ id: string; status: string; failureReason?: string }>)
    .find(item => item.id === textPosts[0].id);
  assert.equal(recoveredTextPost?.status, "queued");
  assert.equal(recoveredTextPost?.failureReason, undefined);

  const instagramAccountResponse = await api("/api/platforms/instagram/accounts", {
    method: "POST",
    body: JSON.stringify({
      displayName: "Instagram test account",
      handle: "@agenticthat-instagram-test",
      enabled: true,
    }),
  });
  assert.equal(instagramAccountResponse.status, 201);
  const instagramAccount = await instagramAccountResponse.json() as { id: string };
  const unsupportedTextResponse = await api("/api/posts/unified/text", {
    method: "POST",
    body: JSON.stringify({
      description: "Instagram must reject this text-only post",
      destinations: [{ accountId: instagramAccount.id }],
    }),
  });
  assert.equal(unsupportedTextResponse.status, 400);
  const unsupportedText = await unsupportedTextResponse.json() as { message: string };
  assert.match(unsupportedText.message, /Instagram does not support text posts/i);

  const consentWithoutCompanion = await api("/api/automation/consent", { method: "POST" });
  assert.equal(consentWithoutCompanion.status, 409);
  assert.match((await consentWithoutCompanion.json() as { message: string }).message, /Open Publishing Companion/i);

  const xAccountResponse = await api("/api/platforms/x/accounts", {
    method: "POST",
    body: JSON.stringify({ displayName: "X safety account", handle: "@agenticthat-safety", enabled: true }),
  });
  assert.equal(xAccountResponse.status, 201);
  const xAccount = await xAccountResponse.json() as { id: string };
  const firstXPostResponse = await api("/api/posts/unified/text", {
    method: "POST",
    body: JSON.stringify({ description: "First X safety post", destinations: [{ accountId: xAccount.id }] }),
  });
  assert.equal(firstXPostResponse.status, 201);
  const [firstXPost] = await firstXPostResponse.json() as Array<{ id: string }>;
  assert.equal((await api(`/api/uploads/${firstXPost.id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "processing" }),
  })).status, 200);
  assert.equal((await api(`/api/uploads/${firstXPost.id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "posted" }),
  })).status, 200);

  const safetyAssessmentResponse = await api("/api/publishing-safety/assess", {
    method: "POST",
    body: JSON.stringify({ postFormat: "text", destinations: [{ accountId: xAccount.id }] }),
  });
  assert.equal(safetyAssessmentResponse.status, 200);
  const safetyAssessment = await safetyAssessmentResponse.json() as {
    allowed: boolean;
    issues: Array<{ accountId: string; earliestAt: string }>;
  };
  assert.equal(safetyAssessment.allowed, true);
  assert.equal(safetyAssessment.issues[0]?.accountId, xAccount.id);
  assert.ok(Date.parse(safetyAssessment.issues[0]?.earliestAt) > Date.now());

  const mixedSafetyPostResponse = await api("/api/posts/unified/text", {
    method: "POST",
    body: JSON.stringify({
      description: "Mixed destination safety post",
      destinations: [{ accountId: xAccount.id }, { accountId: account.id }],
    }),
  });
  assert.equal(mixedSafetyPostResponse.status, 201);
  const mixedSafetyPosts = await mixedSafetyPostResponse.json() as Array<{
    id: string;
    accountId: string;
    safetyDeferredUntil?: string;
    safetyReason?: string;
  }>;
  assert.equal(mixedSafetyPosts.length, 2);
  const deferredXPost = mixedSafetyPosts.find(post => post.accountId === xAccount.id);
  const readyFacebookPost = mixedSafetyPosts.find(post => post.accountId === account.id);
  assert.ok(Date.parse(deferredXPost?.safetyDeferredUntil ?? "") > Date.now());
  assert.match(deferredXPost?.safetyReason ?? "", /Other selected accounts can continue/i);
  assert.equal(readyFacebookPost?.safetyDeferredUntil, undefined);
  const { automationInput: loadAutomationInput } = await import("./local-storage.js");
  const mixedAutomationInput = await loadAutomationInput();
  const readyAutomationIds = new Set(Object.values(mixedAutomationInput.channels).flat().map(post => post.id));
  assert.equal(readyAutomationIds.has(readyFacebookPost!.id), true);
  assert.equal(readyAutomationIds.has(deferredXPost!.id), false);

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
      rightsConfirmed: true,
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

  const roleUsers = [
    { username: "handoff.uploader", fullName: "Handoff Uploader", role: "post_uploader", password: "Uploader@2026" },
    { username: "handoff.scheduler", fullName: "Handoff Scheduler", role: "scheduler", password: "Scheduler@2026" },
    { username: "handoff.viewer", fullName: "Handoff Viewer", role: "viewer", password: "ViewerPass@2026" },
  ] as const;
  for (const roleUser of roleUsers) {
    const createUserResponse = await api("/api/users", {
      method: "POST",
      body: JSON.stringify(roleUser),
    });
    assert.equal(createUserResponse.status, 201);
  }

  async function roleLogin(username: string, password: string) {
    const response = await fetch(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    assert.equal(response.status, 200);
    return response.json() as Promise<{ token: string }>;
  }
  const [uploaderLogin, schedulerLogin, viewerLogin] = await Promise.all([
    roleLogin("handoff.uploader", "Uploader@2026"),
    roleLogin("handoff.scheduler", "Scheduler@2026"),
    roleLogin("handoff.viewer", "ViewerPass@2026"),
  ]);
  const roleApi = (token: string, route: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    return fetch(`${origin}${route}`, { ...init, headers });
  };

  const uploadsBeforeHandoff = await (await api("/api/uploads")).json() as unknown[];
  const handoffResponse = await roleApi(uploaderLogin.token, "/api/submissions/text", {
    method: "POST",
    body: JSON.stringify({ description: "Persistent uploader to scheduler handoff", selectedAccountIds: [account.id] }),
  });
  assert.equal(handoffResponse.status, 201);
  const handoff = await handoffResponse.json() as { id: string; status: string; description: string; createdByUserId: string };
  assert.equal(handoff.status, "awaiting_schedule");
  assert.equal((await (await api("/api/uploads")).json() as unknown[]).length, uploadsBeforeHandoff.length);

  const uploaderDirectPublish = await roleApi(uploaderLogin.token, "/api/posts/unified/text", {
    method: "POST",
    body: JSON.stringify({ description: "Must not bypass scheduler", destinations: [{ accountId: account.id }] }),
  });
  assert.equal(uploaderDirectPublish.status, 403);
  assert.equal((await roleApi(uploaderLogin.token, "/api/platforms/facebook/accounts", {
    method: "POST",
    body: JSON.stringify({ displayName: "Forbidden", handle: "@forbidden", enabled: true }),
  })).status, 403);

  const schedulerSubmissionsResponse = await roleApi(schedulerLogin.token, "/api/submissions");
  assert.equal(schedulerSubmissionsResponse.status, 200);
  const schedulerSubmissions = await schedulerSubmissionsResponse.json() as Array<{ id: string; status: string }>;
  assert.equal(schedulerSubmissions.some(submission => submission.id === handoff.id && submission.status === "awaiting_schedule"), true);
  assert.equal((await roleApi(schedulerLogin.token, "/api/submissions/text", {
    method: "POST",
    body: JSON.stringify({ description: "Schedulers cannot create content" }),
  })).status, 403);
  assert.equal((await roleApi(schedulerLogin.token, "/api/automation/consent", {
    method: "POST",
  })).status, 403);

  const handoffScheduledAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const scheduleHandoffResponse = await roleApi(schedulerLogin.token, `/api/submissions/${handoff.id}/schedule`, {
    method: "POST",
    body: JSON.stringify({ destinations: [{ accountId: account.id, scheduledAt: handoffScheduledAt }] }),
  });
  assert.equal(scheduleHandoffResponse.status, 201);
  const scheduledHandoff = await scheduleHandoffResponse.json() as {
    submission: { status: string; destinationUploadIds: string[] };
    uploads: Array<{ caption: string; scheduledAt?: string; createdByUserId?: string; scheduledByUserId?: string; sourceSubmissionId?: string }>;
  };
  assert.equal(scheduledHandoff.submission.status, "scheduled");
  assert.equal(scheduledHandoff.submission.destinationUploadIds.length, 1);
  assert.equal(scheduledHandoff.uploads[0].caption, handoff.description);
  assert.equal(scheduledHandoff.uploads[0].scheduledAt, handoffScheduledAt);
  assert.equal(scheduledHandoff.uploads[0].createdByUserId, handoff.createdByUserId);
  assert.ok(scheduledHandoff.uploads[0].scheduledByUserId);
  assert.notEqual(scheduledHandoff.uploads[0].scheduledByUserId, handoff.createdByUserId);
  assert.equal(scheduledHandoff.uploads[0].sourceSubmissionId, handoff.id);
  assert.equal((await roleApi(schedulerLogin.token, `/api/submissions/${handoff.id}/schedule`, {
    method: "POST",
    body: JSON.stringify({ destinations: [{ accountId: account.id, scheduledAt: handoffScheduledAt }] }),
  })).status, 400);

  assert.equal((await roleApi(viewerLogin.token, "/api/submissions")).status, 200);
  assert.equal((await roleApi(viewerLogin.token, "/api/uploads")).status, 200);
  assert.equal((await roleApi(viewerLogin.token, `/api/submissions/${handoff.id}/schedule`, {
    method: "POST",
    body: JSON.stringify({ destinations: [{ accountId: account.id, scheduledAt: handoffScheduledAt }] }),
  })).status, 403);
  assert.equal((await roleApi(viewerLogin.token, "/api/users")).status, 403);
  assert.equal((await roleApi(viewerLogin.token, "/api/automation/stop", { method: "POST" })).status, 403);

  const idleStopResponse = await api("/api/automation/stop", { method: "POST" });
  assert.equal(idleStopResponse.status, 200);
  assert.deepEqual(await idleStopResponse.json(), {
    stopped: false,
    message: "No publishing automation is running.",
  });
  const stopAudit = await (await api("/api/activity-logs?limit=20")).json() as Array<{ action: string }>;
  assert.equal(stopAudit.some(entry => entry.action === "automation.stop_checked"), true);

  const processingResponse = await api(`/api/uploads/${posts[0].id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "processing" }),
  });
  assert.equal(processingResponse.status, 200);
  const { recoverInterruptedPublishingWork, updateUploadPublishActionState } = await import("./local-storage.js");
  await updateUploadPublishActionState(posts[0].id, "submitted");
  process.env.PUBLISH_QUEUE_INTERRUPTED_POST_RECOVERY = "retry";
  const recovery = await recoverInterruptedPublishingWork();
  assert.equal(recovery.recoveredUploads, 1);
  assert.equal(recovery.recoveryMode, "retry");
  process.env.PUBLISH_QUEUE_INTERRUPTED_POST_RECOVERY = "review";
  const recoveredUploadsResponse = await api("/api/uploads");
  const recoveredUploads = await recoveredUploadsResponse.json() as Array<{
    id: string;
    status: string;
    failureReason?: string;
    attemptCount?: number;
    publishActionState?: string;
  }>;
  const recoveredPost = recoveredUploads.find(upload => upload.id === posts[0].id);
  assert.equal(recoveredPost?.status, "failed");
  assert.equal(recoveredPost?.attemptCount, 1);
  assert.equal(recoveredPost?.publishActionState, "uncertain");
  assert.match(recoveredPost?.failureReason || "", /after the final publish action/i);
  assert.match(recoveredPost?.failureReason || "", /automatic retry is blocked/i);

  const blockedRetryResponse = await api(`/api/uploads/${posts[0].id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "queued" }),
  });
  assert.equal(blockedRetryResponse.status, 400);
  assert.match((await blockedRetryResponse.json() as { message: string }).message, /may already be published/i);

  const failedResponse = await api(`/api/uploads/${posts[0].id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "failed", failureReason: "Test failure details" }),
  });
  assert.equal(failedResponse.status, 200);
  const failedPost = await failedResponse.json() as { status: string; failureReason?: string };
  assert.equal(failedPost.status, "failed");
  assert.match(failedPost.failureReason || "", /Test failure details/);
});
