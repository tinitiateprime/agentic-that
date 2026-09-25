import crypto from "node:crypto";
import { getPlatformSql } from "./auth-store.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const SCOPES = {
  calendar: [
    "openid", "email",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.events.freebusy",
  ],
  mail: ["openid", "email", "https://www.googleapis.com/auth/gmail.send"],
};

function connectionError(message, status = 503) {
  return Object.assign(new Error(message), { status });
}

function credentialEncryptionKeyConfigured() {
  const key = String(process.env.CREDENTIAL_ENCRYPTION_KEY || "").trim();
  return key.length >= 32
    && new Set(key).size >= 8
    && !/^(?:a_long_random_secret|your[_-].*|change[_-]?me|placeholder)$/i.test(key);
}

export function googleConnectionConfiguration() {
  const configured = Boolean(
    String(process.env.GOOGLE_OAUTH_CLIENT_ID || "").trim()
    && String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || "").trim()
    && credentialEncryptionKeyConfigured(),
  );
  return { configured };
}

function requireConfiguration() {
  if (!googleConnectionConfiguration().configured) {
    throw connectionError("Google connection is not configured. Add the OAuth web client and credential encryption key.");
  }
  return {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID.trim(),
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET.trim(),
  };
}

export function googleRedirectUri(requestUrl) {
  const explicit = String(process.env.GOOGLE_OAUTH_REDIRECT_URI || "").trim();
  if (explicit) return explicit;
  const incoming = new URL(requestUrl);
  const local = ["localhost", "127.0.0.1"].includes(incoming.hostname);
  const base = local ? incoming.origin : String(process.env.PLATFORM_PUBLIC_URL || process.env.URL || "").trim();
  if (!base) throw connectionError("Set PLATFORM_PUBLIC_URL before connecting Google.");
  const parsed = new URL(base);
  if (!local && parsed.protocol !== "https:") throw connectionError("Google connections require an HTTPS public URL.");
  return new URL("/api/phone-front-desk/google/callback", parsed).toString();
}

function encryptionKey() {
  const source = String(process.env.CREDENTIAL_ENCRYPTION_KEY || "").trim();
  if (!credentialEncryptionKeyConfigured()) throw connectionError("Set CREDENTIAL_ENCRYPTION_KEY to a stable, random value of at least 32 characters before connecting Google.");
  return crypto.createHash("sha256").update(source).digest();
}

export function encryptGoogleToken(token) {
  if (!token || typeof token !== "string") throw connectionError("Google did not provide a token.", 502);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const value = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), value.toString("base64url")].join(":");
}

export function decryptGoogleToken(value) {
  const [version, iv, tag, ciphertext] = String(value || "").split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw connectionError("Google connection needs to be reconnected.", 409);
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

function validKind(kind) {
  if (kind !== "calendar" && kind !== "mail") throw connectionError("Choose Google Calendar or Gmail.", 400);
  return kind;
}

export function createGoogleAuthorization(kind, requestUrl) {
  validKind(kind);
  const { clientId } = requireConfiguration();
  const state = crypto.randomBytes(32).toString("base64url");
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleRedirectUri(requestUrl),
    response_type: "code",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    scope: SCOPES[kind].join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return { url: url.toString(), state, verifier };
}

async function googleFetch(url, { method = "GET", token, body, form } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form) : body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

export async function exchangeGoogleCode(kind, code, verifier, requestUrl) {
  validKind(kind);
  const { clientId, clientSecret } = requireConfiguration();
  if (!code || !verifier) throw connectionError("Google connection expired. Please try again.", 400);
  const { response, data } = await googleFetch(TOKEN_URL, {
    method: "POST",
    form: { code, code_verifier: verifier, client_id: clientId, client_secret: clientSecret, redirect_uri: googleRedirectUri(requestUrl), grant_type: "authorization_code" },
  });
  if (!response.ok || !data.access_token || !data.refresh_token) {
    throw connectionError("Google did not grant lasting access. Please connect again and approve all permissions.", 502);
  }
  const granted = new Set(String(data.scope || "").split(/\s+/).filter(Boolean));
  const hasScope = (scope) => granted.has(scope) || (scope === "email" && granted.has("https://www.googleapis.com/auth/userinfo.email"));
  if (!SCOPES[kind].every(hasScope)) {
    throw connectionError("The required Google permissions were not granted. Please connect again.", 403);
  }
  const user = await googleFetch(USERINFO_URL, { token: data.access_token });
  if (!user.response.ok || !user.data.email_verified || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(user.data.email || ""))) {
    throw connectionError("Google did not confirm the email address for this account.", 502);
  }
  return { email: user.data.email.toLowerCase(), accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: Number(data.expires_in) || 3600, scopes: [...granted] };
}

