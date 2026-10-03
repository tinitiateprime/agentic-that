import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";

async function find(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", "runtime", "out", "data", "public", ".git", ".next"].includes(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await find(file));
    else if (/\.test\.(js|mjs|ts)$/.test(entry.name)) files.push(file);
  }
  return files;
}
const files = [];
for (const directory of ["lib", "src", "services", "scripts", "apps"]) files.push(...await find(directory));
console.log(`Running ${files.length} test files across all services and platform modules.`);
// Test processes must not read or change production service data.
const environment = { ...process.env, NODE_ENV: "test", DATA_STORE: "json", TELEGRAM_DATA_STORE: "json", TELEGRAM_TEST_DATABASE_URL: "", DATABASE_URL: "", SUPABASE_DB_URL: "", SUPABASE_DATABASE_URL: "", SERVERLESS: "false", HOSTING_PROVIDER: "node" };
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=3", ...files], { env: environment, stdio: "inherit" });
process.exit(result.status ?? 1);
