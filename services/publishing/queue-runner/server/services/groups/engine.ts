// Does Group Manager's work in the real apps: create the group, add and remove
// members, send messages. The website saves each request as pending in
// AgenticThat's database; the Companion receives the group, does everything
// pending, and every result is saved and reported as it happens. Each app has
// its own queue, so people are added one at a time at a calm pace (WhatsApp
// limits accounts that add people too fast).

import {
  APP_LABELS,
  type Contact,
  GROUP_APPS,
  type Group,
  IDENTITY_LABELS,
  type GroupApp,
  type MemberAppStatus,
  type MemberState,
  contactIdentity,
} from "./model.js";
import type { GroupStore } from "./store.js";

export type ConnectionState = {
  app: GroupApp;
  state: "disconnected" | "connecting" | "qr" | "code" | "password" | "connected" | "error";
  /** The connected account, e.g. "+91 63091 23485" or "AgenticThat Bot". */
  account?: string;
  detail?: string;
  /** WhatsApp: the QR code to scan, as an image data URL. */
  qr?: string;
  /** Discord: the servers the bot is in, and the link to add it to another one. */
  guilds?: { id: string; name: string }[];
  addBotUrl?: string;
};

export type AddResult = { state: MemberState; detail?: string; link?: string };

export interface GroupAppAdapter {
  readonly app: GroupApp;
  /** Wait between two member changes in this app. */
  readonly paceMs: number;
  connection(): ConnectionState;
  createGroup(input: { name: string; description: string; guildId?: string; members?: string[] }): Promise<{ ref: Record<string, string>; link?: string }>;
  addMember(ref: Record<string, string>, identity: string, context: { groupName: string; contactName: string; link?: string }): Promise<AddResult>;
  removeMember(ref: Record<string, string>, identity: string): Promise<void>;
  sendMessage(ref: Record<string, string>, text: string): Promise<void>;
}

/** A piece of work from the website: the group as saved, and the contacts it needs. */
export type GroupJob = {
  group: Group;
  contacts: Contact[];
  action?: "sync" | "remove" | "retry";
  contactId?: string;
};

