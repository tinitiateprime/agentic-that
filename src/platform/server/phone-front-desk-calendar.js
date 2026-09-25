import crypto from "node:crypto";
import { connectedGoogleRequest } from "./phone-front-desk-google.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
].join(" ");
let cachedToken = null;
let tokenPromise = null;

function serviceAccount() {
  const encoded = String(process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_BASE64 || "").trim();
  if (!encoded) throw Object.assign(new Error("Add the Google Calendar service account to Netlify first."), { status: 503 });
  let account;
  try { account = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")); } catch {
    throw Object.assign(new Error("The Google Calendar service account setting is invalid."), { status: 503 });
  }
  if (account?.type !== "service_account" || !account.client_email || !account.private_key) {
    throw Object.assign(new Error("The Google Calendar service account setting is incomplete."), { status: 503 });
  }
  return account;
}

export function calendarConfiguration() {
  try { return { configured: true, shareWith: serviceAccount().client_email }; }
  catch { return { configured: false, shareWith: "" }; }
}

function base64url(value) {
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
}

async function accessToken() {
  if (cachedToken?.expiresAt > Date.now() + 60_000) return cachedToken.value;
  if (tokenPromise) return tokenPromise;
  tokenPromise = (async () => {
    const account = serviceAccount();
    const now = Math.floor(Date.now() / 1000);
    const header = base64url({ alg: "RS256", typ: "JWT" });
    const claims = base64url({ iss: account.client_email, scope: SCOPES, aud: TOKEN_URL, iat: now, exp: now + 3600 });
    const unsigned = `${header}.${claims}`;
    const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), account.private_key).toString("base64url");
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
      signal: AbortSignal.timeout(8_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.access_token) throw Object.assign(new Error("Google Calendar authentication failed. Check the service account setting."), { status: 502 });
    cachedToken = { value: body.access_token, expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
    return cachedToken.value;
  })().finally(() => { tokenPromise = null; });
  return tokenPromise;
}

