import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { handleCompanionRpc } from "./companion-database-api.js";

test("PostgreSQL Companion pairing, heartbeat, leases, results, and workspace isolation", {
  skip: !process.env.COMPANION_DATABASE_TEST_URL,
}, async () => {
  const sql = postgres(process.env.COMPANION_DATABASE_TEST_URL, { max: 1, prepare: false, connect_timeout: 10, onnotice: () => {} });
  const prefix = `connection_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const rollback = new Error("ROLLBACK_COMPANION_INTEGRATION_TEST");
  try {
    try {
      await sql.begin(async (transaction) => {
        await transaction`SET LOCAL statement_timeout = '15s'`;
        const workspace = `${prefix}_workspace`;
        const otherWorkspace = `${prefix}_other_workspace`;
        const instance = `${prefix}_installation`;
        const pairingCode = crypto.randomBytes(48).toString("base64url");
        const codeHash = crypto.createHash("sha256").update(pairingCode).digest("hex");
        await transaction`INSERT INTO public.platform_workspaces (id, name) VALUES (${workspace}, 'Database integration test'), (${otherWorkspace}, 'Isolation integration test')`;
        await transaction`
          INSERT INTO public.companion_pairing_challenges (id, workspace_id, code_hash, label, companion_instance_id, expires_at)
          VALUES (${`${prefix}_challenge`}, ${workspace}, ${codeHash}, 'Temporary integration test', ${instance}, now() + interval '5 minutes')`;

        // Each RPC gets a savepoint, as it would get its own transaction over HTTP.
        // The outer transaction rolls every fixture and successful mutation back.
        const scopedSql = (strings, ...values) => transaction.savepoint((savepoint) => savepoint(strings, ...values));
        scopedSql.json = (value) => transaction.json(value);
        const environment = {
          COMPANION_RPC_TRANSPORT: "postgres", PLATFORM_PUBLIC_URL: "https://website.example.test",
          NEXT_PUBLIC_SUPABASE_URL: "https://media.example.test", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_integration_test",
        };
        const rpc = (name, body) => handleCompanionRpc(new Request(`https://website.example.test/rest/v1/rpc/${name}`, {
          method: "POST", headers: { "content-type": "application/json", apikey: environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY }, body: JSON.stringify(body),
        }), name, { environment, sqlFactory: async () => scopedSql });
        const redeemInput = { p_pairing_code: pairingCode, p_instance_id: instance, p_version: "99.0.0", p_platform: "test", p_architecture: "test", p_secure_storage: true };
        const pairingResponse = await rpc("companion_redeem_pairing", redeemInput);
        assert.equal(pairingResponse.status, 200, "The restored pairing function must execute on the target database.");
        const pairing = await pairingResponse.json();
        assert.ok(typeof pairing.token === "string" && pairing.token.length >= 32);
        assert.equal(pairing.companion.workspaceId, workspace);
        assert.equal((await rpc("companion_redeem_pairing", redeemInput)).status, 401, "Pairing codes must be one-time.");
        const identity = { p_token: pairing.token, p_instance_id: instance };
        assert.equal((await rpc("companion_heartbeat", { ...identity, p_version: "99.0.0", p_accounts: [] })).status, 200);
        assert.equal((await rpc("companion_heartbeat", { ...identity, p_instance_id: "different-installation" })).status, 401);

        const job = `${prefix}_job`;
        const otherJob = `${prefix}_other_job`;
        const payload = { upload: { artifact: { downloadUrl: "https://media.example.test/storage/v1/object/sign/job-artifacts/test-workspace/file.jpg?token=test-signature" } } };
        await transaction`
          INSERT INTO public.jobs (id, workspace_id, job_type, platform, idempotency_key, payload)
          VALUES (${job}, ${workspace}, 'scrape.instagram', 'instagram', ${job}, ${transaction.json(payload)}),
                 (${otherJob}, ${otherWorkspace}, 'scrape.instagram', 'instagram', ${otherJob}, '{}'::jsonb)`;
        const claimResponse = await rpc("companion_claim_jobs", identity);
        assert.equal(claimResponse.status, 200);
        const claimed = await claimResponse.json();
        assert.equal(claimed.length, 1);
        assert.equal(claimed[0].id, job);
        assert.equal(new URL(claimed[0].payload.upload.artifact.downloadUrl).origin, environment.PLATFORM_PUBLIC_URL);
        assert.equal((await rpc("companion_update_job", { ...identity, p_job_id: otherJob, p_status: "success" })).status, 404);
        assert.equal((await rpc("companion_update_job", { ...identity, p_job_id: job, p_status: "running", p_progress: { stage: "test" } })).status, 200);
        assert.equal((await rpc("companion_update_job", { ...identity, p_job_id: job, p_status: "success", p_result: { integrationTest: true } })).status, 200);
        const [stored] = await transaction`SELECT status FROM public.jobs WHERE id = ${job}`;
        const [result] = await transaction`SELECT outcome FROM public.job_results WHERE job_id = ${job}`;
        const [untouched] = await transaction`SELECT status, assigned_device_id FROM public.jobs WHERE id = ${otherJob}`;
        assert.equal(stored.status, "success");
        assert.equal(result.outcome, "SUCCESS");
        assert.equal(untouched.status, "queued");
        assert.equal(untouched.assigned_device_id, null);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    const [remaining] = await sql`SELECT count(*)::int AS count FROM public.platform_workspaces WHERE id IN (${`${prefix}_workspace`}, ${`${prefix}_other_workspace`})`;
    assert.equal(remaining.count, 0, "All integration fixtures must be rolled back.");
  } finally { await sql.end({ timeout: 2 }); }
});
