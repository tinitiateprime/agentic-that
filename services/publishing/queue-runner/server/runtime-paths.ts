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

function isServerlessRuntime() {
  return (
    process.env.SERVERLESS === "true" ||
    process.env.HOSTING_PROVIDER === "aws-amplify"
  );
}

export function publishingUploadDirectory() {
  // The deployed application is read-only; durable media lives in Supabase.
  if (isServerlessRuntime()) {
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
