import { getSql } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function PATCH(req) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { name, admin_number, currency } = await req.json();
  const sql = await getSql();
  const [biz] = await sql`SELECT * FROM businesses WHERE id = ${user.business_id}`;
  await sql`
    UPDATE businesses
       SET name = ${name?.trim() || biz.name},
           admin_number = ${admin_number?.trim() || biz.admin_number},
           currency = ${currency?.trim() || biz.currency}
     WHERE id = ${user.business_id}`;
  return Response.json({ ok: true });
}
