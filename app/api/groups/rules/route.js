import { getCurrentUser, whatsappAccessErrorResponse } from "@whatsapp/lib/auth";
import { GroupRuleError, createGroupRule, listGroupRules } from "@whatsapp/lib/group-rules";

// Keyword rules that put contacts into a group automatically. Reading is open
// to anyone who can see the workspace; changing the automation is operator work.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return whatsappAccessErrorResponse("view");
  return Response.json({ ok: true, rules: await listGroupRules(user.business_id) });
}

export async function POST(req) {
  const user = await getCurrentUser("operate");
  if (!user) return whatsappAccessErrorResponse("operate");
  try {
    const body = await req.json().catch(() => ({}));
    return Response.json({ ok: true, rule: await createGroupRule(user.business_id, body) });
  } catch (error) {
    if (error instanceof GroupRuleError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
