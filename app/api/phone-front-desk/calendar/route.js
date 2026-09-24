import { accessErrorResponse, assertPrincipalCapability, authorizeApiAccess } from "@platform/server/access-control";
import { phoneFrontDeskProfileForActor } from "@platform/server/phone-front-desk-store";
import { getPlatformSql } from "@platform/server/auth-store";
import {
  bookCalendarAppointment,
  checkCalendarAvailability,
  verifyCalendarAccess,
} from "@platform/server/phone-front-desk-calendar";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function POST(request) {
  try {
    const raw = await request.text();
    if (raw.length > 4_000) return Response.json({ error: "Invalid calendar request." }, { status: 400 });
    const input = JSON.parse(raw || "{}");
    const level = input.action === "verify" ? "configure" : "operate";
    const actor = await assertPrincipalCapability(await authorizeApiAccess("messaging.ai-phone-front-desk", level), `messaging.${level}`);
    const profile = await phoneFrontDeskProfileForActor(actor);
    let result;
    if (input.action === "verify") result = { connected: await verifyCalendarAccess(profile) };
    else if (input.action === "check") result = await checkCalendarAvailability(profile, input);
    else if (input.action === "book") {
      if (input.callerConfirmed !== true) return Response.json({ error: "The caller must agree to the exact date and time before booking." }, { status: 400 });
      const sql = await getPlatformSql();
      result = await sql.begin(async (transaction) => {
        // Serialize bookings from this app for the same calendar while Google is rechecked.
        await transaction`SELECT pg_advisory_xact_lock(hashtext(${profile.calendarId}))`;
        return bookCalendarAppointment(profile, input, {
          workspaceId: actor.workspaceId,
          conversationId: input.conversationId,
          callerName: input.callerName,
          callerPhone: input.callerPhone,
        });
      });
    } else return Response.json({ error: "Choose check, book, or verify." }, { status: 400 });
    return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    try { return accessErrorResponse(error); } catch {
      console.error("Phone Front Desk calendar request failed", error);
      return Response.json({ error: error instanceof Error ? error.message : "Calendar request failed." }, { status: Number(error?.status) || 500 });
    }
  }
}
