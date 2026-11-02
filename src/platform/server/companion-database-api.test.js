import assert from "node:assert/strict";
import test from "node:test";
import {
  companionDownloadUrls, companionPairingConfiguration, handleCompanionMedia,
  handleCompanionRpc, validateCompanionRpc,
} from "./companion-database-api.js";

const environment = {
  COMPANION_RPC_TRANSPORT: "postgres",
  PLATFORM_PUBLIC_URL: "https://www.example.test",
  NEXT_PUBLIC_SUPABASE_URL: "https://storage.example.test",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_companion_test",
};
const token = "test-token-".repeat(8);
const instance = "companion-test-installation";
const request = (body, headers = {}) => new Request("https://spoofed-host.test/rest/v1/rpc/companion_claim_jobs", {
  method: "POST", headers: { "content-type": "application/json", apikey: environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, ...headers },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

test("pairing switches only the Companion endpoint and preserves the public key", () => {
  const configuration = { supabaseUrl: environment.NEXT_PUBLIC_SUPABASE_URL, supabaseApiKey: environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY };
  assert.deepEqual(companionPairingConfiguration(configuration, {}), configuration);
  assert.deepEqual(companionPairingConfiguration(configuration, environment), { ...configuration, supabaseUrl: environment.PLATFORM_PUBLIC_URL });
  assert.throws(() => companionPairingConfiguration(configuration, { ...environment, PLATFORM_PUBLIC_URL: "https://user:password@example.test/" }));
  assert.throws(() => companionPairingConfiguration(configuration, { ...environment, PLATFORM_PUBLIC_URL: environment.NEXT_PUBLIC_SUPABASE_URL }));
});

test("public RPC accepts only the four operations and validates before accessing the database", async () => {
  let databaseCalls = 0;
  const sqlFactory = async () => { databaseCalls++; throw new Error("must not connect"); };
  const cases = [
    [{}, "arbitrary_sql", 404],
    [{ p_token: token, p_instance_id: instance, p_sql: "DROP TABLE jobs" }, "companion_claim_jobs", 400],
    [{ p_token: token, p_instance_id: instance, p_limit: 999 }, "companion_claim_jobs", 400],
    [{ p_token: token, p_instance_id: instance, p_limit: "1" }, "companion_claim_jobs", 400],
    [{ p_token: "short", p_instance_id: instance }, "companion_claim_jobs", 400],
    [{ p_token: token, p_instance_id: "short" }, "companion_claim_jobs", 400],
    ["not json", "companion_claim_jobs", 400],
    [[], "companion_claim_jobs", 400],
    ["x".repeat(1024 * 1024 + 1), "companion_claim_jobs", 413],
  ];
  for (const [body, operation, expected] of cases) {
    const result = await handleCompanionRpc(request(body), operation, { environment, sqlFactory });
    assert.equal(result.status, expected);
  }
  assert.equal((await handleCompanionRpc(request({}), "companion_claim_jobs", { environment: {}, sqlFactory })).status, 404);
  assert.equal((await handleCompanionRpc(request({}, { apikey: "wrong" }), "companion_claim_jobs", { environment, sqlFactory })).status, 401);
  assert.equal((await handleCompanionRpc(request({}, { "content-type": "text/plain" }), "companion_claim_jobs", { environment, sqlFactory })).status, 415);
  assert.equal(databaseCalls, 0);
});

test("RPC uses parameterized SQL and rewrites only signed media to the configured website", async () => {
  let query;
  const sql = async (strings, ...values) => {
    query = { text: strings.join("?"), values };
    return [{ result: [{ id: "job_1", payload: { upload: { artifact: {
      downloadUrl: "https://storage.example.test/storage/v1/object/sign/job-artifacts/workspace_1/file.jpg?token=signed",
      parts: [{ downloadUrl: "https://storage.example.test/storage/v1/object/sign/job-artifacts/workspace_1/file.jpg.parts/0000?token=signed" }],
    } } } }] }];
  };
  const result = await handleCompanionRpc(request({ p_token: token, p_instance_id: instance }), "companion_claim_jobs", { environment, sqlFactory: async () => sql });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.ok(query.text.includes("public.companion_claim_jobs"));
  assert.ok(!query.text.includes(token));
  assert.deepEqual(query.values, [token, instance, 1]);
  const [job] = await result.json();
  assert.equal(new URL(job.payload.upload.artifact.downloadUrl).origin, environment.PLATFORM_PUBLIC_URL);
  assert.equal(new URL(job.payload.upload.artifact.parts[0].downloadUrl).origin, environment.PLATFORM_PUBLIC_URL);
  const foreign = { downloadUrl: "https://foreign.example.test/storage/v1/object/sign/job-artifacts/workspace/file?token=signed" };
  assert.deepEqual(companionDownloadUrls(foreign, environment), foreign);
});

test("database authentication and lease failures stay scoped and SQL details remain private", async (context) => {
  const logs = [];
  context.mock.method(console, "error", (...args) => logs.push(args));
  for (const [code, expected] of [["28000", 401], ["42501", 403], ["P0002", 404], ["22023", 400], ["55000", 409], ["XX000", 503]]) {
    const sql = async () => { throw Object.assign(new Error("private SQL and database connection details"), { code }); };
    const result = await handleCompanionRpc(request({ p_token: token, p_instance_id: instance }), "companion_claim_jobs", { environment, sqlFactory: async () => sql });
    assert.equal(result.status, expected);
    assert.ok(!(await result.text()).includes("private SQL"));
  }
  assert.equal(logs.length, 1);
  assert.ok(!JSON.stringify(logs).includes("private SQL"));
});

test("inventory and status requests reject malformed typed values", () => {
  assert.throws(() => validateCompanionRpc("companion_heartbeat", { p_token: token, p_instance_id: instance, p_accounts: {} }));
  assert.throws(() => validateCompanionRpc("companion_heartbeat", { p_token: token, p_instance_id: instance, p_accounts: [null] }));
  assert.throws(() => validateCompanionRpc("companion_update_job", { p_token: token, p_instance_id: instance, p_job_id: "job_1", p_status: "running", p_final_action: "true" }));
  const update = validateCompanionRpc("companion_update_job", { p_token: token, p_instance_id: instance, p_job_id: "job_1", p_status: "running" });
  assert.deepEqual(update.p_progress, {});
  assert.equal(update.p_final_action, false);
});

test("an omitted job result or error is SQL NULL rather than a JSON null document", async () => {
  let parameters;
  const sql = async (_strings, ...values) => { parameters = values; return [{ result: {} }]; };
  sql.json = (value) => ({ json: value });
  const result = await handleCompanionRpc(request({ p_token: token, p_instance_id: instance, p_job_id: "job_1", p_status: "running" }), "companion_update_job", { environment, sqlFactory: async () => sql });
  assert.equal(result.status, 200);
  assert.equal(parameters[7], null);
  assert.equal(parameters[8], null);
});

test("signed media streams ranges without forwarding cookies, API keys, or redirects", async () => {
  let called;
  const result = await handleCompanionMedia(new Request("https://www.example.test/storage/v1/object/sign/job-artifacts/workspace/file.jpg?token=signed", {
    headers: { range: "bytes=0-2", cookie: "private-cookie", authorization: "private-key", apikey: "private-key" },
  }), { environment, fetchImplementation: async (url, options) => {
    called = { url, options };
    return new Response(Uint8Array.from([1, 2, 3]), { status: 206, headers: { "content-type": "image/jpeg", "content-range": "bytes 0-2/10", "set-cookie": "private=1" } });
  } });
  assert.equal(result.status, 206);
  assert.equal(called.url.origin, environment.NEXT_PUBLIC_SUPABASE_URL);
  assert.deepEqual(called.options.headers, { range: "bytes=0-2" });
  assert.equal(called.options.redirect, "error");
  assert.equal(result.headers.get("set-cookie"), null);
  assert.equal(result.headers.get("content-range"), "bytes 0-2/10");
  assert.equal(result.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), Uint8Array.from([1, 2, 3]));
});

test("media proxy cannot become an open proxy or an unsigned storage endpoint", async () => {
  let called = false;
  const fetchImplementation = async () => { called = true; throw new Error(); };
  for (const [url, status, headers] of [
    ["https://www.example.test/storage/v1/object/sign/job-artifacts/workspace/file.jpg", 401],
    ["https://www.example.test/storage/v1/object/sign/job-artifacts/workspace/file.jpg?token=t&url=https://evil.test", 401],
    ["https://www.example.test/storage/v1/object/sign/job-artifacts/workspace%2Fsecret/file.jpg?token=t", 400],
    ["https://www.example.test/storage/v1/object/sign/job-artifacts/workspace/file.jpg?token=t", 416, { range: "bytes=0-1,3-4" }],
  ]) {
    assert.equal((await handleCompanionMedia(new Request(url, { headers }), { environment, fetchImplementation })).status, status);
  }
  assert.equal(called, false);
  const expired = await handleCompanionMedia(new Request("https://www.example.test/storage/v1/object/sign/job-artifacts/workspace/file.jpg?token=expired"), {
    environment, fetchImplementation: async () => new Response("private upstream error", { status: 403 }),
  });
  assert.equal(expired.status, 403);
  assert.ok(!(await expired.text()).includes("private upstream error"));
});
