import dotenv from "dotenv";
import { getStore } from "@netlify/blobs";
import { initializeDatabaseDocument, getDatabaseSql, readDatabaseDocument } from "../lib/database-document-store.js";
import { PROJECT_WORKSPACE_DOCUMENT_KEY, safeLocalPath } from "../src/platform/server/project-workspace-persistence.js";
import path from "node:path";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });
if (!process.env.NETLIFY_SITE_ID || !process.env.NETLIFY_AUTH_TOKEN) throw new Error("NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN are required for the one-time export. Keep tokens out of chat and source control.");
process.env.DATA_STORE = "postgres";
process.env.NODE_ENV = "production";
process.env.RUN_DATABASE_MIGRATIONS = "false";
const apply = process.argv.includes("--apply");
const sql = await getDatabaseSql();
const source = name => getStore({ name, siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_AUTH_TOKEN, consistency: "strong" });
async function listed(store, prefix) {
  const blobs = [];
  for await (const page of store.list({ prefix, paginate: true })) blobs.push(...page.blobs);
  return blobs;
}

try {
  const projects = source("agentic-that-project-management");
  const files = {};
  for (const item of await listed(projects, "workspace-v1/")) {
    const relative = item.key.slice("workspace-v1/".length);
    safeLocalPath(path.resolve("artifacts/netlify-import"), relative);
    const bytes = await projects.get(item.key, { type: "arrayBuffer" });
    if (bytes !== null) files[relative] = Buffer.from(bytes).toString("base64");
  }
  console.log(`Project management: ${Object.keys(files).length} files available.`);
  if (apply && Object.keys(files).length && !(await readDatabaseDocument(PROJECT_WORKSPACE_DOCUMENT_KEY))) {
    await initializeDatabaseDocument(PROJECT_WORKSPACE_DOCUMENT_KEY, { version: 1, files });
  }
  for (const namespace of ["instagram-scraper", "facebook-scraper"]) {
    const store = source(namespace);
    for (const collection of ["runs", "jobs"]) {
      const groups = new Map();
      const records = [];
      for (const blob of await listed(store, `${collection}/`)) {
        const value = await store.get(blob.key, { type: "json" });
        if (value?.workspaceId && value?.id) records.push(value);
      }
      // Older Instagram caches used one document rather than one blob per run.
      if (collection === "runs") {
        const legacy = await store.get("runs", { type: "json" });
        for (const value of legacy?.runs || []) if (value?.workspaceId && value?.id && !records.some(record => record.id === value.id)) records.push(value);
      }
      for (const record of records) {
        const group = groups.get(record.workspaceId) || [];
        group.push(record); groups.set(record.workspaceId, group);
      }
      console.log(`${namespace}/${collection}: ${records.length} records in ${groups.size} workspaces.`);
      if (apply) for (const [workspaceId, records] of groups) {
        await initializeDatabaseDocument(`${namespace}/workspaces/${workspaceId}/${collection}`, { version: 1, records });
      }
    }
  }
  const growth = source("instagram-growth-advisor");
  const jobs = [];
  for (const blob of await listed(growth, "jobs/")) {
    const job = await growth.get(blob.key, { type: "json" });
    if (job?.id && job?.userId) jobs.push({ ...job, workspaceId: job.workspaceId || job.userId });
  }
  console.log(`Growth Advisor: ${jobs.length} jobs available.`);
  if (apply && jobs.length) await initializeDatabaseDocument("instagram-growth-advisor", { version: 1, jobs });
  console.log(apply ? "Import complete. Existing PostgreSQL documents and source Netlify data were preserved." : "Dry run complete. Add --apply to import into empty PostgreSQL documents.");
} finally { await sql.end(); }
