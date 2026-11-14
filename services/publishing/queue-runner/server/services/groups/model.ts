// Group Manager's data: the user's contacts (Contact Master) and the groups they
// create in WhatsApp, Telegram, Discord, Messenger and Instagram, with every
// member's status in each app.

import { randomUUID } from "node:crypto";
import { z } from "zod";

export const GROUP_APPS = ["whatsapp", "telegram", "discord", "messenger", "instagram"] as const;
export type GroupApp = (typeof GROUP_APPS)[number];
export const APP_LABELS: Record<GroupApp, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  discord: "Discord",
  messenger: "Messenger",
  instagram: "Instagram",
};
/** What a contact needs saved for each app. */
export const IDENTITY_LABELS: Record<GroupApp, string> = {
  whatsapp: "WhatsApp number",
  telegram: "Telegram number or username",
  discord: "Discord ID",
  messenger: "Facebook profile",
  instagram: "Instagram username",
};

/** Where a member stands in one app's group. */
export type MemberState =
  | "pending" // waiting for its turn
  | "added" // really in the group
  | "invited" // the app didn't allow adding them: they got an invite link
  | "not-on-app" // the number or ID isn't on this app
  | "missing-id" // the contact has no number or ID for this app
  | "failed"
  | "removed";

export type MemberAppStatus = { state: MemberState; detail?: string; link?: string; at: string };
export type Member = { contactId: string; addedAt: string; apps: Partial<Record<GroupApp, MemberAppStatus>> };

export type GroupAppStatus = {
  state: "creating" | "ready" | "failed";
  /** The app's own identifiers for the group (chat id, channel id, access hash…). */
  ref?: Record<string, string>;
  link?: string;
  error?: string;
  at: string;
};

export type MessageResult = { state: "sending" | "sent" | "failed"; error?: string };
export type GroupMessage = { id: string; text: string; sentAt: string; results: Partial<Record<GroupApp, MessageResult>> };

export type Group = {
  id: string;
  name: string;
  description: string;
  apps: Partial<Record<GroupApp, GroupAppStatus>>;
  /** The Discord server the group's channel lives in. */
  discordGuildId?: string;
  members: Member[];
  messages: GroupMessage[];
  createdAt: string;
  updatedAt: string;
};

export type Contact = {
  id: string;
  name: string;
  whatsapp: string;
  telegram: string;
  discord: string;
  instagram: string;
  facebook: string;
  x: string;
  reddit: string;
  linkedin: string;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type GroupData = { version: 1; contacts: Contact[]; groups: Group[] };

export const MAX_MESSAGES_KEPT = 50;

// ---- Contact fields ---------------------------------------------------------------

/** "+91 63091 23485" → "+916309123485". Numbers need their country code. */
export function normalizePhone(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) throw new Error("Phone numbers need the country code, for example +91 63091 23485.");
  return `+${digits}`;
}

/** A Telegram phone number, or an @username. */
export function normalizeTelegram(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const username = trimmed.replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, "");
  if (/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username)) return `@${username}`;
  return normalizePhone(trimmed);
}

/** A Discord user ID (17–20 digits) or a username. */
export function normalizeDiscord(value: string) {
  const trimmed = value.trim().replace(/^@/, "");
  if (!trimmed) return "";
  if (/^\d{17,20}$/.test(trimmed)) return trimmed;
  if (/^[a-z0-9_.]{2,32}$/i.test(trimmed)) return trimmed.toLowerCase();
  throw new Error("Use the Discord user ID (17–20 digits) or the username.");
}

/** "@Name", "instagram.com/name/" → "name". */
export function normalizeInstagram(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const username = trimmed
    .replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, "")
    .replace(/[/?#].*$/, "")
    .replace(/^@/, "")
    .toLowerCase();
  if (/^[a-z0-9._]{1,30}$/.test(username)) return username;
  throw new Error("Use the Instagram username, for example @agenticthat.");
}

/** A full name as shown on Facebook ("Tintiate Kaushik"): at least two words. */
export function isFacebookName(value: string) {
  return /^[\p{L}\p{M}][\p{L}\p{M}'’.-]*( [\p{L}\p{M}][\p{L}\p{M}'’.-]*){1,5}$/u.test(value);
}

