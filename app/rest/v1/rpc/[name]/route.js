import { handleCompanionRpc } from "@platform/server/companion-database-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, context) {
  const { name } = await context.params;
  return handleCompanionRpc(request, name);
}
