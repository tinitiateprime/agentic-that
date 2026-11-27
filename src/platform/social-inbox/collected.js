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

/** Only well-formed YouTube comments from a Companion result reach the inbox. */
export function cleanCollectedItems(result) {
  const items = Array.isArray(result?.items) ? result.items : [];
  const text = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return items.flatMap((item) => {
    const externalId = text(item?.externalId, 120);
    const permalink = text(item?.permalink, 1000);
    const body = text(item?.body, 4000);
    if (!/^yt:[\w-]{10,100}$/.test(externalId) || !body) return [];
    const authorUrl = text(item?.authorUrl, 1000);
    const receivedAt = item?.receivedAt && Number.isFinite(Date.parse(item.receivedAt)) ? new Date(item.receivedAt).toISOString() : null;
    return [{
      platform: "youtube",
      kind: "comment",
      externalId,
      authorName: text(item?.authorName, 200) || "YouTube viewer",
      authorUrl: /^https:\/\/(www\.)?youtube\.com\//.test(authorUrl) ? authorUrl : "",
      body,
      contextText: text(item?.contextText, 500),
      permalink: /^https:\/\/(www\.)?youtube\.com\//.test(permalink) ? permalink : "",
      receivedAt,
    }];
  });
}