async function googleResponse(settings, path, { method = "GET", body } = {}) {
  if (settings.googleCalendarConnected && settings.workspaceId) {
    return (settings.googleCalendarRequest || connectedGoogleRequest)(settings.workspaceId, "calendar", `${CALENDAR_API}${path}`, { method, body });
  }
  const token = await accessToken();
  const response = await fetch(`${CALENDAR_API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8_000),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, data: payload };
}

async function googleRequest(settings, path, { method = "GET", body } = {}) {
  const { response, data: payload } = await googleResponse(settings, path, { method, body });
  if (!response.ok) {
    const reason = response.status === 403 || response.status === 404
      ? settings.googleCalendarConnected
        ? "This Google account cannot access the selected calendar. Reconnect or select another calendar."
        : "Share this Google Calendar with the service account using 'Make changes to events', then check the Calendar ID."
      : `Google Calendar returned HTTP ${response.status}.`;
    throw Object.assign(new Error(reason), { status: response.status, googleStatus: response.status });
  }
  return payload;
}

export function normalizeCalendarSettings(input = {}) {
  const calendarId = String(input.calendarId || "").trim().slice(0, 254);
  if (calendarId && !/^[a-zA-Z0-9_@.#+-]+$/.test(calendarId)) throw Object.assign(new Error("Enter a valid Google Calendar ID."), { status: 400 });
  const timeZone = String(input.timeZone || "UTC").trim().slice(0, 80);
  try { new Intl.DateTimeFormat("en", { timeZone }); } catch {
    throw Object.assign(new Error("Enter a valid IANA time zone, such as Asia/Kolkata."), { status: 400 });
  }
  const durationMinutes = Number(input.durationMinutes ?? 60);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 180) {
    throw Object.assign(new Error("Appointment length must be 15 to 180 minutes."), { status: 400 });
  }
  return { calendarId, timeZone, durationMinutes };
}

function localParts(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

export function appointmentInterval(settings, input, now = Date.now()) {
  const date = String(input?.date || input?.preferred_date || "").trim();
  const time = String(input?.time || input?.preferred_time || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw Object.assign(new Error("Use an exact date (YYYY-MM-DD) and time (HH:mm) before checking availability."), { status: 400 });
  }
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  if (new Date(naive).toISOString().slice(0, 10) !== date) throw Object.assign(new Error("The appointment date is invalid."), { status: 400 });
  const offsets = new Set();
  for (const sample of [naive - 86_400_000, naive, naive + 86_400_000]) {
    const p = localParts(new Date(sample), settings.timeZone);
    offsets.add(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)) - sample);
  }
  const candidates = [...offsets].map((offset) => naive - offset).filter((instant) => {
    const p = localParts(new Date(instant), settings.timeZone);
    return `${p.year}-${p.month}-${p.day}` === date && `${p.hour}:${p.minute}` === time;
  });
  if (candidates.length !== 1) throw Object.assign(new Error("That local time is unavailable or ambiguous. Choose another time."), { status: 400 });
  const start = candidates[0];
  if (start < now + 5 * 60_000 || start > now + 90 * 86_400_000) {
    throw Object.assign(new Error("Choose a time at least five minutes from now and within 90 days."), { status: 400 });
  }
  return { start: new Date(start).toISOString(), end: new Date(start + settings.durationMinutes * 60_000).toISOString(), date, time };
}

export async function checkCalendarAvailability(settings, input) {
  if (!settings.calendarId) throw Object.assign(new Error("This business has not connected a Google Calendar. Take an appointment request instead."), { status: 409 });
  const slot = appointmentInterval(settings, input);
  const result = await googleRequest(settings, "/freeBusy", {
    method: "POST",
    body: { timeMin: slot.start, timeMax: slot.end, items: [{ id: settings.calendarId }] },
  });
  const calendar = result.calendars?.[settings.calendarId];
  if (!calendar || calendar.errors?.length) throw Object.assign(new Error("Google Calendar could not verify availability for this calendar."), { status: 502 });
  return { available: !calendar.busy?.length, ...slot, timeZone: settings.timeZone };
}

export async function verifyCalendarAccess(settings) {
  if (!settings.calendarId) throw Object.assign(new Error("Enter a Calendar ID first."), { status: 400 });
  const now = new Date();
  const result = await googleRequest(settings, "/freeBusy", {
    method: "POST",
    body: { timeMin: now.toISOString(), timeMax: new Date(now.getTime() + 60_000).toISOString(), items: [{ id: settings.calendarId }] },
  });
  if (!result.calendars?.[settings.calendarId] || result.calendars[settings.calendarId].errors?.length) {
    throw Object.assign(new Error(settings.googleCalendarConnected ? "The connected account cannot see this calendar. Choose another calendar." : "The service account cannot see this calendar. Check sharing and Calendar ID."), { status: 403 });
  }
  const events = await googleRequest(settings, `/calendars/${encodeURIComponent(settings.calendarId)}/events?maxResults=1&fields=accessRole`);
  if (!["writerWithoutPrivateAccess", "writer", "owner"].includes(events.accessRole)) {
    throw Object.assign(new Error("The connected account can see the calendar but cannot edit events. Choose a calendar with event-editing permission."), { status: 403 });
  }
  return true;
}

export async function bookCalendarAppointment(settings, input, { workspaceId, conversationId, callerName, callerPhone }) {
  if (!conversationId || !/^conv_[a-zA-Z0-9_-]{10,100}$/.test(conversationId)) {
    throw Object.assign(new Error("Start a live AI conversation before booking."), { status: 400 });
  }
  if (!callerName?.trim() || !callerPhone?.trim()) {
    throw Object.assign(new Error("Collect the caller's name and callback number before booking."), { status: 400 });
  }
  const availability = await checkCalendarAvailability(settings, input);
  const eventId = `pfd${crypto.createHash("sha256").update(`${workspaceId}|${conversationId}`).digest("hex").slice(0, 48)}`;
  const eventPath = `/calendars/${encodeURIComponent(settings.calendarId)}/events`;
  // Repeated client tool calls should return the first booking, never create another.
  const { response: existingResponse, data: existingData } = await googleResponse(settings, `${eventPath}/${eventId}`);
  if (existingResponse.ok) {
    const existing = existingData;
    if (Date.parse(existing.start?.dateTime || "") !== Date.parse(availability.start)) {
      return { booked: false, reason: "This call already booked a different time. Do not confirm this new slot; ask the business to change the existing booking." };
    }
    return { booked: true, eventId, start: existing.start?.dateTime, end: existing.end?.dateTime, eventUrl: existing.htmlLink || "", alreadyBooked: true };
  }
  if (existingResponse.status !== 404) throw Object.assign(new Error("Google Calendar could not verify whether this call was already booked."), { status: 502 });
  if (!availability.available) return { booked: false, reason: "That time is already busy. Ask the caller for another time." };
  const service = String(input?.service || "Appointment").trim().slice(0, 120);
  const description = [
    `Booked by AgenticThat AI Phone Front Desk`,
    `Caller: ${callerName.trim().slice(0, 120)}`,
    `Callback: ${callerPhone.trim().slice(0, 40)}`,
    `Service: ${service}`,
    `Conversation: ${conversationId}`,
  ].join("\n");
  try {
    const event = await googleRequest(settings, eventPath, {
      method: "POST",
      body: { id: eventId, summary: `${service} — ${callerName.trim().slice(0, 80)}`, description, start: { dateTime: availability.start, timeZone: settings.timeZone }, end: { dateTime: availability.end, timeZone: settings.timeZone } },
    });
    return { booked: true, eventId: event.id, start: availability.start, end: availability.end, eventUrl: event.htmlLink || "", alreadyBooked: false };
  } catch (error) {
    if (error.googleStatus === 409) {
      const event = await googleRequest(settings, `${eventPath}/${eventId}`);
      if (Date.parse(event.start?.dateTime || "") !== Date.parse(availability.start)) {
        return { booked: false, reason: "This call already booked a different time. Do not confirm this new slot; ask the business to change the existing booking." };
      }
      return { booked: true, eventId, start: event.start?.dateTime, end: event.end?.dateTime, eventUrl: event.htmlLink || "", alreadyBooked: true };
    }
    throw error;
  }
}
