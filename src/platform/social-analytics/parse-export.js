// Reads the analytics files social platforms let their users export and turns
// them into one shape: a post with its text, link, time and numbers.
//   Instagram / Facebook: Meta Business Suite → Insights → Content → Export (CSV)
//   YouTube: YouTube Studio → Analytics → Advanced mode → Export (CSV, or the zip)
//   LinkedIn: Page → Analytics → Content → Export (XLSX)
//   X: Analytics → Content → Export data (CSV)
// Column names differ between platforms and change over time, so each value is
// found by a list of known names.
import JSZip from "jszip";

export const ANALYTICS_PLATFORMS = ["instagram", "facebook", "youtube", "linkedin", "x"];
export const METRICS = ["views", "reach", "impressions", "likes", "comments", "shares", "saves", "clicks", "follows", "watchHours"];

const COLUMNS = {
  id: ["post id", "tweet id", "content", "video id", "media id"],
  permalink: ["permalink", "post link", "tweet permalink", "update link", "link", "url", "post url"],
  text: ["description", "post text", "tweet text", "update title", "title", "video title", "caption", "message", "post", "content title"],
  published: ["publish time", "published", "video publish time", "created date", "date", "time", "posted", "post date", "publish date", "created"],
  type: ["post type", "content type", "type", "media type"],
  account: ["account username", "account name", "page name", "account", "channel"],
  views: ["views", "video views", "plays", "video plays", "total plays", "reels plays", "3-second video views", "video views (3-second)", "engaged views"],
  reach: ["reach", "accounts reached", "unique impressions", "post reach", "people reached", "lifetime post total reach"],
  impressions: ["impressions", "thumbnail impressions", "post impressions", "lifetime post total impressions"],
  likes: ["likes", "reactions", "like", "total reactions", "likes and reactions", "post reactions"],
  comments: ["comments", "replies", "comment"],
  shares: ["shares", "reposts", "retweets", "repost", "share"],
  saves: ["saves", "bookmarks", "save"],
  clicks: ["clicks", "link clicks", "url clicks", "total clicks", "post clicks"],
  follows: ["follows", "new follows", "subscribers", "subscribers gained", "follows gained", "page follows", "profile follows", "followers gained"],
  watchHours: ["watch time (hours)", "watch time hours"],
};

const clean = (value) => String(value ?? "").replace(/^﻿/, "").trim();
// "Impressions (organic)", "Clicks (total)" → "impressions", "clicks": LinkedIn
// and Meta label the same number with these suffixes. Units such as
// "(hours)" stay, since they change what the number means.
const normal = (value) => clean(value).toLowerCase().replace(/\s+/g, " ").replace(/\s*\((organic|total|lifetime)\)$/, "");

/** Splits CSV text into rows, handling quotes, commas and line breaks inside quotes. */
export function parseCsv(text) {
  const source = String(text || "").replace(/^﻿/, "");
  // Some exports use semicolons or tabs.
  const firstLine = source.split(/\r?\n/, 1)[0] || "";
  const delimiter = [",", ";", "\t"].map((mark) => [mark, firstLine.split(mark).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === "\"" && source[index + 1] === "\"") { cell += "\""; index += 1; }
      else if (char === "\"") quoted = false;
      else cell += char;
    } else if (char === "\"") quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((entry) => entry.some((value) => clean(value)));
}

const decodeXml = (value) => String(value)
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
  .replace(/&amp;/g, "&");

const columnIndex = (reference) => {
  const letters = /^[A-Z]+/.exec(reference)?.[0] || "A";
  return [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1;
};

/** Every sheet of an .xlsx workbook as rows of cell text, in workbook order. */
export async function parseXlsx(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const sharedXml = await zip.file("xl/sharedStrings.xml")?.async("string") || "";
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => decodeXml([...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((part) => part[1]).join("")));
  const sheetFiles = Object.keys(zip.files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)[1]) - Number(/(\d+)\.xml$/.exec(b)[1]));
  const sheets = [];
  for (const name of sheetFiles) {
    const xml = await zip.file(name).async("string");
    const rows = [];
    for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const cellMatch of rowMatch[1].matchAll(/<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attributes = cellMatch[1];
        const body = cellMatch[2] || "";
        const reference = /r="([A-Z]+)\d+"/.exec(attributes)?.[1] || "";
        const type = /t="([^"]+)"/.exec(attributes)?.[1] || "";
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
        const inline = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((part) => part[1]).join("");
        const value = type === "s" ? shared[Number(raw)] ?? "" : type === "inlineStr" ? decodeXml(inline) : decodeXml(raw);
        const index = reference ? columnIndex(reference) : row.length;
        while (row.length < index) row.push("");
        row[index] = value;
      }
      if (row.some((value) => clean(value))) rows.push(row);
    }
    sheets.push(rows);
  }
  return sheets;
}

