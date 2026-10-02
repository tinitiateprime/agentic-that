import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getDatabaseSql, isDatabaseDocumentStoreConfigured } from "../../../lib/database-document-store.js";

export const PROJECT_WORKSPACE_DOCUMENT_KEY = "project-management/files-v1";

export function safeLocalPath(root, relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes(":") || normalized.split("/").some(part => !part || part === ".." || part === ".")) throw new Error("Invalid project file path.");
  const target = path.resolve(root, ...normalized.split("/"));
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error("Project file is outside its data directory.");
  return target;
}

export async function snapshotProjectWorkspace(root, directory = root) {
  const files = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(files, await snapshotProjectWorkspace(root, absolutePath));
    else if (entry.isFile()) files[path.relative(root, absolutePath).split(path.sep).join("/")] = (await readFile(absolutePath)).toString("base64");
    else throw new Error("Project storage cannot contain symbolic links.");
  }
  return files;
}

export async function restoreProjectWorkspace(root, files) {
  for (const [relativePath, value] of Object.entries(files || {})) {
    if (typeof value !== "string") throw new Error("Invalid stored project file.");
    const target = safeLocalPath(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(value, "base64"), { mode: 0o600 });
  }
}

export async function withProjectWorkspacePersistence(operation) {
  if (!isDatabaseDocumentStoreConfigured()) {
    if (process.env.NODE_ENV === "production") throw new Error("DATABASE_URL is required for project management storage.");
    const directory = path.resolve(process.env.PROJECT_WORKSPACE_DATA_DIR || path.join(process.cwd(), ".data", "project-management"));
    await mkdir(directory, { recursive: true });
    return operation(directory);
  }
  const sql = await getDatabaseSql();
  return sql.begin(async transaction => {
    // Serialize the entire hydration/request/snapshot across AWS instances.
    await transaction`SELECT pg_advisory_xact_lock(hashtext(${PROJECT_WORKSPACE_DOCUMENT_KEY}))`;
    const [row] = await transaction`SELECT value FROM agentic_that.app_document_store WHERE key = ${PROJECT_WORKSPACE_DOCUMENT_KEY}`;
    const directory = await mkdtemp(path.join(os.tmpdir(), "agenticthat-projects-"));
    try {
      await restoreProjectWorkspace(directory, row?.value?.files);
      const response = await operation(directory);
      const body = await response.arrayBuffer();
      const files = await snapshotProjectWorkspace(directory);
      await transaction`
        INSERT INTO agentic_that.app_document_store(key, value) VALUES (${PROJECT_WORKSPACE_DOCUMENT_KEY}, ${transaction.json({ version: 1, files })})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
      return new Response(body.byteLength ? body : null, { status: response.status, statusText: response.statusText, headers: response.headers });
    } finally {
      if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Invalid temporary project directory.");
      await rm(directory, { recursive: true, force: true });
    }
  });
}
