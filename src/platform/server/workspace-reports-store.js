import { OPERATIONAL_ROLE_CATALOG } from "../access-catalog.js";
import { getPlatformSql } from "./auth-store.js";
import { publishingWorkspaceSnapshot } from "./publishing-central-store.js";

const RANGE_DAYS = new Set([7, 30, 90]);
const DAY_MS = 24 * 60 * 60 * 1000;
const FEED_LIMIT = 200;
const roleNames = new Map(OPERATIONAL_ROLE_CATALOG.map((role) => [role.id, role.name]));

const PLATFORM_LABELS = {
  instagram: "Instagram", facebook: "Facebook", youtube: "YouTube", linkedin: "LinkedIn",
  x: "X", twitter: "X", reddit: "Reddit", tiktok: "TikTok", telegram: "Telegram", threads: "Threads",
};
const platformLabel = (value) => PLATFORM_LABELS[String(value || "").toLowerCase()] || String(value || "social");
// "an Instagram post", "an X post", "a YouTube post".
const withArticle = (word) => `${/^([aeiou]|x)/i.test(word) ? "an" : "a"} ${word}`;

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function jobOutcome(status) {
  if (status === "success") return "completed";
  if (["failed", "error", "canceled", "cancelled", "reconnect_required"].includes(status)) return "failed";
  return "in_progress";
}

function emptyCounts() {
  return { postsCreated: 0, postsPublished: 0, postsFailed: 0, submissions: 0, scrapingRuns: 0, groupMessages: 0 };
}

