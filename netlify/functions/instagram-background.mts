import type { Config, Context } from "@netlify/functions";
import { executeInstagramJob } from "../../services/scraping/instagram/src/api.ts";
import { requireScrapingServiceAccess } from "../../lib/scraping-service-auth.ts";

export default async function handler(request: Request, context: Context) {
  process.env.SERVERLESS = "true";
  const jobId = context.params.id || new URL(request.url).pathname.match(/\/jobs\/([^/]+)\/run$/)?.[1];
  if (!jobId) return;
  const identity = requireScrapingServiceAccess(request, "scraping.instagram", "operate");
  await executeInstagramJob(jobId, identity.workspaceId);
}

export const config: Config = {
  background: true,
  method: "POST",
  path: "/api/scraping/instagram/jobs/:id/run"
};
