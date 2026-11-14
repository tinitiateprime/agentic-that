import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { signServiceAccessToken } from "../../../../../../lib/service-access-token.js";
import { DiscordAdapter, splitDiscordMessage } from "./discord.js";
import { type AddResult, type ConnectionState, type GroupAppAdapter, GroupEngine } from "./engine.js";
import { type Contact, type Group, type GroupApp, contactFromInput, contactIdentity, discordChannelName, normalizeDiscord, normalizeFacebook, normalizeInstagram, normalizePhone, normalizeTelegram } from "./model.js";
import { explainInstagramError, instagramThreadFromUrl } from "./instagram.js";
import { profileIdFromHtml, profileNameFromHtml, threadFromUrl } from "./messenger.js";
import { type GroupReport, reportGroup, setGroupReporter } from "./reporting.js";
import { type GroupServices, groupServices, registerGroupRoutes, setGroupPairedWorkspace } from "./routes.js";
import { GroupStore } from "./store.js";
import { explainTelegramError } from "./telegram.js";
import { explainAddStatus, whatsappJid } from "./whatsapp.js";

process.env.PUBLISH_QUEUE_SESSION_ENCRYPTION_KEY ||= "test-session-key-for-group-manager";

function tempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agenticthat-groups-test-"));
}

const until = async (check: () => boolean, ms = 3000) => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for the group to update.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

/** A pretend app: adds everyone except the identities it is told about. */
class FakeAdapter implements GroupAppAdapter {
  readonly paceMs = 0;
  connected = true;
  failCreate = false;
  failRemove = false;
  outcomes = new Map<string, AddResult>();
  calls: string[] = [];
  constructor(readonly app: GroupApp) {}
  connection(): ConnectionState {
    return { app: this.app, state: this.connected ? "connected" : "disconnected" };
  }
  async createGroup(input: { name: string; members?: string[] }) {
    this.calls.push(`create:${input.name}:${(input.members || []).join(",")}`);
    if (this.failCreate) throw new Error("The app said no.");
    return { ref: { id: `${this.app}-group` }, link: `https://${this.app}.example/join` };
  }
  async addMember(_ref: Record<string, string>, identity: string) {
    this.calls.push(`add:${identity}`);
    return this.outcomes.get(identity) || { state: "added" as const };
  }
  async removeMember(_ref: Record<string, string>, identity: string) {
    this.calls.push(`remove:${identity}`);
    if (this.failRemove) throw new Error("Network down");
  }
  async sendMessage(_ref: Record<string, string>, text: string) {
    this.calls.push(`send:${text}`);
  }
}

function setup(directory = tempDirectory(), resumeAfterMs = -1) {
  const store = new GroupStore(directory);
  const adapters = {
    whatsapp: new FakeAdapter("whatsapp"),
    telegram: new FakeAdapter("telegram"),
    discord: new FakeAdapter("discord"),
    messenger: new FakeAdapter("messenger"),
    instagram: new FakeAdapter("instagram"),
  };
  const engine = new GroupEngine(store, adapters, resumeAfterMs);
  return { directory, store, adapters, engine };
}

const at = (secondsAgo = 0) => new Date(Date.now() - secondsAgo * 1000).toISOString();

function contact(id: string, fields: Partial<Contact>): Contact {
  return { ...contactFromInput({ name: fields.name || id, ...fields }), id };
}

/** A group as the website saves it: new apps "creating", new members "pending". */
function snapshot(apps: GroupApp[], members: string[], extra: Partial<Group> = {}): Group {
  return {
    id: "group-1",
    name: "Batch 5",
    description: "",
    apps: Object.fromEntries(apps.map((app) => [app, { state: "creating", at: at() }])),
    members: members.map((contactId) => ({ contactId, addedAt: at(), apps: Object.fromEntries(apps.map((app) => [app, { state: "pending", at: at() }])) })),
    messages: [],
    createdAt: at(),
    updatedAt: at(),
    ...extra,
  };
}

// ---- Contacts ------------------------------------------------------------------------