export type ActivityEntry = { at: string; app: GroupApp; group: string; text: string; ok: boolean };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => new Date().toISOString();
const REMOVING = "Removing…";

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export class GroupEngine {
  private readonly queues = new Map<GroupApp, Promise<unknown>>();
  private readonly pending = new Map<GroupApp, number>();
  private readonly inFlight = new Set<string>();
  private readonly recent: ActivityEntry[] = [];
  private activityListener: (() => void) | null = null;

  constructor(private readonly store: GroupStore, private readonly adapters: Record<GroupApp, GroupAppAdapter>, resumeAfterMs = 8000) {
    // Work that was going on when the Companion closed carries on, once the apps reconnect.
    if (resumeAfterMs >= 0) {
      setTimeout(() => {
        for (const group of this.store.groups()) this.processPending(group.id);
      }, resumeAfterMs).unref?.();
    }
  }

  /** True while any app still has work queued. */
  busy() {
    return [...this.pending.values()].some((count) => count > 0);
  }

  connections() {
    return GROUP_APPS.map((app) => this.adapters[app].connection());
  }

  /** What is happening now and lately, for the Companion's own window. */
  activity() {
    return {
      working: Object.fromEntries(GROUP_APPS.map((app) => [app, this.pending.get(app) || 0])),
      recent: this.recent.slice(0, 20),
    };
  }

  onActivity(listener: () => void) {
    this.activityListener = listener;
  }

  private note(app: GroupApp, groupId: string, text: string, ok = true) {
    const group = this.store.has(groupId) ? this.store.group(groupId).name : "";
    this.recent.unshift({ at: now(), app, group, text, ok });
    this.recent.splice(40);
    this.activityListener?.();
  }

  private enqueue(app: GroupApp, key: string, task: () => Promise<void>) {
    if (this.inFlight.has(key)) return;
    this.inFlight.add(key);
    this.pending.set(app, (this.pending.get(app) || 0) + 1);
    this.activityListener?.();
    const job = (this.queues.get(app) || Promise.resolve())
      .then(async () => {
        const state = this.adapters[app].connection().state;
        if (state !== "connected" && state !== "connecting") throw new Error(`Connect ${APP_LABELS[app]} in the Companion first.`);
        await task();
      })
      .catch((error) => this.failTask(app, key, message(error)))
      .finally(() => {
        this.inFlight.delete(key);
        this.pending.set(app, Math.max(0, (this.pending.get(app) || 1) - 1));
        this.activityListener?.();
      });
    this.queues.set(app, job);
  }

  /** A task that couldn't start (the app isn't connected): mark what it was for. */
  private failTask(app: GroupApp, key: string, detail: string) {
    const [groupId, , kind, id] = key.split("|");
    if (!this.store.has(groupId)) return;
    this.store.updateGroup(groupId, (group) => {
      if (kind === "create" && group.apps[app]?.state === "creating") group.apps[app] = { ...group.apps[app]!, state: "failed", error: detail, at: now() };
      if (kind === "member") {
        const member = group.members.find((entry) => entry.contactId === id);
        if (member?.apps[app]?.state === "pending") member.apps[app] = { state: "failed", detail, at: now() };
      }
      if (kind === "message") {
        const sent = group.messages.find((entry) => entry.id === id);
        if (sent?.results[app]?.state === "sending") sent.results[app] = { state: "failed", error: detail };
      }
    });
    this.note(app, groupId, detail, false);
  }

  private setMember(groupId: string, contactId: string, app: GroupApp, status: Omit<MemberAppStatus, "at">) {
    this.store.updateGroup(groupId, (group) => {
      const member = group.members.find((entry) => entry.contactId === contactId);
      if (member) member.apps[app] = { ...status, at: now() };
    });
  }

  // ---- The work ---------------------------------------------------------------------------

  private queueCreate(groupId: string, app: GroupApp) {
    this.enqueue(app, `${groupId}|${app}|create`, async () => {
      const group = this.store.group(groupId);
      if (group.apps[app]?.state !== "creating") return;
      try {
        // The members' numbers or IDs, for apps that won't create an empty group.
        const members = group.members
          .map((member) => this.store.contact(member.contactId))
          .map((contact) => (contact ? contactIdentity(contact, app) : ""))
          .filter(Boolean);
        const created = await this.adapters[app].createGroup({ name: group.name, description: group.description, guildId: group.discordGuildId, members });
        this.store.updateGroup(groupId, (entry) => {
          entry.apps[app] = { state: "ready", ref: created.ref, link: created.link, at: now() };
        });
        this.note(app, groupId, `Created "${group.name}"`);
      } catch (error) {
        const detail = `The ${APP_LABELS[app]} group wasn't created.`;
        this.store.updateGroup(groupId, (entry) => {
          entry.apps[app] = { state: "failed", error: message(error), at: now() };
          for (const member of entry.members) {
            if (member.apps[app]?.state === "pending" && member.apps[app]?.detail !== REMOVING) member.apps[app] = { state: "failed", detail, at: now() };
          }
        });
        this.note(app, groupId, `Couldn't create "${group.name}": ${message(error)}`, false);
      }
    });
  }

  private queueAdd(groupId: string, app: GroupApp, contactId: string) {
    this.enqueue(app, `${groupId}|${app}|member|${contactId}`, async () => {
      const group = this.store.group(groupId);
      const member = group.members.find((entry) => entry.contactId === contactId);
      if (member?.apps[app]?.state !== "pending" || member.apps[app]?.detail === REMOVING) return;
      const status = group.apps[app];
      if (status?.state !== "ready" || !status.ref) {
        this.setMember(groupId, contactId, app, { state: "failed", detail: `The ${APP_LABELS[app]} group isn't ready.` });
        return;
      }
      const contact = this.store.contact(contactId);
      if (!contact) {
        this.setMember(groupId, contactId, app, { state: "failed", detail: "This contact was deleted from Contact Master." });
        return;
      }
      const identity = contactIdentity(contact, app);
      if (!identity) {
        this.setMember(groupId, contactId, app, { state: "missing-id", detail: `No ${IDENTITY_LABELS[app]} saved for ${contact.name}.` });
        return;
      }
      try {
        const result = await this.adapters[app].addMember(status.ref, identity, { groupName: group.name, contactName: contact.name, link: status.link });
        this.setMember(groupId, contactId, app, result);
        this.note(app, groupId, `${contact.name}: ${result.state === "added" ? "added" : result.state === "invited" ? "invite sent" : result.detail || result.state}`, ["added", "invited"].includes(result.state));
      } catch (error) {
        this.setMember(groupId, contactId, app, { state: "failed", detail: message(error) });
        this.note(app, groupId, `${contact.name}: ${message(error)}`, false);
      }
      await sleep(this.adapters[app].paceMs);
    });
  }

  private queueRemove(groupId: string, app: GroupApp, contactId: string) {
    this.enqueue(app, `${groupId}|${app}|member|${contactId}`, async () => {
      const group = this.store.group(groupId);
      const member = group.members.find((entry) => entry.contactId === contactId);
      if (member?.apps[app]?.state !== "pending" || member.apps[app]?.detail !== REMOVING) return;
      const contact = this.store.contact(contactId);
      const ref = group.apps[app]?.ref;
      try {
        if (ref && contact) await this.adapters[app].removeMember(ref, contactIdentity(contact, app));
        this.setMember(groupId, contactId, app, { state: "removed" });
        this.note(app, groupId, `${contact?.name || "Member"}: removed`);
      } catch (error) {
        this.setMember(groupId, contactId, app, { state: "failed", detail: `Couldn't remove: ${message(error)}` });
        this.note(app, groupId, `${contact?.name || "Member"}: couldn't remove`, false);
      }
      await sleep(this.adapters[app].paceMs);
    });
  }

  private queueSend(groupId: string, app: GroupApp, messageId: string) {
    this.enqueue(app, `${groupId}|${app}|message|${messageId}`, async () => {
      const group = this.store.group(groupId);
      const sent = group.messages.find((entry) => entry.id === messageId);
      if (sent?.results[app]?.state !== "sending") return;
      let result: { state: "sent" | "failed"; error?: string } = { state: "sent" };
      try {
        const ref = group.apps[app]?.state === "ready" ? group.apps[app]?.ref : undefined;
        if (!ref) throw new Error(`The ${APP_LABELS[app]} group isn't ready.`);
        await this.adapters[app].sendMessage(ref, sent.text);
      } catch (error) {
        result = { state: "failed", error: message(error) };
      }
      this.store.updateGroup(groupId, (entry) => {
        const target = entry.messages.find((candidate) => candidate.id === messageId);
        if (target) target.results[app] = result;
      });
      this.note(app, groupId, result.state === "sent" ? "Message sent" : `Message not sent: ${result.error}`, result.state === "sent");
    });
  }

  /** Queues everything the group still has pending, in order: create, members, messages. */
  processPending(groupId: string) {
    if (!this.store.has(groupId)) return;
    const group = this.store.group(groupId);
    for (const app of GROUP_APPS) {
      if (!group.apps[app]) continue;
      if (group.apps[app]?.state === "creating") this.queueCreate(groupId, app);
      for (const member of group.members) {
        const status = member.apps[app];
        if (status?.state !== "pending") continue;
        if (status.detail === REMOVING) this.queueRemove(groupId, app, member.contactId);
        else this.queueAdd(groupId, app, member.contactId);
      }
      for (const sent of group.messages) if (sent.results[app]?.state === "sending") this.queueSend(groupId, app, sent.id);
    }
  }

  // ---- Jobs from the website ----------------------------------------------------------------

  /** Takes in the group and its contacts, does the asked action, then everything pending. */
  run(job: GroupJob) {
    this.store.upsertContacts(job.contacts);
    this.store.importGroup(job.group);
    if (job.action === "remove" && job.contactId) this.markRemoving(job.group.id, job.contactId);
    if (job.action === "retry") this.markRetry(job.group.id);
    this.processPending(job.group.id);
    return this.store.group(job.group.id);
  }

  private markRemoving(groupId: string, contactId: string) {
    this.store.updateGroup(groupId, (group) => {
      const member = group.members.find((entry) => entry.contactId === contactId);
      if (!member) return;
      for (const app of GROUP_APPS) {
        if (["added", "invited"].includes(member.apps[app]?.state || "") && group.apps[app]?.ref) {
          member.apps[app] = { ...member.apps[app]!, state: "pending", detail: REMOVING, at: now() };
        }
      }
    });
  }

  /** Asks again for what failed: creating the group in an app, then its members there. */
  private markRetry(groupId: string) {
    this.store.updateGroup(groupId, (group) => {
      for (const app of GROUP_APPS) {
        const status = group.apps[app];
        if (!status) continue;
        if (status.state === "failed") group.apps[app] = { state: "creating", at: now() };
        // Discord: invited people may have joined the server since, so check them again.
        const again = app === "discord" ? ["failed", "not-on-app", "missing-id", "invited"] : ["failed", "not-on-app", "missing-id"];
        for (const member of group.members) {
          const current = member.apps[app];
          if (!again.includes(current?.state || "")) continue;
          // A removal that failed is tried again as a removal, never as an add.
          const removing = current?.state === "failed" && current.detail?.startsWith("Couldn't remove");
          member.apps[app] = removing ? { state: "pending", detail: REMOVING, at: now() } : { state: "pending", at: now() };
        }
      }
    });
  }

  /** The group was deleted on the website. */
  forget(groupId: string) {
    this.store.forgetGroup(groupId);
  }
}

export type { Group };
