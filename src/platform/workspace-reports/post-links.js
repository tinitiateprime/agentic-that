// "Open post" links for the Reports page. Publishing doesn't record where a
// post ended up on the platform, but Social Manager knows the company's posts
// with their real links (from automatic updates and exports). A published
// post is matched to the same post there by platform, caption and date. A
// LinkedIn Page post with no match opens that Page. Otherwise there is no
// link: the company's page on a platform is not necessarily the account the
// post went out on, so it is never offered in its place.

const normal = (value) => String(value || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
const DAY = 86400000;

/** https://www.linkedin.com/company/tinitiate-ai/admin/… → https://www.linkedin.com/company/tinitiate-ai/ */
export function linkedinPublicPage(target) {
  const match = /^https:\/\/(?:www\.)?linkedin\.com\/company\/([^/?#]+)/i.exec(String(target?.pageUrl || target?.pagePostsUrl || ""));
  return match ? `https://www.linkedin.com/company/${match[1]}/` : "";
}

/** Two captions are the same post when the shorter one's opening words match the other's. */
export function sameText(left, right) {
  const a = normal(left);
  const b = normal(right);
  if (a.length < 12 || b.length < 12) return false;
  const length = Math.min(60, a.length, b.length);
  return a.slice(0, length) === b.slice(0, length);
}

/**
 * Adds `link` and `linkKind` ("post" | "profile" | "") to each published post.
 * @param {object[]} posts the report's posts ({ platform, state, title, caption, publishedAt, linkedinPage })
 * @param {{ analyticsPosts?: object[] }} known
 *   analyticsPosts: Social Manager posts ({ platform, permalink, text, publishedAt })
 */
export function attachPostLinks(posts, { analyticsPosts = [] } = {}) {
  const byPlatform = new Map();
  for (const candidate of analyticsPosts) {
    if (!/^https:\/\//.test(String(candidate.permalink || ""))) continue;
    const list = byPlatform.get(candidate.platform) || [];
    list.push(candidate);
    byPlatform.set(candidate.platform, list);
  }
  return posts.map((post) => {
    if (post.state !== "published") return { ...post, link: "", linkKind: "" };
    const published = Date.parse(post.publishedAt || "");
    const match = (byPlatform.get(post.platform) || [])
      .filter((candidate) => sameText(post.caption, candidate.text) || (post.title && sameText(post.title, candidate.text)))
      .map((candidate) => ({ candidate, gap: Number.isFinite(published) && candidate.publishedAt ? Math.abs(Date.parse(candidate.publishedAt) - published) : DAY }))
      .filter(({ gap }) => gap <= 3 * DAY)
      .sort((left, right) => left.gap - right.gap)[0];
    if (match) return { ...post, link: match.candidate.permalink, linkKind: "post" };
    // The LinkedIn Page the post itself was published to.
    const page = post.platform === "linkedin" && /^https:\/\//.test(post.linkedinPage || "") ? post.linkedinPage : "";
    return { ...post, link: page, linkKind: page ? "profile" : "" };
  });
}