// Activity report for one company workspace. Every member of the company may
// read it. It names who did what, but never includes post captions, message
// text, credentials or media.
export async function workspaceActivityReport(principal, { days } = {}) {
  const rangeDays = RANGE_DAYS.has(Number(days)) ? Number(days) : 30;
  const until = new Date();
  const since = new Date(until.getTime() - rangeDays * DAY_MS);
  const sinceMs = since.getTime();
  const workspaceId = principal.workspaceId;
  const sql = await getPlatformSql();

  // One connection is shared on Amplify: run these reads one after another.
  const members = await sql`
    SELECT u.id, u.name, u.email, u.status, membership.status AS membership_status,
           membership.approved_at, membership.created_at,
           (SELECT max(session.created_at) FROM platform_sessions session WHERE session.user_id = u.id) AS last_sign_in
      FROM workspace_memberships membership
      JOIN platform_users u ON u.id = membership.user_id
     WHERE membership.workspace_id = ${workspaceId}
     ORDER BY lower(u.name)`;
  const roles = await sql`
    SELECT user_id, role_id FROM user_role_assignments WHERE workspace_id = ${workspaceId}`;
  const jobs = await sql`
    SELECT id, job_type, platform, status, requested_by_user_id, created_at, completed_at
      FROM jobs
     WHERE workspace_id = ${workspaceId} AND job_type <> 'publish' AND created_at >= ${since.toISOString()}
     ORDER BY created_at DESC
     LIMIT 2000`;
  const messages = await sql`
    SELECT message.id, message.sent_by, message.sent_at, grp.name AS group_name
      FROM group_manager_messages message
      LEFT JOIN group_manager_groups grp ON grp.id = message.group_id
     WHERE message.workspace_id = ${workspaceId} AND message.sent_at >= ${since.toISOString()}
     ORDER BY message.sent_at DESC
     LIMIT 2000`;

  let publishing = { uploads: [], submissions: [] };
  let publishingUnavailable = false;
  try {
    publishing = await publishingWorkspaceSnapshot(workspaceId);
  } catch (error) {
    publishingUnavailable = true;
    console.error("Workspace report could not read publishing activity", error instanceof Error ? error.message : error);
  }

  const memberById = new Map(members.map((member) => [String(member.id), member]));
  const nameFor = (userId, fallback) => memberById.get(String(userId || ""))?.name || fallback || "Former member";
  const events = [];
  const push = (event) => {
    const at = iso(event.at);
    if (at && Date.parse(at) >= sinceMs) events.push({ ...event, at, userId: event.userId ? String(event.userId) : null });
  };

  for (const upload of publishing.uploads || []) {
    const platform = platformLabel(upload.platform);
    const actor = { userId: upload.createdByUserId, actorName: nameFor(upload.createdByUserId, upload.createdByName) };
    push({ ...actor, id: `${upload.id}:created`, at: upload.uploadedAt, product: "publishing", kind: "postsCreated",
      label: upload.scheduledAt ? `scheduled ${withArticle(platform)} post` : `created ${withArticle(platform)} post`, outcome: "in_progress" });
    if (upload.status === "posted" && upload.postedAt) {
      push({ ...actor, id: `${upload.id}:published`, at: upload.postedAt, product: "publishing", kind: "postsPublished",
        label: `had ${withArticle(platform)} post published`, outcome: "completed" });
    } else if (upload.status === "failed") {
      push({ ...actor, id: `${upload.id}:failed`, at: upload.updatedAt || upload.uploadedAt, product: "publishing", kind: "postsFailed",
        label: `had ${withArticle(platform)} post fail`, detail: String(upload.failureReason || "").slice(0, 160) || null, outcome: "failed" });
    }
  }
  for (const submission of publishing.submissions || []) {
    push({ id: `${submission.id}:submitted`, userId: submission.createdByUserId,
      actorName: nameFor(submission.createdByUserId, submission.createdByName), at: submission.createdAt,
      product: "publishing", kind: "submissions", label: "submitted content for scheduling",
      outcome: submission.status === "awaiting_schedule" ? "in_progress" : "completed" });
  }
  for (const job of jobs) {
    const platform = platformLabel(job.platform || String(job.job_type).split(".")[1]);
    push({ id: `job:${job.id}`, userId: job.requested_by_user_id, actorName: nameFor(job.requested_by_user_id),
      at: job.created_at, product: "scraping", kind: "scrapingRuns", label: `ran ${withArticle(platform)} research scan`,
      outcome: jobOutcome(job.status) });
  }
  for (const message of messages) {
    push({ id: `message:${message.id}`, userId: message.sent_by, actorName: nameFor(message.sent_by),
      at: message.sent_at, product: "groups", kind: "groupMessages",
      label: message.group_name ? `sent a message to ${message.group_name}` : "sent a group message", outcome: "completed" });
  }
  for (const member of members) {
    push({ id: `joined:${member.id}`, userId: member.id, actorName: member.name, at: member.approved_at || member.created_at,
      product: "team", kind: "joined", label: "joined the company", outcome: "completed" });
  }
  events.sort((left, right) => right.at.localeCompare(left.at));

  // Per-person totals.
  const people = new Map(members.map((member) => [String(member.id), {
    id: String(member.id),
    name: member.name,
    email: member.email,
    status: member.membership_status === "active" && member.status === "active" ? "active" : "suspended",
    roles: roles.filter((row) => String(row.user_id) === String(member.id)).map((row) => roleNames.get(row.role_id) || row.role_id),
    lastSignIn: iso(member.last_sign_in),
    lastActivity: null,
    ...emptyCounts(),
  }]));
  for (const event of events) {
    if (event.kind === "joined") continue;
    const key = event.userId && people.has(event.userId) ? event.userId : `former:${event.actorName}`;
    if (!people.has(key)) {
      people.set(key, { id: key, name: event.actorName, email: "", status: "former", roles: [], lastSignIn: null, lastActivity: null, ...emptyCounts() });
    }
    const person = people.get(key);
    person[event.kind] += 1;
    if (!person.lastActivity || event.at > person.lastActivity) person.lastActivity = event.at;
  }

  // Actions per day (everything except joining), oldest first.
  const daily = [];
  const startDay = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));
  for (let time = startDay.getTime(); time <= until.getTime(); time += DAY_MS) {
    daily.push({ date: new Date(time).toISOString().slice(0, 10), actions: 0 });
  }
  const dayIndex = new Map(daily.map((day, index) => [day.date, index]));
  for (const event of events) {
    if (event.kind === "joined") continue;
    const index = dayIndex.get(event.at.slice(0, 10));
    if (index !== undefined) daily[index].actions += 1;
  }

  const peopleList = [...people.values()].sort((left, right) =>
    (right.lastActivity || "").localeCompare(left.lastActivity || "") || String(left.name).localeCompare(String(right.name)));
  const totals = peopleList.reduce((sum, person) => {
    for (const key of Object.keys(emptyCounts())) sum[key] += person[key];
    return sum;
  }, emptyCounts());
  totals.activeMembers = peopleList.filter((person) => person.lastActivity).length;
  totals.members = members.length;
  totals.postsWaiting = (publishing.uploads || []).filter((upload) => upload.status === "queued").length;

  return {
    workspaceName: principal.businessName,
    rangeDays,
    since: since.toISOString(),
    until: until.toISOString(),
    totals,
    daily,
    people: peopleList,
    events: events.slice(0, FEED_LIMIT),
    eventCount: events.length,
    publishingUnavailable,
  };
}