/** Which column holds each field, from a header row. */
function mapHeader(header) {
  const names = header.map(normal);
  const found = {};
  for (const [field, candidates] of Object.entries(COLUMNS)) {
    for (const candidate of candidates) {
      const index = names.findIndex((name, position) => name === candidate && !Object.values(found).includes(position));
      if (index >= 0) { found[field] = index; break; }
    }
  }
  return found;
}

/** The header row (the first of the first rows naming several known columns) and its columns. */
function findTable(rows) {
  let best = null;
  for (let index = 0; index < Math.min(rows.length, 6); index += 1) {
    const columns = mapHeader(rows[index]);
    const metricCount = METRICS.filter((metric) => metric in columns).length;
    const score = metricCount * 2 + ("text" in columns || "permalink" in columns || "id" in columns ? 2 : 0) + ("published" in columns ? 1 : 0);
    if (metricCount >= 1 && (!best || score > best.score)) best = { index, columns, score };
  }
  return best;
}

/** "1,234", "12.5%", "1.2K" → numbers; blanks → null. */
export function toNumber(value) {
  const text = clean(value).replace(/[,\s%]/g, "");
  if (!text || text === "-" || /^n\/?a$/i.test(text)) return null;
  const suffix = /^(-?[\d.]+)([kmb])$/i.exec(text);
  if (suffix) return Number(suffix[1]) * { k: 1e3, m: 1e6, b: 1e9 }[suffix[2].toLowerCase()];
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

/** A date in the export's own time, kept as written (stored as UTC so the hour stays the same). */
export function toDate(value) {
  const text = clean(value);
  if (!text) return null;
  // Excel serial dates (days since 1899-12-30).
  if (/^\d{5}(\.\d+)?$/.test(text)) return new Date(Math.round((Number(text) - 25569) * 86400000)).toISOString();
  const withoutZone = text.replace(/\s*(UTC|GMT)?\s*[+-]\d{2}:?\d{2}$/i, "").replace(/ (PST|PDT|EST|EDT|IST|UTC|GMT)$/i, "");
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(withoutZone);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3], +(iso[4] || 0), +(iso[5] || 0), +(iso[6] || 0))).toISOString();
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:,?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)?)?/i.exec(withoutZone);
  if (us) {
    let hour = +(us[4] || 0);
    if (us[6] && /pm/i.test(us[6]) && hour < 12) hour += 12;
    if (us[6] && /am/i.test(us[6]) && hour === 12) hour = 0;
    const year = us[3].length === 2 ? 2000 + +us[3] : +us[3];
    return new Date(Date.UTC(year, +us[1] - 1, +us[2], hour, +(us[5] || 0))).toISOString();
  }
  const parsed = Date.parse(`${withoutZone} UTC`);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  const loose = Date.parse(withoutZone);
  return Number.isFinite(loose) ? new Date(loose - new Date(loose).getTimezoneOffset() * 60000).toISOString() : null;
}

/** Works out which platform a file came from, from its links, columns and name. */
export function detectPlatform(header, rows, fileName = "") {
  const names = header.map(normal);
  const has = (name) => names.includes(name);
  const links = rows.slice(0, 20).flat().map(String).join(" ");
  if (/instagram\.com/i.test(links)) return "instagram";
  if (/(twitter|x)\.com\/[^/\s]+\/status/i.test(links)) return "x";
  if (/linkedin\.com/i.test(links)) return "linkedin";
  if (/youtube\.com|youtu\.be/i.test(links)) return "youtube";
  if (/facebook\.com|fb\.com/i.test(links)) return "facebook";
  if (has("watch time (hours)") || has("video publish time") || has("impressions click-through rate (%)")) return "youtube";
  if (has("update title") || has("update link") || has("engagement rate") && has("created date")) return "linkedin";
  if (has("tweet id") || has("tweet permalink") || has("bookmarks") && has("profile visits")) return "x";
  if (/instagram/i.test(fileName)) return "instagram";
  if (/facebook|fb_/i.test(fileName)) return "facebook";
  if (/youtube/i.test(fileName)) return "youtube";
  if (/linkedin/i.test(fileName)) return "linkedin";
  if (/twitter|(^|[^a-z])x[_ -]/i.test(fileName)) return "x";
  return null;
}

