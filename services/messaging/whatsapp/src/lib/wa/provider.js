// WhatsApp messaging provider abstraction.
//
// Every adapter implements the same shape:
//   async sendText({ from, to, body })                 -> { providerId, status }
//   async sendTemplate({ from, to, name, body })       -> { providerId, status }
//   async sendButtons({ from, to, body, buttons })     -> { providerId, status }
//
// `buttons` is an array of up to 3 short labels (the "Bot / 3-button actions"
// from the spec). The rest of the app only talks to getProvider(), so swapping
// BSPs is a one-line env change (WA_PROVIDER) with no caller changes.

// WhatsApp / WATI want the number as digits only, no leading "+".
export function normalizeWaNumber(phone) {
  return String(phone || "").replace(/[^\d]/g, "");
}

// Normalize WATI_ACCESS_TOKEN regardless of how it was pasted: tolerate
// surrounding quotes and a leading "Bearer " (the WATI dashboard shows it both
// ways). We always send exactly one "Bearer <token>".
export function watiToken(value = process.env.WATI_ACCESS_TOKEN || "") {
  let t = String(value || "").trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }
  if (/^bearer\s+/i.test(t)) t = t.replace(/^bearer\s+/i, "").trim();
  return t;
}

function watiApiUrl(creds = null) {
  const value = creds ? creds.serviceUrl : process.env.WATI_API_URL;
  return String(value || "").replace(/\/$/, "");
}

function watiAccessToken(creds = null) {
  return creds ? creds.accessToken || "" : process.env.WATI_ACCESS_TOKEN || "";
}

