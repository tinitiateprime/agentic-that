import assert from "node:assert/strict";
import test from "node:test";
import { supabaseJobControlTestHelpers } from "./supabase-job-control.js";

test("Supabase Storage signed paths retain the storage API prefix", () => {
  assert.equal(
    supabaseJobControlTestHelpers.absoluteSignedArtifactUrl(
      "https://project.supabase.co",
      "/object/sign/job-artifacts/workspace/file.jpg?token=secret",
    ),
    "https://project.supabase.co/storage/v1/object/sign/job-artifacts/workspace/file.jpg?token=secret",
  );
  assert.equal(
    supabaseJobControlTestHelpers.absoluteSignedArtifactUrl(
      "https://project.supabase.co",
      "/storage/v1/object/sign/job-artifacts/workspace/file.jpg?token=secret",
    ),
    "https://project.supabase.co/storage/v1/object/sign/job-artifacts/workspace/file.jpg?token=secret",
  );
});

test("new Supabase API keys are never misused as bearer JWTs", () => {
  assert.deepEqual(
    supabaseJobControlTestHelpers.supabaseApiHeaders("sb_publishable_example"),
    { apikey: "sb_publishable_example" },
  );
  assert.deepEqual(
    supabaseJobControlTestHelpers.supabaseApiHeaders("eyJlegacy.jwt.value"),
    { apikey: "eyJlegacy.jwt.value", authorization: "Bearer eyJlegacy.jwt.value" },
  );
});

test("an existing private media bucket is accepted during cold starts", () => {
  assert.equal(supabaseJobControlTestHelpers.storageResourceAlreadyExists(409, "Conflict"), true);
  assert.equal(supabaseJobControlTestHelpers.storageResourceAlreadyExists(400, "The resource already exists"), true);
  assert.equal(supabaseJobControlTestHelpers.storageResourceAlreadyExists(400, "Bucket already exists"), true);
  assert.equal(supabaseJobControlTestHelpers.storageResourceAlreadyExists(400, "Invalid bucket configuration"), false);
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
