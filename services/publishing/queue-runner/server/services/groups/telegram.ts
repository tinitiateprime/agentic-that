// Telegram through the user's own account (Telegram's official API, the same one
// Telegram's apps use). Log in once with the phone number and code; the session
// is saved encrypted on this computer. Groups are Telegram supergroups.

import path from "node:path";
import bigInt from "big-integer";
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import type { AddResult, ConnectionState, GroupAppAdapter } from "./engine.js";
import { readSecureFile, removeSecureFile, writeSecureFile } from "./secure-file.js";

type Saved = { apiId: number; apiHash: string; session: string; account: string };
type Login = { client: TelegramClient; phone: string; phoneCodeHash: string; apiId: number; apiHash: string };

function telegramError(error: unknown) {
  const code = error && typeof error === "object" && "errorMessage" in error ? String((error as { errorMessage: unknown }).errorMessage) : "";
  return { code, message: error instanceof Error ? error.message : String(error) };
}

/** Telegram's error codes, in words. */
export function explainTelegramError(error: unknown) {
  const { code, message } = telegramError(error);
  const known: Record<string, string> = {
    PHONE_CODE_INVALID: "That code isn't right. Check the code Telegram sent and try again.",
    PHONE_CODE_EXPIRED: "That code expired. Ask for a new one.",
    PHONE_NUMBER_INVALID: "Telegram doesn't recognise that phone number. Include the country code.",
    PASSWORD_HASH_INVALID: "That two-step verification password isn't right.",
    API_ID_INVALID: "The Telegram app ID or hash isn't valid. Check them on my.telegram.org.",
    PEER_FLOOD: "Telegram has paused adding people from this account for a while (too many adds). Try again later.",
    FLOOD_WAIT: "Telegram asks to wait before doing this again. Try again in a few minutes.",
    USER_CHANNELS_TOO_MUCH: "This person is in too many groups to join another.",
    USER_KICKED: "This person was removed from the group before, so Telegram won't add them back automatically.",
    CHAT_ADMIN_REQUIRED: "Your account needs to be an admin of this group.",
    USER_BANNED_IN_CHANNEL: "Your account is limited by Telegram and can't add people right now.",
  };
  const match = Object.keys(known).find((key) => code.startsWith(key) || message.includes(key));
  return match ? known[match] : message;
}

export class TelegramAdapter implements GroupAppAdapter {
  readonly app = "telegram" as const;
  readonly paceMs = 4000;
  private readonly file: string;
  private saved: Saved | null;
  private client: TelegramClient | null = null;
  private login: Login | null = null;
  private state: ConnectionState["state"];
  private detail = "";

  constructor(directory: string) {
    this.file = path.join(directory, "telegram.json");
    this.saved = readSecureFile<Saved | null>(this.file, null);
    this.state = this.saved ? "connected" : "disconnected";
  }

  connection(): ConnectionState {
    return {
      app: "telegram",
      state: this.state,
      account: this.saved?.account,
      detail: this.detail || undefined,
    };
  }

  private async connected() {
    if (!this.saved) throw new Error("Connect Telegram first.");
    if (!this.client) {
      this.client = new TelegramClient(new StringSession(this.saved.session), this.saved.apiId, this.saved.apiHash, { connectionRetries: 5 });
      this.client.setLogLevel("none" as never);
    }
    if (!this.client.connected) await this.client.connect();
    return this.client;
  }

  // ---- Login --------------------------------------------------------------------------

  async startLogin(input: { phone: string; apiId: number; apiHash: string }) {
    await this.login?.client.disconnect().catch(() => undefined);
    const client = new TelegramClient(new StringSession(""), input.apiId, input.apiHash, { connectionRetries: 5 });
    client.setLogLevel("none" as never);
    try {
      await client.connect();
      const sent = await client.sendCode({ apiId: input.apiId, apiHash: input.apiHash }, input.phone);
      this.login = { client, phone: input.phone, phoneCodeHash: sent.phoneCodeHash, apiId: input.apiId, apiHash: input.apiHash };
      this.state = "code";
      this.detail = sent.isCodeViaApp ? "Telegram sent a code to your Telegram app." : "Telegram sent a code by SMS.";
      return this.connection();
    } catch (error) {
      await client.disconnect().catch(() => undefined);
      throw new Error(explainTelegramError(error));
    }
  }

  async submitCode(code: string) {
    const login = this.login;
    if (!login) throw new Error("Start again: enter your phone number first.");
    try {
      await login.client.invoke(new Api.auth.SignIn({ phoneNumber: login.phone, phoneCodeHash: login.phoneCodeHash, phoneCode: code.trim() }));
    } catch (error) {
      if (telegramError(error).code === "SESSION_PASSWORD_NEEDED") {
        this.state = "password";
        this.detail = "Your account has two-step verification. Enter its password.";
        return this.connection();
      }
      throw new Error(explainTelegramError(error));
    }
    return this.finishLogin();
  }

  async submitPassword(password: string) {
    const login = this.login;
    if (!login) throw new Error("Start again: enter your phone number first.");
    try {
      await login.client.signInWithPassword({ apiId: login.apiId, apiHash: login.apiHash }, {
        password: async () => password,
        onError: async (error) => { throw error; },
      });
    } catch (error) {
      throw new Error(explainTelegramError(error));
    }
    return this.finishLogin();
  }