test("contact numbers and IDs are cleaned and checked", () => {
  assert.equal(normalizePhone("+91 63091 23485"), "+916309123485");
  assert.equal(normalizePhone(""), "");
  assert.throws(() => normalizePhone("12345"), /country code/);
  assert.equal(normalizeTelegram("@tinitiate_ai"), "@tinitiate_ai");
  assert.equal(normalizeTelegram("https://t.me/tinitiate_ai"), "@tinitiate_ai");
  assert.equal(normalizeTelegram("+91 6309123485"), "+916309123485");
  assert.equal(normalizeDiscord("123456789012345678"), "123456789012345678");
  assert.equal(normalizeDiscord("@Tinitiate.AI"), "tinitiate.ai");
  assert.throws(() => normalizeDiscord("not valid!"), /Discord user ID/);
  const made = contactFromInput({ name: "  Kaushik   Reddy ", whatsapp: "+91 63091 23485", instagram: "@tinitiateai", reddit: "u/tinitiate" });
  assert.equal(made.name, "Kaushik Reddy");
  assert.equal(made.instagram, "tinitiateai");
  assert.equal(made.reddit, "tinitiate");
  assert.throws(() => contactFromInput({ name: "" }), /name/);
  assert.equal(normalizeInstagram("https://www.instagram.com/Tinitiate.AI/?hl=en"), "tinitiate.ai");
  assert.throws(() => normalizeInstagram("not valid!"), /Instagram username/);
  assert.equal(normalizeFacebook("https://www.facebook.com/profile.php?id=100012345678901"), "100012345678901");
  assert.equal(normalizeFacebook("facebook.com/Kaushik.Reddy?ref=x"), "kaushik.reddy");
  assert.equal(normalizeFacebook("https://m.facebook.com/kaushik.reddy/"), "kaushik.reddy");
  assert.throws(() => normalizeFacebook("https://www.facebook.com/profile.php"), /Facebook profile/);
  assert.equal(normalizeFacebook("  Tintiate   Kaushik "), "Tintiate Kaushik");
  assert.equal(normalizeFacebook("kaushik.reddy"), "kaushik.reddy");
  // Messenger finds people by their Facebook profile.
  assert.equal(contactIdentity(contact("x", { name: "A", facebook: "kaushik.reddy" }), "messenger"), "kaushik.reddy");
  assert.equal(contactIdentity(contact("x", { name: "A", instagram: "asha" }), "instagram"), "asha");
});

test("the Companion's working copy is saved encrypted and read back", () => {
  const { directory, store } = setup();
  store.upsertContacts([contact("c1", { name: "Asha", whatsapp: "+919876543210" })]);
  const raw = fs.readFileSync(path.join(directory, "groups.json"), "utf8");
  assert.doesNotMatch(raw, /Asha|9876543210/, "nothing readable on disk");
  assert.equal(new GroupStore(directory).contact("c1")?.name, "Asha");
});

// ---- Doing the work ---------------------------------------------------------------------

test("a new group is created in each chosen app and every member gets their real status", async () => {
  const { store, adapters, engine } = setup();
  const reported: Group[] = [];
  store.onChange((group) => reported.push(structuredClone(group)));
  const contacts = [
    contact("asha", { name: "Asha", whatsapp: "+919876543210", telegram: "@asha_k" }),
    contact("ravi", { name: "Ravi", whatsapp: "+919812345678" }),
    contact("meera", { name: "Meera", whatsapp: "+919800000000", telegram: "+919800000000" }),
  ];
  adapters.whatsapp.outcomes.set("+919812345678", { state: "invited", detail: "Privacy", link: "https://chat.whatsapp.com/x" });
  adapters.telegram.outcomes.set("+919800000000", { state: "not-on-app" });

  engine.run({ group: snapshot(["whatsapp", "telegram"], ["asha", "ravi", "meera"]), contacts });
  await until(() => !engine.busy());

  const done = store.group("group-1");
  assert.equal(done.apps.whatsapp?.state, "ready");
  assert.equal(done.apps.telegram?.link, "https://telegram.example/join");
  assert.equal(adapters.whatsapp.calls[0], "create:Batch 5:+919876543210,+919812345678,+919800000000");
  const state = (contactId: string, app: GroupApp) => done.members.find((member) => member.contactId === contactId)?.apps[app]?.state;
  assert.equal(state("asha", "whatsapp"), "added");
  assert.equal(state("ravi", "whatsapp"), "invited");
  assert.equal(state("asha", "telegram"), "added");
  assert.equal(state("ravi", "telegram"), "missing-id", "Ravi has no Telegram saved");
  assert.equal(state("meera", "telegram"), "not-on-app");
  assert.equal(adapters.discord.calls.length, 0, "Discord wasn't chosen");
  assert.ok(reported.length >= 7, "every change is reported");
  assert.equal(engine.activity().recent.length > 0, true);
});

