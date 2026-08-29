import { getSql } from "@whatsapp/lib/db";
import { getCurrentUser, whatsappAccessErrorResponse } from "@whatsapp/lib/auth";
import { credsForProvider } from "@whatsapp/lib/tenant";

export async function PATCH(req) {
  const user = await getCurrentUser("configure");
  if (!user) return whatsappAccessErrorResponse("configure");
  const {
    name,
    admin_number,
    currency,
    active_wa_provider,
    welcome_enabled,
    welcome_template_name,
    welcome_template_language,
    welcome_template_params,
    welcome_template_body,
  } = await req.json();
  const sql = await getSql();
  const [biz] = await sql`SELECT * FROM businesses WHERE id = ${user.business_id}`;
  const nextProvider = active_wa_provider === undefined
    ? biz.active_wa_provider
    : String(active_wa_provider || "").toLowerCase();
  if (nextProvider && !["meta", "wati", "mock"].includes(nextProvider)) {
    return Response.json({ error: "Unsupported messaging provider" }, { status: 400 });
  }
  if (nextProvider && nextProvider !== "mock") {
    const configured = await credsForProvider(user.business_id, nextProvider);
    if (!configured) {
      return Response.json({ error: `Connect ${nextProvider === "meta" ? "Meta" : "WATI"} before making it active` }, { status: 400 });
    }
  }

  // The welcome fields are saved as a set by the Welcome message card, so they
  // are only touched when that card posts (all other forms omit them and keep
  // whatever is configured). Clearing the template name turns the greeting off.
  const welcomeName = welcome_template_name?.trim() || null;
  const welcome =
    welcome_template_name === undefined
      ? {
          enabled: biz.welcome_enabled,
          templateName: biz.welcome_template_name,
          language: biz.welcome_template_language,
          params: biz.welcome_template_params,
          body: biz.welcome_template_body,
        }
      : {
          enabled: Boolean(welcome_enabled) && Boolean(welcomeName),
          templateName: welcomeName,
          language: welcome_template_language?.trim() || null,
          params: Array.isArray(welcome_template_params) ? JSON.stringify(welcome_template_params) : null,
          body: welcome_template_body || null,
        };

  await sql`
    UPDATE businesses
       SET name = ${name?.trim() || biz.name},
           admin_number = ${admin_number?.trim() || biz.admin_number},
           currency = ${currency?.trim() || biz.currency},
           provider = ${nextProvider || biz.provider},
           active_wa_provider = ${nextProvider},
           welcome_enabled = ${welcome.enabled},
           welcome_template_name = ${welcome.templateName},
           welcome_template_language = ${welcome.language},
           welcome_template_params = ${welcome.params},
           welcome_template_body = ${welcome.body}
     WHERE id = ${user.business_id}`;
  return Response.json({ ok: true });
}
