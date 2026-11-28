import { logError } from "../../../../lib/error-log.js";

// Errors caught in the browser (error boundaries) are sent here and stored in
// the error log with source "client". Small payloads only; the signed-in user
// is taken from the session cookie, never from the request body.
export const dynamic = "force-dynamic";

const MAX_BODY = 16_000;

export async function POST(req) {
  const text = await req.text().catch(() => "");
  if (!text || text.length > MAX_BODY) return new Response(null, { status: 204 });

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 204 });
  }

  const message = String(body?.message || "").trim();
  if (!message) return new Response(null, { status: 204 });

  await logError(new Error(message), {
    source: "client",
    kind: String(body.kind || "boundary").slice(0, 60),
    method: "GET",
    path: String(body.path || ""),
    errorName: String(body.name || "Error"),
    stack: body.stack ? String(body.stack) : false,
    digest: body.digest ? String(body.digest).slice(0, 120) : null,
    cookieHeader: req.headers.get("cookie"),
    context: { userAgent: String(req.headers.get("user-agent") || "").slice(0, 200) },
  });
  return new Response(null, { status: 204 });
}
