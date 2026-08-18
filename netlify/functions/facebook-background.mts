import type { Config, Context } from "@netlify/functions";
import { executeFacebookJob } from "../../services/scraping/facebook/src/api.ts";
import { requireScrapingServiceAccess } from "../../lib/scraping-service-auth.ts";

export default async function handler(request: Request, context: Context) {
  process.env.SERVERLESS = "true";
  const jobId = context.params.id || new URL(request.url).pathname.match(/\/jobs\/([^/]+)\/run$/)?.[1];
  if (jobId) {
    const identity = requireScrapingServiceAccess(request, "scraping.facebook", "operate");
    await executeFacebookJob(jobId, identity.workspaceId);
  }
}

export const config: Config = {
  background: true,
  method: "POST",
  path: "/api/scraping/facebook/jobs/:id/run",
};
