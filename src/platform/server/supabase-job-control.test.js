import assert from "node:assert/strict";
import test from "node:test";
import { readSupabasePublishingMediaObject, supabaseJobControlTestHelpers } from "./supabase-job-control.js";
import { presignObjectUrl, signMediaToken, verifyMediaToken } from "./object-storage.js";

const MEDIA = {
  MEDIA_S3_ENDPOINT: "https://fsn1.media.example.test",
  MEDIA_S3_REGION: "fsn1",
  MEDIA_S3_BUCKET: "agenticthat-media",
  MEDIA_S3_ACCESS_KEY_ID: "TESTACCESSKEY",
  MEDIA_S3_SECRET_ACCESS_KEY: "test-secret-access-key",
};
const BUCKET = { endpoint: MEDIA.MEDIA_S3_ENDPOINT, bucket: MEDIA.MEDIA_S3_BUCKET, accessKeyId: MEDIA.MEDIA_S3_ACCESS_KEY_ID, secretAccessKey: MEDIA.MEDIA_S3_SECRET_ACCESS_KEY, region: MEDIA.MEDIA_S3_REGION };

function withEnvironment(context, values) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  context.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

test("media reads use the bucket's own signed requests, workspace-scoped, and reject incomplete ranges", async (context) => {
  withEnvironment(context, MEDIA);
  let downloadStatus = 206;
  const calls = [];
  context.mock.method(globalThis, "fetch", async (url, options = {}) => {
    calls.push({ url, options });
    return new Response(Uint8Array.from([2, 3, 4]), { status: downloadStatus });
  });
  assert.deepEqual(await readSupabasePublishingMediaObject("workspace_1", "video.mp4", { start: 2, end: 4 }), Buffer.from([2, 3, 4]));
  assert.equal(calls[0].url, "https://fsn1.media.example.test/agenticthat-media/workspace_1/video.mp4");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.headers.range, "bytes=2-4");
  assert.match(calls[0].options.headers.authorization, /^AWS4-HMAC-SHA256 Credential=TESTACCESSKEY\/\d{8}\/fsn1\/s3\/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(calls[0].options).includes(MEDIA.MEDIA_S3_SECRET_ACCESS_KEY), "the secret is never sent");
  downloadStatus = 500;
  await assert.rejects(readSupabasePublishingMediaObject("workspace_1", "video.mp4", { start: 2, end: 4 }));
  downloadStatus = 206;
  await assert.rejects(readSupabasePublishingMediaObject("workspace_1", "video.mp4", { start: 2, end: 5 }), /incomplete/);
  await assert.rejects(readSupabasePublishingMediaObject("workspace_1", "../secret", null), /invalid/);
});

test("signed bucket links are path-style, expire, and are capped at seven days", () => {
  const now = new Date("2026-11-16T10:00:00Z");
  const url = new URL(presignObjectUrl(BUCKET, "PUT", "workspace_1/photo one.jpg.parts/0000", { expiresIn: 3600, now }));
  assert.equal(url.origin, BUCKET.endpoint);
  assert.equal(url.pathname, "/agenticthat-media/workspace_1/photo%20one.jpg.parts/0000");
  assert.equal(url.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
  assert.equal(url.searchParams.get("X-Amz-Credential"), "TESTACCESSKEY/20261116/fsn1/s3/aws4_request");
  assert.equal(url.searchParams.get("X-Amz-Date"), "20261116T100000Z");
  assert.equal(url.searchParams.get("X-Amz-Expires"), "3600");
  assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), "host");
  assert.match(url.searchParams.get("X-Amz-Signature"), /^[0-9a-f]{64}$/);
  assert.equal(presignObjectUrl(BUCKET, "PUT", "workspace_1/photo one.jpg.parts/0000", { expiresIn: 3600, now }), url.toString(), "deterministic");
  assert.equal(new URL(presignObjectUrl(BUCKET, "GET", "w/f", { expiresIn: 30 * 86400, now })).searchParams.get("X-Amz-Expires"), String(7 * 86400));
  assert.throws(() => presignObjectUrl(BUCKET, "GET", "../escape", { now }), /invalid/);
});

