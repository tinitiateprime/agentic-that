import { getSql } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const sql = await getSql();
  const groups = await sql`
    SELECT g.*, CAST(COUNT(gm.contact_id) AS INTEGER) AS member_count
      FROM groups g
      LEFT JOIN group_members gm ON gm.group_id = g.id
     WHERE g.business_id = ${user.business_id}
     GROUP BY g.id ORDER BY lower(g.name)`;
  return Response.json({ groups });
}

export async function POST(req) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { name } = await req.json();
  if (!name?.trim()) return Response.json({ error: "Name is required" }, { status: 400 });
  const sql = await getSql();
  const [row] = await sql`INSERT INTO groups (business_id, name) VALUES (${user.business_id}, ${name.trim()}) RETURNING id`;
  return Response.json({ ok: true, id: row.id });
}
