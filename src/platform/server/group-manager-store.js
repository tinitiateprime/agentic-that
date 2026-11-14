// Group Manager data in the platform database (Hetzner PostgreSQL): each
// workspace's contacts and groups. New work is saved as pending; the user's
// Companion does it in WhatsApp, Telegram and Discord and reports each result
// back through applyGroupSync.

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getPlatformSql } from "./auth-store.js";
import {
  GROUP_APPS,
  MAX_MESSAGES_KEPT,
  contactFromInput,
  groupInputSchema,
  membersInputSchema,
  messageInputSchema,
} from "../../../services/publishing/queue-runner/server/services/groups/model.ts";

export class GroupManagerError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const CONTACT_FIELDS = ["whatsapp", "telegram", "discord", "instagram", "facebook", "x", "reddit", "linkedin"];

// Tests use their own database; everything else uses the platform database.
let sqlOverride = null;
export function useGroupManagerSql(sql) {
  sqlOverride = sql;
}
const database = () => (sqlOverride ? Promise.resolve(sqlOverride) : getPlatformSql());
const now = () => new Date().toISOString();
const iso = (value) => (value instanceof Date ? value.toISOString() : String(value || ""));

function workspaceOf(actor) {
  const workspaceId = actor?.workspaceId ? String(actor.workspaceId) : "";
  if (!workspaceId) throw new GroupManagerError("Group Manager needs a workspace. Create or join one first.", 409);
  return workspaceId;
}

function contactFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    ...Object.fromEntries(CONTACT_FIELDS.map((field) => [field, row[field] || ""])),
    note: row.note || "",
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function groupFromRows(row, members, messages) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    discordGuildId: row.discord_guild_id || undefined,
    apps: row.apps || {},
    members: members.map((member) => ({ contactId: member.contact_id, addedAt: iso(member.added_at), apps: member.apps || {} })),
    messages: messages.map((message) => ({ id: message.id, text: message.text, sentAt: iso(message.sent_at), results: message.results || {} })),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

async function loadGroups(sql, workspaceId, groupId = null) {
  const groups = groupId
    ? await sql`SELECT * FROM public.group_manager_groups WHERE workspace_id = ${workspaceId} AND id = ${groupId}`
    : await sql`SELECT * FROM public.group_manager_groups WHERE workspace_id = ${workspaceId} ORDER BY created_at DESC`;
  if (!groups.length) return [];
  const ids = groups.map((group) => group.id);
  const members = await sql`SELECT * FROM public.group_manager_members WHERE group_id = ANY(${ids}) ORDER BY added_at`;
  const messages = await sql`
    SELECT * FROM (
      SELECT *, row_number() OVER (PARTITION BY group_id ORDER BY sent_at DESC) AS position
        FROM public.group_manager_messages WHERE group_id = ANY(${ids})
    ) recent WHERE position <= ${MAX_MESSAGES_KEPT} ORDER BY sent_at`;
  return groups.map((group) => groupFromRows(group, members.filter((member) => member.group_id === group.id), messages.filter((message) => message.group_id === group.id)));
}

async function oneGroup(sql, workspaceId, groupId) {
  const [group] = await loadGroups(sql, workspaceId, String(groupId));
  if (!group) throw new GroupManagerError("That group no longer exists.", 404);
  return group;
}

/** The workspace's contacts and groups. */
export async function groupManagerState(actor) {
  const workspaceId = workspaceOf(actor);
  const sql = await database();
  const contacts = await sql`SELECT * FROM public.group_manager_contacts WHERE workspace_id = ${workspaceId} ORDER BY lower(name)`;
  return { contacts: contacts.map(contactFromRow), groups: await loadGroups(sql, workspaceId) };
}

/** The contacts with these ids (for the Companion's work). */
export async function groupManagerContacts(actor, ids) {
  const workspaceId = workspaceOf(actor);
  if (!ids.length) return [];
  const sql = await database();
  const rows = await sql`SELECT * FROM public.group_manager_contacts WHERE workspace_id = ${workspaceId} AND id = ANY(${ids.map(String)})`;
  return rows.map(contactFromRow);
}

// ---- Contact Master ------------------------------------------------------------------

function contactValues(contact) {
  return Object.fromEntries(CONTACT_FIELDS.map((field) => [field, contact[field]]));
}

