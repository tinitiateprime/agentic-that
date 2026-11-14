// The Companion's working copy of the groups it is doing work for. AgenticThat's
// database is the source of truth: each job brings the group and the contacts
// it needs, and every result is reported back. The copy is saved encrypted, so
// work survives a restart.

import path from "node:path";
import { publishingBrowserDataDirectory } from "../../runtime-paths.js";
import { type Contact, GROUP_APPS, type Group, type GroupData, MAX_MESSAGES_KEPT } from "./model.js";
import { readSecureFile, writeSecureFile } from "./secure-file.js";

export function groupsDirectory() {
  return process.env.AGENTICTHAT_GROUPS_DIR?.trim() || path.join(publishingBrowserDataDirectory(), "groups");
}

/** States that ask for work, set on the website. */
const REQUESTS = new Set(["creating", "pending", "sending"]);
const time = (value?: string) => Date.parse(value || "") || 0;

export class GroupStore {
  private data: GroupData;
  private readonly file: string;
  private listeners: ((group: Group) => void)[] = [];

  constructor(directory = groupsDirectory()) {
    this.file = path.join(directory, "groups.json");
    this.data = readSecureFile<GroupData>(this.file, { version: 1, contacts: [], groups: [] });
  }

  private save() {
    writeSecureFile(this.file, this.data);
  }

  /** Called with the group after every change (to report it to AgenticThat). */
  onChange(listener: (group: Group) => void) {
    this.listeners.push(listener);
  }

  // ---- Contacts (copies of the database's) ---------------------------------------------

  contact(id: string) {
    return this.data.contacts.find((contact) => contact.id === id);
  }

  upsertContacts(contacts: Contact[]) {
    for (const contact of contacts) {
      const index = this.data.contacts.findIndex((entry) => entry.id === contact.id);
      if (index >= 0) this.data.contacts[index] = contact;
      else this.data.contacts.push(contact);
    }
    this.save();
  }

  // ---- Groups -----------------------------------------------------------------------------

  groups() {
    return [...this.data.groups].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  has(id: string) {
    return this.data.groups.some((entry) => entry.id === id);
  }

  group(id: string) {
    const group = this.data.groups.find((entry) => entry.id === id);
    if (!group) throw Object.assign(new Error("That group isn't known to this Companion yet."), { status: 404 });
    return group;
  }

  /**
   * Takes in the database's copy of a group. What this Companion already knows
   * is kept (its results are newer), except new requests from the website: new
   * apps, members and messages, and asking again after a failure or removal.
   */
  importGroup(snapshot: Group) {
    const existing = this.data.groups.find((entry) => entry.id === snapshot.id);
    if (!existing) {
      this.data.groups.push(structuredClone(snapshot));
      this.save();
      return;
    }
    existing.name = snapshot.name;
    existing.description = snapshot.description;
    existing.discordGuildId = snapshot.discordGuildId;
    for (const app of GROUP_APPS) {
      const incoming = snapshot.apps[app];
      const known = existing.apps[app];
      if (incoming && (!known || (REQUESTS.has(incoming.state) && !REQUESTS.has(known.state) && time(incoming.at) > time(known.at)))) {
        existing.apps[app] = incoming;
      }
    }
    for (const member of snapshot.members) {
      const known = existing.members.find((entry) => entry.contactId === member.contactId);
      if (!known) {
        existing.members.push(structuredClone(member));
        continue;
      }
      for (const app of GROUP_APPS) {
        const incoming = member.apps[app];
        const mine = known.apps[app];
        if (incoming && (!mine || (incoming.state === "pending" && mine.state !== "pending" && time(incoming.at) > time(mine.at)))) {
          known.apps[app] = incoming;
        }
      }
    }
    for (const message of snapshot.messages) {
      if (!existing.messages.some((entry) => entry.id === message.id)) existing.messages.push(structuredClone(message));
    }
    existing.messages = existing.messages.slice(-MAX_MESSAGES_KEPT);
    this.save();
  }

  /** Changes a group, saves it and reports it. */
  updateGroup(id: string, change: (group: Group) => void) {
    const group = this.group(id);
    change(group);
    group.messages = group.messages.slice(-MAX_MESSAGES_KEPT);
    group.updatedAt = new Date().toISOString();
    this.save();
    for (const listener of this.listeners) listener(group);
    return group;
  }

  /** Forgets a group (it was deleted on the website). */
  forgetGroup(id: string) {
    this.data.groups = this.data.groups.filter((entry) => entry.id !== id);
    this.save();
  }
}

export type { Contact, Group };
