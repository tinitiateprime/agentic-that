import { getSql } from "@whatsapp/lib/db";
import { getCurrentUser, whatsappAccessErrorResponse } from "@whatsapp/lib/auth";

export async function DELETE(_req, { params }) {
  const user = await getCurrentUser("operate");
  if (!user) return whatsappAccessErrorResponse("operate");
  const { id } = await params;
  const sql = await getSql();
  await sql`DELETE FROM templates WHERE id = ${id} AND business_id = ${user.business_id}`;
  return Response.json({ ok: true });
}
