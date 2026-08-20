import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const serviceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

function resolveServicePath(
  configured: string | undefined,
  fallback: string
) {
  const candidate = configured?.trim() || fallback;

  return path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(serviceRoot, candidate);
}

function isNetlifyRuntime() {
  return (
    process.env.NETLIFY === "true" ||
    Boolean(process.env.NETLIFY_BLOBS_CONTEXT)
  );
}

export function publishingUploadDirectory() {
  // Netlify's deployed application directory should not be used
  // for temporary publishing media.
  // Use the runtime temporary directory, then media-storage.ts
  // persists the final file into Netlify Blobs.
  if (isNetlifyRuntime()) {
    return path.join(
      tmpdir(),
      "agentic-that-publishing",
      "uploads"
    );
  }

  return resolveServicePath(
    process.env.PUBLISH_QUEUE_UPLOAD_DIR ||
      process.env.UPLOAD_DIR,
    "./uploads"
  );
}

export function publishingBrowserDataDirectory() {
  return resolveServicePath(
    process.env.PUBLISH_QUEUE_BROWSER_DATA_DIR,
    "./browser-data"
  );
}

export function publishingUploadFilePath(fileName: string) {
  const uploadDirectory = publishingUploadDirectory();
  const resolved = path.resolve(uploadDirectory, fileName);

  if (!resolved.startsWith(`${uploadDirectory}${path.sep}`)) {
    throw new Error("The publishing media path is invalid.");
  }

  return resolved;
}