import { getSql } from "@whatsapp/lib/db";
import { getCurrentUser, whatsappAccessErrorResponse } from "@whatsapp/lib/auth";

export async function PATCH(req, { params }) {
  const user = await getCurrentUser("operate");
  if (!user) return whatsappAccessErrorResponse("operate");
  const { id } = await params;
  const { name } = await req.json();
  if (!name?.trim()) return Response.json({ error: "Name is required" }, { status: 400 });
  const sql = await getSql();
  const res = await sql`UPDATE groups SET name = ${name.trim()} WHERE id = ${id} AND business_id = ${user.business_id}`;
  if (!res.count) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}

export async function DELETE(_req, { params }) {
  const user = await getCurrentUser("operate");
  if (!user) return whatsappAccessErrorResponse("operate");
  const { id } = await params;
  const sql = await getSql();
  await sql`DELETE FROM groups WHERE id = ${id} AND business_id = ${user.business_id}`;
  return Response.json({ ok: true });
}
