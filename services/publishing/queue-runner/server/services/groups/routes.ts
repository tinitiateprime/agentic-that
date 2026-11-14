// Companion endpoints for Group Manager. The website calls them on 127.0.0.1
// with a short-lived signed "group-manager" token from AgenticThat. Contacts and
// groups live in AgenticThat's database; the Companion holds the app logins,
// does the work in WhatsApp, Telegram and Discord, and reports every result.

import fs from "node:fs";
import path from "node:path";
import express from "express";
import { z } from "zod";
import { verifyServiceAccessToken } from "../../../../../../lib/service-access-token.js";
import { publishingDesktopHost } from "../desktop-host.js";
import { DiscordAdapter } from "./discord.js";
import { type GroupAppAdapter, GroupEngine, type GroupJob } from "./engine.js";
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
};

let services: GroupServices | null = null;

/** What the Companion's own window shows in its Group Manager section. */
export function groupManagerSnapshot() {
  if (!services) return { started: false, connections: GROUP_APPS.map((app) => ({ app, state: "disconnected" })), working: {}, recent: [] };
  const activity = services.engine.activity();
  return {
    started: true,
    connections: services.engine.connections().map(({ app, state, account, detail }) => ({ app, state, account, detail })),
    ...activity,
  };
}

function publishActivity() {
  publishingDesktopHost()?.updateGroupActivity?.(groupManagerSnapshot());
}

/** Started on first use (or at Companion start when apps are already connected). */
export function groupServices(): GroupServices {
  if (services) return services;
  const directory = groupsDirectory();
  const store = new GroupStore(directory);
  const whatsapp = new WhatsAppAdapter(directory);
  const telegram = new TelegramAdapter(directory);
  const discord = new DiscordAdapter(directory);
  const adapters: Record<GroupApp, GroupAppAdapter> = { whatsapp, telegram, discord };
  const engine = new GroupEngine(store, adapters);
  store.onChange((group) => reportGroup(group));
  engine.onActivity(publishActivity);
  services = { store, engine, whatsapp, telegram, discord };
  publishActivity();
  return services;
}

/** At Companion start: reconnect the apps and finish unfinished work, if Group Manager was used before. */
export function startGroupManagerIfUsed() {
  const directory = groupsDirectory();
  if (["groups.json", "whatsapp.json", "telegram.json", "discord.json"].some((file) => fs.existsSync(path.join(directory, file)))) groupServices();
}

/** True while Group Manager is adding people or sending messages. */
export function groupManagerBusy() {
  return services?.engine.busy() ?? false;
}

function requireToken(req: express.Request, res: express.Response, next: express.NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || !verifyServiceAccessToken(token, "group-manager")) {
    res.status(401).json({ message: "Sign in to AgenticThat to manage your groups." });
    return;
  }
  next();
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

export function registerGroupRoutes(app: express.Express, get: () => GroupServices = groupServices) {
  const router = express.Router();
  router.use(express.json({ limit: "2mb" }));

  // Safe without a token: only whether each app is connected.
  router.get("/status", (_req, res) => {
    const connections = services ? services.engine.connections().map(({ app: id, state }) => ({ app: id, state })) : GROUP_APPS.map((id) => ({ app: id, state: "unknown" }));
    res.json({ ok: true, connections });
  });

  router.use(requireToken);

  // The app connections, and this Companion's latest results (the page copies them to AgenticThat).
  router.get("/state", handle(() => {
    const { store, engine } = get();
    return { connections: engine.connections(), groups: store.groups().map((group) => ({ ...groupReport(group), updatedAt: group.updatedAt })), busy: engine.busy() };
  }));

  // Work for one group: take it in, do the action, then everything pending.
  router.post("/jobs", handle((req) => {
    const job = jobSchema.parse(req.body) as GroupJob;
    const group = get().engine.run(job);
    return { group: { ...groupReport(group), updatedAt: group.updatedAt } };
  }));
  router.delete("/groups/:id", handle((req) => {
    get().engine.forget(String(req.params.id));
    return {};
  }));

  // ---- App connections ----------------------------------------------------------------------
  router.post("/connect/whatsapp", handle(async () => ({ connection: await get().whatsapp.start() })));
  router.post("/connect/telegram", handle(async (req) => {
    const input = telegramStartSchema.parse(req.body);
    return { connection: await get().telegram.startLogin({ phone: input.phone.replace(/[^\d+]/g, ""), ...telegramApp(input) }) };
  }));
  router.post("/connect/telegram/code", handle(async (req) => ({ connection: await get().telegram.submitCode(z.object({ code: z.string().trim().min(3).max(12) }).parse(req.body).code) })));
  router.post("/connect/telegram/password", handle(async (req) => ({ connection: await get().telegram.submitPassword(z.object({ password: z.string().min(1).max(256) }).parse(req.body).password) })));
  router.post("/connect/discord", handle(async (req) => ({ connection: await get().discord.connect(z.object({ token: z.string().trim().min(30, "Paste the bot token from the Discord Developer Portal.").max(200) }).parse(req.body).token) })));
  router.post("/connect/discord/refresh", handle(async () => ({ connection: await get().discord.refreshGuilds() })));
  router.post("/disconnect/:app", handle(async (req) => {
    const target = z.enum(GROUP_APPS).parse(req.params.app);
    return { connection: await get()[target].disconnect() };
  }));

  app.use("/api/group-manager", router);
}
