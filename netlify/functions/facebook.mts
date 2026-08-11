import type { Config } from "@netlify/functions";
import { handleFacebookRequest } from "../../services/scraping/facebook/src/api.ts";

export default async function handler(request: Request) {
  process.env.SERVERLESS = "true";
  return handleFacebookRequest(request);
}

export const config: Config = {
  path: "/api/scraping/facebook/*",
  excludedPath: "/api/scraping/facebook/jobs/:id/run",
};
