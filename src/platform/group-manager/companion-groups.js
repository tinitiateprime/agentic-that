// Browser clients for Group Manager:
//  - website: contacts and groups, saved in AgenticThat's database (Hetzner).
//  - companion: the app connections and the work, done by the AgenticThat
//    Companion on 127.0.0.1 with the user's own WhatsApp, Telegram and Discord.

const COMPANION = "http://127.0.0.1:8792/api/group-manager";

export class GroupManagerError extends Error {
  constructor(message, status, details = {}) {
    super(message);
    this.status = status;
    Object.assign(this, details);
  }
}

// ---- AgenticThat (database) ------------------------------------------------------------

async function site(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(`/api/group-manager/${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new GroupManagerError("Couldn't reach AgenticThat. Check your internet connection.", 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new GroupManagerError(data.error || `AgenticThat returned ${response.status}.`, response.status);
  return data;
}

export const website = {
  state: () => site("state"),
  addContact: (contact) => site("contacts", { method: "POST", body: contact }),
  updateContact: (id, contact) => site(`contacts/${id}`, { method: "PUT", body: contact }),
  deleteContact: (id) => site(`contacts/${id}`, { method: "DELETE" }),
  createGroup: (group) => site("groups", { method: "POST", body: group }),
  deleteGroup: (id) => site(`groups/${id}`, { method: "DELETE" }),
  addMembers: (id, contactIds) => site(`groups/${id}/members`, { method: "POST", body: { contactIds } }),
  removeMember: (id, contactId) => site(`groups/${id}/members/${contactId}`, { method: "DELETE" }),
  sendMessage: (id, text) => site(`groups/${id}/messages`, { method: "POST", body: { text } }),
  /** Copies results the Companion has (when it couldn't report them itself). */
  sync: (groups) => site("sync", { method: "POST", body: { groups } }),
};

// ---- The Companion -----------------------------------------------------------------------

let cached = null;

/** A short-lived token from AgenticThat (and the shared Telegram app identity). */
async function session() {
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached;
  const data = await site("companion-token", { method: "POST" }).catch((error) => {
    throw new GroupManagerError(error.message || "Sign in again to manage your groups.", error.status);
  });
  if (!data.token) throw new GroupManagerError("Sign in again to manage your groups.", 401);
  cached = { token: data.token, telegramApp: data.telegramApp || null, expiresAt: Date.now() + (data.expiresInSeconds || 300) * 1000 };
  return cached;
}

async function call(path, { method = "GET", body, timeoutMs = 20_000 } = {}) {
  const { token } = await session();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${COMPANION}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = response.status === 404
        ? "Update the AgenticThat Companion to use Group Manager."
        : data.message || `The Companion returned ${response.status}.`;
      throw new GroupManagerError(message, response.status, { needsApp: data.needsApp === true });
    }
    return data;
  } catch (error) {
    if (error instanceof GroupManagerError) throw error;
    if (error?.name === "AbortError") throw new GroupManagerError("The Companion took too long to answer. Try again.", 0);
    throw new GroupManagerError("The AgenticThat Companion isn't running on this computer.", 0, { offline: true });
  } finally {
    clearTimeout(timer);
  }
}

/** Is the Companion running, and does it have Group Manager? */
export async function companionGroupsStatus() {
  try {
    const response = await fetch(`${COMPANION}/status`, { cache: "no-store", signal: AbortSignal.timeout(2500) });
    // Any answer means the Companion is running. Versions before Group Manager
    // answer 404 or 401 ("Sign in to continue") for this address.
    const data = await response.json().catch(() => ({}));
    const supported = response.ok && data.ok === true && Array.isArray(data.connections);
    return { running: true, supported };
  } catch {
    return { running: false, supported: false };
  }
}

export const companion = {
  /** The app connections, and the Companion's latest results for each group. */
  state: () => call("/state"),
  /** Work for one group: the group as saved, the contacts it needs, and an action. */
  run: (group, contacts, action = "sync", contactId) => call("/jobs", { method: "POST", body: { group, contacts, action, ...(contactId ? { contactId } : {}) } }),
  forget: (groupId) => call(`/groups/${groupId}`, { method: "DELETE" }),
  linkWhatsApp: () => call("/connect/whatsapp", { method: "POST", timeoutMs: 30_000 }),
  /** Only the phone number: AgenticThat's own Telegram app identity is used for everyone. */
  async startTelegram(phone) {
    const app = (await session()).telegramApp;
    return call("/connect/telegram", { method: "POST", body: { phone, ...(app || {}) }, timeoutMs: 45_000 });
  },
  telegramCode: (code) => call("/connect/telegram/code", { method: "POST", body: { code }, timeoutMs: 45_000 }),
  telegramPassword: (password) => call("/connect/telegram/password", { method: "POST", body: { password }, timeoutMs: 45_000 }),
  connectDiscord: (token) => call("/connect/discord", { method: "POST", body: { token }, timeoutMs: 30_000 }),
  refreshDiscord: () => call("/connect/discord/refresh", { method: "POST" }),
  disconnect: (app) => call(`/disconnect/${app}`, { method: "POST", timeoutMs: 30_000 }),
};
