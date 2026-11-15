// X group chats through the user's own X account, in its logged-in browser
// (see browser-app.ts); X's API for chats is paid. The work is done in X Chat
// (x.com/i/chat) the way a person would: New message → Create a group → pick
// people → Next, then name it; add and remove people from the group's details
// (More). X only lets you add people who follow you; for anyone else X's own
// reason is shown. Every change is confirmed in the group's member list.

import type { Locator, Page } from "playwright-core";
import { BrowserAppSession, NeedsUserError, sleep } from "./browser-app.js";
import type { AddResult, ConnectionState, GroupAppAdapter } from "./engine.js";
import { splitMessage } from "./model.js";

const ORIGIN = "https://x.com";
const MESSAGE_LIMIT = 10_000;

/** "/i/chat/g2121…" → the group chat's id ("g2121…"). */
export function chatIdFromUrl(url: string) {
  return url.match(/x\.com\/i\/chat\/(g\d{5,30})/)?.[1] || "";
}

/** X's reason for not letting someone be added, in plain words. */
export function explainXAddBlock(toast: string) {
  if (/does not follow you|doesn.t follow you/i.test(toast)) return "Doesn't follow you on X. X only lets you add people who follow you.";
  if (/inbox is closed|message settings/i.test(toast)) return "Their X message settings don't allow you to message them.";
  if (/already/i.test(toast)) return "";
  return toast ? `X said: ${toast.replace(/^cannot add user\s*/i, "")}` : "X didn't let them be added.";
}

const pattern = (text: string) => new RegExp(text, "i");

async function firstVisible(candidates: Locator[], timeoutMs = 0) {
  const deadline = Date.now() + timeoutMs;
  do {
    for (const candidate of candidates) {
      const count = await candidate.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const item = candidate.nth(index);
        if (await item.isVisible().catch(() => false)) return item;
      }
    }
    if (Date.now() < deadline) await sleep(400);
  } while (Date.now() < deadline);
  return null;
}

type Pick = { ok: true; name: string } | { ok: false; reason: string; notFound?: boolean };

export class XAdapter implements GroupAppAdapter {
  readonly app = "x" as const;
  // X limits accounts that add people or message quickly.
  readonly paceMs = 8000;
  readonly session: BrowserAppSession;
  private readonly names = new Map<string, string>();

