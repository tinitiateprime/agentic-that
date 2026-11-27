// Social Manager → Inbox: the work queue of comments and messages, who it's
// assigned to, snoozes, done, and the company's saved replies.
import crypto from "node:crypto";
import { inboxView, snoozeUntil } from "../social-inbox/from-scrape.js";
import { getPlatformSql } from "./auth-store.js";

const LABELS = { instagram: "Instagram", facebook: "Facebook", youtube: "YouTube", linkedin: "LinkedIn", x: "X" };
const iso = (value) => (value ? new Date(value).toISOString() : null);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

// Until the inbox migration is applied, Social Manager works as before.
export const inboxTableMissing = (error) => error?.code === "42P01";

/** Adds new items; items already in the inbox keep their status, assignee and note. */
export async function addInboxItems(workspaceId, items, source) {
  if (!items.length) return { added: 0 };
  const sql = await getPlatformSql();
  let added = 0;
  for (const item of items) {
    const rows = await sql`
      INSERT INTO public.social_inbox_items
        (id, workspace_id, platform, kind, external_id, author_name, author_url, body, context_text, permalink, received_at, source)
      VALUES
        (${`inbox_${crypto.randomUUID()}`}, ${workspaceId}, ${item.platform}, ${item.kind}, ${item.externalId.slice(0, 300)},
         ${item.authorName.slice(0, 200)}, ${item.authorUrl.slice(0, 1000)}, ${item.body}, ${item.contextText}, ${item.permalink.slice(0, 1000)},
         ${item.receivedAt || new Date().toISOString()}, ${String(source).slice(0, 100)})
      ON CONFLICT (workspace_id, platform, external_id) DO NOTHING
      RETURNING id`;
    added += rows.length;
  }
  return { added };
}

function publicItem(row, userId) {
  const item = {
    id: row.id,
    platform: row.platform,
    platformLabel: LABELS[row.platform] || row.platform,
    kind: row.kind,
    authorName: row.author_name,
    authorUrl: row.author_url,
    body: row.body,
    contextText: row.context_text,
    permalink: row.permalink,
    receivedAt: iso(row.received_at),
    status: row.status,
    assignedTo: row.assigned_to || null,
    assignedName: row.assigned_name || "",
    snoozedUntil: iso(row.snoozed_until),
    note: row.note,
    doneByName: row.done_by_name || "",
    doneAt: iso(row.done_at),
  };
  return { ...item, view: inboxView(item, userId) };
}

/** Everything the Inbox tab shows: items, counts, teammates and saved replies. */
export async function inboxOverview(principal) {
  const sql = await getPlatformSql();
  const workspaceId = principal.workspaceId;
  const rows = await sql`
    SELECT i.*, a.name AS assigned_name, d.name AS done_by_name
      FROM public.social_inbox_items i
      LEFT JOIN platform_users a ON a.id = i.assigned_to
      LEFT JOIN platform_users d ON d.id = i.done_by
     WHERE i.workspace_id = ${workspaceId}
       AND (i.status = 'open' OR i.done_at > now() - interval '30 days')
     ORDER BY i.received_at DESC NULLS LAST
     LIMIT 1000`;
  const members = await sql`
    SELECT u.id, u.name, u.email
      FROM workspace_memberships m JOIN platform_users u ON u.id = m.user_id
     WHERE m.workspace_id = ${workspaceId} AND m.status = 'active'
     ORDER BY lower(u.name)`;
  const replies = await sql`
    SELECT id, title, body FROM public.social_inbox_saved_replies
     WHERE workspace_id = ${workspaceId} ORDER BY lower(title)`;
  const items = rows.map((row) => publicItem(row, principal.userId));
  const counts = { open: 0, mine: 0, snoozed: 0, done: 0 };
  for (const item of items) {
    counts[item.view] += 1;
    if (item.view === "mine") counts.open += 1; // "Needs reply" includes your own
  }
  return {
    userId: principal.userId,
    items,
    counts,
    members: members.map((member) => ({ id: member.id, name: member.name || member.email })),
    savedReplies: replies,
  };
}

async function requireItem(sql, workspaceId, id) {
  const [row] = await sql`SELECT id FROM public.social_inbox_items WHERE id = ${String(id)} AND workspace_id = ${workspaceId}`;
  if (!row) throw fail("That conversation was not found.", 404);
}

/** done | reopen | assign | snooze | unsnooze | note */
export async function updateInboxItem(principal, { id, action, assigneeId, snooze, timezoneOffsetMinutes, note }) {
  const sql = await getPlatformSql();
  const workspaceId = principal.workspaceId;
  await requireItem(sql, workspaceId, id);
  if (action === "done") {
    await sql`UPDATE public.social_inbox_items SET status = 'done', done_by = ${principal.userId}, done_at = now(), snoozed_until = NULL, updated_at = now() WHERE id = ${id}`;
  } else if (action === "reopen") {
    await sql`UPDATE public.social_inbox_items SET status = 'open', done_by = NULL, done_at = NULL, updated_at = now() WHERE id = ${id}`;
  } else if (action === "assign") {
    let assignee = null;
    if (assigneeId) {
      const [member] = await sql`SELECT user_id FROM workspace_memberships WHERE user_id = ${String(assigneeId)} AND workspace_id = ${workspaceId} AND status = 'active'`;
      if (!member) throw fail("Choose someone in this company.");
      assignee = member.user_id;
    }
    await sql`UPDATE public.social_inbox_items SET assigned_to = ${assignee}, updated_at = now() WHERE id = ${id}`;
  } else if (action === "snooze") {
    const until = snoozeUntil(snooze, new Date(), Math.max(-840, Math.min(840, Number(timezoneOffsetMinutes) || 0)));
    if (!until) throw fail("Choose how long to snooze it.");
    await sql`UPDATE public.social_inbox_items SET snoozed_until = ${until.toISOString()}, updated_at = now() WHERE id = ${id}`;
  } else if (action === "unsnooze") {
    await sql`UPDATE public.social_inbox_items SET snoozed_until = NULL, updated_at = now() WHERE id = ${id}`;
  } else if (action === "note") {
    await sql`UPDATE public.social_inbox_items SET note = ${String(note || "").slice(0, 2000)}, updated_at = now() WHERE id = ${id}`;
  } else {
    throw fail("That action isn't available.");
  }
  return inboxOverview(principal);
}

/** Adds, changes or removes a saved reply. */
export async function saveReply(principal, { id, title, body, remove = false }) {
  const sql = await getPlatformSql();
  const workspaceId = principal.workspaceId;
  if (remove) {
    await sql`DELETE FROM public.social_inbox_saved_replies WHERE id = ${String(id)} AND workspace_id = ${workspaceId}`;
    return inboxOverview(principal);
  }
  const cleanTitle = String(title || "").trim().slice(0, 120);
  const cleanBody = String(body || "").trim().slice(0, 4000);
  if (!cleanTitle || !cleanBody) throw fail("Give the saved reply a name and some text.");
  if (id) {
    await sql`UPDATE public.social_inbox_saved_replies SET title = ${cleanTitle}, body = ${cleanBody}, updated_at = now() WHERE id = ${String(id)} AND workspace_id = ${workspaceId}`;
  } else {
    await sql`
      INSERT INTO public.social_inbox_saved_replies (id, workspace_id, title, body, created_by)
      VALUES (${`reply_${crypto.randomUUID()}`}, ${workspaceId}, ${cleanTitle}, ${cleanBody}, ${principal.userId || null})`;
  }
  return inboxOverview(principal);
}
