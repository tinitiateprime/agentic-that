// Reads LinkedIn notification data into inbox items: comments on your posts,
// replies to your comments, and mentions. It works for a member's own
// notifications (voyagerIdentityDashNotificationCards) and for a Page's admin
// Activity (graphql organizationDashNotificationCardsByNotifications); both
// send the same notification cards. Reactions, reposts, visitors and
// "Suggested for you" are left out; they need no answer.
import crypto from "node:crypto";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const joined = (texts) => clean((Array.isArray(texts) ? texts : []).map((text) => text?.text || "").join(" "));

// "Thanusree Gajendran commented on your company's update" → who + what.
const HEADLINE = /^(.+?)\s+(commented on|replied to|mentioned your company|mentioned you|mentioned)\b/i;

/** "/p1-route/web-view?url=https%3A%2F%2Fwww.linkedin.com%2Ffeed%2F…" → the LinkedIn address inside. */
export function linkedinTarget(actionTarget) {
  const raw = String(actionTarget || "");
  let url = raw;
  const wrapped = /[?&]url=([^&]+)/.exec(raw);
  if (wrapped) {
    try { url = decodeURIComponent(wrapped[1]); } catch { url = ""; }
  }
  if (url.startsWith("/")) url = `https://www.linkedin.com${url}`;
  return /^https:\/\/(www\.)?linkedin\.com\//.test(url) ? url : "";
}

function cardKind(card) {
  return /\(([A-Z_]+),/.exec(card?.entityUrn || "")?.[1] || "";
}

// Only these card types can need an answer. The headline alone isn't enough:
// a "Suggested for you" post can contain the word "mentioned".
const ANSWERABLE = /COMMENT|REPL|MENTION/;
const fingerprint = (...parts) => crypto.createHash("sha1").update(parts.join("\n")).digest("hex").slice(0, 16);

/**
 * Inbox items from a notifications response (a member's own, or a Page's).
 * @param {object} body the voyager response
 * @param {{ pageName?: string }} options pageName when it is a Page's Activity
 */
export function linkedinItemsFromNotifications(body, { pageName = "" } = {}) {
  const cards = (Array.isArray(body?.included) ? body.included : [])
    .filter((item) => /notifications\.Card$/.test(item?.$type || ""));
  const items = [];
  for (const card of cards) {
    const headline = clean(card.headline?.text);
    const match = HEADLINE.exec(headline);
    if (!match) continue;
    const verb = match[2].toLowerCase();
    const kindCode = cardKind(card);
    if (!ANSWERABLE.test(kindCode)) continue;
    const isComment = verb.startsWith("commented") || kindCode === "COMMENT";
    const isReply = verb.startsWith("replied");
    const isMention = verb.startsWith("mentioned");
    if (!isComment && !isReply && !isMention) continue;
    // A comment's own words; for a mention, the post that mentions the Page.
    const said = joined(card.contentPrimaryText);
    const post = joined(card.contentSecondaryText);
    const body = said || (isMention ? post : "");
    const objectUrn = clean(card.objectUrn);
    if (!body || !objectUrn) continue;
    const link = linkedinTarget(card.cardAction?.actionTarget || card.actions?.[0]?.actionTarget);
    const author = linkedinTarget(card.headerImage?.actionTarget);
    items.push({
      platform: "linkedin",
      kind: isMention ? "mention" : isReply ? "reply" : "comment",
      // A member's notification is per post, not per comment ("X and 2 others
      // commented"), so the author and words keep each comment apart.
      externalId: `li:${objectUrn.slice(0, 240)}:${fingerprint(match[1], body)}`,
      authorName: clean(match[1]).slice(0, 200),
      authorUrl: author,
      body: body.slice(0, 4000),
      contextText: (isMention ? (pageName ? `Mentions ${pageName}` : "Mentions you") : post).slice(0, 500),
      permalink: link,
      receivedAt: Number.isFinite(card.publishedAt) ? new Date(card.publishedAt).toISOString() : null,
    });
  }
  return items;
}

/** Pages this member administers, from the links on their LinkedIn feed ("/company/117884053/admin/"). */
export function adminPagesFromLinks(links) {
  const pages = new Map();
  for (const { href, text } of links || []) {
    const id = /linkedin\.com\/company\/(\d+)\/admin\/?(?:$|[?#])/.exec(String(href || ""))?.[1] || /^\/company\/(\d+)\/admin\/?$/.exec(String(href || ""))?.[1];
    const name = clean(text);
    if (id && name && !pages.has(id)) pages.set(id, { id, name });
  }
  return [...pages.values()];
}

/** The same as linkedinItemsFromNotifications, for a Page's Activity. */
export const linkedinItemsFromPageActivity = (body, options) => linkedinItemsFromNotifications(body, options);
