// Companion endpoints for Group Manager. The website calls them on 127.0.0.1
// with a short-lived signed "group-manager" token from AgenticThat. Contacts and
// groups live in AgenticThat's database; the Companion holds the app logins,
// does the work in WhatsApp, Telegram, Discord, Messenger and Instagram, and
// reports every result.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { z } from "zod";
import { verifyServiceAccessToken } from "../../../../../../lib/service-access-token.js";
import { publishingDesktopHost } from "../desktop-host.js";
import { DiscordAdapter } from "./discord.js";
import { type GroupAppAdapter, GroupEngine, type GroupJob } from "./engine.js";
import { InstagramAdapter } from "./instagram.js";
import { MessengerAdapter } from "./messenger.js";
import { GROUP_APPS, type GroupApp } from "./model.js";
import { groupReport, reportGroup } from "./reporting.js";
import { GroupStore, groupsDirectory } from "./store.js";
import { TelegramAdapter } from "./telegram.js";
import { WhatsAppAdapter } from "./whatsapp.js";

export type GroupServices = {
  store: GroupStore;
  engine: GroupEngine;
  whatsapp: Pick<WhatsAppAdapter, "start" | "disconnect">;
  telegram: Pick<TelegramAdapter, "startLogin" | "submitCode" | "submitPassword" | "disconnect">;
  discord: Pick<DiscordAdapter, "connect" | "refreshGuilds" | "disconnect">;
  messenger: Pick<MessengerAdapter, "connect" | "disconnect">;
  instagram: Pick<InstagramAdapter, "connect" | "disconnect">;
};

// Each AgenticThat workspace has its own app logins and working copy, in its own
// folder: a person signed in to another workspace on this computer can neither
// see nor use them.
const services = new Map<string, GroupServices>();
let lastWorkspace = "";

function workspaceKey(workspaceId: string) {
  return createHash("sha256").update(`agenticthat-groups:${workspaceId}`).digest("hex").slice(0, 32);
}

function workspaceDirectory(workspaceId: string) {
  return path.join(groupsDirectory(), "workspaces", workspaceKey(workspaceId));
}

// Logins saved by Companion 2.4.0 before they were kept per workspace belong to
// the workspace this Companion is paired with; never to whoever signs in first.
const LEGACY_FILES = ["groups.json", "whatsapp.json", "telegram.json", "discord.json"];
let pairedWorkspace: () => Promise<string | null> = async () => null;

export function setGroupPairedWorkspace(resolver: () => Promise<string | null>) {
  pairedWorkspace = resolver;
}

async function adoptLegacyLogins(workspaceId: string) {
  const root = groupsDirectory();
  const legacy = LEGACY_FILES.filter((file) => fs.existsSync(path.join(root, file)));
  if (!legacy.length || (await pairedWorkspace().catch(() => null)) !== workspaceId) return;
  const target = workspaceDirectory(workspaceId);
  fs.mkdirSync(target, { recursive: true });
  for (const file of legacy) {
    if (!fs.existsSync(path.join(target, file))) fs.renameSync(path.join(root, file), path.join(target, file));
  }
}

/** What the Companion's own window shows: the workspace used most recently on this computer. */
export function groupManagerSnapshot() {
  const current = services.get(lastWorkspace) || [...services.values()][0];
  if (!current) return { started: false, connections: GROUP_APPS.map((app) => ({ app, state: "disconnected" })), working: {}, recent: [] };
  const working: Record<string, number> = {};
  for (const entry of services.values()) {
    for (const [app, count] of Object.entries(entry.engine.activity().working)) working[app] = (working[app] || 0) + Number(count || 0);
  }
  return {
    started: true,
    connections: current.engine.connections().map(({ app, state, account, detail }) => ({ app, state, account, detail })),
    working,
    recent: [...services.values()].flatMap((entry) => entry.engine.activity().recent).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20),
  };
}

function publishActivity() {
  publishingDesktopHost()?.updateGroupActivity?.(groupManagerSnapshot());
}

