import { getSql } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function DELETE(_req, { params }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const sql = await getSql();
  await sql`DELETE FROM templates WHERE id = ${id} AND business_id = ${user.business_id}`;
  return Response.json({ ok: true });
}
