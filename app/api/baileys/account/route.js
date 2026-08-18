import { getCurrentUser, whatsappAccessErrorResponse } from "@whatsapp/lib/auth";
import { credsForProvider, upsertAccount } from "@whatsapp/lib/tenant";

// Saves this business's Baileys connection service config (Settings →
// WhatsApp connection). `secret` is optional on update — omit it to keep
// whatever's already stored (see upsertAccount's COALESCE-on-conflict).
export async function PATCH(req) {
  const user = await getCurrentUser("configure");
  if (!user) return whatsappAccessErrorResponse("configure");

  const { serviceUrl, secret } = await req.json();
  if (!serviceUrl?.trim()) return Response.json({ error: "Service URL is required" }, { status: 400 });

  let parsed;
  try {
    parsed = new URL(serviceUrl.trim());
  } catch {
    return Response.json({ error: "Enter a valid service URL" }, { status: 400 });
  }
  const localDevelopment = process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !localDevelopment) {
    return Response.json({ error: "The Baileys service must use HTTPS in production" }, { status: 400 });
  }

  const existing = await credsForProvider(user.business_id, "baileys");
  if (!String(secret || existing?.accessToken || "").trim()) {
    return Response.json({ error: "A shared secret is required" }, { status: 400 });
  }

  try {
    await upsertAccount({
      businessId: user.business_id,
    // Baileys has no WABA id — synthesize one to satisfy the existing
    // UNIQUE(waba_id) constraint. Not used for routing (unlike Meta's).
      wabaId: `baileys:${user.business_id}`,
      accessToken: secret || undefined,
      provider: "baileys",
      onboardingSource: "settings",
      status: "active",
      serviceUrl: parsed.toString().replace(/\/$/, ""),
    });
  } catch (err) {
    return Response.json({ error: err.message || "Could not save the monitoring service" }, { status: 400 });
  }

  return Response.json({ ok: true });
}