test("the same job twice does the work once", async () => {
  const { adapters, engine } = setup();
  const contacts = [contact("asha", { name: "Asha", whatsapp: "+919876543210" })];
  const group = snapshot(["whatsapp"], ["asha"]);
  engine.run({ group, contacts });
  engine.run({ group, contacts });
  await until(() => !engine.busy());
  assert.deepEqual(adapters.whatsapp.calls, ["create:Batch 5:+919876543210", "add:+919876543210"]);
});

test("an app that isn't connected marks its work, and Try again does it once connected", async () => {
  const { store, adapters, engine } = setup();
  adapters.telegram.connected = false;
  engine.run({ group: snapshot(["telegram"], ["asha"]), contacts: [contact("asha", { name: "Asha", telegram: "@asha_k" })] });
  await until(() => !engine.busy());
  assert.equal(store.group("group-1").apps.telegram?.state, "failed");
  assert.match(store.group("group-1").apps.telegram?.error || "", /Connect Telegram in the Companion first/);

  adapters.telegram.connected = true;
  engine.run({ group: store.group("group-1"), contacts: [], action: "retry" });
  await until(() => !engine.busy());
  assert.equal(store.group("group-1").apps.telegram?.state, "ready");
  assert.equal(store.group("group-1").members[0].apps.telegram?.state, "added");
});

test("people and messages added later are taken in and done; removal happens in every app", async () => {
  const { store, adapters, engine } = setup();
  const asha = contact("asha", { name: "Asha", whatsapp: "+919876543210", discord: "123456789012345678" });
  engine.run({ group: snapshot(["whatsapp", "discord"], [], { discordGuildId: "999999999999999999" }), contacts: [] });
  await until(() => !engine.busy());

  // The website saved a new member and a message as pending, then sent the group.
  const later = structuredClone(store.group("group-1"));
  later.members.push({ contactId: "asha", addedAt: at(), apps: { whatsapp: { state: "pending", at: at() }, discord: { state: "pending", at: at() } } });
  later.messages.push({ id: "m1", text: "Class starts at 7 PM", sentAt: at(), results: { whatsapp: { state: "sending" }, discord: { state: "sending" } } });
  engine.run({ group: later, contacts: [asha] });
  await until(() => !engine.busy());
  assert.equal(store.group("group-1").members[0].apps.discord?.state, "added");
  assert.deepEqual(store.group("group-1").messages[0].results, { whatsapp: { state: "sent" }, discord: { state: "sent" } });

  engine.run({ group: store.group("group-1"), contacts: [asha], action: "remove", contactId: "asha" });
  await until(() => !engine.busy());
  assert.ok(adapters.whatsapp.calls.includes("remove:+919876543210"));
  assert.ok(adapters.discord.calls.includes("remove:123456789012345678"));
  assert.deepEqual(Object.values(store.group("group-1").members[0].apps).map((entry) => entry?.state), ["removed", "removed"]);

  // Added again on the website after the removal: a newer request, so it's done.
  const again = structuredClone(store.group("group-1"));
  again.members[0].apps = { whatsapp: { state: "pending", at: new Date(Date.now() + 5000).toISOString() } , discord: again.members[0].apps.discord };
  engine.run({ group: again, contacts: [asha] });
  await until(() => !engine.busy());
  assert.equal(store.group("group-1").members[0].apps.whatsapp?.state, "added");
});

