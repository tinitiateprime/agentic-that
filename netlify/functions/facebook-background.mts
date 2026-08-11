import type { Config, Context } from "@netlify/functions";
import { executeFacebookJob } from "../../services/scraping/facebook/src/api.ts";

export default async function handler(request: Request, context: Context) {
  process.env.SERVERLESS = "true";
  const jobId = context.params.id || new URL(request.url).pathname.match(/\/jobs\/([^/]+)\/run$/)?.[1];
  if (jobId) await executeFacebookJob(jobId);
}

export const config: Config = {
  background: true,
  method: "POST",
  path: "/api/scraping/facebook/jobs/:id/run",
};
