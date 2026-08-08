import type { Config, Context } from "@netlify/functions";
import { executeGrowthAdvisorJob } from "../../services/scraping/instagram/src/growth-advisor-jobs.ts";

export default async function handler(request: Request, context: Context) {
  process.env.SERVERLESS = "true";
  const jobId = context.params.id || new URL(request.url).pathname.match(/\/jobs\/([^/]+)\/run$/)?.[1];
  if (!jobId) return;
  await executeGrowthAdvisorJob(jobId);
}

export const config: Config = {
  background: true,
  method: "POST",
  path: "/api/instagram/growth-advisor/jobs/:id/run"
};
