import type { Config, Context } from "@netlify/functions";
import {
  requireScrapingServiceAccess,
  ScrapingServiceAuthError
} from "../../lib/scraping-service-auth.ts";
import { executeGrowthAdvisorJob } from "../../services/scraping/instagram/src/growth-advisor-jobs.ts";

export default async function handler(request: Request, context: Context) {
  process.env.SERVERLESS = "true";
  let identity;
  try {
    identity = requireScrapingServiceAccess(request, "scraping.instagram", "operate");
  } catch (error) {
    if (error instanceof ScrapingServiceAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
  const jobId = context.params.id || new URL(request.url).pathname.match(/\/jobs\/([^/]+)\/run$/)?.[1];
  if (!jobId) return Response.json({ error: "AI job not found." }, { status: 404 });
  const completed = await executeGrowthAdvisorJob(jobId, {
    workspaceId: identity.workspaceId,
    userId: identity.sub
  });
  if (!completed) return Response.json({ error: "AI job not found." }, { status: 404 });
}

export const config: Config = {
  background: true,
  method: "POST",
  path: "/api/instagram/growth-advisor/jobs/:id/run"
};
