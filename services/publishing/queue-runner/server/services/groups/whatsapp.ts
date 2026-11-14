// WhatsApp through the user's own number, linked like WhatsApp Web: scan a QR
// code once in WhatsApp → Linked devices. It runs as a direct connection (the
// Baileys library), with no browser window. The link keys are saved encrypted
// on this computer.

import path from "node:path";
import makeWASocket, {
  type AuthenticationCreds,
  type AuthenticationState,
  Browsers,
  DisconnectReason,
  type SignalDataTypeMap,
  type WASocket,
  initAuthCreds,
  makeCacheableSignalKeyStore,
  proto,
} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import type { AddResult, ConnectionState, GroupAppAdapter } from "./engine.js";
import { readSecureFile, removeSecureFile, writeSecureFile } from "./secure-file.js";

type SavedAuth = { creds: AuthenticationCreds; keys: Record<string, Record<string, unknown>> };

const logger = pino({ level: "silent" });

/** "+91 63091 23485" → "916309123485@s.whatsapp.net". */
export function whatsappJid(phone: string) {
  return `${phone.replace(/\D/g, "")}@s.whatsapp.net`;
}

/** WhatsApp's answer for one person when adding them to a group. */
export function explainAddStatus(status: string) {
  switch (status) {
    case "200": return { state: "added" as const };
    case "409": return { state: "added" as const, detail: "Already in the group." };
    case "403": return { state: "invite" as const, detail: "Their privacy settings don't allow being added." };
    case "408": return { state: "invite" as const, detail: "They left this group recently, so WhatsApp won't add them back right away." };
    case "401": return { state: "failed" as const, detail: "They have blocked this number." };
    default: return { state: "failed" as const, detail: `WhatsApp didn't add them (code ${status}).` };
  }
}

/** The link keys, kept in one encrypted file and saved shortly after each change. */
function encryptedAuthState(file: string) {
  const saved = readSecureFile<SavedAuth | null>(file, null);
  const data: SavedAuth = saved || { creds: initAuthCreds(), keys: {} };
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      writeSecureFile(file, data);
    }, 500);
  };
  const state: AuthenticationState = {
    creds: data.creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const bucket = data.keys[type] || {};
        const result: { [id: string]: SignalDataTypeMap[T] } = {};
        for (const id of ids) {
          let value = bucket[id];
          if (value && type === "app-state-sync-key") value = proto.Message.AppStateSyncKeyData.fromObject(value as object);
          if (value) result[id] = value as SignalDataTypeMap[T];
        }
        return result;
      },
      set: async (changes) => {
        for (const [type, entries] of Object.entries(changes)) {
          const bucket = (data.keys[type] ||= {});
          for (const [id, value] of Object.entries(entries || {})) {
            if (value) bucket[id] = value;
            else delete bucket[id];
          }
        }
        save();
      },
    },
  };
  return {
    state,
    save,
    flush: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      writeSecureFile(file, data);
    },
    linked: () => Boolean(data.creds.registered || data.creds.me),
  };
}

export class WhatsAppAdapter implements GroupAppAdapter {
  readonly app = "whatsapp" as const;
  // WhatsApp limits numbers that add many people quickly: one person every few seconds.
  readonly paceMs = 6000;
  private readonly file: string;
  private socket: WASocket | null = null;
  private state: ConnectionState["state"] = "disconnected";
  private detail = "";
  private qr = "";
  private account = "";
  private stopping = false;
  private auth: ReturnType<typeof encryptedAuthState> | null = null;

  constructor(directory: string) {
    this.file = path.join(directory, "whatsapp.json");
    const auth = encryptedAuthState(this.file);
    // Linked before: reconnect in the background.
    if (auth.linked()) {
      this.auth = auth;
      this.account = auth.state.creds.me?.name || this.phoneOf(auth.state.creds.me?.id);
      void this.start();
    }
  }

  private phoneOf(jid?: string) {
    const digits = jid?.split("@")[0]?.split(":")[0] || "";
    return digits ? `+${digits}` : "";
  }

  connection(): ConnectionState {
    return {
      app: "whatsapp",
      state: this.state,
      account: this.account || undefined,
      detail: this.detail || undefined,
      qr: this.state === "qr" ? this.qr : undefined,
    };
  }

