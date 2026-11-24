import { getPlatformSql } from "./auth-store.js";

// Usernames (login emails) of Super Admins, so <AuditStamp superAdmins=...>
// can mark changes they made. Cached briefly; an empty list on any error.
const CACHE_TTL_MS = 60_000;
let cached = { at: 0, usernames: [] };

export async function listSuperAdminUsernames() {
  if (Date.now() - cached.at < CACHE_TTL_MS) return cached.usernames;
  try {
    const sql = await getPlatformSql();
    const rows = await sql`
      SELECT lower(email) AS email FROM platform_users
       WHERE is_global_admin = true AND email IS NOT NULL`;
    cached = { at: Date.now(), usernames: rows.map((row) => row.email) };
  } catch {
    cached = { at: Date.now(), usernames: [] };
  }
  return cached.usernames;
}
