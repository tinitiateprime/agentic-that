import { handleCompanionMedia } from "@platform/server/companion-database-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request) {
  return handleCompanionMedia(request);
}
