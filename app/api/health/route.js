export const dynamic = "force-dynamic";

export async function GET(request) {
  const checkAutomation = new URL(request.url).searchParams.get("automation") === "1";
  let automation = null;
  if (checkAutomation) {
    const origin = String(process.env.SERVER_AUTOMATION_ORIGIN || "").trim().replace(/\/$/, "");
    if (!origin) {
      automation = false;
    } else {
      automation = await fetch(`${origin}/ready`, {
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      }).then(response => response.ok).catch(() => false);
    }
  }
  const ok = automation !== false;
  return Response.json(
    { ok, service: "agenticthat-website", ...(checkAutomation ? { automation } : {}) },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