function validContact(input, existing) {
  try {
    return contactFromInput(input, existing);
  } catch (error) {
    if (error instanceof z.ZodError) throw new GroupManagerError(error.issues[0]?.message || "Check the contact's details.");
    throw new GroupManagerError(error instanceof Error ? error.message : "Check the contact's details.");
  }
}

export async function addGroupContact(actor, input) {
  const workspaceId = workspaceOf(actor);
  const contact = validContact(input);
  const sql = await database();
  const [row] = await sql`
    INSERT INTO public.group_manager_contacts ${sql({ id: contact.id, workspace_id: workspaceId, name: contact.name, ...contactValues(contact), note: contact.note, created_by: actor.userId || null })}
    RETURNING *`;
  return contactFromRow(row);
}

export async function updateGroupContact(actor, contactId, input) {
  const workspaceId = workspaceOf(actor);
  const sql = await database();
  const [existing] = await sql`SELECT * FROM public.group_manager_contacts WHERE workspace_id = ${workspaceId} AND id = ${String(contactId)}`;
  if (!existing) throw new GroupManagerError("That contact no longer exists.", 404);
  const contact = validContact(input, contactFromRow(existing));
  const [row] = await sql`
    UPDATE public.group_manager_contacts
       SET name = ${contact.name}, whatsapp = ${contact.whatsapp}, telegram = ${contact.telegram}, discord = ${contact.discord},
           instagram = ${contact.instagram}, facebook = ${contact.facebook}, x = ${contact.x}, reddit = ${contact.reddit},
           linkedin = ${contact.linkedin}, note = ${contact.note}, updated_at = now()
     WHERE workspace_id = ${workspaceId} AND id = ${existing.id}
    RETURNING *`;
  return contactFromRow(row);
}

/** Removes the contact from Contact Master (not from any real group they're in). */
export async function deleteGroupContact(actor, contactId) {
  const workspaceId = workspaceOf(actor);
  const sql = await database();
  const deleted = await sql`DELETE FROM public.group_manager_contacts WHERE workspace_id = ${workspaceId} AND id = ${String(contactId)} RETURNING id`;
  if (!deleted.length) throw new GroupManagerError("That contact no longer exists.", 404);
}

// ---- Groups ----------------------------------------------------------------------------

function parse(schema, input) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new GroupManagerError(parsed.error.issues[0]?.message || "Check the details and try again.");
  return parsed.data;
}

async function workspaceContactIds(sql, workspaceId, ids) {
  if (!ids.length) return [];
  const rows = await sql`SELECT id FROM public.group_manager_contacts WHERE workspace_id = ${workspaceId} AND id = ANY(${ids})`;
  const found = new Set(rows.map((row) => row.id));
  return ids.filter((id) => found.has(id));
}

