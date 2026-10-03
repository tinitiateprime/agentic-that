import crypto from "node:crypto";
import { createWebsiteAssistantSession } from "@platform/server/website-studio-assistant";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function visitorKey(request) {
  const address = request.headers.get("x-nf-client-connection-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]
    || "unknown";
  const agent = request.headers.get("user-agent") || "unknown";
  return crypto.createHash("sha256").update(`${address}|${agent}`).digest("hex").slice(0, 32);
}

export async function POST(request) {
  try {
    const raw = await request.text();
    if (raw.length > 4_000) return Response.json({ error: "Invalid assistant request." }, { status: 400 });
    const input = raw ? JSON.parse(raw) : {};
    const session = await createWebsiteAssistantSession(input, visitorKey(request));
    return Response.json({ ok: true, ...session }, {
      headers: { "cache-control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    console.error("Website assistant session failed", error);
    const status = Number(error?.status);
    return Response.json({
      error: error instanceof Error ? error.message : "The AI assistant is temporarily unavailable.",
      code: error?.code || "ASSISTANT_UNAVAILABLE",
    }, {
      status: status >= 400 && status < 600 ? status : 500,
      headers: { "cache-control": "private, no-store, max-age=0" },
    });
  }
}
