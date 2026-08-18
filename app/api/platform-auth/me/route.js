import { getCurrentPrincipal } from "@platform/server/access-control";

export const dynamic = "force-dynamic";

export async function GET() {
  const principal = await getCurrentPrincipal();
  if (!principal) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ ok: true, principal });
}
