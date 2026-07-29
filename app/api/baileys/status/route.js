import { getCurrentUser } from "@whatsapp/lib/auth";
import { credsForProvider } from "@whatsapp/lib/tenant";

// Server-side proxy to this business's Baileys connection service — keeps
// the shared secret off the browser. Checks the Baileys account specifically
// (not whichever provider is currently active), so Settings can verify it
// before switching the live channel.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const creds = await credsForProvider(user.business_id, "baileys");
  if (!creds?.serviceUrl) return Response.json({ error: "No service URL configured" }, { status: 400 });

  try {
    const res = await fetch(`${creds.serviceUrl.replace(/\/$/, "")}/api/status`, {
      headers: creds.accessToken ? { "x-api-secret": creds.accessToken } : {},
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return Response.json({ error: data?.error || `HTTP ${res.status}` }, { status: 502 });
    return Response.json(data);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}
