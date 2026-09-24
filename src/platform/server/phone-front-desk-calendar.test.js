import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import {
  appointmentInterval,
  bookCalendarAppointment,
  checkCalendarAvailability,
  normalizeCalendarSettings,
  verifyCalendarAccess,
} from "./phone-front-desk-calendar.js";

test("calendar converts the business's local time and rejects DST gaps", () => {
  const settings = normalizeCalendarSettings({ calendarId: "team@example.com", timeZone: "Asia/Kolkata", durationMinutes: 45 });
  const slot = appointmentInterval(settings, { date: "2026-10-01", time: "10:30" }, Date.UTC(2026, 8, 1));
  assert.equal(slot.start, "2026-10-01T05:00:00.000Z");
  assert.equal(slot.end, "2026-10-01T05:45:00.000Z");
  const newYork = normalizeCalendarSettings({ calendarId: "team@example.com", timeZone: "America/New_York" });
  assert.throws(() => appointmentInterval(newYork, { date: "2027-03-14", time: "02:30" }, Date.UTC(2027, 0, 1)), /unavailable or ambiguous/);
  assert.throws(() => appointmentInterval(newYork, { date: "2026-11-01", time: "01:30" }, Date.UTC(2026, 0, 1)), /unavailable or ambiguous/);
});

test("booking checks Google free/busy and creates one repeatable event", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_BASE64;
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_BASE64 = Buffer.from(JSON.stringify({ type: "service_account", client_email: "bot@example.iam.gserviceaccount.com", private_key: privateKey })).toString("base64");
  const events = new Map();
  let inserts = 0;
  let accessRole = "writer";
  globalThis.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "token", expires_in: 3600 });
    if (value.endsWith("/freeBusy")) {
      const body = JSON.parse(options.body);
      const busy = [...events.values()].filter((event) => event.start.dateTime < body.timeMax && event.end.dateTime > body.timeMin)
        .map((event) => ({ start: event.start.dateTime, end: event.end.dateTime }));
      return Response.json({ calendars: { "team@example.com": { busy } } });
    }
    if (value.includes("/events?maxResults=1")) return Response.json({ accessRole });
    if (value.endsWith("/events") && options.method === "POST") {
      inserts += 1;
      const event = JSON.parse(options.body);
      events.set(event.id, { ...event, htmlLink: "https://calendar.google.com/event" });
      return Response.json({ ...event, htmlLink: "https://calendar.google.com/event" });
    }
    const id = value.split("/").at(-1);
    return events.has(id) ? Response.json(events.get(id)) : Response.json({}, { status: 404 });
  };
  try {
    const settings = normalizeCalendarSettings({ calendarId: "team@example.com", timeZone: "Asia/Kolkata" });
    const args = { workspaceId: "workspace-1", conversationId: "conv_1234567890abcdef", callerName: "Sam", callerPhone: "+919000000000" };
    const input = { date: "2026-10-01", time: "10:30", service: "HVAC repair" };
    assert.equal(await verifyCalendarAccess(settings), true);
    accessRole = "reader";
    await assert.rejects(verifyCalendarAccess(settings), /cannot edit events/);
    accessRole = "writer";
    assert.equal((await checkCalendarAvailability(settings, input)).available, true);
    const first = await bookCalendarAppointment(settings, input, args);
    const second = await bookCalendarAppointment(settings, input, args);
    assert.equal(first.booked, true);
    assert.equal(second.alreadyBooked, true);
    assert.equal(first.eventId, second.eventId);
    assert.equal(inserts, 1);
    assert.equal((await checkCalendarAvailability(settings, input)).available, false);
    const differentSlot = await bookCalendarAppointment(settings, { ...input, time: "12:30" }, args);
    assert.equal(differentSlot.booked, false);
    assert.match(differentSlot.reason, /already booked a different time/);
    assert.equal(inserts, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_BASE64;
    else process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_BASE64 = originalKey;
  }
});