/** Saves a new group as "creating" in each chosen app, with its members pending. */
export async function createManagedGroup(actor, input) {
  const workspaceId = workspaceOf(actor);
  const data = parse(groupInputSchema, input);
  if (data.apps.includes("discord") && !data.discordGuildId) throw new GroupManagerError("Choose the Discord server for this group.");
  const sql = await database();
  const contactIds = await workspaceContactIds(sql, workspaceId, [...new Set(data.contactIds)]);
  const id = randomUUID();
  const at = now();
  try {
    await sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO public.group_manager_groups ${transaction({
          id,
          workspace_id: workspaceId,
          name: data.name.replace(/\s+/g, " "),
          description: data.description,
          discord_guild_id: data.apps.includes("discord") ? data.discordGuildId : null,
          apps: transaction.json(Object.fromEntries(data.apps.map((app) => [app, { state: "creating", at }]))),
          created_by: actor.userId || null,
        })}`;
      for (const contactId of contactIds) {
        await transaction`
          INSERT INTO public.group_manager_members ${transaction({
            group_id: id,
            contact_id: contactId,
            workspace_id: workspaceId,
            apps: transaction.json(Object.fromEntries(data.apps.map((app) => [app, { state: "pending", at }]))),
          })}`;
      }
    });
  } catch (error) {
    if (error?.code === "23505") throw new GroupManagerError(`You already have a group called "${data.name}".`, 409);
    throw error;
  }
  return oneGroup(sql, workspaceId, id);
}

/**
 * Adds people (pending) in every app of the group. An app whose group couldn't be
 * made yet (Messenger and Instagram need 2 people) is asked to make it again.
 */
export async function addManagedGroupMembers(actor, groupId, input) {
  const workspaceId = workspaceOf(actor);
  const { contactIds } = parse(membersInputSchema, input);
  const sql = await database();
  const group = await oneGroup(sql, workspaceId, groupId);
  const apps = GROUP_APPS.filter((app) => ["ready", "creating", "failed"].includes(group.apps[app]?.state));
  if (!apps.length) throw new GroupManagerError("This group isn't in any app.", 409);
  const valid = await workspaceContactIds(sql, workspaceId, [...new Set(contactIds)]);
  const at = now();
  const failed = apps.filter((app) => group.apps[app]?.state === "failed");
  await sql.begin(async (transaction) => {
    if (failed.length) {
      const nextApps = { ...group.apps, ...Object.fromEntries(failed.map((app) => [app, { state: "creating", at }])) };
      await transaction`UPDATE public.group_manager_groups SET apps = ${transaction.json(nextApps)}, updated_at = now() WHERE id = ${group.id} AND workspace_id = ${workspaceId}`;
    }
    for (const contactId of valid) {
      const existing = group.members.find((member) => member.contactId === contactId);
      const next = { ...(existing?.apps || {}) };
      for (const app of apps) if (next[app]?.state !== "added") next[app] = { state: "pending", at };
      await transaction`
        INSERT INTO public.group_manager_members (group_id, contact_id, workspace_id, apps)
        VALUES (${group.id}, ${contactId}, ${workspaceId}, ${transaction.json(next)})
        ON CONFLICT (group_id, contact_id) DO UPDATE SET apps = EXCLUDED.apps`;
    }
  });
  return oneGroup(sql, workspaceId, group.id);
}

/** Marks a member to be removed in the apps; people never added are removed at once. */
export async function removeManagedGroupMember(actor, groupId, contactId) {
  const workspaceId = workspaceOf(actor);
  const sql = await database();
  const group = await oneGroup(sql, workspaceId, groupId);
  const member = group.members.find((entry) => entry.contactId === String(contactId));
  if (!member) throw new GroupManagerError("That person isn't in this group.", 404);
  const live = GROUP_APPS.filter((app) => ["added", "invited"].includes(member.apps[app]?.state));
  if (!live.length) {
    await sql`DELETE FROM public.group_manager_members WHERE group_id = ${group.id} AND contact_id = ${member.contactId}`;
    return { group: await oneGroup(sql, workspaceId, group.id), needsCompanion: false };
  }
  const at = now();
  const next = { ...member.apps };
  for (const app of live) next[app] = { ...next[app], state: "pending", detail: "Removing…", at };
  await sql`UPDATE public.group_manager_members SET apps = ${sql.json(next)} WHERE group_id = ${group.id} AND contact_id = ${member.contactId}`;
  return { group: await oneGroup(sql, workspaceId, group.id), needsCompanion: true };
}

/** Saves a message as "sending" in every app the group is live in. */
export async function addManagedGroupMessage(actor, groupId, input) {
  const workspaceId = workspaceOf(actor);
  const { text } = parse(messageInputSchema, input);
  const sql = await database();
  const group = await oneGroup(sql, workspaceId, groupId);
  const apps = GROUP_APPS.filter((app) => group.apps[app]?.state === "ready");
  if (!apps.length) throw new GroupManagerError("This group isn't ready in any app yet.", 409);
  await sql`
    INSERT INTO public.group_manager_messages ${sql({
      id: randomUUID(),
      group_id: group.id,
      workspace_id: workspaceId,
      text,
      results: sql.json(Object.fromEntries(apps.map((app) => [app, { state: "sending" }]))),
      sent_by: actor.userId || null,
    })}`;
  return oneGroup(sql, workspaceId, group.id);
}

/** Removes the group from Group Manager (the real groups stay in the apps). */
export async function deleteManagedGroup(actor, groupId) {
  const workspaceId = workspaceOf(actor);
  const sql = await database();
  const deleted = await sql`DELETE FROM public.group_manager_groups WHERE workspace_id = ${workspaceId} AND id = ${String(groupId)} RETURNING id`;
  if (!deleted.length) throw new GroupManagerError("That group no longer exists.", 404);
}

export async function managedGroup(actor, groupId) {
  const sql = await database();
  return oneGroup(sql, workspaceOf(actor), groupId);
}

// ---- Results from the Companion ---------------------------------------------------------

const status = z.object({ state: z.string().max(20) }).passthrough();
const appMap = z.partialRecord(z.enum(GROUP_APPS), status);
export const groupSyncSchema = z.object({
  groups: z.array(z.object({
    id: z.string().max(80),
    apps: appMap.optional(),
    members: z.array(z.object({ contactId: z.string().max(80), apps: appMap })).max(500).optional(),
    messages: z.array(z.object({ id: z.string().max(80), results: appMap })).max(100).optional(),
  })).max(50),
});

/** Statuses only: the app's ids, links and each person's and message's state. */
function cleanStatus(value) {
  const clean = { state: String(value.state).slice(0, 20) };
  for (const key of ["detail", "error", "link", "at"]) if (typeof value[key] === "string") clean[key] = value[key].slice(0, key === "link" ? 300 : 500);
  if (value.ref && typeof value.ref === "object") {
    clean.ref = Object.fromEntries(Object.entries(value.ref).filter(([, entry]) => typeof entry === "string").slice(0, 6).map(([key, entry]) => [key.slice(0, 40), entry.slice(0, 200)]));
  }
  return clean;
}

function cleanApps(apps) {
  return Object.fromEntries(Object.entries(apps || {}).filter(([app]) => GROUP_APPS.includes(app)).map(([app, value]) => [app, cleanStatus(value)]));
}

/** A member who has been taken out of every app they were in. */
function fullyRemoved(apps) {
  const states = Object.values(apps).map((value) => value.state);
  return states.includes("removed") && states.every((state) => ["removed", "missing-id", "not-on-app"].includes(state));
}

/**
 * Saves what the Companion did, for this workspace's groups only. Members and
 * messages added on the website meanwhile are left as they are.
 */
export async function applyGroupSync(workspaceId, input, connection = null) {
  const { groups } = groupSyncSchema.parse(input);
  if (!workspaceId) throw new GroupManagerError("No workspace for this Companion.", 403);
  const sql = connection || await database();
  let updated = 0;
  await sql.begin(async (transaction) => {
    for (const group of groups) {
      const [owned] = await transaction`SELECT id, apps FROM public.group_manager_groups WHERE id = ${group.id} AND workspace_id = ${String(workspaceId)} FOR UPDATE`;
      if (!owned) continue;
      updated += 1;
      if (group.apps) {
        await transaction`UPDATE public.group_manager_groups SET apps = ${transaction.json({ ...(owned.apps || {}), ...cleanApps(group.apps) })}, updated_at = now() WHERE id = ${owned.id}`;
      }
      for (const member of group.members || []) {
        const apps = cleanApps(member.apps);
        const [current] = await transaction`SELECT apps FROM public.group_manager_members WHERE group_id = ${owned.id} AND contact_id = ${member.contactId}`;
        if (!current) continue;
        const merged = { ...(current.apps || {}) };
        for (const [app, value] of Object.entries(apps)) {
          // A newer request from the website (add again after a removal or failure) wins.
          const saved = merged[app];
          const newerRequest = saved?.state === "pending" && value.state !== "pending" && Date.parse(saved.at || "") > Date.parse(value.at || "") + 1000;
          if (!newerRequest) merged[app] = value;
        }
        if (fullyRemoved(merged)) {
          await transaction`DELETE FROM public.group_manager_members WHERE group_id = ${owned.id} AND contact_id = ${member.contactId}`;
          continue;
        }
        await transaction`UPDATE public.group_manager_members SET apps = ${transaction.json(merged)} WHERE group_id = ${owned.id} AND contact_id = ${member.contactId}`;
      }
      for (const message of group.messages || []) {
        await transaction`
          UPDATE public.group_manager_messages SET results = results || ${transaction.json(cleanApps(message.results))}
           WHERE id = ${message.id} AND group_id = ${owned.id}`;
      }
    }
  });
  return { updated };
}
