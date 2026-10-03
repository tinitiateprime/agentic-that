import { accessErrorResponse, assertPrincipalCapability, authorizeApiAccess } from "@platform/server/access-control";
import { phoneFrontDeskIntegrationsEnabled } from "@platform/server/phone-front-desk-store";
import {
  disconnectGoogleConnection,
  googleConnectionSummary,
  listConnectedCalendars,
  selectConnectedCalendar,
  setConnectedBookingTimeZone,
  sendConnectedGmail,
} from "@platform/server/phone-front-desk-google";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function authorize() {
  const actor = await assertPrincipalCapability(await authorizeApiAccess("messaging.ai-phone-front-desk", "configure"), "messaging.configure");
  if (!phoneFrontDeskIntegrationsEnabled()) throw Object.assign(new Error("Google connections are not enabled."), { status: 404 });
  return actor;
}

function failure(error) {
  try { return accessErrorResponse(error); } catch {
    return Response.json({ error: error instanceof Error ? error.message : "Google connection request failed." }, { status: Number(error?.status) || 500 });
  }
}

export async function GET(request) {
  try {
    const actor = await authorize();
    const calendars = new URL(request.url).searchParams.get("calendars") === "true"
      ? await listConnectedCalendars(actor.workspaceId) : undefined;
    return Response.json({ ok: true, connections: await googleConnectionSummary(actor.workspaceId), ...(calendars ? { calendars } : {}) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function POST(request) {
  try {
    const actor = await authorize();
    const raw = await request.text();
    if (raw.length > 2_000) return Response.json({ error: "Invalid connection request." }, { status: 400 });
    const input = JSON.parse(raw || "{}");
    if (input.action === "select-calendar") {
      const selected = await selectConnectedCalendar(actor.workspaceId, String(input.calendarId || ""));
      return Response.json({ ok: true, selected, connections: await googleConnectionSummary(actor.workspaceId) });
    }
    if (input.action === "set-time-zone") {
      const selected = await setConnectedBookingTimeZone(actor.workspaceId, input.timeZone);
      return Response.json({ ok: true, selected, connections: await googleConnectionSummary(actor.workspaceId) });
    }
    if (input.action === "test-mail") {
      const status = await googleConnectionSummary(actor.workspaceId);
      if (!status.mail.connected) return Response.json({ error: "Connect Gmail first." }, { status: 409 });
      const sent = await sendConnectedGmail(actor.workspaceId, { to: status.mail.email, subject: "AI Phone Front Desk email connection test", text: "Your business Gmail connection can send AI Phone Front Desk follow-up emails." });
      return Response.json({ ok: true, provider: sent.provider, messageId: sent.messageId });
    }
    return Response.json({ error: "Choose a supported connection action." }, { status: 400 });
  } catch (error) { return failure(error); }
}

export async function DELETE(request) {
  try {
    const actor = await authorize();
    const kind = new URL(request.url).searchParams.get("kind");
    await disconnectGoogleConnection(actor.workspaceId, kind);
    return Response.json({ ok: true, connections: await googleConnectionSummary(actor.workspaceId) });
  } catch (error) { return failure(error); }
}