/** One workspace's Group Manager, started on first use. */
export function groupServices(workspaceId: string): GroupServices {
  const existing = services.get(workspaceId);
  if (existing) return existing;
  const directory = workspaceDirectory(workspaceId);
  fs.mkdirSync(directory, { recursive: true });
  // Which workspace the folder belongs to, so its apps reconnect when the Companion starts.
  const owner = path.join(directory, "workspace.json");
  if (!fs.existsSync(owner)) fs.writeFileSync(owner, JSON.stringify({ workspaceId }), { mode: 0o600 });
  const store = new GroupStore(directory);
  const whatsapp = new WhatsAppAdapter(directory);
  const telegram = new TelegramAdapter(directory);
  const discord = new DiscordAdapter(directory);
  const messenger = new MessengerAdapter(directory);
  const instagram = new InstagramAdapter(directory);
  const adapters: Record<GroupApp, GroupAppAdapter> = { whatsapp, telegram, discord, messenger, instagram };
  const engine = new GroupEngine(store, adapters);
  store.onChange((group) => reportGroup(group));
  engine.onActivity(publishActivity);
  const created = { store, engine, whatsapp, telegram, discord, messenger, instagram };
  services.set(workspaceId, created);
  publishActivity();
  return created;
}

/** At Companion start: reconnect each workspace's apps and finish unfinished work. */
export async function startGroupManagerIfUsed() {
  const paired = await pairedWorkspace().catch(() => null);
  if (paired) await adoptLegacyLogins(paired);
  const root = path.join(groupsDirectory(), "workspaces");
  if (!fs.existsSync(root)) return;
  for (const folder of fs.readdirSync(root)) {
    try {
      const { workspaceId } = JSON.parse(fs.readFileSync(path.join(root, folder, "workspace.json"), "utf8")) as { workspaceId?: string };
      if (workspaceId && workspaceDirectory(workspaceId) === path.join(root, folder)) groupServices(workspaceId);
    } catch {
      // A folder without its owner record is left alone.
    }
  }
}

/** True while Group Manager is adding people or sending messages. */
export function groupManagerBusy() {
  return [...services.values()].some((entry) => entry.engine.busy());
}

type GroupRequest = express.Request & { groupWorkspace?: string };

function requireToken(req: GroupRequest, res: express.Response, next: express.NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const claims = token ? verifyServiceAccessToken(token, "group-manager") as { workspaceId?: string } | null : null;
  if (!claims?.workspaceId) {
    res.status(401).json({ message: "Sign in to AgenticThat to manage your groups." });
    return;
  }
  req.groupWorkspace = String(claims.workspaceId);
  lastWorkspace = req.groupWorkspace;
  void adoptLegacyLogins(req.groupWorkspace).then(() => next(), () => next());
}

/** The signed-in workspace (from the AgenticThat token). */
function workspaceOf(req: express.Request) {
  return (req as GroupRequest).groupWorkspace || "";
}

function fail(res: express.Response, error: unknown) {
  if (error instanceof z.ZodError) {
    res.status(400).json({ message: error.issues[0]?.message || "Check the details and try again." });
    return;
  }
  const status = Number((error as { status?: number })?.status) || 400;
  const needsApp = (error as { needsApp?: boolean })?.needsApp === true;
  res.status(status >= 400 && status < 600 ? status : 400).json({ message: error instanceof Error ? error.message : "That didn't work. Try again.", ...(needsApp ? { needsApp } : {}) });
}

/** Wraps a handler: JSON in, JSON out, errors as { message }. */
function handle(action: (req: express.Request) => unknown) {
  return async (req: express.Request, res: express.Response) => {
    try {
      const result = await action(req);
      publishActivity();
      res.json({ ok: true, ...(result as object) });
    } catch (error) {
      fail(res, error);
    }
  };
}

const status = z.object({ state: z.string().max(20) }).passthrough();
const appMap = z.partialRecord(z.enum(GROUP_APPS), status);
const contactSchema = z.object({
  id: z.string().max(80),
  name: z.string().max(80),
  whatsapp: z.string().max(40).default(""),
  telegram: z.string().max(64).default(""),
  discord: z.string().max(40).default(""),
  instagram: z.string().max(80).default(""),
  facebook: z.string().max(120).default(""),
  x: z.string().max(80).default(""),
  reddit: z.string().max(80).default(""),
  linkedin: z.string().max(160).default(""),
  note: z.string().max(240).default(""),
  createdAt: z.string().max(40).default(""),
  updatedAt: z.string().max(40).default(""),
});
export const jobSchema = z.object({
  action: z.enum(["sync", "remove", "retry"]).default("sync"),
  contactId: z.string().max(80).optional(),
  contacts: z.array(contactSchema).max(500).default([]),
  group: z.object({
    id: z.string().max(80),
    name: z.string().min(1).max(100),
    description: z.string().max(500).default(""),
    discordGuildId: z.string().max(40).optional(),
    apps: appMap,
    members: z.array(z.object({ contactId: z.string().max(80), addedAt: z.string().max(40).default(""), apps: appMap })).max(500),
    messages: z.array(z.object({ id: z.string().max(80), text: z.string().max(4000), sentAt: z.string().max(40).default(""), results: appMap })).max(100),
    createdAt: z.string().max(40).default(""),
    updatedAt: z.string().max(40).default(""),
  }),
});

