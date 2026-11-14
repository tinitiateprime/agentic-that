// Messenger group chats through the user's own Facebook account, in its
// logged-in browser (see browser-app.ts). Messenger's own requests are
// encrypted and change often, so the work is done on facebook.com/messages the
// way a person would, finding buttons by their accessible names (what screen
// readers use), which stay stable when the page's look changes. People are
// found by their Facebook profile (link, username or number), never by name
// alone.

import type { Locator, Page } from "playwright-core";
import { BrowserAppSession, NeedsUserError, sleep } from "./browser-app.js";
import type { AddResult, ConnectionState, GroupAppAdapter } from "./engine.js";
import { isFacebookName, splitMessage } from "./model.js";

const ORIGIN = "https://www.facebook.com";
const MESSAGE_LIMIT = 4000;

export type FacebookPerson = { id: string; name: string };

/** The profile number in a Facebook profile page's HTML. */
export function profileIdFromHtml(html: string) {
  const patterns = [/"userID":"(\d{5,20})"/, /fb:\/\/profile\/(\d{5,20})/, /"profile_owner":\{"id":"(\d{5,20})"/, /"entity_id":"(\d{5,20})"/];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }
  return "";
}

/** The person's name in their profile page's data: {"id":"6159…",…,"name":"Hello Uhfh"}. */
export function profileNameFromHtml(html: string, id: string) {
  const match = html.match(new RegExp(`"id":"${id}"(?:,"[a-z_]+":(?:"[^"]*"|true|false|null|\\d+))*,"name":"((?:[^"\\\\]|\\\\.)*)"`));
  if (!match) return "";
  try {
    return String(JSON.parse(`"${match[1]}"`)).trim();
  } catch {
    return match[1].trim();
  }
}

/** "/messages/t/123/" or "/messages/e2ee/t/123" → the chat and whether it is end-to-end encrypted. */
export function threadFromUrl(url: string) {
  const match = url.match(/\/messages\/(e2ee\/)?t\/(\d{5,25})/);
  return match ? { threadId: match[2], e2ee: match[1] ? "1" : "" } : null;
}

