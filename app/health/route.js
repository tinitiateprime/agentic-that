export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({ ok: true, service: "agentic-that", provider: process.env.HOSTING_PROVIDER || "node" }, {
    headers: { "cache-control": "no-store" },
  });
}