const telegramStartSchema = z.object({
  phone: z.string().trim().min(8).max(32),
  apiId: z.coerce.number().int().positive().optional(),
  apiHash: z.string().trim().regex(/^[a-f0-9]{32}$/i).optional(),
});

function telegramApp(input: z.output<typeof telegramStartSchema>) {
  const apiId = input.apiId || Number(process.env.TELEGRAM_API_ID || "");
  const apiHash = input.apiHash || process.env.TELEGRAM_API_HASH?.trim() || "";
  if (!Number.isInteger(apiId) || apiId <= 0 || !/^[a-f0-9]{32}$/i.test(apiHash)) {
    throw Object.assign(new Error("AgenticThat's Telegram app identity isn't set up (TELEGRAM_API_ID and TELEGRAM_API_HASH)."), { status: 503, needsApp: true });
  }
  return { apiId, apiHash };
}

export function registerGroupRoutes(app: express.Express, get: (workspaceId: string) => GroupServices = groupServices) {
  const router = express.Router();
  router.use(express.json({ limit: "2mb" }));

  // Safe without a token: only that this Companion has Group Manager (connections are per workspace).
  router.get("/status", (_req, res) => {
    res.json({ ok: true, connections: GROUP_APPS.map((id) => ({ app: id, state: "unknown" })) });
  });

  router.use(requireToken);

  // The app connections, and this Companion's latest results (the page copies them to AgenticThat).
  router.get("/state", handle((req) => {
    const { store, engine } = get(workspaceOf(req));
    return { connections: engine.connections(), groups: store.groups().map((group) => ({ ...groupReport(group), updatedAt: group.updatedAt })), busy: engine.busy() };
  }));

  // Work for one group: take it in, do the action, then everything pending.
  router.post("/jobs", handle((req) => {
    const job = jobSchema.parse(req.body) as GroupJob;
    const group = get(workspaceOf(req)).engine.run(job);
    return { group: { ...groupReport(group), updatedAt: group.updatedAt } };
  }));
  router.delete("/groups/:id", handle((req) => {
    get(workspaceOf(req)).engine.forget(String(req.params.id));
    return {};
  }));

  // ---- App connections ----------------------------------------------------------------------
  router.post("/connect/whatsapp", handle(async (req) => ({ connection: await get(workspaceOf(req)).whatsapp.start() })));
  router.post("/connect/telegram", handle(async (req) => {
    const input = telegramStartSchema.parse(req.body);
    return { connection: await get(workspaceOf(req)).telegram.startLogin({ phone: input.phone.replace(/[^\d+]/g, ""), ...telegramApp(input) }) };
  }));
  router.post("/connect/telegram/code", handle(async (req) => ({ connection: await get(workspaceOf(req)).telegram.submitCode(z.object({ code: z.string().trim().min(3).max(12) }).parse(req.body).code) })));
  router.post("/connect/telegram/password", handle(async (req) => ({ connection: await get(workspaceOf(req)).telegram.submitPassword(z.object({ password: z.string().min(1).max(256) }).parse(req.body).password) })));
  router.post("/connect/discord", handle(async (req) => ({ connection: await get(workspaceOf(req)).discord.connect(z.object({ token: z.string().trim().min(30, "Paste the bot token from the Discord Developer Portal.").max(200) }).parse(req.body).token) })));
  router.post("/connect/discord/refresh", handle(async (req) => ({ connection: await get(workspaceOf(req)).discord.refreshGuilds() })));
  // Messenger and Instagram: a window opens on the app's own login page; connected once the user has logged in.
  router.post("/connect/messenger", handle(async (req) => ({ connection: await get(workspaceOf(req)).messenger.connect() })));
  router.post("/connect/instagram", handle(async (req) => ({ connection: await get(workspaceOf(req)).instagram.connect() })));
  router.post("/disconnect/:app", handle(async (req) => {
    const target = z.enum(GROUP_APPS).parse(req.params.app);
    return { connection: await get(workspaceOf(req))[target].disconnect() };
  }));

  app.use("/api/group-manager", router);
}
