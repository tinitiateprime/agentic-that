import { getSql } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// Add one or more contacts to a group.
// Body: { contactIds: number[] }
export async function POST(req, { params }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const sql = await getSql();
  const [group] = await sql`SELECT * FROM groups WHERE id = ${id} AND business_id = ${user.business_id}`;
  if (!group) return Response.json({ error: "Group not found" }, { status: 404 });

  const { contactIds } = await req.json();
  if (!Array.isArray(contactIds) || !contactIds.length) {
    return Response.json({ error: "contactIds required" }, { status: 400 });
  }

  await sql.begin(async (tx) => {
    for (const cid of contactIds) {
      await tx`INSERT INTO group_members (group_id, contact_id) VALUES (${id}, ${cid}) ON CONFLICT DO NOTHING`;
    }
  });
  return Response.json({ ok: true });
}

// Remove a single contact.  Body: { contactId: number }
export async function DELETE(req, { params }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { contactId } = await req.json();
  const sql = await getSql();
  await sql`DELETE FROM group_members WHERE group_id = ${id} AND contact_id = ${contactId}`;
  return Response.json({ ok: true });
}
