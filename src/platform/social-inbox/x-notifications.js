// Reads X's notifications data (the graphql NotificationsTimeline response
// x.com/notifications/mentions loads while signed in) into inbox items:
// replies to your posts, mentions and quotes. Likes, follows and reposts need
// no answer and are left out.

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const ANSWERABLE = /repl|mention|quote/i;

// A post may arrive wrapped ("TweetWithVisibilityResults").
const unwrap = (result) => (result?.tweet && !result.legacy ? result.tweet : result);

function entriesOf(body) {
  const timeline = body?.data?.viewer_v2?.user_results?.result?.notification_timeline?.timeline
    || body?.data?.viewer?.timeline_response?.timeline
    || body?.data?.notification_timeline?.timeline;
  const instructions = Array.isArray(timeline?.instructions) ? timeline.instructions : [];
  return instructions.flatMap((instruction) => instruction?.entries || (instruction?.entry ? [instruction.entry] : []));
}

/** "@testingka07 thanks" → "thanks" (the leading @names are who it's addressed to). */
export function withoutLeadingMentions(text) {
  return clean(text).replace(/^(?:@\w{1,15}\s+)+/, "") || clean(text);
}

/** Inbox items from a NotificationsTimeline response. */
export function xItemsFromNotifications(body) {
  const items = [];
  const seen = new Set();
  for (const entry of entriesOf(body)) {
    const content = entry?.content;
    const element = String(content?.clientEventInfo?.element || "");
    const tweet = unwrap(content?.itemContent?.tweet_results?.result);
    if (!tweet?.rest_id || !tweet.legacy) continue;
    // Mentions-tab entries are posts that mention you; on "All" only replies/mentions/quotes count.
    if (element && !ANSWERABLE.test(element)) continue;
    if (seen.has(tweet.rest_id)) continue;
    seen.add(tweet.rest_id);
    const user = tweet.core?.user_results?.result;
    const handle = clean(user?.core?.screen_name || user?.legacy?.screen_name);
    const name = clean(user?.core?.name || user?.legacy?.name) || (handle ? `@${handle}` : "X user");
    const text = clean(tweet.note_tweet?.note_tweet_results?.result?.text || tweet.legacy.full_text);
    if (!text) continue;
    const reply = Boolean(tweet.legacy.in_reply_to_status_id_str) || /repl/i.test(element);
    const quote = /quote/i.test(element) || Boolean(tweet.legacy.is_quote_status);
    const created = Date.parse(tweet.legacy.created_at || "");
    items.push({
      platform: "x",
      kind: reply ? "reply" : "mention",
      externalId: `x:${tweet.rest_id}`,
      authorName: handle ? `${name} (@${handle})` : name,
      authorUrl: handle ? `https://x.com/${handle}` : "",
      body: withoutLeadingMentions(text).slice(0, 4000),
      contextText: reply ? "Reply to your post" : quote ? "Quoted your post" : "Mentioned you",
      permalink: handle ? `https://x.com/${handle}/status/${tweet.rest_id}` : `https://x.com/i/web/status/${tweet.rest_id}`,
      receivedAt: Number.isFinite(created) ? new Date(created).toISOString() : null,
    });
  }
  return items;
}