  private async finishLogin() {
    const login = this.login!;
    const me = await login.client.getMe();
    const name = [me.firstName, me.lastName].filter(Boolean).join(" ").trim() || me.username || "Telegram";
    this.saved = {
      apiId: login.apiId,
      apiHash: login.apiHash,
      session: login.client.session.save() as unknown as string,
      account: me.phone ? `${name} · +${me.phone}` : name,
    };
    writeSecureFile(this.file, this.saved);
    await this.client?.disconnect().catch(() => undefined);
    this.client = login.client;
    this.login = null;
    this.state = "connected";
    this.detail = "";
    return this.connection();
  }

  async disconnect() {
    try {
      const client = await this.connected();
      await client.invoke(new Api.auth.LogOut());
    } catch {
      // Already logged out on Telegram's side.
    }
    await this.client?.disconnect().catch(() => undefined);
    await this.login?.client.disconnect().catch(() => undefined);
    this.client = null;
    this.login = null;
    this.saved = null;
    removeSecureFile(this.file);
    this.state = "disconnected";
    this.detail = "";
    return this.connection();
  }

  // ---- Groups -------------------------------------------------------------------------

  private channel(ref: Record<string, string>) {
    return new Api.InputPeerChannel({ channelId: bigInt(ref.channelId), accessHash: bigInt(ref.accessHash) });
  }

  /** The Telegram user for a phone number or @username, or null when they aren't on Telegram. */
  private async user(identity: string, name: string) {
    const client = await this.connected();
    if (identity.startsWith("@")) {
      try {
        return await client.getEntity(identity);
      } catch {
        return null;
      }
    }
    const [firstName, ...rest] = name.split(" ");
    const imported = await client.invoke(new Api.contacts.ImportContacts({
      contacts: [new Api.InputPhoneContact({ clientId: bigInt(Date.now()), phone: identity, firstName: firstName || name, lastName: rest.join(" ") })],
    }));
    return imported.users[0] || null;
  }

  async createGroup(input: { name: string; description: string }) {
    const client = await this.connected();
    try {
      const updates = await client.invoke(new Api.channels.CreateChannel({ title: input.name, about: input.description, megagroup: true }));
      const chats = "chats" in updates ? updates.chats : [];
      const channel = chats.find((chat): chat is Api.Channel => chat instanceof Api.Channel);
      if (!channel?.accessHash) throw new Error("Telegram didn't return the new group.");
      const ref = { channelId: channel.id.toString(), accessHash: channel.accessHash.toString() };
      const invite = await client.invoke(new Api.messages.ExportChatInvite({ peer: this.channel(ref) })).catch(() => null);
      return { ref, link: invite && "link" in invite ? invite.link : undefined };
    } catch (error) {
      throw new Error(explainTelegramError(error));
    }
  }

  async addMember(ref: Record<string, string>, identity: string, context: { groupName: string; contactName: string; link?: string }): Promise<AddResult> {
    const client = await this.connected();
    const user = await this.user(identity, context.contactName);
    if (!user) return { state: "not-on-app", detail: `${identity} isn't on Telegram.` };
    try {
      const result = await client.invoke(new Api.channels.InviteToChannel({ channel: this.channel(ref), users: [user] }));
      const missing = "missingInvitees" in result ? result.missingInvitees : [];
      if (!missing.length) return { state: "added" };
    } catch (error) {
      const { code } = telegramError(error);
      if (code === "USER_ALREADY_PARTICIPANT") return { state: "added" };
      if (!["USER_PRIVACY_RESTRICTED", "USER_NOT_MUTUAL_CONTACT"].includes(code)) {
        return { state: "failed", detail: explainTelegramError(error) };
      }
    }
    // Their privacy settings don't allow being added: send them the invite link.
    const link = context.link;
    if (!link) return { state: "failed", detail: "Their privacy settings don't allow being added, and the group has no invite link." };
    try {
      await client.sendMessage(user, { message: `Hi ${context.contactName}! You're invited to join "${context.groupName}" on Telegram: ${link}` });
      return { state: "invited", detail: "Their privacy settings don't allow being added, so they were sent the invite link.", link };
    } catch {
      return { state: "invited", detail: "Their privacy settings don't allow being added or messaged. Share this invite link with them.", link };
    }
  }

  async removeMember(ref: Record<string, string>, identity: string) {
    const client = await this.connected();
    const user = await this.user(identity, "Contact");
    if (!user) return;
    const channel = this.channel(ref);
    try {
      // Remove, then lift the ban so they can be added again later.
      await client.invoke(new Api.channels.EditBanned({ channel, participant: user, bannedRights: new Api.ChatBannedRights({ untilDate: 0, viewMessages: true }) }));
      await client.invoke(new Api.channels.EditBanned({ channel, participant: user, bannedRights: new Api.ChatBannedRights({ untilDate: 0 }) }));
    } catch (error) {
      if (telegramError(error).code === "USER_NOT_PARTICIPANT") return;
      throw new Error(explainTelegramError(error));
    }
  }

  async sendMessage(ref: Record<string, string>, text: string) {
    const client = await this.connected();
    try {
      await client.sendMessage(this.channel(ref), { message: text });
    } catch (error) {
      throw new Error(explainTelegramError(error));
    }
  }
}
