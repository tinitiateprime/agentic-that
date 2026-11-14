// Discord through the user's own bot (Discord's official API). A group is a
// private channel in one of the user's servers: members already in the server
// are added to the channel directly; anyone else gets an invite link (Discord
// lets no one add a person to a server).

import path from "node:path";
import type { AddResult, ConnectionState, GroupAppAdapter } from "./engine.js";
import { discordChannelName, isDiscordUserId } from "./model.js";
import { readSecureFile, removeSecureFile, writeSecureFile } from "./secure-file.js";

const API = "https://discord.com/api/v10";

// Permission bits (https://discord.com/developers/docs/topics/permissions).
const CREATE_INVITE = 1n;
const MANAGE_CHANNELS = 16n;
const VIEW_CHANNEL = 1024n;
const SEND_MESSAGES = 2048n;
const READ_HISTORY = 65536n;
const MANAGE_ROLES = 268435456n;
const MEMBER_ACCESS = VIEW_CHANNEL | SEND_MESSAGES | READ_HISTORY;
/** What the bot needs in a server, asked for when it is added. */
export const BOT_PERMISSIONS = (CREATE_INVITE | MANAGE_CHANNELS | VIEW_CHANNEL | SEND_MESSAGES | READ_HISTORY | MANAGE_ROLES).toString();
const MESSAGE_LIMIT = 2000;

type Saved = { token: string; botId: string; botName: string; applicationId: string };
type Guild = { id: string; name: string };

export class DiscordError extends Error {
  constructor(message: string, readonly status: number, readonly code?: number) {
    super(message);
  }
}

