import { getCurrentPrincipal } from "@platform/server/access-control";
import { getPlatformSql } from "@platform/server/auth-store";

// Read the application error log (agentic_that.app_error_log).
//   GET /api/error-log                 your own recent errors
//   GET /api/error-log?scope=all       every error (Super Admins only)
//   GET /api/error-log?limit=100       up to 200 rows, newest first
// Super Admins see stack traces for every row; everyone else sees them only
// for errors raised by their own requests.
export const dynamic = "force-dynamic";

export async function GET(req) {
  const principal = await getCurrentPrincipal();
  if (!principal) return Response.json({ error: "Sign in to continue." }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const limit = Math.min(Math.max(Number(params.get("limit")) || 50, 1), 200);
  const all = params.get("scope") === "all";
  if (all && !principal.isGlobalAdmin) {
    return Response.json({ error: "Only Super Admins can see every error." }, { status: 403 });
  }

  const sql = await getPlatformSql();
  try {
    const rows = all
      ? await sql`
          SELECT id, occurred_at, source, kind, method, path, route, error_name, message, stack,
                 digest, code, username, workspace_id, context
            FROM agentic_that.app_error_log
           ORDER BY occurred_at DESC
           LIMIT ${limit}`
      : await sql`
          SELECT id, occurred_at, source, kind, method, path, route, error_name, message, stack,
                 digest, code, username, workspace_id, context
            FROM agentic_that.app_error_log
           WHERE user_id = ${String(principal.userId)}
           ORDER BY occurred_at DESC
           LIMIT ${limit}`;
    return Response.json({ ok: true, scope: all ? "all" : "mine", errors: rows });
  } catch (error) {
    if (error?.code === "42P01") {
      return Response.json(
        { error: "The error log isn't set up on this database yet. Run the platform migration (npm run db:migrate:platform)." },
        { status: 503 }
      );
    }
    throw error;
  }
}
