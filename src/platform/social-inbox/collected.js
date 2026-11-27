// Checks on what a Companion reports back for the inbox.

export function versionAtLeast(current, minimum) {
  const parts = (value) => String(value || "").split(/[-+]/)[0].split(".").map(Number);
  const [a, b] = [parts(current), parts(minimum)];
  if (a.length !== 3 || a.some(Number.isNaN)) return false;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index];
  }
  return true;
}

// What each platform's Companion reader may report: the id it uses and the
// only site its links may point to.
const RULES = {
  youtube: { id: /^yt:[\w-]{10,100}$/, site: /^https:\/\/(www\.)?youtube\.com\//, fallbackName: "YouTube viewer" },
  linkedin: { id: /^li:urn:li:[\w:(),.-]{5,240}:[0-9a-f]{16}$/, site: /^https:\/\/(www\.)?linkedin\.com\//, fallbackName: "LinkedIn member" },
  x: { id: /^x:\d{5,30}$/, site: /^https:\/\/(x|twitter)\.com\//, fallbackName: "X user" },
};
const KINDS = new Set(["comment", "reply", "mention", "message"]);

/** Only well-formed items for the job's platform reach the inbox. */
export function cleanCollectedItems(result, platform = "youtube") {
  const rule = RULES[platform];
  if (!rule) return [];
  const items = Array.isArray(result?.items) ? result.items : [];
  const text = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return items.flatMap((item) => {
    const externalId = text(item?.externalId, 300);
    const permalink = text(item?.permalink, 1000);
    const body = text(item?.body, 4000);
    if (!rule.id.test(externalId) || !body) return [];
    const authorUrl = text(item?.authorUrl, 1000);
    const receivedAt = item?.receivedAt && Number.isFinite(Date.parse(item.receivedAt)) ? new Date(item.receivedAt).toISOString() : null;
    return [{
      platform,
      kind: KINDS.has(item?.kind) ? item.kind : "comment",
      externalId,
      authorName: text(item?.authorName, 200) || rule.fallbackName,
      authorUrl: rule.site.test(authorUrl) ? authorUrl : "",
      body,
      contextText: text(item?.contextText, 500),
      permalink: rule.site.test(permalink) ? permalink : "",
      receivedAt,
    }];
  });
}

/** The Companion version that can collect each platform's inbox. */
export const INBOX_VERSIONS = { youtube: "2.9.0", linkedin: "2.10.0", x: "2.11.0" };
