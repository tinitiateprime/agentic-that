import { getSql } from "@whatsapp/lib/db";
import { getCurrentUser, whatsappAccessErrorResponse } from "@whatsapp/lib/auth";

export async function POST(req) {
  const user = await getCurrentUser("operate");
  if (!user) return whatsappAccessErrorResponse("operate");
  const { name, category, body } = await req.json();
  if (!name?.trim() || !body?.trim()) {
    return Response.json({ error: "Name and body are required" }, { status: 400 });
  }
  const sql = await getSql();
  const [row] = await sql`
    INSERT INTO templates (business_id, name, category, body)
    VALUES (${user.business_id}, ${name.trim()}, ${category?.trim() || "marketing"}, ${body.trim()})
    RETURNING id`;
  return Response.json({ ok: true, id: row.id });
}
