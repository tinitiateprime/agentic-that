// Instagram group chats through the user's own Instagram, in its logged-in
// browser (see browser-app.ts). Instagram's website no longer answers its older
// web requests for Direct messages, so the work is done on instagram.com/direct
// the way a person would: New message → tick the people → Chat, then the first
// message starts the group. People are picked by their exact username.

import type { Locator, Page } from "playwright-core";
import { BrowserAppSession, sleep } from "./browser-app.js";
import type { AddResult, ConnectionState, GroupAppAdapter } from "./engine.js";
import { splitMessage } from "./model.js";

const ORIGIN = "https://www.instagram.com";
const MESSAGE_LIMIT = 1000;

/** Instagram's answer, in plain words (from its page or a request). */
export function explainInstagramError(response: { status: number; json: Record<string, any> | null }) {
  const message = String(response.json?.message || response.json?.feedback_message || "");
  if (/checkpoint|challenge/i.test(message) || response.json?.checkpoint_url) return "Instagram wants to confirm it's you.";
  if (/login_required|not.?logged/i.test(message) || response.status === 401) return "Instagram logged this computer out. Connect Instagram again.";
  if (/feedback_required|spam|wait a few minutes|try again later/i.test(message) || response.status === 429) {
    return "Instagram is limiting this account for a while. Group Manager will go slower; try again later.";
  }
  if (/can'?t message|cannot message|not allowed|privacy|restrict/i.test(message)) return "Their Instagram settings don't allow being added by you.";
  if (message) return `Instagram said: ${message}`;
  return `Instagram didn't accept it (code ${response.status}).`;
}

/** "/direct/t/1809…/" → the chat's number. */
export function instagramThreadFromUrl(url: string) {
  return url.match(/instagram\.com\/direct\/t\/(\d{5,30})/)?.[1] || "";
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

export class InstagramAdapter implements GroupAppAdapter {
  readonly app = "instagram" as const;
  // Instagram limits accounts that add people or message quickly.
  readonly paceMs = 9000;
  readonly session: BrowserAppSession;

  constructor(directory: string) {
    this.session = new BrowserAppSession(directory, {
      app: "instagram",
      loginUrl: `${ORIGIN}/accounts/login/`,
      homeUrl: `${ORIGIN}/`,
      sessionCookies: ["sessionid", "ds_user_id"],
      needsUser: (url) => /instagram\.com\/(challenge|accounts\/suspended|accounts\/login\/two_factor|auth_platform)/i.test(url),
      accountName: async (page) => {
        await page.goto(`${ORIGIN}/direct/inbox/`, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
        await sleep(3000);
        // The inbox heading shows the logged-in username.
        const heading = await firstVisible([page.locator("[role='navigation'][aria-label='Thread list'] [role='button']").first()], 5000);
        const name = ((await heading?.innerText().catch(() => "")) || "").split("\n")[0].trim();
        return /^[a-z0-9._]{1,30}$/i.test(name) ? `@${name}` : "";
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

  // ---- Instagram's page ---------------------------------------------------------------------

  /** Closes Instagram's own pop-ups ("Turn on notifications") that sit over the page. */
  private async dismissPopups(page: Page) {
    for (let round = 0; round < 3; round += 1) {
      const notNow = await firstVisible([page.getByRole("button", { name: pattern("^not now$") })], round === 0 ? 2500 : 600);
      if (!notNow) return;
      await notNow.click().catch(() => undefined);
      await sleep(800);
    }
  }

  private async inbox(page: Page) {
    await page.goto(`${ORIGIN}/direct/inbox/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await sleep(2500);
    await this.dismissPopups(page);
  }

  /** In a "New message" or "Add people" dialog: search the username and tick exactly that account. */
  private async tick(page: Page, dialog: Locator, username: string) {
    const search = await firstVisible([dialog.locator("input[name='queryBox']"), dialog.locator("input[type='text']")], 10_000);
    if (!search) throw new Error("Instagram's people search didn't open.");
    await search.click();
    await search.fill("");
    await search.pressSequentially(username, { delay: 70 });
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      await sleep(700);
      const boxes = dialog.locator("input[type='checkbox']");
      const count = await boxes.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const box = boxes.nth(index);
        // The row around the tick box holds the person's name and username.
        const lines = await box.evaluate((element) => {
          let row: HTMLElement | null = element as HTMLElement;
          for (let level = 0; level < 8 && row; level += 1) {
            const text = row.innerText || "";
            if (text.trim()) return text.split("\n").map((line) => line.trim());
            row = row.parentElement;
          }
          return [];
        }).catch(() => [] as string[]);
        if (!lines.some((line) => line.toLowerCase() === username.toLowerCase())) continue;
        if (!(await box.isChecked().catch(() => false))) {
          await box.evaluate((element) => (element.closest("label") as HTMLElement | null)?.click() ?? (element as HTMLElement).click());
          await sleep(600);
        }
        return true;
      }
    }
    return false;
  }

  private async messageBox(page: Page) {
    const box = await firstVisible([
      page.locator("div[role='textbox'][contenteditable='true'][aria-label]"),
      page.locator("div[role='textbox'][contenteditable='true']"),
    ], 30_000);
    if (!box) throw new Error("Instagram's chat didn't open. Try again.");
    return box;
  }

  private async type(page: Page, text: string) {
    const box = await this.messageBox(page);
    await box.click();
    for (const [index, line] of text.split("\n").entries()) {
      if (index > 0) await page.keyboard.press("Shift+Enter");
      if (line) await page.keyboard.insertText(line);
    }
    await sleep(300);
    await page.keyboard.press("Enter");
    await sleep(2000);
  }

  private async openThread(page: Page, threadId: string) {
    await page.goto(`${ORIGIN}/direct/t/${encodeURIComponent(threadId)}/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await sleep(2500);
    await this.dismissPopups(page);
  }

  /** The chat's details panel (the "i" at the top right). */
  private async openDetails(page: Page) {
    const info = await firstVisible([
      page.locator("svg[aria-label='Conversation information']").locator("xpath=ancestor::*[@role='button'][1]"),
      page.getByRole("button", { name: pattern("conversation information") }),
    ], 15_000);
    if (!info) throw new Error("Instagram's chat details didn't open.");
    await info.click();
    await sleep(1500);
  }

  // ---- The work -----------------------------------------------------------------------------

  async createGroup({ name, members = [] }: { name: string; members?: string[] }) {
    return this.session.run(async (page) => {
      const usernames = [...new Set(members.map((member) => member.toLowerCase()))];
      // With one person Instagram opens a private chat, not a group.
      if (usernames.length < 2) throw new Error("Instagram makes a group chat with at least 2 people. Add 2 people who have an Instagram username saved, then press Try again.");
      await this.inbox(page);
      const pencil = await firstVisible([
        page.locator("svg[aria-label='New message']").locator("xpath=ancestor::*[@role='button'][1]"),
        page.locator("svg[aria-label='New message']"),
      ], 15_000);
      if (!pencil) throw new Error("Instagram's New message button didn't show.");
      await pencil.click();
      const dialog = page.locator("[role='dialog']").filter({ has: page.locator("input[name='queryBox']") }).last();
      await dialog.waitFor({ state: "visible", timeout: 15_000 });
      const picked: string[] = [];
      for (const username of usernames) {
        if (await this.tick(page, dialog, username)) picked.push(username);
      }
      if (picked.length < 2) {
        const missing = usernames.filter((username) => !picked.includes(username)).map((username) => `@${username}`).join(", ");
        await page.keyboard.press("Escape").catch(() => undefined);
        throw new Error(`Instagram's search didn't find ${missing}, so the group wasn't made (it needs 2 people). Check the usernames, then press Try again.`);
      }
      const chat = await firstVisible([dialog.getByRole("button", { name: pattern("^chat$|^next$") }), dialog.getByText(pattern("^chat$"))], 8000);
      if (!chat) throw new Error("Instagram's Chat button didn't show.");
      await chat.click();
      await sleep(2500);
      await this.dismissPopups(page);
      // An Instagram group starts with its first message: the group's name.
      await this.type(page, name);
      let threadId = instagramThreadFromUrl(page.url());
      const deadline = Date.now() + 30_000;
      while (!threadId && Date.now() < deadline) {
        await sleep(500);
        threadId = instagramThreadFromUrl(page.url());
      }
      if (!threadId) throw new Error("Instagram didn't open the new group.");
      await this.rename(page, name).catch(() => undefined);
      return { ref: { threadId, members: picked.join(",") } };
    });
  }

  /** Names the group (details → Change, next to the group name). */
  private async rename(page: Page, name: string) {
    await this.openDetails(page);
    const change = await firstVisible([page.getByRole("button", { name: pattern("^change$") }), page.getByText(pattern("^change$"))], 5000);
    if (!change) return;
    await change.click();
    const input = await firstVisible([page.locator("[role='dialog'] input[type='text'], [role='dialog'] input:not([type])")], 6000);
    if (!input) return;
    await input.fill(name.slice(0, 100));
    const save = await firstVisible([page.locator("[role='dialog']").getByRole("button", { name: pattern("^save$") }), page.locator("[role='dialog']").getByText(pattern("^save$"))], 4000);
    await save?.click();
    await sleep(1500);
  }

  async addMember(ref: Record<string, string>, username: string): Promise<AddResult> {
    // People ticked when the group was made are already in it.
    if ((ref.members || "").split(",").includes(username.toLowerCase())) return { state: "added" };
    return this.session.run(async (page) => {
      await this.openThread(page, ref.threadId);
      await this.openDetails(page);
      const add = await firstVisible([page.getByRole("button", { name: pattern("^add people$") }), page.getByText(pattern("^add people$"))], 8000);
      if (!add) throw new Error("Instagram's Add people button didn't show (only the group's admins can add people).");
      await add.click();
      const dialog = page.locator("[role='dialog']").filter({ has: page.locator("input[name='queryBox'], input[type='text']") }).last();
      await dialog.waitFor({ state: "visible", timeout: 15_000 });
      if (!(await this.tick(page, dialog, username))) {
        await page.keyboard.press("Escape").catch(() => undefined);
        return { state: "not-on-app", detail: `Instagram's search didn't find @${username}.` };
      }
      const confirm = await firstVisible([dialog.getByRole("button", { name: pattern("^next$|^add$|^done$|^chat$") }), dialog.getByText(pattern("^next$|^add$|^done$"))], 8000);
      if (!confirm) throw new Error("Instagram's Add button didn't show.");
      await confirm.click();
      await sleep(2500);
      return { state: "added" };
    });
  }

  async removeMember(ref: Record<string, string>, username: string) {
    await this.session.run(async (page) => {
      await this.openThread(page, ref.threadId);
      await this.openDetails(page);
      const row = await firstVisible([page.locator("[role='button'], [role='listitem']").filter({ hasText: pattern(`^${username.replace(/[.]/g, "\\.")}$|\\n${username.replace(/[.]/g, "\\.")}(\\n|$)`) })], 6000);
      if (!row) return;
      const more = await firstVisible([row.locator("svg[aria-label*='ptions'], svg[aria-label='More']").locator("xpath=ancestor::*[@role='button'][1]")], 3000);
      await (more || row).click();
      const remove = await firstVisible([page.getByRole("button", { name: pattern("remove from group") }), page.getByText(pattern("^remove from group$"))], 5000);
      if (!remove) throw new Error("Instagram didn't offer to remove them (only the group's admins can).");
      await remove.click();
      const confirm = await firstVisible([page.locator("[role='dialog']").getByRole("button", { name: pattern("^remove$") })], 4000);
      await confirm?.click();
      await sleep(2000);
    });
  }

  async sendMessage(ref: Record<string, string>, text: string) {
    await this.session.run(async (page) => {
      await this.openThread(page, ref.threadId);
      for (const part of splitMessage(text, MESSAGE_LIMIT)) await this.type(page, part);
    });
  }
}

