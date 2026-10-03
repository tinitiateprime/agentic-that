import { getCurrentUser, whatsappAccessErrorResponse } from "@whatsapp/lib/auth";
import { GroupRuleError, deleteGroupRule, updateGroupRule } from "@whatsapp/lib/group-rules";

export async function PATCH(req, { params }) {
  const user = await getCurrentUser("operate");
  if (!user) return whatsappAccessErrorResponse("operate");
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    return Response.json({ ok: true, rule: await updateGroupRule(user.business_id, Number(id), body) });
  } catch (error) {
    if (error instanceof GroupRuleError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

export async function DELETE(_req, { params }) {
  const user = await getCurrentUser("operate");
  if (!user) return whatsappAccessErrorResponse("operate");
  try {
    const { id } = await params;
    await deleteGroupRule(user.business_id, Number(id));
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof GroupRuleError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
