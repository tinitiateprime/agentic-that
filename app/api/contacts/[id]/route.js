import { getSql } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function PATCH(req, { params }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const { name, phone, tags, notes, opted_in } = await req.json();
  const sql = await getSql();
  const [existing] = await sql`SELECT * FROM contacts WHERE id = ${id} AND business_id = ${user.business_id}`;
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

  await sql`
    UPDATE contacts
       SET name = ${name?.trim() ?? existing.name},
           phone = ${phone?.trim() ?? existing.phone},
           tags = ${tags?.trim() ?? existing.tags},
           notes = ${notes?.trim() ?? existing.notes},
           opted_in = ${opted_in == null ? existing.opted_in : opted_in ? 1 : 0}
     WHERE id = ${id} AND business_id = ${user.business_id}`;
  return Response.json({ ok: true });
}

export async function DELETE(_req, { params }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const sql = await getSql();
  await sql`DELETE FROM contacts WHERE id = ${id} AND business_id = ${user.business_id}`;
  return Response.json({ ok: true });
}