test("AgenticThat media tokens open one object until they expire", () => {
  const now = Date.parse("2026-11-16T10:00:00Z");
  const token = signMediaToken(BUCKET, "workspace_1/photo.jpg", now + 60_000, {});
  assert.equal(verifyMediaToken(BUCKET, token, "workspace_1/photo.jpg", {}, now), "workspace_1/photo.jpg");
  assert.equal(verifyMediaToken(BUCKET, token, "workspace_2/photo.jpg", {}, now), null, "another object");
  assert.equal(verifyMediaToken(BUCKET, token, "workspace_1/photo.jpg", {}, now + 120_000), null, "expired");
  assert.equal(verifyMediaToken(BUCKET, `${token.split(".")[0]}.forged`, "workspace_1/photo.jpg", {}, now), null, "forged");
  assert.equal(verifyMediaToken({ ...BUCKET, secretAccessKey: "other" }, token, "workspace_1/photo.jpg", {}, now), null, "another bucket key");
});

test("direct media upload parts use bounded, workspace-scoped object paths", () => {
  assert.equal(
    supabaseJobControlTestHelpers.artifactPartObjectPath("workspace_1", "media_demo.mp4", 7),
    "workspace_1/media_demo.mp4.parts/0007",
  );
  assert.doesNotThrow(() => supabaseJobControlTestHelpers.validateArtifactPartInput({
    index: 0,
    offset: 0,
    byteSize: 5 * 1024 * 1024,
  }));
  assert.throws(() => supabaseJobControlTestHelpers.validateArtifactPartInput({ index: 0, offset: 0, byteSize: 5 * 1024 * 1024 + 1 }));
  assert.throws(() => supabaseJobControlTestHelpers.validateArtifactPartInput({ index: -1, offset: 0, byteSize: 1 }));
});

test("Companion status is derived from heartbeat freshness and minimum version", () => {
  const current = new Date().toISOString();
  const base = {
    id: "companion_1",
    workspace_id: "workspace_1",
    label: "Office PC",
    companion_instance_id: "instance_1",
    version: "2.1.4",
    runtime_status: "ready",
    update_status: "idle",
    last_error: null,
    platform: "win32",
    architecture: "x64",
    secure_storage: true,
    last_seen_at: current,
    paired_at: current,
    updated_at: current,
    revoked_at: null,
  };
  assert.equal(supabaseJobControlTestHelpers.publicDevice(base, "2.1.4").status, "online");
  assert.equal(supabaseJobControlTestHelpers.publicDevice({ ...base, version: "2.1.3" }, "2.1.4").status, "outdated");
  assert.equal(supabaseJobControlTestHelpers.publicDevice({ ...base, revoked_at: current }, "2.1.4").status, "offline");
});

