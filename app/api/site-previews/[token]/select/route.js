import { publishSelectedWebsite } from "@platform/server/website-studio-store";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  try {
    const { token } = await params;
    const body = await request.json();
    const result = await publishSelectedWebsite(token, body?.theme);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Unable to publish this website.",
      code: error?.code || "PUBLISH_FAILED",
    }, { status: Number(error?.status) >= 400 ? Number(error.status) : 500 });
  }
}
