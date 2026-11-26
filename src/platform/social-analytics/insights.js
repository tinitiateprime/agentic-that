// Plain-language takeaways for the Social Manager dashboard, worked out from
// the numbers already on the page. Each one is a short sentence a busy owner
// can act on; nothing is said unless there are enough posts behind it.

const MIN_GROUP = 2; // posts a group needs before we compare it
const MIN_RATIO = 1.3; // a difference smaller than 30% is not worth saying

const pct = (now, before) => (before ? Math.round(((now - before) / before) * 100) : null);
const round1 = (value) => Math.round(value * 10) / 10;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

function averageRate(posts) {
  const rated = posts.filter((post) => post.engagementRate !== null && post.engagementRate !== undefined);
  return rated.length ? rated.reduce((sum, post) => sum + post.engagementRate, 0) / rated.length : null;
}

// Groups posts by a key and returns the best and worst groups by average
// engagement rate, when the gap between them is big enough to mention.
function bestVersusWorst(posts, keyOf) {
  const groups = new Map();
  for (const post of posts) {
    const key = keyOf(post);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(post);
  }
  const ranked = [...groups.entries()]
    .filter(([, list]) => list.length >= MIN_GROUP)
    .map(([key, list]) => ({ key, posts: list.length, rate: averageRate(list) }))
    .filter((group) => group.rate !== null)
    .sort((a, b) => b.rate - a.rate);
  if (ranked.length < 2) return null;
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  if (worst.rate <= 0) return best.rate > 0 ? { best, worst, ratio: null } : null;
  const ratio = best.rate / worst.rate;
  return ratio >= MIN_RATIO ? { best, worst, ratio } : null;
}

const times = (ratio) => (ratio === null ? "far more" : ratio >= 2 ? `${round1(ratio)}× the` : `${Math.round((ratio - 1) * 100)}% more`);

/**
 * @param {{ posts: any[], totals: any, previous: any|null, bestSlots: any[] }} report
 * @returns {{ id: string, tone: "good"|"bad"|"tip", text: string }[]}
 */
export function buildInsights({ posts = [], totals, previous = null, bestSlots = [] }) {
  const insights = [];
  if (!posts.length) return insights;
  if (!totals.engagement) {
    return [{ id: "no-engagement", tone: "tip", text: "None of these posts show likes, comments, shares or saves, so there is nothing to compare yet. If that looks wrong, export again with those columns included (in YouTube Studio, add Likes and Comments to the table before downloading)." }];
  }

  // 1. Better or worse than the period before?
  if (previous && previous.posts > 0) {
    const change = pct(totals.engagement, previous.engagement);
    if (change !== null && Math.abs(change) >= 10) {
      insights.push(change > 0
        ? { id: "trend", tone: "good", text: `Engagement is up ${change}% on the period before. Keep doing what you did.` }
        : { id: "trend", tone: "bad", text: `Engagement is down ${Math.abs(change)}% on the period before. The tips below can help win it back.` });
    }
    const postGap = totals.posts - previous.posts;
    if (postGap <= -2 && change !== null && change < 0) {
      insights.push({ id: "frequency", tone: "tip", text: `You posted ${plural(Math.abs(postGap), "time")} fewer than the period before (${totals.posts} vs ${previous.posts}). Posting more often is the quickest way back.` });
    }
  }

  // 2. Which kind of post works best?
  const byType = bestVersusWorst(posts, (post) => (post.type || "").trim());
  if (byType) {
    insights.push({ id: "type", tone: "tip", text: `${byType.best.key} posts get ${times(byType.ratio)} engagement rate of ${byType.worst.key} posts (${byType.best.posts} vs ${byType.worst.posts} posts). Make more ${byType.best.key} posts.` });
  }

  // 3. Which platform gives the most back?
  const byPlatform = bestVersusWorst(posts, (post) => post.platformLabel);
  if (byPlatform) {
    insights.push({ id: "platform", tone: "tip", text: `Your audience is most active on ${byPlatform.best.key}: ${round1(byPlatform.best.rate)}% engagement rate, against ${round1(byPlatform.worst.rate)}% on ${byPlatform.worst.key}.` });
  }

  // 4. When to post.
  const slot = bestSlots[0];
  if (slot && slot.averageRate > 0) {
    insights.push({ id: "time", tone: "tip", text: `Post on ${slot.weekday} ${slot.daypart.toLowerCase()}: posts published then averaged ${slot.averageRate}% engagement.` });
  }

  // 5. Short or long captions?
  const withText = posts.filter((post) => (post.text || "").trim());
  const byLength = bestVersusWorst(withText, (post) => ((post.text || "").trim().length <= 100 ? "Short captions (up to 100 characters)" : "Longer captions"));
  if (byLength) {
    insights.push({ id: "caption", tone: "tip", text: `${byLength.best.key} do better: ${round1(byLength.best.rate)}% engagement rate, against ${round1(byLength.worst.rate)}% for ${byLength.worst.key.toLowerCase()}.` });
  }

  // 6. The standout post.
  if (posts.length >= 3 && totals.engagement > 0) {
    const top = posts.reduce((best, post) => (post.engagement > best.engagement ? post : best), posts[0]);
    const averageEngagement = totals.engagement / posts.length;
    const ratio = top.engagement / averageEngagement;
    if (ratio >= 2) {
      const snippet = (top.text || "").trim().replace(/\s+/g, " ");
      const name = snippet ? `"${snippet.length > 60 ? `${snippet.slice(0, 57)}…` : snippet}"` : `Your ${top.platformLabel} post`;
      insights.push({ id: "standout", tone: "good", text: `${name} got ${round1(ratio)}× your average engagement. Try a follow-up on the same topic.` });
    }
  }

  return insights.slice(0, 5);
}