function threadUrl(ref: Record<string, string>) {
  return `${ORIGIN}/messages/${ref.e2ee ? "e2ee/" : ""}t/${encodeURIComponent(ref.threadId)}/`;
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

export class MessengerAdapter implements GroupAppAdapter {
  readonly app = "messenger" as const;
  // Facebook limits accounts that add people or message quickly.
  readonly paceMs = 9000;
  readonly session: BrowserAppSession;
  private readonly people = new Map<string, FacebookPerson | null>();

  constructor(directory: string) {
    this.session = new BrowserAppSession(directory, {
      app: "messenger",
      loginUrl: `${ORIGIN}/login/`,
      homeUrl: `${ORIGIN}/`,
      sessionCookies: ["c_user", "xs"],
      needsUser: (url) => /facebook\.com\/(checkpoint|two_step_verification|login\/identify|recover|confirmemail|login_approval|auth_platform)/i.test(url),
      accountName: async (page) => {
        await page.goto(`${ORIGIN}/me/`, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
        await sleep(1500);
        return (await page.title().catch(() => "")).replace(/\s*\|\s*Facebook\s*$/i, "").replace(/^\(\d+\)\s*/, "").trim();
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

  // ---- Finding people ---------------------------------------------------------------------

  /** The person behind a Facebook profile (null: no such profile, or not visible to this account). */
  private async person(page: Page, identity: string): Promise<FacebookPerson | null> {
    if (this.people.has(identity)) return this.people.get(identity)!;
    // Saved as a full name: Messenger's search picks the one person with exactly that name.
    if (isFacebookName(identity)) return { id: "", name: identity };
    const url = /^\d+$/.test(identity) ? `${ORIGIN}/profile.php?id=${identity}` : `${ORIGIN}/${encodeURIComponent(identity)}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await sleep(2000);
    const html = await page.content();
    const id = /^\d+$/.test(identity) ? identity : profileIdFromHtml(html);
    let name = id ? profileNameFromHtml(html, id) : "";
    if (!name) {
      const heading = await firstVisible([page.locator("[role='main'] h1")], 3000);
      name = ((await heading?.innerText().catch(() => "")) || "").split("\n")[0].trim();
    }
    const found = id && name ? { id, name } : null;
    this.people.set(identity, found);
    return found;
  }

  // ---- Messenger's page -------------------------------------------------------------------

  /** Messenger may ask for the chat-history PIN on a new device: the user decides that once. */
  private async checkBlockers(page: Page) {
    const pin = await firstVisible([page.getByText(pattern("enter your PIN|restore your chat history|create a PIN"))]);
    if (pin) throw new NeedsUserError("Messenger asks you to create (or enter) your chats PIN, once on this computer.");
  }

  private async openThread(page: Page, ref: Record<string, string>) {
    await page.goto(threadUrl(ref), { waitUntil: "domcontentloaded", timeout: 45_000 });
    await this.messageBox(page);
  }

  private async messageBox(page: Page) {
    const box = await firstVisible([
      page.locator("div[role='textbox'][contenteditable='true'][aria-label]"),
      page.locator("div[role='textbox'][contenteditable='true']"),
    ], 30_000);
    if (!box) {
      await this.checkBlockers(page);
      throw new Error("Messenger's chat didn't open. Try again.");
    }
    return box;
  }

  private async type(page: Page, box: Locator, text: string) {
    await box.click();
    for (const [index, line] of text.split("\n").entries()) {
      if (index > 0) await page.keyboard.press("Shift+Enter");
      if (line) await page.keyboard.insertText(line);
    }
    await sleep(300);
    await page.keyboard.press("Enter");
    await sleep(1500);
  }

  /** Types a name in a "To:" or "Add people" search box and picks exactly that profile. */
  private async pick(page: Page, search: Locator, person: FacebookPerson) {
    await search.click();
    await search.fill("");
    await search.pressSequentially(person.name, { delay: 60 });
    await sleep(2000);
    // Only the people rows: section headings ("More people") hold the same profile links.
    const options = page.locator("[role='option']");
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const count = await options.count().catch(() => 0);
      const matches: Locator[] = [];
      for (let index = 0; index < count; index += 1) {
        const option = options.nth(index);
        if (!(await option.isVisible().catch(() => false))) continue;
        const html = await option.evaluate((element) => element.outerHTML).catch(() => "");
        // The profile number in the option settles which "Alex Smith" it is.
        if (person.id && html.includes(person.id)) {
          await option.click();
          return true;
        }
        const text = (await option.innerText().catch(() => "")).split("\n")[0].trim();
        if (text.toLowerCase() === person.name.toLowerCase()) matches.push(option);
      }
      if (matches.length === 1) {
        await matches[0].click();
        return true;
      }
      if (matches.length > 1) throw new Error(`More than one "${person.name}" came up in Messenger, so nobody was added. Save their Facebook profile link in Contact Master instead of the name.`);
      await sleep(500);
    }
    return false;
  }

  private async openMembers(page: Page) {
    const info = await firstVisible([
      page.getByRole("button", { name: pattern("conversation (information|details)|chat info") }),
      page.locator("[aria-label*='onversation information'], [aria-label*='onversation details'], [aria-label*='hat info']"),
    ], 15_000);
    if (!info) throw new Error("Messenger's chat details didn't open.");
    if ((await info.getAttribute("aria-expanded")) !== "true") await info.click();
    const members = await firstVisible([page.getByRole("button", { name: pattern("^chat members") }), page.getByText(pattern("^chat members$"))], 8000);
    if (members && (await members.getAttribute("aria-expanded")) !== "true") await members.click();
    await sleep(800);
  }

  /** Each member's "Member settings for <name>" button in the chat's member list (shown once it has loaded). */
  private async memberButtons(page: Page) {
    const all = page.getByRole("button", { name: pattern("^member settings for ") });
    if (!(await firstVisible([all], 10_000))) throw new Error("Messenger's member list didn't open. Try again.");
    return all;
  }

  private async memberRow(page: Page, person: FacebookPerson) {
    await this.memberButtons(page);
    const own = page.getByRole("button", { name: `Member settings for ${person.name}`, exact: true });
    const count = await own.count();
    if (count > 1) throw new Error(`More than one "${person.name}" is in this Messenger group, so nobody was changed.`);
    return count === 1 ? own.first() : null;
  }

  // ---- The work -----------------------------------------------------------------------------

  async createGroup({ name, members = [] }: { name: string; members?: string[] }) {
    return this.session.run(async (page) => {
      const people: FacebookPerson[] = [];
      const included: string[] = [];
      for (const identity of members) {
        const found = await this.person(page, identity).catch(() => null);
        if (found && !people.some((entry) => (entry.id || entry.name) === (found.id || found.name))) {
          people.push(found);
          included.push(identity);
        }
        if (people.length >= 2) break;
      }
      // With one person Messenger opens a private chat, not a group.
      if (people.length < 2) throw new Error("Messenger makes a group chat with at least 2 people. Add 2 people who have a Facebook profile saved, then press Try again.");
      await page.goto(`${ORIGIN}/messages/new/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await sleep(2500);
      await this.checkBlockers(page);
      // Messenger's own "To:" box, never Facebook's search bar at the top of the page.
      const to = await firstVisible([
        page.locator("input[aria-label='Send message to']"),
        page.getByRole("combobox", { name: pattern("^(to|send message to)$") }),
      ], 20_000);
      if (!to) throw new Error("Messenger's new-message page didn't open.");
      for (const person of people) {
        if (!(await this.pick(page, to, person))) throw new Error(`${person.name} didn't come up in Messenger's search. You may need to be Facebook friends.`);
        await sleep(800);
      }
      // Both people must be in the "To:" line before anything is written.
      const chips = page.locator("[role='main'] [aria-label^='Remove']");
      for (const person of people) {
        if (!(await chips.evaluateAll((elements, wanted) => elements.some((element) => (element.getAttribute("aria-label") || "").toLowerCase().includes(wanted)), person.name.toLowerCase()))) {
          throw new Error(`${person.name} couldn't be picked in Messenger, so nothing was sent. Try again.`);
        }
      }
      // The new chat's message box ("Write to …"), and a Messenger group starts with its first message: the group's name.
      const compose = await firstVisible([page.locator("[role='main'] div[role='textbox'][contenteditable='true'][aria-label^='Write to']"), page.locator("[role='main'] div[role='textbox'][contenteditable='true']")], 15_000);
      if (!compose) throw new Error("Messenger's message box didn't show for the new group.");
      await this.type(page, compose, name);
      const deadline = Date.now() + 30_000;
      let thread = threadFromUrl(page.url());
      while (!thread && Date.now() < deadline) {
        await sleep(500);
        thread = threadFromUrl(page.url());
      }
      if (!thread) throw new Error("Messenger didn't open the new group.");
      await this.rename(page, name).catch(() => undefined);
      // The people picked when the group was made are in it already.
      return { ref: { ...thread, members: included.join("\n") } };
    });
  }

  /** Gives the group its name (Messenger: Customize chat → Change chat name). */
  private async rename(page: Page, name: string) {
    await this.openMembers(page).catch(() => undefined);
    const customize = await firstVisible([page.getByRole("button", { name: pattern("^customi[sz]e chat") })], 4000);
    if (customize && (await customize.getAttribute("aria-expanded")) !== "true") await customize.click();
    const change = await firstVisible([page.getByRole("button", { name: pattern("change chat name") }), page.getByText(pattern("^change chat name$"))], 4000);
    if (!change) return;
    await change.click();
    const input = await firstVisible([page.locator("[role='dialog'] input[type='text'], [role='dialog'] input:not([type])")], 6000);
    if (!input) return;
    await input.fill(name.slice(0, 100));
    const save = await firstVisible([page.locator("[role='dialog']").getByRole("button", { name: pattern("^save$") })], 4000);
    await save?.click();
    await sleep(1500);
  }

  async addMember(ref: Record<string, string>, identity: string): Promise<AddResult> {
    return this.session.run(async (page) => {
      const person = await this.person(page, identity);
      if (!person) return { state: "not-on-app", detail: "No Facebook profile found for this contact (or it isn't visible to you)." };
      await this.openThread(page, ref);
      await this.openMembers(page);
      // Checked in the real member list (they may have been removed since the group was made).
      if (await this.memberRow(page, person)) return { state: "added", detail: "In the group." };
      const add = await firstVisible([page.locator("[role='main'] [role='button'][aria-label='Add']"), page.getByRole("button", { name: pattern("^add people$") })], 8000);
      if (!add) throw new Error("Messenger's Add people button didn't show.");
      await add.click();
      const dialog = page.locator("[role='dialog']").filter({ hasText: pattern("add people") }).last();
      const search = await firstVisible([dialog.locator("input[aria-label='Search']"), dialog.locator("input[type='text']")], 10_000);
      if (!search) throw new Error("Messenger's Add people search didn't open.");
      await search.click();
      await search.fill("");
      await search.pressSequentially(person.name, { delay: 60 });
      // People show as tick boxes; the profile number settles which "Alex Smith" it is.
      let ticked = false;
      const deadline = Date.now() + 12_000;
      while (!ticked && Date.now() < deadline) {
        await sleep(700);
        const boxes = dialog.getByRole("checkbox");
        const count = await boxes.count().catch(() => 0);
        const byName: Locator[] = [];
        for (let index = 0; index < count; index += 1) {
          const box = boxes.nth(index);
          const html = await box.evaluate((element) => element.outerHTML).catch(() => "");
          if (person.id && html.includes(person.id)) {
            byName.splice(0, byName.length, box);
            break;
          }
          if ((await box.innerText().catch(() => "")).split("\n")[0].trim().toLowerCase() === person.name.toLowerCase()) byName.push(box);
        }
        if (byName.length > 1) {
          await page.keyboard.press("Escape").catch(() => undefined);
          return { state: "failed", detail: `More than one "${person.name}" came up in Messenger, so nobody was added. Save their Facebook profile link in Contact Master.` };
        }
        if (byName.length === 1) {
          if ((await byName[0].getAttribute("aria-checked")) !== "true") await byName[0].click();
          ticked = true;
        }
      }
      if (!ticked) {
        await page.keyboard.press("Escape").catch(() => undefined);
        return { state: "failed", detail: `${person.name} didn't come up in Messenger's Add people search. You may need to be Facebook friends.` };
      }
      const confirm = dialog.getByRole("button", { name: pattern("^add people$") });
      const ready = Date.now() + 6000;
      while (Date.now() < ready && (await confirm.getAttribute("aria-disabled").catch(() => "true")) === "true") await sleep(300);
      await confirm.click();
      // Added only when they show in the member list.
      const shown = Date.now() + 15_000;
      while (Date.now() < shown) {
        await sleep(1000);
        if (await this.memberRow(page, person).catch(() => null)) return { state: "added" };
      }
      return { state: "failed", detail: "Messenger didn't show them in the group after adding. Try again." };
    });
  }

  async removeMember(ref: Record<string, string>, identity: string) {
    await this.session.run(async (page) => {
      const person = await this.person(page, identity);
      if (!person) throw new Error("Their Facebook profile couldn't be found, so they weren't removed.");
      await this.openThread(page, ref);
      await this.openMembers(page);
      const settings = await this.memberRow(page, person);
      // The member list loaded and they aren't in it: nothing to remove.
      if (!settings) return;
      await settings.click();
      const remove = await firstVisible([page.getByRole("menuitem", { name: pattern("^remove (member|from group)$") })], 6000);
      if (!remove) {
        await page.keyboard.press("Escape").catch(() => undefined);
        throw new Error("Messenger didn't offer to remove them (only the group's admins can).");
      }
      await remove.click();
      const confirm = await firstVisible([page.locator("[role='dialog']").getByRole("button", { name: pattern("^remove") })], 6000);
      await confirm?.click();
      // Removed only when they're really gone from the member list.
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline) {
        await sleep(800);
        if (!(await this.memberRow(page, person).catch(() => settings))) return;
      }
      throw new Error("Messenger didn't confirm the removal. Try again.");
    });
  }

  async sendMessage(ref: Record<string, string>, text: string) {
    await this.session.run(async (page) => {
      await this.openThread(page, ref);
      for (const part of splitMessage(text, MESSAGE_LIMIT)) {
        await this.type(page, await this.messageBox(page), part);
      }
    });
  }
}
