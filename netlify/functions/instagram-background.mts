import type { Config, Context } from "@netlify/functions";
import { executeInstagramJob } from "../../services/scraping/instagram/src/api.ts";

export default async function handler(request: Request, context: Context) {
  process.env.SERVERLESS = "true";
  const jobId = context.params.id || new URL(request.url).pathname.match(/\/jobs\/([^/]+)\/run$/)?.[1];
  if (!jobId) return;
  await executeInstagramJob(jobId);
}

export const config: Config = {
  background: true,
  memory: 2048,
  method: "POST",
  path: "/api/scraping/instagram/jobs/:id/run"
};