test("a removal that failed is tried again as a removal, never as an add", async () => {
  const { store, adapters, engine } = setup();
  const asha = contact("asha", { name: "Asha", whatsapp: "+919876543210" });
  engine.run({ group: snapshot(["whatsapp"], ["asha"]), contacts: [asha] });
  await until(() => !engine.busy());
  adapters.whatsapp.failRemove = true;
  engine.run({ group: store.group("group-1"), contacts: [asha], action: "remove", contactId: "asha" });
  await until(() => !engine.busy());
  assert.equal(store.group("group-1").members[0].apps.whatsapp?.state, "failed");

  adapters.whatsapp.failRemove = false;
  adapters.whatsapp.calls = [];
  engine.run({ group: store.group("group-1"), contacts: [asha], action: "retry" });
  await until(() => !engine.busy());
  assert.deepEqual(adapters.whatsapp.calls, ["remove:+919876543210"]);
  assert.equal(store.group("group-1").members[0].apps.whatsapp?.state, "removed");
});

test("work cut short by a Companion restart carries on by itself", async () => {
  const directory = tempDirectory();
  const first = setup(directory);
  first.store.upsertContacts([contact("asha", { name: "Asha", whatsapp: "+919876543210" })]);
  first.store.importGroup(snapshot(["whatsapp"], ["asha"]));
  const second = setup(directory, 0);
  await until(() => second.store.group("group-1").members[0].apps.whatsapp?.state === "added");
  assert.equal(second.store.group("group-1").apps.whatsapp?.state, "ready");
});

test("results are reported in batches over the pairing, and kept until they go through", async () => {
  const sent: GroupReport[][] = [];
  let online = false;
  setGroupReporter(async (groups) => {
    if (!online) return false;
    sent.push(groups);
    return true;
  });
  const group = snapshot(["whatsapp"], ["asha"]);
  reportGroup(group);
  reportGroup({ ...group, apps: { whatsapp: { state: "ready", at: at() } } });
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(sent.length, 0, "not paired yet");
  online = true;
  setGroupReporter(async (groups) => { sent.push(groups); return true; });
  await until(() => sent.length === 1);
  assert.equal(sent[0].length, 1, "one report per group, the newest");
  assert.equal(sent[0][0].apps.whatsapp?.state, "ready");
  setGroupReporter(null);
});

// ---- App details ---------------------------------------------------------------------------