  /** Starts linking (shows a QR code) or reconnects a linked number. */
  async start() {
    if (this.socket && this.state !== "error" && this.state !== "disconnected") return this.connection();
    this.stopping = false;
    this.auth ||= encryptedAuthState(this.file);
    const auth = this.auth;
    this.state = "connecting";
    this.detail = "";
    const socket = makeWASocket({
      auth: { creds: auth.state.creds, keys: makeCacheableSignalKeyStore(auth.state.keys, logger) },
      logger,
      browser: Browsers.windows("AgenticThat Companion"),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    this.socket = socket;
    socket.ev.on("creds.update", auth.save);
    socket.ev.on("connection.update", (update) => {
      if (this.socket !== socket) return;
      if (update.qr) {
        this.state = "qr";
        this.detail = "On your phone: WhatsApp → Settings → Linked devices → Link a device, then scan this code.";
        void QRCode.toDataURL(update.qr, { margin: 1, width: 300 }).then((url) => { this.qr = url; });
      }
      if (update.connection === "open") {
        auth.flush();
        this.state = "connected";
        this.detail = "";
        this.qr = "";
        this.account = [socket.user?.name, this.phoneOf(socket.user?.id)].filter(Boolean).join(" · ");
      }
      if (update.connection === "close") {
        const code = (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
        this.socket = null;
        if (this.stopping) return;
        if (code === DisconnectReason.loggedOut) {
          this.forget("This computer was unlinked from WhatsApp. Link it again to continue.");
          return;
        }
        if (code === DisconnectReason.connectionReplaced) {
          this.state = "error";
          this.detail = "WhatsApp was opened with this link somewhere else. Reconnect to use it here.";
          return;
        }
        if (!auth.linked()) {
          // The QR code expired without being scanned.
          this.state = "disconnected";
          this.detail = "The QR code expired. Click Link WhatsApp to get a new one.";
          this.qr = "";
          return;
        }
        // A dropped connection or a restart WhatsApp asked for: reconnect.
        this.state = "connecting";
        setTimeout(() => void this.start(), code === DisconnectReason.restartRequired ? 500 : 5000);
      }
    });
    return this.connection();
  }

  private forget(detail = "") {
    this.auth = null;
    removeSecureFile(this.file);
    this.socket = null;
    this.state = "disconnected";
    this.detail = detail;
    this.qr = "";
    this.account = "";
  }

  async disconnect() {
    this.stopping = true;
    try {
      await this.socket?.logout();
    } catch {
      this.socket?.end(undefined);
    }
    this.forget();
    return this.connection();
  }

  /** The open connection, waiting briefly while it reconnects. */
  private async open() {
    for (let waited = 0; waited < 20_000; waited += 500) {
      if (this.socket && this.state === "connected") return this.socket;
      if (this.state === "disconnected" || this.state === "qr") break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("WhatsApp isn't connected right now. Check the WhatsApp connection on this page.");
  }

  /** The person's WhatsApp ID, or null when the number isn't on WhatsApp. */
  private async person(phone: string) {
    const socket = await this.open();
    const [hit] = (await socket.onWhatsApp(phone.replace(/\D/g, ""))) || [];
    return hit?.exists ? hit.jid : null;
  }

  async createGroup(input: { name: string; description: string; members?: string[] }) {
    const socket = await this.open();
    let metadata;
    try {
      metadata = await socket.groupCreate(input.name, []);
    } catch (error) {
      // WhatsApp may want at least one other person in a new group.
      const first = await this.firstReachable(input.members || []);
      if (!first) throw new Error(`WhatsApp didn't create the group: ${error instanceof Error ? error.message : error}`);
      metadata = await socket.groupCreate(input.name, [first]);
    }
    if (input.description) await socket.groupUpdateDescription(metadata.id, input.description).catch(() => undefined);
    const code = await socket.groupInviteCode(metadata.id).catch(() => undefined);
    return { ref: { jid: metadata.id }, link: code ? `https://chat.whatsapp.com/${code}` : undefined };
  }

  private async firstReachable(phones: string[]) {
    for (const phone of phones.slice(0, 5)) {
      const jid = await this.person(phone).catch(() => null);
      if (jid) return jid;
    }
    return null;
  }

  async addMember(ref: Record<string, string>, identity: string, context: { groupName: string; contactName: string; link?: string }): Promise<AddResult> {
    const socket = await this.open();
    const jid = await this.person(identity);
    if (!jid) return { state: "not-on-app", detail: `${identity} isn't on WhatsApp.` };
    const [result] = await socket.groupParticipantsUpdate(ref.jid, [jid], "add");
    const outcome = explainAddStatus(String(result?.status || ""));
    if (outcome.state !== "invite") return outcome;
    // Not allowed to add them: send the invite link instead.
    const link = context.link || (await socket.groupInviteCode(ref.jid).then((code) => code && `https://chat.whatsapp.com/${code}`).catch(() => undefined));
    if (!link) return { state: "failed", detail: `${outcome.detail} The group has no invite link to send.` };
    try {
      await socket.sendMessage(jid, { text: `Hi ${context.contactName}! You're invited to join "${context.groupName}" on WhatsApp: ${link}` });
      return { state: "invited", detail: `${outcome.detail} They were sent the invite link.`, link };
    } catch {
      return { state: "invited", detail: `${outcome.detail} Share this invite link with them.`, link };
    }
  }

  async removeMember(ref: Record<string, string>, identity: string) {
    const socket = await this.open();
    const jid = await this.person(identity);
    if (!jid) return;
    const [result] = await socket.groupParticipantsUpdate(ref.jid, [jid], "remove");
    const status = String(result?.status || "");
    // 404: they weren't in the group (they hadn't joined from the invite yet, or left).
    if (status && status !== "200" && status !== "404") throw new Error(`WhatsApp didn't remove them (code ${status}).`);
  }

  async sendMessage(ref: Record<string, string>, text: string) {
    const socket = await this.open();
    await socket.sendMessage(ref.jid, { text });
  }
}