function fingerprint(text) {
  let hash = 0;
  for (const char of String(text)) hash = (hash * 31 + char.codePointAt(0)) | 0;
  return (hash >>> 0).toString(36);
}

/** Turns one table (rows with a header) into posts. */
function postsFromTable(rows, table, platform) {
  const { columns } = table;
  const get = (row, field) => (field in columns ? clean(row[columns[field]]) : "");
  const posts = [];
  for (const row of rows.slice(table.index + 1)) {
    const text = get(row, "text");
    const id = get(row, "id");
    // "Total" rows (YouTube), blank rows and second header rows are not posts.
    if (/^total$/i.test(id) || /^total$/i.test(text) || /^total$/i.test(clean(row[0]))) continue;
    const metrics = {};
    let describesColumns = false;
    for (const metric of METRICS) {
      const raw = get(row, metric);
      const value = toNumber(raw);
      if (value !== null) metrics[metric] = value;
      // Words where a number belongs: a second header line describing the columns.
      else if (/[a-z]{3,}/i.test(raw) && !/^n\/?a$/i.test(raw)) describesColumns = true;
    }
    if (describesColumns) continue;
    const permalink = get(row, "permalink");
    const publishedAt = toDate(get(row, "published"));
    // A row is a post when it names one: an id, a link, or text with a date or
    // numbers. Its numbers may all be blank (no views in the exported period):
    // that is 0, not "skip".
    if (!id && !permalink && !(text && (publishedAt || Object.keys(metrics).length))) continue;
    posts.push({
      platform,
      postKey: id || permalink || `fp:${fingerprint(`${text}|${publishedAt || ""}`)}`,
      account: get(row, "account"),
      permalink: /^https?:\/\//i.test(permalink) ? permalink : platform === "youtube" && id && !/\s/.test(id) ? `https://youtu.be/${id}` : "",
      text: text.slice(0, 2000),
      type: get(row, "type"),
      publishedAt,
      metrics,
    });
  }
  return posts;
}

export class AnalyticsImportError extends Error {}

/**
 * Reads an export file. `platform` may be given, else it is detected.
 * Returns { platform, posts }.
 */
export async function readAnalyticsExport({ fileName, bytes, platform: chosen = "" }) {
  const name = String(fileName || "").toLowerCase();
  let tables = [];
  if (name.endsWith(".zip")) {
    const zip = await JSZip.loadAsync(bytes);
    // YouTube's export: "Table data.csv" holds one row per video.
    const csvFiles = Object.keys(zip.files).filter((entry) => entry.toLowerCase().endsWith(".csv"))
      .sort((a, b) => Number(/table data/i.test(b)) - Number(/table data/i.test(a)));
    for (const entry of csvFiles) tables.push(parseCsv(await zip.file(entry).async("string")));
  } else if (name.endsWith(".xlsx")) {
    tables = await parseXlsx(bytes);
  } else if (name.endsWith(".xls")) {
    throw new AnalyticsImportError("This is an old Excel (.xls) file. Open it in Excel or Google Sheets and save it as .xlsx or .csv, then upload that.");
  } else if (name.endsWith(".csv") || name.endsWith(".txt") || name.endsWith(".tsv")) {
    let text = new TextDecoder("utf-8").decode(bytes);
    // Some exports are UTF-16.
    if (text.includes("\u0000")) text = new TextDecoder("utf-16le").decode(bytes);
    tables = [parseCsv(text)];
  } else {
    throw new AnalyticsImportError("Upload the analytics file as .csv, .xlsx or the .zip YouTube Studio gives you.");
  }

  // The sheet that lists posts: most known columns, and one row per post.
  let best = null;
  for (const rows of tables) {
    const table = findTable(rows);
    if (!table) continue;
    const perPost = "text" in table.columns || "permalink" in table.columns || "id" in table.columns;
    const score = table.score + (perPost ? 10 : 0) + Math.min(rows.length, 50) / 100;
    if (!best || score > best.score) best = { rows, table, score };
  }
  if (!best) throw new AnalyticsImportError("This file doesn't look like a social analytics export: no columns such as Views, Likes, Reach or Impressions were found.");

  const platform = ANALYTICS_PLATFORMS.includes(chosen) ? chosen : detectPlatform(best.rows[best.table.index], best.rows.slice(best.table.index + 1), fileName);
  if (!platform) throw new AnalyticsImportError("Couldn't tell which platform this file is from. Choose the platform and upload it again.");
  const posts = postsFromTable(best.rows, best.table, platform);
  if (!posts.length) throw new AnalyticsImportError("No posts with numbers were found in this file. Export the per-post (content) analytics, not only the account summary.");
  return { platform, posts };
}
