import type { Config } from "@netlify/functions";
import { handleInstagramRequest } from "../../services/scraping/instagram/src/api.ts";

export default async function handler(request: Request) {
  return handleInstagramRequest(request);
}

export const config: Config = {
  path: "/api/scraping/instagram/*"
};
