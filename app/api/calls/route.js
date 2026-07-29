import { getCurrentUser } from "@whatsapp/lib/auth";
import { listCalls, missedCalls, callStatusSummary, acknowledgeCall } from "@whatsapp/lib/data";

// Call log for the signed-in business.
//   GET            -> { calls, summary }
//   GET ?missed=1  -> { calls: <unacknowledged missed calls>, summary }
//   POST { callId } -> mark a missed call as seen (clears the Notify alert)
export async function GET(req) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const missedOnly = new URL(req.url).searchParams.get("missed") === "1";
  const calls = missedOnly
    ? await missedCalls(user.business_id)
    : await listCalls(user.business_id);
  const summary = await callStatusSummary(user.business_id);
  return Response.json({ ok: true, calls, summary });
}

export async function POST(req) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { callId } = await req.json();
  if (!callId) return Response.json({ error: "callId required" }, { status: 400 });

  const ok = await acknowledgeCall(user.business_id, Number(callId));
  if (!ok) return Response.json({ error: "Call not found" }, { status: 404 });
  return Response.json({ ok: true });
}