// --- Mock (default) --------------------------------------------------------
// No network, no credentials. Pretends the BSP accepted the message and
// returns a fake provider id. Supports the full interface incl. buttons so the
// 3-button flow is demoable locally (see /api/messages/simulate-reply).
const mock = {
  name: "mock",
  async sendText({ to, body }) {
    return {
      providerId: `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status: "sent",
      echo: { to, body },
    };
  },
  async sendTemplate(args) {
    return this.sendText({ to: args.to, body: args.body });
  },
  async sendButtons(args) {
    return this.sendText({ to: args.to, body: args.body });
  },
};

// --- WATI (https://www.wati.io) -------------------------------------------
// Set in .env:
//   WA_PROVIDER=wati
//   WATI_API_URL=https://live-mt-server.wati.io/<tenantId>   (from WATI > API Docs)
//   WATI_ACCESS_TOKEN=<Bearer token from WATI dashboard>
//
// Docs: https://docs.wati.io/reference  (sendDirectSendMessages, sendTemplateMessage,
//        sendInteractiveButtonsMessage)
const wati = {
  name: "wati",
  creds: null,
  base() {
    return watiApiUrl(this.creds);
  },
  headers(extra = {}) {
    return {
      Authorization: `Bearer ${watiToken(watiAccessToken(this.creds))}`,
      "Content-Type": "application/json",
      ...extra,
    };
  },
  async _post(path, { query = {}, body } = {}) {
    const url = new URL(this.base() + path);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: body == null ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    // WATI returns { result: true/"success", ... } on success.
    const ok = res.ok && data?.result !== false && data?.ok !== false;
    if (!ok) throw new Error(watiErrorMessage(data, res.status));
    return data;
  },
  // Free-form text via WATI's direct-send endpoint.
  async sendText({ to, body }) {
    const num = normalizeWaNumber(to);
    let data;
    try {
      data = await this._post(`/api/v1/sendDirectSendMessages`, {
        body: {
          broadcast_name: `direct_text_${Date.now()}`,
          receivers: [watiReceiver(num)],
          category: "utility",
          type: "text",
          text: body,
        },
      });
    } catch (err) {
      if (!watiDirectSendDisabled(err)) throw err;
      data = await this._post(`/api/v1/sendSessionMessage/${num}`, {
        query: { messageText: body },
      });
    }
    return { providerId: data?.id || data?.whatsappMessageId || null, status: "sent" };
  },
  // Approved WhatsApp template (works OUTSIDE the 24h window). `name` must be a
  // template registered + APPROVED in WATI/Meta. Errors surface (no silent
  // fallback) so the caller can report exactly why a send failed.
  async sendTemplate({ to, name, parameters = [], broadcastName }) {
    const num = normalizeWaNumber(to);
    const data = await this._post(`/api/v1/sendTemplateMessage`, {
      query: { whatsappNumber: num },
      body: {
        template_name: name,
        broadcast_name: broadcastName || `${name}_${Date.now()}`,
        parameters,
      },
    });
    return { providerId: data?.id || data?.whatsappMessageId || null, status: "sent" };
  },
  // Interactive reply buttons — the 3-button "Bot" action.
  async sendButtons({ to, body, buttons = [], header, footer }) {
    const num = normalizeWaNumber(to);
    const cleanButtons = buttons.slice(0, 3).map((text, index) => ({
      type: "reply",
      reply: {
        id: `button_${index + 1}`,
        title: text,
      },
    }));
    const interactive = {
      type: 0,
      body: { text: body },
      action: { buttons: cleanButtons },
    };
    if (header) interactive.header = { type: "text", text: header };
    if (footer) interactive.footer = { text: footer };

    let data;
    try {
      data = await this._post(`/api/v1/sendDirectSendMessages`, {
        body: {
          broadcast_name: `direct_buttons_${Date.now()}`,
          receivers: [watiReceiver(num)],
          category: "utility",
          type: "interactive",
          interactive,
        },
      });
    } catch (err) {
      if (!watiDirectSendDisabled(err)) throw err;
      data = await this._post(`/api/v1/sendInteractiveButtonsMessage`, {
        query: { whatsappNumber: num },
        body: {
          body,
          buttons: buttons.slice(0, 3).map((text) => ({ text })),
        },
      });
    }
    return { providerId: data?.id || data?.whatsappMessageId || null, status: "sent" };
  },
};

// --- Meta WhatsApp Cloud API (direct, no BSP) -------------------------------
// Set in .env:
//   WA_PROVIDER=meta
//   META_ACCESS_TOKEN=<System User permanent token, or a temporary token from
//                       Meta for Developers > WhatsApp > API Setup>
//   META_PHONE_NUMBER_ID=<Phone number ID from the same API Setup page>
//   META_API_VERSION=v21.0   (optional, defaults below)
//
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
const meta = {
  name: "meta",
  // Bound to one tenant's credentials by getProvider(creds). `creds` is null for
  // the legacy env-configured deployment, in which case withCreds() supplies the
  // environment values.
  creds: null,
  // Every send can target a specific sender number (multi-number WABAs);
  // omitted, it falls back to the tenant's default number.
  base(phoneNumberId) {
    const c = withCreds(this.creds);
    const phoneId = phoneNumberId || c.defaultPhoneNumberId || "";
    return `https://graph.facebook.com/${c.apiVersion}/${phoneId}`;
  },
  async _post(path, body, phoneNumberId) {
    const res = await fetch(`${this.base(phoneNumberId)}${path}`, {
      method: "POST",
      headers: metaAuthHeaders(this.creds),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(metaErrorMessage(data, res.status));
    return data;
  },
  // Free-form text — only deliverable inside the 24h customer service window.
  async sendText({ to, body, phoneNumberId }) {
    const data = await this._post(
      "/messages",
      {
        messaging_product: "whatsapp",
        to: normalizeWaNumber(to),
        type: "text",
        text: { body },
      },
      phoneNumberId
    );
    return { providerId: data?.messages?.[0]?.id || null, status: "sent" };
  },
  // Approved WhatsApp template — works outside the 24h window. `name` must be
  // registered + APPROVED for this WABA. `parameters` is [{ name, value }, ...]
  // (name is ignored by Meta — Cloud API templates are positional).
  async sendTemplate({ to, name, parameters = [], language = "en_US", phoneNumberId }) {
    const components = parameters.length
      ? [
          {
            type: "body",
            parameters: parameters.map((p) => ({
              type: "text",
              text: String(p?.value ?? p ?? ""),
            })),
          },
        ]
      : [];
    const data = await this._post(
      "/messages",
      {
        messaging_product: "whatsapp",
        to: normalizeWaNumber(to),
        type: "template",
        template: {
          name,
          language: { code: language },
          components,
        },
      },
      phoneNumberId
    );
    return { providerId: data?.messages?.[0]?.id || null, status: "sent" };
  },
  // Interactive reply buttons (max 3, 20-char titles per Meta's limit).
  async sendButtons({ to, body, buttons = [], header, footer, phoneNumberId }) {
    const action = {
      buttons: buttons.slice(0, 3).map((text, index) => ({
        type: "reply",
        reply: { id: `button_${index + 1}`, title: String(text).slice(0, 20) },
      })),
    };
    const interactive = { type: "button", body: { text: body }, action };
    if (header) interactive.header = { type: "text", text: header };
    if (footer) interactive.footer = { text: footer };

    const data = await this._post(
      "/messages",
      {
        messaging_product: "whatsapp",
        to: normalizeWaNumber(to),
        type: "interactive",
        interactive,
      },
      phoneNumberId
    );
    return { providerId: data?.messages?.[0]?.id || null, status: "sent" };
  },
};

// All sender numbers on the WABA — powers the multi-number picker and the
// per-message "via <number>" labels. Live discovery: adding a number in Meta
// Business Manager makes it appear here with no code/env change.
export async function metaListPhoneNumbers(creds = null) {
  const c = withCreds(creds);
  if (!metaTemplatesConfigured(c)) return [];
  const url = new URL(metaGraphUrl(`/${c.wabaId}/phone_numbers`, c));
  url.searchParams.set("fields", "id,display_phone_number,verified_name,quality_rating,status");
  const res = await fetch(url, { headers: metaAuthHeaders(c) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(metaErrorMessage(data, res.status));
  return (data.data || []).map((n) => ({
    id: n.id,
    number: n.display_phone_number || "",
    name: n.verified_name || "",
    quality_rating: n.quality_rating || null,
    status: n.status || null,
    isDefault: n.id === c.defaultPhoneNumberId,
  }));
}

// --- Meta phone number registration / verification --------------------------
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/phone-numbers
// A phone number is added to the WABA in Meta Business Manager first (which
// gives it a Phone Number ID); these calls request/confirm the SMS or voice
// verification code for that ID, and fetch its live status.
// --- Per-tenant credentials -------------------------------------------------
// Every Meta helper takes an optional `creds` ({ accessToken, wabaId, apiVersion,
// appId, defaultPhoneNumberId }). When omitted it falls back to the environment,
// so the original single-tenant deployment keeps working while tenants are
// migrated into whatsapp_accounts. In SaaS mode the caller resolves creds for
// the signed-in tenant (lib/tenant.js → credsForBusiness).
export function metaEnvCreds() {
  return {
    accessToken: (process.env.META_ACCESS_TOKEN || "").trim() || null,
    wabaId: (process.env.META_WABA_ID || "").trim() || null,
    appId: (process.env.META_APP_ID || "").trim() || null,
    apiVersion: process.env.META_API_VERSION || "v21.0",
    defaultPhoneNumberId: (process.env.META_PHONE_NUMBER_ID || "").trim() || null,
  };
}

function withCreds(creds) {
  const env = metaEnvCreds();
  if (!creds) return env;
  // Never fill tenant secrets or identifiers from the deployment owner's env.
  // Only the non-secret API version receives a default.
  return {
    accessToken: creds.accessToken || null,
    wabaId: creds.wabaId || null,
    appId: creds.appId || null,
    apiVersion: creds.apiVersion || "v21.0",
    defaultPhoneNumberId: creds.defaultPhoneNumberId || null,
  };
}

function metaGraphUrl(path, creds) {
  return `https://graph.facebook.com/${withCreds(creds).apiVersion}${path}`;
}

function metaAuthHeaders(creds) {
  return {
    Authorization: `Bearer ${withCreds(creds).accessToken || ""}`,
    "Content-Type": "application/json",
  };
}

export async function metaRequestVerificationCode({ phoneNumberId, codeMethod = "SMS", language = "en", creds = null }) {
  if (!phoneNumberId) throw new Error("Phone Number ID is required");
  const res = await fetch(metaGraphUrl(`/${phoneNumberId}/request_code`, creds), {
    method: "POST",
    headers: metaAuthHeaders(creds),
    body: JSON.stringify({ code_method: codeMethod, language }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(metaErrorMessage(data, res.status));
  return data;
}

export async function metaVerifyCode({ phoneNumberId, code, creds = null }) {
  if (!phoneNumberId) throw new Error("Phone Number ID is required");
  if (!code) throw new Error("Verification code is required");
  const res = await fetch(metaGraphUrl(`/${phoneNumberId}/verify_code`, creds), {
    method: "POST",
    headers: metaAuthHeaders(creds),
    body: JSON.stringify({ code }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(metaErrorMessage(data, res.status));
  return data;
}

// Live status for a phone number: verification state, display number, quality
// rating. Works for any Phone Number ID on the WABA the token can access, not
// just the one configured for sending (META_PHONE_NUMBER_ID).
export async function metaGetPhoneNumberStatus({ phoneNumberId, creds = null }) {
  if (!phoneNumberId) throw new Error("Phone Number ID is required");
  const url = new URL(metaGraphUrl(`/${phoneNumberId}`, creds));
  url.searchParams.set(
    "fields",
    "display_phone_number,verified_name,code_verification_status,quality_rating,platform_type"
  );
  const res = await fetch(url, { headers: metaAuthHeaders(creds) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(metaErrorMessage(data, res.status));
  return data;
}

// --- WhatsApp Business Calling API ------------------------------------------
// Docs: https://developers.facebook.com/documentation/business-messaging/whatsapp/calling
// Calling is OFF by default on a business number and requires a messaging limit
// of 2000+. Once enabled, Meta posts call events to the `calls` webhook field.

// Current calling config for a number: { status, call_icon_visibility,
// callback_permission_status }.
export async function metaGetCallSettings({ phoneNumberId, creds = null }) {
  if (!phoneNumberId) throw new Error("Phone Number ID is required");
  const url = new URL(metaGraphUrl(`/${phoneNumberId}/settings`, creds));
  url.searchParams.set("fields", "calling");
  const res = await fetch(url, { headers: metaAuthHeaders(creds) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(metaErrorMessage(data, res.status));
  return data?.calling || {};
}

// Turn calling on/off and control the call button + callback requests.
//   status:                   ENABLED | DISABLED
//   callIconVisibility:       DEFAULT (show call button) | DISABLE_ALL (hide it)
//   callbackPermissionStatus: ENABLED | DISABLED  (lets users request a callback
//                             when you don't pick up)
export async function metaUpdateCallSettings({
  phoneNumberId,
  status,
  callIconVisibility,
  callbackPermissionStatus,
  creds = null,
}) {
  if (!phoneNumberId) throw new Error("Phone Number ID is required");
  const calling = {};
  if (status) calling.status = status;
  if (callIconVisibility) calling.call_icon_visibility = callIconVisibility;
  if (callbackPermissionStatus) calling.callback_permission_status = callbackPermissionStatus;
  if (!Object.keys(calling).length) throw new Error("Nothing to update");

  const res = await fetch(metaGraphUrl(`/${phoneNumberId}/settings`, creds), {
    method: "POST",
    headers: metaAuthHeaders(creds),
    body: JSON.stringify({ calling }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(metaErrorMessage(data, res.status));
  return data;
}

function metaErrorMessage(data, status) {
  const err = data?.error;
  if (!err) return `Meta Cloud API ${status}`;
  const detail = err.error_user_msg || err.message || `HTTP ${status}`;
  return `Meta Cloud API: ${detail}`;
}

// Is the Meta Cloud API usable for this tenant (or from env when creds omitted)?
export function metaConfigured(creds = null) {
  const c = withCreds(creds);
  return Boolean(c.accessToken && c.defaultPhoneNumberId);
}

// Templates/numbers additionally need the WhatsApp Business Account id
// (different from the phone number id).
export function metaTemplatesConfigured(creds = null) {
  const c = withCreds(creds);
  return Boolean(c.accessToken && c.wabaId);
}

// Fetch WhatsApp message templates straight from Meta's Graph API — the direct
// equivalent of watiGetTemplates() below, for when WA_PROVIDER=meta. Only
// APPROVED templates can message a contact outside the 24h session window.
export async function metaGetTemplates({ approvedOnly = true, creds = null } = {}) {
  const c = withCreds(creds);
  if (!metaTemplatesConfigured(c)) {
    throw new Error(
      "Meta templates not configured — connect a WhatsApp Business Account (WABA id + access token) for this workspace."
    );
  }
  const url = new URL(metaGraphUrl(`/${c.wabaId}/message_templates`, c));
  url.searchParams.set("fields", "id,name,status,category,language,components,rejected_reason");
  url.searchParams.set("limit", "100");

  const res = await fetch(url, { headers: metaAuthHeaders(c) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(metaErrorMessage(data, res.status));

  const list = data.data || [];
  const mapped = list.map((t) => {
    const bodyText = t.components?.find((c) => c.type === "BODY")?.text || "";
    const header = t.components?.find((c) => c.type === "HEADER");
    const footer = t.components?.find((c) => c.type === "FOOTER")?.text || "";
    const buttons = t.components?.find((c) => c.type === "BUTTONS")?.buttons || [];
    const placeholderNames = Array.from(
      String(bodyText).matchAll(/\{\{\s*([^}]+?)\s*\}\}/g),
      (match) => match[1].trim()
    );
    return {
      id: t.id,
      name: t.name,
      status: t.status,
      category: t.category,
      rejectedReason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
      language: t.language,
      body: bodyText,
      headerFormat: header?.format || null,
      headerText: header?.format === "TEXT" ? header.text || "" : "",
      footer,
      buttons: buttons.map((b) => ({
        type: b.type,
        text: b.text,
        url: b.url,
        phoneNumber: b.phone_number,
      })),
      placeholderNames,
      placeholders: placeholderNames.length,
    };
  });

  return approvedOnly
    ? mapped.filter((t) => String(t.status).toUpperCase() === "APPROVED")
    : mapped;
}

// Build the `components` array Meta expects, shared by create + edit.
function buildTemplateComponents({ bodyText, headerText, headerImageHandle, footerText, buttons }) {
  const components = [];
  if (headerImageHandle) {
    components.push({ type: "HEADER", format: "IMAGE", example: { header_handle: [headerImageHandle] } });
  } else if (headerText?.trim()) {
    components.push({ type: "HEADER", format: "TEXT", text: headerText.trim() });
  }

  const placeholderNames = Array.from(
    String(bodyText).matchAll(/\{\{\s*([^}]+?)\s*\}\}/g),
    (match) => match[1].trim()
  );
  const bodyComponent = { type: "BODY", text: bodyText };
  if (placeholderNames.length) {
    bodyComponent.example = { body_text: [placeholderNames.map((_, i) => `example${i + 1}`)] };
  }
  components.push(bodyComponent);

  if (footerText?.trim()) {
    components.push({ type: "FOOTER", text: footerText.trim() });
  }

  const cleanButtons = (buttons || []).filter((b) => b?.text?.trim());
  if (cleanButtons.length) {
    if (cleanButtons.length > 10) throw new Error("A template can have at most 10 buttons");
    const ctaCount = cleanButtons.filter((b) => b.type === "URL" || b.type === "PHONE_NUMBER").length;
    if (ctaCount > 2) throw new Error("A template can have at most 2 call-to-action (URL/phone) buttons");

    components.push({
      type: "BUTTONS",
      buttons: cleanButtons.map((b) => {
        if (b.type === "PHONE_NUMBER") {
          return { type: "PHONE_NUMBER", text: b.text.trim(), phone_number: b.phoneNumber?.trim() };
        }
        if (b.type === "URL") {
          const button = { type: "URL", text: b.text.trim(), url: b.url?.trim() };
          // A URL button may end in one {{1}} variable — needs a filled-in example, same idea as the body.
          if (/\{\{\s*1\s*\}\}/.test(button.url || "")) {
            button.example = [button.url.replace(/\{\{\s*1\s*\}\}/, "example")];
          }
          return button;
        }
        return { type: "QUICK_REPLY", text: b.text.trim() };
      }),
    });
  }

  return components;
}

// Submit a new WhatsApp message template for Meta's review. Returns
// immediately with status "PENDING" — approval/rejection happens
// asynchronously; poll metaGetTemplates() to see the updated status.
// `headerImageHandle` comes from metaUploadTemplateImage() below.
export async function metaCreateTemplate({
  name,
  category,
  language = "en_US",
  bodyText,
  headerText,
  headerImageHandle,
  footerText,
  buttons,
  creds = null,
}) {
  const c = withCreds(creds);
  if (!metaTemplatesConfigured(c)) {
    throw new Error("Meta templates not configured — connect a WhatsApp Business Account for this workspace.");
  }
  if (!/^[a-z0-9_]+$/.test(name || "")) {
    throw new Error("Template name must be lowercase letters, numbers, and underscores only");
  }

  const components = buildTemplateComponents({ bodyText, headerText, headerImageHandle, footerText, buttons });

  const res = await fetch(metaGraphUrl(`/${c.wabaId}/message_templates`, c), {
    method: "POST",
    headers: metaAuthHeaders(c),
    body: JSON.stringify({ name, category, language, components }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(metaErrorMessage(data, res.status));
  return data; // { id, status: "PENDING", category }
}

// Edit an existing template (Meta allows editing APPROVED, REJECTED, or PAUSED
// templates; name and language are immutable). An edited APPROVED template
// goes back to PENDING review before the changes go live.
export async function metaEditTemplate({ templateId, category, bodyText, headerText, headerImageHandle, footerText, buttons, creds = null }) {
  const c = withCreds(creds);
  if (!metaTemplatesConfigured(c)) {
    throw new Error("Meta templates not configured — connect a WhatsApp Business Account for this workspace.");
  }
  if (!templateId) throw new Error("Template id is required");

  const components = buildTemplateComponents({ bodyText, headerText, headerImageHandle, footerText, buttons });
  const payload = { components };
  if (category) payload.category = category;

  const res = await fetch(metaGraphUrl(`/${templateId}`, c), {
    method: "POST",
    headers: metaAuthHeaders(c),
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(metaErrorMessage(data, res.status));
  return data; // { success: true }
}

// Upload an image for use as a template HEADER, via Meta's Resumable Upload
// API. Two steps: (1) create an upload session against the app id, (2) push
// the file bytes to that session to get back a reusable "handle".
// Docs: https://developers.facebook.com/docs/graph-api/guides/upload
export async function metaUploadTemplateImage({ buffer, mimeType, creds = null }) {
  const c = withCreds(creds);
  const appId = c.appId;
  if (!appId) throw new Error("A Meta App ID is required to upload template images");
  const token = c.accessToken || "";

  const sessionRes = await fetch(
    metaGraphUrl(`/${appId}/uploads?file_length=${buffer.length}&file_type=${encodeURIComponent(mimeType)}`, c),
    { method: "POST", headers: { Authorization: `Bearer ${token}` } }
  );
  const sessionData = await sessionRes.json().catch(() => ({}));
  if (!sessionRes.ok) throw new Error(metaErrorMessage(sessionData, sessionRes.status));
  const uploadSessionId = sessionData.id; // "upload:<id>"

  const uploadRes = await fetch(`https://graph.facebook.com/${c.apiVersion}/${uploadSessionId}`, {
    method: "POST",
    headers: {
      // This endpoint authenticates with "OAuth", not "Bearer" — Meta's
      // resumable upload API is inconsistent with the rest of the Graph API.
      Authorization: `OAuth ${token}`,
      file_offset: "0",
      "Content-Type": mimeType,
    },
    body: buffer,
  });
  const uploadData = await uploadRes.json().catch(() => ({}));
  if (!uploadRes.ok) throw new Error(metaErrorMessage(uploadData, uploadRes.status));
  return uploadData.h; // the header_handle
}

// --- Baileys (unofficial, one WhatsApp-app number via a linked device) -----
// Read-only by design: this only ever reports inbound messages/calls (see
// app/api/webhooks/baileys/[businessId]/route.js) — it never sends. Sending
// is what tends to draw WhatsApp's abuse detection to an unofficial linked
// device, so a number linked here keeps working normally in the WhatsApp app
// and replies go out from there, not through this adapter. Enforced twice:
// the connection service itself refuses POST /api/send when READ_ONLY=true,
// and these methods refuse before ever making that call at all.
const baileys = {
  name: "baileys",
  // Bound to one tenant's creds by getProvider(creds), same as meta.
  creds: null,
  async sendText() {
    throw new Error("This WhatsApp Web connection is read-only — reply from the phone's WhatsApp app instead.");
  },
  async sendTemplate() {
    return this.sendText();
  },
  async sendButtons() {
    return this.sendText();
  },
};

// --- Twilio (WhatsApp) -----------------------------------------------------
const twilio = {
  name: "twilio",
  async sendText({ from, to, body }) {
    const url = process.env.WA_API_URL;
    const sid = process.env.WA_API_KEY;
    const token = process.env.WA_API_SECRET;
    const form = new URLSearchParams({
      From: `whatsapp:${from}`,
      To: `whatsapp:${to}`,
      Body: body,
    });
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || "Twilio send failed");
    return { providerId: data.sid, status: "sent" };
  },
  async sendTemplate(args) {
    return this.sendText(args);
  },
  async sendButtons(args) {
    // Twilio buttons require pre-approved content templates; fall back to text.
    return this.sendText({ ...args, body: withButtonFallback(args) });
  },
};

// --- Gupshup ---------------------------------------------------------------
const gupshup = {
  name: "gupshup",
  async sendText({ from, to, body }) {
    const url = process.env.WA_API_URL;
    const apiKey = process.env.WA_API_KEY;
    const form = new URLSearchParams({
      channel: "whatsapp",
      source: from,
      destination: to,
      "src.name": process.env.WA_APP_NAME || "",
      message: JSON.stringify({ type: "text", text: body }),
    });
    const res = await fetch(url, {
      method: "POST",
      headers: { apikey: apiKey, "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || "Gupshup send failed");
    return { providerId: data.messageId, status: "sent" };
  },
  async sendTemplate(args) {
    return this.sendText(args);
  },
  async sendButtons(args) {
    return this.sendText({ ...args, body: withButtonFallback(args) });
  },
};

// --- 360dialog -------------------------------------------------------------
const dialog360 = {
  name: "dialog360",
  async sendText({ to, body }) {
    const url = process.env.WA_API_URL;
    const res = await fetch(url, {
      method: "POST",
      headers: { "D360-API-KEY": process.env.WA_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ to, type: "text", text: { body } }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "360dialog send failed");
    return { providerId: data?.messages?.[0]?.id, status: "sent" };
  },
  async sendTemplate(args) {
    return this.sendText(args);
  },
  async sendButtons(args) {
    return this.sendText({ ...args, body: withButtonFallback(args) });
  },
};

// For adapters without native interactive buttons, append numbered options so
// the message is still actionable ("Reply 1 / 2 / 3").
function withButtonFallback({ body, buttons = [] }) {
  if (!buttons.length) return body;
  const lines = buttons.slice(0, 3).map((b, i) => `${i + 1}. ${b}`);
  return `${body}\n\n${lines.join("\n")}\n\n(Reply with the number of your choice)`;
}

function watiReceiver(whatsappNumber, customParams = []) {
  return {
    whatsappNumber,
    contactId: whatsappNumber,
    customParams,
  };
}

function watiDirectSendDisabled(err) {
  return /direct send message functionality is not enabled/i.test(String(err?.message || err));
}

// Is WATI configured with a real endpoint + token? (the example file ships a
// "YOUR_TENANT_ID" placeholder, which we treat as unconfigured.)
export function watiConfigured(creds = null) {
  const url = watiApiUrl(creds);
  const token = watiAccessToken(creds);
  return Boolean(url && token && !url.includes("YOUR_TENANT_ID"));
}

// Fetch the business's primary contacts straight from WATI (read-only).
// Returns a normalized list independent of WA_PROVIDER, so it works even while
// messaging stays on the mock provider.
export async function watiGetContacts({ pageSize = 100, pageNumber = 1 } = {}, creds = null) {
  if (!watiConfigured(creds)) {
    throw new Error(
      "WATI not configured — set WATI_API_URL (with your tenant id) and WATI_ACCESS_TOKEN in .env.local"
    );
  }
  const base = watiApiUrl(creds);
  const url = new URL(base + "/api/v1/getContacts");
  url.searchParams.set("pageSize", pageSize);
  url.searchParams.set("pageNumber", pageNumber);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${watiToken(watiAccessToken(creds))}` },
  });
  const contentType = res.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `WATI getContacts failed (HTTP ${res.status})`);
  }
  if (!data) {
    throw new Error(
      "WATI_API_URL returned a web page instead of API JSON. Copy the API endpoint exactly from WATI → API Docs."
    );
  }

  const list = data.contact_list || data.contacts || data.result?.contact_list || [];
  return list.map((c) => ({
    id: c.id || c.wAid || c.phone,
    name: c.fullName || c.firstName || `+${c.wAid || c.phone || ""}`,
    phone: c.phone || (c.wAid ? `+${c.wAid}` : ""),
    optedIn: c.optedIn ?? null,
    source: c.source || null,
    created: c.created || c.createdDate || null,
  }));
}

// Pull one contact's WATI conversation history. WATI's V1 response wraps the
// actual rows in messages.items; normalize that provider-specific shape here
// so the CRM sync path only deals with its own message model.
export async function watiGetMessages(phone, { pageSize = 100, pageNumber = 1 } = {}, creds = null) {
  if (!watiConfigured(creds)) throw new Error("WATI not configured.");
  const target = normalizeWaNumber(phone);
  if (!target) throw new Error("A valid WhatsApp number is required.");

  const base = watiApiUrl(creds);
  const url = new URL(`${base}/api/v1/getMessages/${encodeURIComponent(target)}`);
  url.searchParams.set("pageSize", Math.min(Math.max(Number(pageSize) || 100, 1), 100));
  url.searchParams.set("pageNumber", Math.max(Number(pageNumber) || 1, 1));

  const res = await fetch(url, { headers: { Authorization: `Bearer ${watiToken(watiAccessToken(creds))}` } });
  const contentType = res.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `WATI getMessages failed (HTTP ${res.status})`);
  }
  if (!data) throw new Error("WATI getMessages returned a non-JSON response.");

  const envelope = data.messages || data;
  const items = Array.isArray(envelope) ? envelope : envelope.items || data.items || [];
  return {
    messages: items.map(normalizeWatiMessage),
    pageNumber: Number(envelope.pageNumber || pageNumber),
    pageSize: Number(envelope.pageSize || pageSize),
    total: Number(envelope.total || envelope.grandTotal || items.length),
    hasNextPage: Boolean(envelope.hasNextPage),
  };
}

function normalizeWatiMessage(message) {
  const type = String(message.type || "text").toLowerCase();
  const direction = message.owner === true ? "out" : "in";
  const buttonText =
    message.interactiveButtonReply?.text ||
    message.listReply?.title ||
    message.buttonReply?.text ||
    message.replyButtonViewModel?.text;
  const text = buttonText || stringField(message.text) || stringField(message.translationText);
  const body = text || watiMediaLabel(type, message.data);
  const providerId =
    stringField(message.whatsappMessageId) ||
    stringField(message.id) ||
    stringField(message.localMessageId) ||
    null;
  const createdAt = normalizeWatiTimestamp(message.created || message.timestamp);
  const status = String(message.statusString || (direction === "in" ? "delivered" : "sent")).toLowerCase();
  const interactive = ["button", "interactive", "list"].includes(type);

  return {
    body,
    direction,
    status,
    providerId,
    createdAt,
    kind: interactive ? (direction === "in" ? "button_reply" : "interactive_buttons") : type,
  };
}

function stringField(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function watiMediaLabel(type, data) {
  const caption = data && typeof data === "object" ? stringField(data.caption || data.fileName) : null;
  return caption || `[${type || "message"}]`;
}

function normalizeWatiTimestamp(value) {
  if (value == null || value === "") return new Date().toISOString();
  const raw = String(value);
  const numeric = Number(raw);
  const date = Number.isFinite(numeric) && /^\d+(\.\d+)?$/.test(raw)
    ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
    : new Date(raw);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

// Fetch WhatsApp message templates from WATI. Only APPROVED templates can be
// used to message contacts proactively (outside the 24h session window).
export async function watiGetTemplates({ approvedOnly = true } = {}, creds = null) {
  if (!watiConfigured(creds)) {
    throw new Error("WATI not configured.");
  }
  const base = watiApiUrl(creds);
  const url = new URL(base + "/api/v1/getMessageTemplates");
  url.searchParams.set("pageSize", 100);
  url.searchParams.set("pageNumber", 1);

  const res = await fetch(url, { headers: { Authorization: `Bearer ${watiToken(watiAccessToken(creds))}` } });
  const contentType = res.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    throw new Error(data?.message || `WATI getMessageTemplates failed (HTTP ${res.status})`);
  }
  if (!data) {
    throw new Error(
      "WATI_API_URL returned a web page instead of API JSON. Copy the API endpoint exactly from WATI → API Docs."
    );
  }

  const list =
    data.messageTemplates || data.message_templates || data.templates || [];
  const mapped = list.map((t) => {
    const lang = t.language?.value || t.language?.key || t.languageCode || t.language || "en";
    // Placeholders in the body (so the UI knows how many params to collect).
    const bodyText =
      t.body ||
      (Array.isArray(t.components)
        ? t.components.find((c) => c.type === "BODY")?.text || ""
        : "");
    const placeholderNames = Array.from(
      String(bodyText).matchAll(/\{\{\s*([^}]+?)\s*\}\}/g),
      (match) => match[1].trim()
    );
    return {
      name: t.elementName || t.name,
      status: t.status,
      language: lang,
      body: bodyText,
      placeholderNames,
      placeholders: placeholderNames.length,
    };
  });

  return approvedOnly
    ? mapped.filter((t) => String(t.status).toUpperCase() === "APPROVED")
    : mapped;
}

const ADAPTERS = { mock, wati, meta, baileys, twilio, gupshup, dialog360 };

function watiErrorMessage(data, status) {
  // `sendSessionMessage` reports failures asynchronously-shaped: the real reason
  // sits at data.message.failedDetail (data.message is the sent-message object,
  // not a string) rather than at the top level.
  const nestedDetail =
    data?.message && typeof data.message === "object" ? data.message.failedDetail : null;
  const flatMessage = typeof data?.message === "string" ? data.message : null;
  const raw = String(data?.info || nestedDetail || flatMessage || data?.error || `WATI ${status}`);
  if (/invalid conversation/i.test(raw)) {
    return (
      "WATI rejected this as an invalid conversation. Free-text and button messages only work " +
      "inside an active 24-hour WhatsApp conversation; send an approved WhatsApp template to start or reopen the chat."
    );
  }
  return raw;
}

// Resolve the messaging adapter for a tenant. Pass the tenant's creds (from
// lib/tenant.js → credsForBusiness) to send via their own WABA/token; omit it
// and the env-configured provider is used (legacy single-tenant path).
//
// The meta adapter is credential-bound, so it's cloned per call — sharing one
// mutable module-level object across tenants would leak credentials between
// concurrent requests.
export function getProvider(creds = null) {
  const name = (creds?.provider || process.env.WA_PROVIDER || "mock").toLowerCase();
  const adapter = ADAPTERS[name] || mock;
  if (adapter === meta) return { ...meta, creds };
  if (adapter === wati) return { ...wati, creds };
  if (adapter === baileys) return { ...baileys, creds };
  return adapter;
}
