import { listSignupRoleOptions } from "@platform/server/auth-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await listSignupRoleOptions(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Unable to load signup roles", error);
    return Response.json({ error: "Signup access options are unavailable." }, { status: 503 });
  }
}
