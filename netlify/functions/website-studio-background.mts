import type { Config, Context } from "@netlify/functions";
import { executeAutomatedWebsiteProject } from "../../src/platform/server/website-studio-store.js";

export default async function handler(request: Request, context: Context) {
  process.env.SERVERLESS = "true";
  const projectId = context.params.id
    || new URL(request.url).pathname.match(/\/website-studio\/jobs\/([^/]+)\/run$/)?.[1];
  if (!projectId) return;

  let jobToken = "";
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 2_000) return;
    const payload = await request.json();
    jobToken = typeof payload?.jobToken === "string" ? payload.jobToken : "";
  } catch {
    return;
  }
  if (!jobToken) return;

  try {
    await executeAutomatedWebsiteProject(decodeURIComponent(projectId), jobToken);
  } catch (error) {
    console.error("AI Website Studio background job failed unexpectedly", {
      projectId,
      message: error instanceof Error ? error.message : "Unknown background error",
    });
  }
}

export const config: Config = {
  background: true,
  method: "POST",
  path: "/api/website-studio/jobs/:id/run",
};