/** Splits long text into Discord-sized messages, at line breaks where possible. */
export function splitDiscordMessage(text: string) {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > MESSAGE_LIMIT) {
    let at = rest.lastIndexOf("\n", MESSAGE_LIMIT);
    if (at < MESSAGE_LIMIT * 0.5) at = rest.lastIndexOf(" ", MESSAGE_LIMIT);
    if (at < 1) at = MESSAGE_LIMIT;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export class DiscordAdapter implements GroupAppAdapter {
  readonly app = "discord" as const;
  readonly paceMs = 1200;
  private readonly file: string;
  private saved: Saved | null;
  private guilds: Guild[] = [];
  private detail = "";

  constructor(directory: string, private readonly fetcher: typeof fetch = fetch) {
    this.file = path.join(directory, "discord.json");
    this.saved = readSecureFile<Saved | null>(this.file, null);
    if (this.saved) void this.refreshGuilds().catch(() => undefined);
  }

  connection(): ConnectionState {
    return {
      app: "discord",
      state: this.saved ? "connected" : "disconnected",
      account: this.saved?.botName,
      detail: this.detail || undefined,
      guilds: this.saved ? this.guilds : undefined,
      addBotUrl: this.saved ? `https://discord.com/oauth2/authorize?client_id=${this.saved.applicationId}&scope=bot&permissions=${BOT_PERMISSIONS}` : undefined,
    };
  }

  private async call<T>(method: string, route: string, body?: unknown, token = this.saved?.token): Promise<T> {
    if (!token) throw new Error("Connect Discord first.");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await this.fetcher(`${API}${route}`, {
        method,
        headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json", "User-Agent": "AgenticThatCompanion (https://agenticthat.com, 1)" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.status === 429) {
        const wait = Number((await response.json().catch(() => ({})) as { retry_after?: number }).retry_after || 1);
        await new Promise((resolve) => setTimeout(resolve, Math.min(10, wait) * 1000 + 250));
        continue;
      }
      if (response.status === 204) return undefined as T;
      const data = await response.json().catch(() => ({})) as { message?: string; code?: number };
      if (!response.ok) {
        const reason = response.status === 401 ? "The Discord bot token isn't valid (it may have been reset)." :
          response.status === 403 ? "The bot doesn't have permission for this. Add it to the server again with the link on this page." :
          data.message || `Discord answered ${response.status}.`;
        throw new DiscordError(reason, response.status, data.code);
      }
      return data as T;
    }
    throw new DiscordError("Discord is rate-limiting the bot. Try again in a minute.", 429);
  }

  // ---- Connection ---------------------------------------------------------------------

  async connect(token: string) {
    const clean = token.trim().replace(/^Bot\s+/i, "");
    const me = await this.call<{ id: string; username: string }>("GET", "/users/@me", undefined, clean);
    const application = await this.call<{ id: string }>("GET", "/oauth2/applications/@me", undefined, clean);
    this.saved = { token: clean, botId: me.id, botName: me.username, applicationId: application.id };
    writeSecureFile(this.file, this.saved);
    await this.refreshGuilds();
    return this.connection();
  }

  async refreshGuilds() {
    const guilds = await this.call<Guild[]>("GET", "/users/@me/guilds");
    this.guilds = guilds.map(({ id, name }) => ({ id, name }));
    this.detail = this.guilds.length ? "" : "Add the bot to your Discord server with the link below.";
    return this.connection();
  }

  async disconnect() {
    this.saved = null;
    this.guilds = [];
    this.detail = "";
    removeSecureFile(this.file);
    return this.connection();
  }

  // ---- Groups -------------------------------------------------------------------------

  async createGroup(input: { name: string; description: string; guildId?: string }) {
    if (!input.guildId) throw new Error("Choose the Discord server for this group.");
    const saved = this.saved;
    if (!saved) throw new Error("Connect Discord first.");
    const channel = await this.call<{ id: string }>("POST", `/guilds/${input.guildId}/channels`, {
      name: discordChannelName(input.name),
      type: 0,
      topic: input.description || input.name,
      // Private: only the bot and the members added to the group can see it.
      permission_overwrites: [
        { id: input.guildId, type: 0, deny: VIEW_CHANNEL.toString(), allow: "0" },
        { id: saved.botId, type: 1, allow: (MEMBER_ACCESS | CREATE_INVITE | MANAGE_ROLES).toString(), deny: "0" },
      ],
    });
    const invite = await this.call<{ code: string }>("POST", `/channels/${channel.id}/invites`, { max_age: 0, max_uses: 0, unique: false }).catch(() => null);
    return { ref: { guildId: input.guildId, channelId: channel.id }, link: invite ? `https://discord.gg/${invite.code}` : undefined };
  }

  /** The member's user ID: as saved, or found by username in the server. */
  private async userId(guildId: string, identity: string) {
    if (isDiscordUserId(identity)) return identity;
    const found = await this.call<{ user: { id: string; username: string } }[]>("GET", `/guilds/${guildId}/members/search?query=${encodeURIComponent(identity)}&limit=5`).catch(() => []);
    return found.find((member) => member.user.username.toLowerCase() === identity.toLowerCase())?.user.id || null;
  }

  private async inServer(guildId: string, userId: string) {
    try {
      await this.call("GET", `/guilds/${guildId}/members/${userId}`);
      return true;
    } catch (error) {
      if (error instanceof DiscordError && error.status === 404) return false;
      throw error;
    }
  }

  async addMember(ref: Record<string, string>, identity: string, context: { groupName: string; contactName: string; link?: string }): Promise<AddResult> {
    const userId = await this.userId(ref.guildId, identity);
    if (userId) {
      // Let them see the channel (works once they are in the server).
      const allowed = await this.call("PUT", `/channels/${ref.channelId}/permissions/${userId}`, { type: 1, allow: MEMBER_ACCESS.toString(), deny: "0" })
        .then(() => true).catch(() => false);
      if (allowed && await this.inServer(ref.guildId, userId)) return { state: "added" };
    }
    const link = context.link;
    if (!link) return { state: "failed", detail: "They aren't in the Discord server, and the group has no invite link." };
    const note = userId ? "" : " Save their Discord user ID in Contact Master so they're added to the channel when they join.";
    if (userId) {
      // Bots can only message people who share a server with them.
      const sent = await this.call<{ id: string }>("POST", "/users/@me/channels", { recipient_id: userId })
        .then((dm) => this.call("POST", `/channels/${dm.id}/messages`, { content: `Hi ${context.contactName}! You're invited to join "${context.groupName}" on Discord: ${link}` }))
        .then(() => true).catch(() => false);
      if (sent) return { state: "invited", detail: "They aren't in the server yet, so they were sent the invite link.", link };
    }
    return { state: "invited", detail: `They aren't in the server yet. Share this invite link with them.${note}`, link };
  }

  async removeMember(ref: Record<string, string>, identity: string) {
    const userId = await this.userId(ref.guildId, identity);
    if (!userId) throw new Error("Save their Discord user ID in Contact Master to remove them.");
    await this.call("DELETE", `/channels/${ref.channelId}/permissions/${userId}`).catch((error) => {
      if (!(error instanceof DiscordError && error.status === 404)) throw error;
    });
  }

  async sendMessage(ref: Record<string, string>, text: string) {
    for (const content of splitDiscordMessage(text)) {
      await this.call("POST", `/channels/${ref.channelId}/messages`, { content, allowed_mentions: { parse: [] } });
    }
  }
}
