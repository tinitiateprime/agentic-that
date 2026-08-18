import { listSignupPlanOptions } from "@platform/server/auth-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await listSignupPlanOptions(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Unable to load signup plans", error);
    return Response.json({ error: "Signup plan options are unavailable." }, { status: 503 });
  }
}