test("each app's answers are explained in plain words", () => {
  assert.equal(whatsappJid("+91 63091 23485"), "916309123485@s.whatsapp.net");
  assert.deepEqual(explainAddStatus("200"), { state: "added" });
  assert.equal(explainAddStatus("403").state, "invite");
  assert.equal(explainAddStatus("409").state, "added");
  assert.equal(explainAddStatus("500").state, "failed");
  assert.match(explainTelegramError(Object.assign(new Error("x"), { errorMessage: "PEER_FLOOD" })), /paused adding people/);
  assert.match(explainTelegramError(Object.assign(new Error("x"), { errorMessage: "FLOOD_WAIT_120" })), /wait/);
  assert.equal(discordChannelName("Tinitiate Batch 5 — Data Eng!"), "tinitiate-batch-5-data-eng");
  const long = `${"a".repeat(1500)}\n${"b".repeat(1500)}`;
  assert.deepEqual(splitDiscordMessage(long).map((part) => part.length), [1500, 1500]);
  assert.match(explainInstagramError({ status: 400, json: { status: "fail", message: "feedback_required" } }), /limiting/);
  assert.match(explainInstagramError({ status: 400, json: { message: "challenge_required" } }), /confirm it's you/);
  assert.match(explainInstagramError({ status: 401, json: null }), /logged this computer out/);
  assert.equal(profileIdFromHtml('..."userID":"100012345678901",...'), "100012345678901");
  assert.deepEqual(threadFromUrl("https://www.facebook.com/messages/e2ee/t/7712345678901234/"), { threadId: "7712345678901234", e2ee: "1" });
  assert.deepEqual(threadFromUrl("https://www.facebook.com/messages/t/123456789/"), { threadId: "123456789", e2ee: "" });
  assert.equal(threadFromUrl("https://www.facebook.com/messages/new/"), null);
  const profile = '{"__typename":"User","id":"61593507754763","friendship_status":"CAN_REQUEST","name":"Hello Uhfh","__isNode":"User"}';
  assert.equal(profileNameFromHtml(profile, "61593507754763"), "Hello Uhfh");
  assert.equal(profileNameFromHtml('{"id":"61593507754763","name":"Ravi \u00e9"}', "61593507754763"), "Ravi é");
  assert.equal(profileNameFromHtml(profile, "999"), "");
  assert.equal(instagramThreadFromUrl("https://www.instagram.com/direct/t/18098168560910730/"), "18098168560910730");
});

test("Discord: a private channel is created, server members are added, others get the invite", async () => {
  const requests: { method: string; url: string; body?: Record<string, unknown> }[] = [];
  const reply = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status });
  const fakeFetch = (async (url: string, init: RequestInit) => {
    const route = url.replace("https://discord.com/api/v10", "");
    requests.push({ method: init.method || "GET", url: route, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (route === "/users/@me") return reply(200, { id: "111111111111111111", username: "AgenticThat Bot" });
    if (route === "/oauth2/applications/@me") return reply(200, { id: "222222222222222222" });
    if (route === "/users/@me/guilds") return reply(200, [{ id: "333333333333333333", name: "Tinitiate" }]);
    if (route.endsWith("/channels") && init.method === "POST") return reply(201, { id: "444444444444444444" });
    if (route.endsWith("/invites")) return reply(200, { code: "abc123" });
    if (route.includes("/permissions/")) return reply(204, null);
    if (route === "/guilds/333333333333333333/members/555555555555555555") return reply(200, { user: { id: "555555555555555555" } });
    if (route === "/guilds/333333333333333333/members/666666666666666666") return reply(404, { message: "Unknown Member" });
    if (route === "/users/@me/channels") return reply(403, { message: "Cannot send messages to this user" });
    return reply(404, { message: "Unknown" });
  }) as typeof fetch;

  const discord = new DiscordAdapter(tempDirectory(), fakeFetch);
  const connection = await discord.connect("Bot abcdefghijklmnopqrstuvwxyz0123456789");
  assert.equal(connection.state, "connected");
  assert.deepEqual(connection.guilds, [{ id: "333333333333333333", name: "Tinitiate" }]);
  assert.match(connection.addBotUrl || "", /client_id=222222222222222222/);

  const created = await discord.createGroup({ name: "Batch 5", description: "", guildId: "333333333333333333" });
  assert.deepEqual(created, { ref: { guildId: "333333333333333333", channelId: "444444444444444444" }, link: "https://discord.gg/abc123" });
  const channelRequest = requests.find((request) => request.url === "/guilds/333333333333333333/channels");
  assert.equal(channelRequest?.body?.name, "batch-5");
  assert.deepEqual((channelRequest?.body?.permission_overwrites as { id: string; deny: string }[])[0], { id: "333333333333333333", type: 0, deny: "1024", allow: "0" }, "hidden from everyone else");

  const context = { groupName: "Batch 5", contactName: "Asha", link: created.link };
  assert.deepEqual(await discord.addMember(created.ref, "555555555555555555", context), { state: "added" });
  const outside = await discord.addMember(created.ref, "666666666666666666", context);
  assert.equal(outside.state, "invited");
  assert.equal(outside.link, "https://discord.gg/abc123");
});

// ---- Routes ----------------------------------------------------------------------------------

test("routes: status is open, everything else needs a valid group-manager token", async () => {
  const { store, engine } = setup();
  const connection = () => engine.connections()[0];
  const fake: GroupServices = {
    store,
    engine,
    whatsapp: { start: async () => connection(), disconnect: async () => connection() },
    telegram: { startLogin: async () => connection(), submitCode: async () => connection(), submitPassword: async () => connection(), disconnect: async () => connection() },
    discord: { connect: async () => connection(), refreshGuilds: async () => connection(), disconnect: async () => connection() },
    messenger: { connect: async () => connection(), disconnect: async () => connection() },
    instagram: { connect: async () => connection(), disconnect: async () => connection() },
  };
  const app = express();
  registerGroupRoutes(app, () => fake);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/group-manager`;
  try {
    assert.equal((await (await fetch(`${base}/status`)).json()).ok, true);
    assert.equal((await fetch(`${base}/state`)).status, 401);
    const wrong = signServiceAccessToken({ audience: "social-seo", subject: "u1", workspaceId: "w1" });
    assert.equal((await fetch(`${base}/state`, { headers: { Authorization: `Bearer ${wrong}` } })).status, 401);

    const token = signServiceAccessToken({ audience: "group-manager", subject: "u1", workspaceId: "w1" });
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const job = { group: snapshot(["whatsapp"], ["asha"]), contacts: [contact("asha", { name: "Asha", whatsapp: "+919876543210" })] };
    const ran = await fetch(`${base}/jobs`, { method: "POST", headers, body: JSON.stringify(job) });
    assert.equal(ran.status, 200);
    await until(() => !engine.busy());
    const state = await (await fetch(`${base}/state`, { headers })).json();
    assert.equal(state.groups[0].members[0].apps.whatsapp.state, "added");
    assert.equal(state.connections.length, 5);
    const bad = await fetch(`${base}/jobs`, { method: "POST", headers, body: JSON.stringify({ group: { id: "x" } }) });
    assert.equal(bad.status, 400);
  } finally {
    server.close();
  }
});

test("each workspace only reaches its own app logins, and older logins go to the paired workspace", async () => {
  const root = tempDirectory();
  process.env.AGENTICTHAT_GROUPS_DIR = root;
  // Logins saved before they were kept per workspace (a working copy file stands in for them).
  new GroupStore(root).upsertContacts([contact("asha", { name: "Asha" })]);
  setGroupPairedWorkspace(async () => "paired-workspace");
  const asked: string[] = [];
  const app = express();
  registerGroupRoutes(app, (workspaceId) => {
    asked.push(workspaceId);
    return groupServices(workspaceId);
  });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/group-manager`;
  const tokenFor = (workspaceId: string) => ({ Authorization: `Bearer ${signServiceAccessToken({ audience: "group-manager", subject: "u1", workspaceId })}` });
  try {
    // Someone else signs in on this computer first: they get their own, empty Group Manager.
    const other = await (await fetch(`${base}/state`, { headers: tokenFor("other-workspace") })).json();
    assert.deepEqual(other.connections.map((entry: { state: string }) => entry.state), ["disconnected", "disconnected", "disconnected", "disconnected", "disconnected"]);
    assert.ok(fs.existsSync(path.join(root, "groups.json")), "older logins are not handed to another workspace");
    // The paired workspace: the older logins move to its own folder.
    await fetch(`${base}/state`, { headers: tokenFor("paired-workspace") });
    assert.equal(fs.existsSync(path.join(root, "groups.json")), false);
    assert.deepEqual(asked, ["other-workspace", "paired-workspace"]);
    const folders = fs.readdirSync(path.join(root, "workspaces"));
    assert.equal(folders.length, 2, "one folder per workspace");
    assert.ok(folders.some((folder) => fs.existsSync(path.join(root, "workspaces", folder, "groups.json")) && JSON.parse(fs.readFileSync(path.join(root, "workspaces", folder, "workspace.json"), "utf8")).workspaceId === "paired-workspace"));
  } finally {
    server.close();
    setGroupPairedWorkspace(async () => null);
    delete process.env.AGENTICTHAT_GROUPS_DIR;
  }
});