/**
 * A Facebook profile: its link, username or number. "facebook.com/profile.php?id=1000…"
 * → "1000…"; "facebook.com/Some.Name" → "some.name". Or the person's full name as
 * shown on Facebook ("Tintiate Kaushik"). Messenger uses it to find the person.
 */
export function normalizeFacebook(value: string) {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  if (isFacebookName(trimmed)) return trimmed;
  const id = trimmed.match(/[?&]id=(\d{5,20})/);
  if (id) return id[1];
  const name = trimmed
    .replace(/^(https?:\/\/)?((www|m|web|mbasic)\.)?(facebook|fb)\.com\//i, "")
    .replace(/^(messages\/t\/|people\/[^/]+\/)/i, "")
    .replace(/[/?#].*$/, "")
    .replace(/^@/, "");
  if (/^\d{5,20}$/.test(name)) return name;
  if (/^[A-Za-z0-9.]{5,50}$/.test(name) && !/^profile\.php$/i.test(name)) return name.toLowerCase();
  throw new Error("Use the Facebook profile link (for example facebook.com/your.name) or the full name as shown on Facebook.");
}

export function isDiscordUserId(value: string) {
  return /^\d{17,20}$/.test(value);
}

const text = (max: number) => z.string().max(max).optional().default("").transform((value) => value.trim().replace(/\s+/g, " "));

export const contactInputSchema = z.object({
  name: z.string().trim().min(1, "Give the contact a name.").max(80),
  whatsapp: z.string().max(32).optional().default(""),
  telegram: z.string().max(64).optional().default(""),
  discord: z.string().max(40).optional().default(""),
  instagram: text(80),
  facebook: text(120),
  x: text(80),
  reddit: text(80),
  linkedin: text(160),
  note: text(240),
});
export type ContactInput = z.input<typeof contactInputSchema>;

export function contactFromInput(input: unknown, existing?: Contact): Contact {
  const parsed = contactInputSchema.parse(input);
  const now = new Date().toISOString();
  return {
    id: existing?.id || randomUUID(),
    name: parsed.name.replace(/\s+/g, " "),
    whatsapp: normalizePhone(parsed.whatsapp),
    telegram: normalizeTelegram(parsed.telegram),
    discord: normalizeDiscord(parsed.discord),
    instagram: normalizeInstagram(parsed.instagram),
    facebook: normalizeFacebook(parsed.facebook),
    x: parsed.x.replace(/^@/, ""),
    reddit: parsed.reddit.replace(/^u\//i, ""),
    linkedin: parsed.linkedin,
    note: parsed.note,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}

/** The contact's number or ID in one app ("" when they have none). Messenger uses the Facebook profile. */
export function contactIdentity(contact: Contact, app: GroupApp) {
  return (app === "messenger" ? contact.facebook : contact[app]) || "";
}

/** Splits long text into messages of at most `limit` characters, at line breaks where possible. */
export function splitMessage(text: string, limit: number) {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    let at = rest.lastIndexOf("\n", limit);
    if (at < limit * 0.5) at = rest.lastIndexOf(" ", limit);
    if (at < 1) at = limit;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

// ---- Groups -----------------------------------------------------------------------

export const groupInputSchema = z.object({
  name: z.string().trim().min(1, "Give the group a name.").max(100),
  description: z.string().trim().max(500).optional().default(""),
  apps: z.array(z.enum(GROUP_APPS)).min(1, "Choose at least one app.").max(GROUP_APPS.length),
  contactIds: z.array(z.string().uuid()).max(500).optional().default([]),
  discordGuildId: z.string().regex(/^\d{17,20}$/).optional(),
});

export const membersInputSchema = z.object({ contactIds: z.array(z.string().uuid()).min(1).max(500) });
export const messageInputSchema = z.object({ text: z.string().trim().min(1, "Write a message.").max(4000) });

export function newGroup(input: z.output<typeof groupInputSchema>): Group {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    name: input.name.replace(/\s+/g, " "),
    description: input.description,
    apps: Object.fromEntries(input.apps.map((app) => [app, { state: "creating", at: now }])),
    discordGuildId: input.discordGuildId,
    members: [],
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** A Discord channel name: lowercase words joined by dashes. */
export function discordChannelName(name: string) {
  return name.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "group";
}
