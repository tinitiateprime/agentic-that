import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getStore } from "@netlify/blobs";

const STORE_NAME = "agentic-that-project-management";
const STORE_PREFIX = "workspace-v1/";
const NETLIFY_DATA_DIRECTORY = path.join(os.tmpdir(), "agentic-that", "project-management");

let hydration;
let persistenceQueue = Promise.resolve();

function usesNetlifyBlobs() {
  return process.env.NETLIFY === "true";
}

function blobStore() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

function safeLocalPath(root, relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error("Project management storage returned an invalid file path.");
  }
  const target = path.resolve(root, ...normalized.split("/"));
  const prefix = `${path.resolve(root)}${path.sep}`;
  if (!target.startsWith(prefix)) {
    throw new Error("Project management storage returned a path outside its data directory.");
  }
  return target;
}

async function listStoredBlobs(store) {
  const blobs = [];
  for await (const page of store.list({ prefix: STORE_PREFIX, paginate: true })) {
    blobs.push(...page.blobs);
  }
  return blobs;
}

async function localFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await localFiles(root, absolutePath));
    else if (entry.isFile()) {
      files.push({
        absolutePath,
        relativePath: path.relative(root, absolutePath).split(path.sep).join("/"),
      });
    }
  }
  return files;
}

export function projectWorkspaceDataDirectory() {
  if (usesNetlifyBlobs()) return NETLIFY_DATA_DIRECTORY;
  const configured = process.env.PROJECT_WORKSPACE_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(process.cwd(), ".data", "project-management");
}

export async function hydrateProjectWorkspaceData(dataDirectory) {
  if (!usesNetlifyBlobs()) return;
  hydration ||= (async () => {
    const resolvedRoot = path.resolve(dataDirectory);
    const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
    if (!resolvedRoot.startsWith(tempRoot)) {
      throw new Error("Netlify project management data must stay inside the temporary directory.");
    }
    await rm(resolvedRoot, { recursive: true, force: true });
    await mkdir(resolvedRoot, { recursive: true });
    const store = blobStore();
    const blobs = await listStoredBlobs(store);
    await Promise.all(blobs.map(async ({ key }) => {
      const relativePath = key.slice(STORE_PREFIX.length);
      const target = safeLocalPath(resolvedRoot, relativePath);
      const value = await store.get(key, { type: "arrayBuffer", consistency: "strong" });
      if (value === null) return;
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(value), { mode: 0o600 });
    }));
  })().catch((error) => {
    hydration = undefined;
    throw error;
  });
  await hydration;
}

export async function persistProjectWorkspaceData(dataDirectory) {
  if (!usesNetlifyBlobs()) return;
  const persist = async () => {
    const resolvedRoot = path.resolve(dataDirectory);
    const store = blobStore();
    const [files, storedBlobs] = await Promise.all([
      localFiles(resolvedRoot),
      listStoredBlobs(store),
    ]);
    const storedKeys = new Set(storedBlobs.map(({ key }) => key));
    const localKeys = new Set(files.map(({ relativePath }) => `${STORE_PREFIX}${relativePath}`));

    await Promise.all(files.map(async ({ absolutePath, relativePath }) => {
      const key = `${STORE_PREFIX}${relativePath}`;
      if (relativePath.includes("/api-cache/blobs/") && storedKeys.has(key)) return;
      const value = await readFile(absolutePath);
      await store.set(key, value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength), {
        metadata: { sha256: createHash("sha256").update(value).digest("hex") },
      });
    }));
    await Promise.all([...storedKeys]
      .filter((key) => !localKeys.has(key))
      .map((key) => store.delete(key)));
  };

  persistenceQueue = persistenceQueue.then(persist, persist);
  await persistenceQueue;
}