  constructor(directory: string) {
    this.session = new BrowserAppSession(directory, {
      app: "x",
      loginUrl: `${ORIGIN}/i/flow/login`,
      homeUrl: `${ORIGIN}/`,
      sessionCookies: ["auth_token", "ct0"],
      needsUser: (url) => /x\.com\/(account\/access|account\/locked|i\/flow\/(login|consent|verify))/i.test(url),
      accountName: async (page) => {
        await page.goto(`${ORIGIN}/home`, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
        const profile = await firstVisible([page.locator("a[data-testid='AppTabBar_Profile_Link']")], 15_000);
        const username = ((await profile?.getAttribute("href").catch(() => "")) || "").replace(/^\//, "").split(/[/?#]/)[0];
        return username ? `@${username}` : "";
      },
    });
  }

  connection(): ConnectionState {
    return this.session.connection();
  }

  connect() {
    return this.session.connect();
  }

  disconnect() {
    return this.session.disconnect();
  }

  // ---- X Chat -------------------------------------------------------------------------------

  /** X Chat draws inside this element. */
  private chat(page: Page) {
    return page.locator("[data-testid='xchatEmbedRoute']");
  }

  /** Opens X Chat (or one group in it), once X has unlocked the user's chats. */
  private async open(page: Page, chatId = "") {
    await page.goto(`${ORIGIN}/i/chat${chatId ? `/${chatId}` : ""}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const chat = this.chat(page);
    const ready = chatId ? chat.locator("[data-testid='dm-composer-textarea']") : chat.locator("[data-testid='dm-new-chat-button']");
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      if (await chat.locator("[data-testid='pin-title'], [data-testid='pin-code-input-container']").count().catch(() => 0)) {
        throw new NeedsUserError("X asks for your Chat passcode (or to create one), once on this computer.");
      }
      if (await firstVisible([ready])) return chat;
      await sleep(700);
    }
    throw new Error(chatId ? "X didn't open the group chat. It may have been deleted in X." : "X Chat didn't open. Try again.");
  }

  /** The person's display name on their profile (what X Chat lists members by). */
  private async displayName(page: Page, username: string) {
    const key = username.toLowerCase();
    if (this.names.has(key)) return this.names.get(key)!;
    await page.goto(`${ORIGIN}/${encodeURIComponent(username)}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const heading = await firstVisible([page.locator("[data-testid='UserName']")], 15_000);
    const name = ((await heading?.innerText().catch(() => "")) || "").split("\n")[0].trim();
    if (name) this.names.set(key, name);
    return name;
  }

  /** In a "Create a group" or "Add" search: picks exactly @username, or says why X won't allow it. */
  private async pick(page: Page, scope: Locator, username: string): Promise<Pick> {
    const input = await firstVisible([scope.locator("input[placeholder='Search name or username']"), scope.locator("[data-testid='new-dm-search-input']")], 10_000);
    if (!input) throw new Error("X's people search didn't open.");
    await input.click();
    await input.fill("");
    await input.pressSequentially(username, { delay: 60 });
    const handle = `@${username.toLowerCase()}`;
    const rows = scope.locator("[data-testid^='new-dm-user-suggestion']");
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      await sleep(600);
      const count = await rows.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const row = rows.nth(index);
        const lines = (await row.innerText().catch(() => "")).split("\n").map((line) => line.trim());
        if (!lines.some((line) => line.toLowerCase() === handle)) continue;
        const name = lines[0] && lines[0].toLowerCase() !== handle ? lines[0] : username;
        await row.click();
        if ((await row.getAttribute("aria-disabled")) === "true") {
          // X explains in a short message at the bottom ("Cannot Add User …").
          const toast = await firstVisible([page.getByText(pattern("^cannot add user")).locator("xpath=..")], 3000);
          return { ok: false, reason: explainXAddBlock(((await toast?.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim()) };
        }
        return { ok: true, name };
      }
    }
    return { ok: false, reason: `No X account @${username} came up in X's search.`, notFound: true };
  }

  /** The group's details panel (More), with its member list. */
  private async details(page: Page, chat: Locator) {
    const editGroup = chat.getByRole("button", { name: pattern("^edit group$") });
    if (!(await firstVisible([editGroup], 800))) {
      await chat.locator("[data-testid='dm-conversation-more-button']").click();
      if (!(await firstVisible([editGroup], 10_000))) throw new Error("X's group details didn't open.");
    }
    await sleep(800);
  }

  /** Display names of the group's members (the user themself excluded). */
  private async members(chat: Locator) {
    const labels = await chat.getByRole("button", { name: pattern("^more options for ") }).evaluateAll((elements) => elements.map((element) => (element.getAttribute("aria-label") || "").replace(/^more options for /i, "").trim()));
    return labels;
  }

  private async rename(page: Page, chat: Locator, name: string) {
    await this.details(page, chat);
    await chat.getByRole("button", { name: pattern("^edit group$") }).click();
    const input = await firstVisible([chat.locator("input:not([placeholder])")], 8000);
    if (!input) return;
    await input.fill(name.slice(0, 50));
    const save = chat.getByRole("button", { name: pattern("^save$") });
    const ready = Date.now() + 5000;
    while (Date.now() < ready && (await save.isDisabled().catch(() => true))) await sleep(300);
    if (!(await save.isDisabled().catch(() => true))) await save.click();
    await sleep(1500);
    const back = await firstVisible([chat.getByRole("button", { name: pattern("^back$") })], 1500);
    await back?.click().catch(() => undefined);
  }

  /** The group chat's id; groups made as X Lists (Companion 2.6 previews) have none. */
  private chatOf(ref: Record<string, string>) {
    if (!/^g\d+$/.test(ref.chatId || "")) throw new Error("This X group was made as an X List by an earlier test version. Delete this group and create it again to get an X group chat.");
    return ref.chatId;
  }

  // ---- The work -----------------------------------------------------------------------------

  async createGroup({ name, members = [] }: { name: string; members?: string[] }) {
    return this.session.run(async (page) => {
      const chat = await this.open(page);
      // X reopens an existing group that has exactly the same people instead of making a new one.
      await sleep(1500);
      const existing = new Set(await chat.locator("[data-testid^='dm-conversation-item-g']").evaluateAll((elements) => elements.map((element) => (element.getAttribute("data-testid") || "").replace("dm-conversation-item-", ""))));
      await chat.locator("[data-testid='dm-new-chat-button']").click();
      const modal = chat.locator("[data-testid='dm-new-chat-modal']");
      await modal.locator("[data-testid='new-dm-create-group-button']").click();
      const picked: string[] = [];
      const refused: string[] = [];
      for (const username of [...new Set(members.map((member) => member.toLowerCase()))].slice(0, 20)) {
        const result = await this.pick(page, modal, username);
        if (result.ok) {
          picked.push(username);
          this.names.set(username, result.name);
        } else refused.push(`@${username}: ${result.reason}`);
      }
      if (!picked.length) {
        await page.keyboard.press("Escape").catch(() => undefined);
        throw new Error(members.length
          ? `Nobody could be added on X, so the group wasn't made. ${refused.join(" ")}`
          : "Add at least 1 person who has an X username saved and follows you on X, then press Try again.");
      }
      const next = modal.getByRole("button", { name: pattern("^next$") });
      await next.click();
      // Next makes the group at once and opens it.
      let chatId = "";
      const deadline = Date.now() + 30_000;
      while (!chatId && Date.now() < deadline) {
        await sleep(600);
        chatId = chatIdFromUrl(page.url());
      }
      if (!chatId) throw new Error("X didn't open the new group.");
      if (existing.has(chatId)) {
        throw new Error(`X already has a group chat with exactly these people (${picked.map((username) => `@${username}`).join(", ")}), so it opened that one instead of making a new group. Add someone different, then press Try again.`);
      }
      await this.rename(page, chat, name).catch(() => undefined);
      return { ref: { chatId } };
    });
  }

  async addMember(ref: Record<string, string>, username: string): Promise<AddResult> {
    return this.session.run(async (page) => {
      const name = await this.displayName(page, username);
      if (!name) return { state: "not-on-app", detail: `No X account is called @${username}.` };
      const chat = await this.open(page, this.chatOf(ref));
      await this.details(page, chat);
      const before = await this.members(chat);
      // Checked in the real member list (they may have been removed since the group was made).
      if (before.includes(name)) return { state: "added", detail: "In the group." };
      await chat.getByRole("button", { name: pattern("^add$") }).first().click();
      const result = await this.pick(page, chat, username);
      if (!result.ok) {
        await page.keyboard.press("Escape").catch(() => undefined);
        if (result.notFound) return { state: "not-on-app", detail: result.reason };
        return result.reason ? { state: "failed", detail: result.reason } : { state: "added", detail: "In the group." };
      }
      const next = chat.getByRole("button", { name: pattern("^next$|^add$|^done$") }).last();
      const ready = Date.now() + 5000;
      while (Date.now() < ready && (await next.isDisabled().catch(() => true))) await sleep(300);
      await next.click();
      // Added only when they show in the member list.
      const shown = Date.now() + 15_000;
      while (Date.now() < shown) {
        await sleep(1200);
        await this.details(page, chat).catch(() => undefined);
        if ((await this.members(chat)).includes(result.name || name)) return { state: "added" };
      }
      return { state: "failed", detail: "X didn't show them in the group after adding. Try again." };
    });
  }

  async removeMember(ref: Record<string, string>, username: string) {
    await this.session.run(async (page) => {
      const name = await this.displayName(page, username);
      if (!name) throw new Error(`No X account is called @${username}, so nobody was removed.`);
      const chat = await this.open(page, this.chatOf(ref));
      await this.details(page, chat);
      const present = (await this.members(chat)).filter((member) => member === name).length;
      // The member list loaded and they aren't in it: nothing to remove.
      if (!present) return;
      if (present > 1) throw new Error(`More than one "${name}" is in this X group, so nobody was removed.`);
      await chat.getByRole("button", { name: `More options for ${name}`, exact: true }).click();
      const remove = await firstVisible([chat.getByRole("menuitem", { name: pattern("^remove from group$") }), page.getByRole("menuitem", { name: pattern("^remove from group$") })], 6000);
      if (!remove) throw new Error("X didn't offer to remove them (only the group's admins can).");
      await remove.click();
      const confirm = await firstVisible([chat.locator("[role='dialog'], [role='alertdialog']").getByRole("button", { name: pattern("^remove") })], 4000);
      await confirm?.click();
      // Removed only when they're really gone from the member list.
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline) {
        await sleep(1000);
        await this.details(page, chat).catch(() => undefined);
        if (!(await this.members(chat)).includes(name)) return;
      }
      throw new Error("X still shows them in the group. Try again.");
    });
  }

  async sendMessage(ref: Record<string, string>, text: string) {
    await this.session.run(async (page) => {
      const chat = await this.open(page, this.chatOf(ref));
      for (const part of splitMessage(text, MESSAGE_LIMIT)) {
        const box = chat.locator("[data-testid='dm-composer-textarea']");
        await box.click();
        await box.fill(part);
        await sleep(300);
        await box.press("Enter");
        await sleep(1500);
      }
    });
  }
}