test("normalized account readiness never exposes local credentials", () => {
  const account = supabaseJobControlTestHelpers.camelAccount({
    id: "account_1",
    workspace_id: "workspace_1",
    companion_device_id: "companion_1",
    platform: "instagram",
    display_name: "Example",
    handle: "example",
    login_identifier: "example@example.com",
    enabled: true,
    credential_configured: false,
    session_status: "reconnect_required",
    safety_status: "healthy",
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { status: "online" });
  assert.equal(account.readiness, "reconnect_required");
  assert.equal(account.credentialConfigured, false);
  assert.equal(Object.hasOwn(account, "cookies"), false);
  assert.equal(Object.hasOwn(account, "password"), false);
});

test("Supabase account metadata preserves provider-safe publishing engines", () => {
  assert.equal(supabaseJobControlTestHelpers.publishingEngineForPlatform("instagram", "companion"), "companion");
  assert.equal(supabaseJobControlTestHelpers.publishingEngineForPlatform("instagram", "external_browser"), "external_browser");
  assert.equal(supabaseJobControlTestHelpers.publishingEngineForPlatform("facebook", "companion"), "external_browser");
  assert.equal(supabaseJobControlTestHelpers.publishingEngineForPlatform("x", "companion"), "external_browser");
  assert.equal(supabaseJobControlTestHelpers.publishingEngineForPlatform("youtube", "companion"), "external_browser");
  const account = supabaseJobControlTestHelpers.camelAccount({
    platform: "youtube",
    enabled: true,
    credential_configured: true,
    metadata: { executionEngine: "companion" },
  }, { status: "online" });
  assert.equal(account.executionEngine, "external_browser");
});

test("LinkedIn managed Page metadata is normalized to safe direct admin URLs", () => {
  const account = supabaseJobControlTestHelpers.camelAccount({
    platform: "linkedin",
    enabled: true,
    credential_configured: true,
    metadata: {
      linkedinManagedPages: [
        { id: "117884053", name: "Tinitiate AI Solutions", pageUrl: "https://evil.example/page", pagePostsUrl: "https://evil.example/posts" },
        { id: "../unsafe", name: "Unsafe" },
      ],
      linkedinManagedPagesUpdatedAt: "2026-09-10T10:00:00.000Z",
    },
  }, { status: "online" });
  assert.deepEqual(account.linkedinManagedPages, [{
    id: "117884053",
    name: "Tinitiate AI Solutions",
    pageUrl: "https://www.linkedin.com/company/117884053/admin/",
    pagePostsUrl: "https://www.linkedin.com/company/117884053/admin/page-posts/published/",
  }]);
});

test("normalized job rows preserve durable lease and outcome fields", () => {
  const job = supabaseJobControlTestHelpers.camelJob({
    id: "job_1",
    workspace_id: "workspace_1",
    job_type: "scrape.instagram",
    platform: "instagram",
    account_id: null,
    requested_by_user_id: "user_1",
    assigned_device_id: "companion_1",
    idempotency_key: "request_1",
    priority: 100,
    status: "running",
    payload: { query: "example" },
    progress: { stage: "scraping" },
    message: "Collecting",
    error: null,
    attempt_count: 1,
    max_attempts: 3,
    lease_expires_at: new Date().toISOString(),
    final_action_started_at: null,
    not_before: new Date().toISOString(),
    started_at: new Date().toISOString(),
    completed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  assert.equal(job.type, "scrape.instagram");
  assert.equal(job.state, "running");
  assert.equal(job.attemptCount, 1);
  assert.equal(job.progress.stage, "scraping");
});

test("publishing synchronization batches only active jobs with complete relations", () => {
  const account = {
    id: "account_1",
    workspaceId: "workspace_1",
    platform: "instagram",
    executionEngine: "companion",
  };
  const upload = {
    id: "upload_1",
    accountId: account.id,
    createdByUserId: "user_1",
    artifact: { bucket: "job-artifacts", path: "workspace_1/file.png", fileName: "file.png" },
  };
  const plan = supabaseJobControlTestHelpers.publishingSynchronizationPlan(
    "workspace_1",
    [
      { id: "job_1", uploadId: upload.id, accountId: account.id, state: "queued" },
      { id: "job_done", uploadId: upload.id, accountId: account.id, state: "published" },
      { id: "job_missing", uploadId: "upload_missing", accountId: account.id, state: "queued" },
    ],
    [upload],
    [account],
  );
  assert.equal(plan.accounts.length, 1);
  assert.equal(plan.jobs.length, 1);
  assert.equal(plan.jobs[0].id, "job_1");
  assert.equal(plan.jobs[0].idempotencyKey, "publish:job_1");
  assert.equal(plan.jobs[0].payload.upload.artifact.path, "workspace_1/file.png");
});