async function googleCalendarListWithToken(token) {
  const calendars = [];
  let pageToken = "";
  for (let page = 0; page < 5; page += 1) {
    const url = new URL(`${CALENDAR_API}/users/me/calendarList`);
    url.searchParams.set("maxResults", "250");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const { response, data } = await googleFetch(url.toString(), { token });
    if (!response.ok) throw connectionError("Google Calendar could not list calendars. Please reconnect.", 502);
    calendars.push(...(Array.isArray(data.items) ? data.items : []));
    pageToken = String(data.nextPageToken || "");
    if (!pageToken) break;
  }
  return calendars.filter((item) => item?.id && ["owner", "writer", "writerWithoutPrivateAccess"].includes(item.accessRole))
    .map((item) => ({ id: String(item.id), name: String(item.summaryOverride || item.summary || item.id), primary: Boolean(item.primary), timeZone: String(item.timeZone || "UTC") }));
}

export async function saveGoogleConnection(workspaceId, kind, grant) {
  validKind(kind);
  const sql = await getPlatformSql();
  const calendars = kind === "calendar" ? await googleCalendarListWithToken(grant.accessToken) : [];
  const selected = calendars.find((item) => item.primary) || calendars[0];
  if (kind === "calendar" && !selected) throw connectionError("This Google account has no calendar where it can create appointments.", 409);
  const calendarId = selected?.id || "";
  const timeZone = selected?.timeZone || "UTC";
  const expiresAt = new Date(Date.now() + grant.expiresIn * 1000).toISOString();
  await sql`
    INSERT INTO ai_phone_front_desk_google_connections
      (workspace_id, kind, google_email, refresh_token_ciphertext, access_token_ciphertext,
       access_token_expires_at, granted_scopes, calendar_id, time_zone)
    VALUES (${String(workspaceId)}, ${kind}, ${grant.email}, ${encryptGoogleToken(grant.refreshToken)},
      ${encryptGoogleToken(grant.accessToken)}, ${expiresAt}, ${grant.scopes.join(" ")}, ${calendarId}, ${timeZone})
    ON CONFLICT (workspace_id, kind) DO UPDATE SET
      google_email = excluded.google_email,
      refresh_token_ciphertext = excluded.refresh_token_ciphertext,
      access_token_ciphertext = excluded.access_token_ciphertext,
      access_token_expires_at = excluded.access_token_expires_at,
      granted_scopes = excluded.granted_scopes,
      calendar_id = excluded.calendar_id,
      time_zone = excluded.time_zone,
      connected_at = now(), updated_at = now()`;
  return { email: grant.email, calendarId, timeZone };
}

async function connectionRow(workspaceId, kind) {
  validKind(kind);
  const sql = await getPlatformSql();
  const [row] = await sql`
    SELECT * FROM ai_phone_front_desk_google_connections
     WHERE workspace_id = ${String(workspaceId)} AND kind = ${kind}`;
  return row || null;
}

export async function googleConnectionSummary(workspaceId) {
  const sql = await getPlatformSql();
  const rows = await sql`
    SELECT kind, google_email, calendar_id, time_zone, connected_at
      FROM ai_phone_front_desk_google_connections
     WHERE workspace_id = ${String(workspaceId)}`;
  const result = { calendar: { connected: false }, mail: { connected: false } };
  for (const row of rows) result[row.kind] = {
    connected: true,
    email: row.google_email,
    ...(row.kind === "calendar" ? { calendarId: row.calendar_id, timeZone: row.time_zone } : {}),
    connectedAt: row.connected_at,
  };
  return result;
}

export async function googleAccessToken(workspaceId, kind, { forceRefresh = false } = {}) {
  const row = await connectionRow(workspaceId, kind);
  if (!row) throw connectionError(`Connect ${kind === "mail" ? "Gmail" : "Google Calendar"} first.`, 409);
  if (!forceRefresh && row.access_token_ciphertext && Date.parse(row.access_token_expires_at) > Date.now() + 60_000) {
    return decryptGoogleToken(row.access_token_ciphertext);
  }
  const refreshed = await refreshGoogleGrant(decryptGoogleToken(row.refresh_token_ciphertext));
  const sql = await getPlatformSql();
  const refreshedCiphertext = refreshed.refreshToken ? encryptGoogleToken(refreshed.refreshToken) : row.refresh_token_ciphertext;
  const expiresAt = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString();
  await sql`
    UPDATE ai_phone_front_desk_google_connections
       SET access_token_ciphertext = ${encryptGoogleToken(refreshed.accessToken)},
           refresh_token_ciphertext = ${refreshedCiphertext}, access_token_expires_at = ${expiresAt}, updated_at = now()
     WHERE workspace_id = ${String(workspaceId)} AND kind = ${kind}`;
  return refreshed.accessToken;
}

