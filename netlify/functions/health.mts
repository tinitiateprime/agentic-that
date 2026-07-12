import type { Config } from "@netlify/functions";

export default async function handler() {
  return Response.json({ ok: true, service: "agentic-that-netlify" });
}

export const config: Config = {
  path: "/health"
};