export async function refreshGoogleGrant(refreshToken) {
  const { clientId, clientSecret } = requireConfiguration();
  const { response, data } = await googleFetch(TOKEN_URL, {
    method: "POST",
    form: { client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" },
  });
  if (!response.ok || !data.access_token) {
    throw connectionError("Google access expired or was revoked. Reconnect this account.", 409);
  }
  return { accessToken: data.access_token, refreshToken: data.refresh_token || "", expiresIn: Number(data.expires_in) || 3600 };
}

export async function connectedGoogleRequest(workspaceId, kind, url, options = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await googleAccessToken(workspaceId, kind, { forceRefresh: attempt > 0 });
    const result = await googleFetch(url, { ...options, token });
    if (result.response.status !== 401 || attempt === 1) return result;
  }
}

export async function listConnectedCalendars(workspaceId) {
  const token = await googleAccessToken(workspaceId, "calendar");
  return googleCalendarListWithToken(token);
}

export async function selectConnectedCalendar(workspaceId, calendarId) {
  const selected = (await listConnectedCalendars(workspaceId)).find((item) => item.id === calendarId);
  if (!selected) throw connectionError("Choose a calendar you can edit from the list.", 400);
  const sql = await getPlatformSql();
  const [row] = await sql`
    UPDATE ai_phone_front_desk_google_connections
       SET calendar_id = ${selected.id}, updated_at = now()
     WHERE workspace_id = ${String(workspaceId)} AND kind = 'calendar'
     RETURNING time_zone`;
  if (!row) throw connectionError("Connect Google Calendar first.", 409);
  return { ...selected, timeZone: row.time_zone };
}

export function normalizeBookingTimeZone(value) {
  const timeZone = String(value || "").trim();
  if (!timeZone || timeZone.length > 80) throw connectionError("Choose a valid booking time zone, such as Asia/Kolkata.", 400);
  try { new Intl.DateTimeFormat("en", { timeZone }); }
  catch { throw connectionError("Choose a valid booking time zone, such as Asia/Kolkata.", 400); }
  return timeZone;
}

export async function setConnectedBookingTimeZone(workspaceId, value) {
  const timeZone = normalizeBookingTimeZone(value);
  const sql = await getPlatformSql();
  const [row] = await sql`
    UPDATE ai_phone_front_desk_google_connections
       SET time_zone = ${timeZone}, updated_at = now()
     WHERE workspace_id = ${String(workspaceId)} AND kind = 'calendar'
     RETURNING calendar_id, time_zone`;
  if (!row) throw connectionError("Connect Google Calendar first.", 409);
  return { calendarId: row.calendar_id, timeZone: row.time_zone };
}

export async function disconnectGoogleConnection(workspaceId, kind) {
  validKind(kind);
  const row = await connectionRow(workspaceId, kind);
  if (!row) return;
  const sql = await getPlatformSql();
  await sql`DELETE FROM ai_phone_front_desk_google_connections WHERE workspace_id = ${String(workspaceId)} AND kind = ${kind}`;
  // Calendar and Gmail may belong to the same Google grant. Deleting this
  // workspace's credential stops our access without revoking the other kind.
}

function emailAddress(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(normalized)) throw connectionError("Enter a valid recipient email address.", 400);
  return normalized;
}

export function buildGmailRaw({ from, to, subject, text }) {
  const sender = emailAddress(from);
  const recipient = emailAddress(to);
  const safeSubject = String(subject || "").replace(/[\r\n]+/g, " ").trim().slice(0, 180);
  const body = String(text || "").replace(/\r?\n/g, "\r\n").slice(0, 20000);
  const bodyBase64 = Buffer.from(body).toString("base64").replace(/.{1,76}/g, "$&\r\n").trimEnd();
  const mime = [`From: ${sender}`, `To: ${recipient}`, `Subject: =?UTF-8?B?${Buffer.from(safeSubject).toString("base64")}?=`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", bodyBase64].join("\r\n");
  return Buffer.from(mime).toString("base64url");
}

export async function sendConnectedGmail(workspaceId, { to, subject, text }) {
  const row = await connectionRow(workspaceId, "mail");
  if (!row) throw connectionError("Connect a business Gmail account before sending follow-up emails.", 409);
  const from = emailAddress(row.google_email);
  const raw = buildGmailRaw({ from, to, subject, text });
  const { response, data } = await connectedGoogleRequest(workspaceId, "mail", `${GMAIL_API}/users/me/messages/send`, {
    method: "POST", body: { raw },
  });
  if (!response.ok || !data.id) throw connectionError("Gmail could not send this email. Check the connection and retry.", response.status === 401 || response.status === 403 ? 409 : 502);
  return { provider: "gmail", messageId: data.id, skipped: false, from };
}
