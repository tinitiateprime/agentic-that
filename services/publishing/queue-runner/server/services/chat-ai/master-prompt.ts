// One short master prompt for ChatGPT, Claude and Gemini. They know social
// media SEO, so there are no writing rules: only the post's details and the
// section markers that let the website show each part with its own copy button.

export const SEO_PLATFORMS = ["instagram", "facebook", "linkedin", "youtube", "x", "reddit"] as const;
export type SeoPlatform = (typeof SEO_PLATFORMS)[number];

type Section = { key: string; marker: string; kind: "text" | "hashtags" | "tags" };

export const SECTIONS: Record<SeoPlatform, Section[]> = {
  instagram: [
    { key: "caption", marker: "INSTAGRAM CAPTION", kind: "text" },
    { key: "hashtags", marker: "INSTAGRAM HASHTAGS", kind: "hashtags" },
    { key: "altText", marker: "INSTAGRAM ALT TEXT", kind: "text" },
  ],
  facebook: [
    { key: "post", marker: "FACEBOOK POST", kind: "text" },
    { key: "hashtags", marker: "FACEBOOK HASHTAGS", kind: "hashtags" },
  ],
  linkedin: [
    { key: "post", marker: "LINKEDIN POST", kind: "text" },
    { key: "hashtags", marker: "LINKEDIN HASHTAGS", kind: "hashtags" },
  ],
  youtube: [
    { key: "title", marker: "YOUTUBE TITLE", kind: "text" },
    { key: "description", marker: "YOUTUBE DESCRIPTION", kind: "text" },
    { key: "tags", marker: "YOUTUBE TAGS", kind: "tags" },
  ],
  x: [
    { key: "post", marker: "X POST", kind: "text" },
    { key: "hashtags", marker: "X HASHTAGS", kind: "hashtags" },
  ],
  reddit: [
    { key: "title", marker: "REDDIT TITLE", kind: "text" },
    { key: "post", marker: "REDDIT POST", kind: "text" },
    { key: "subreddits", marker: "REDDIT SUBREDDITS", kind: "tags" },
  ],
};

const LABELS: Record<SeoPlatform, string> = { instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", youtube: "YouTube", x: "X (Twitter)", reddit: "Reddit" };

export type PostDetails = {
  platforms: SeoPlatform[];
  mediaKind: "image" | "carousel" | "video";
  imageCount: number;
  durationSeconds?: number;
  description?: string;
  brandName?: string;
  location?: string;
  businessDetails?: string;
};

function mediaLine(details: PostDetails) {
  if (details.mediaKind === "video") {
    const seconds = Math.round(details.durationSeconds || 0);
    const length = seconds ? ` (${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} long)` : "";
    return `It is a video${length}; the attached images are frames from it.`;
  }
  return details.imageCount > 1 ? `It is a carousel of ${details.imageCount} images (attached in order).` : "The post image is attached.";
}

/**
 * Current platform limits the AI may not know yet. Facts, not writing rules:
 * Instagram has allowed only 5 hashtags per post since December 2025.
 */
const PLATFORM_FACTS: Partial<Record<SeoPlatform, string>> = {
  instagram: "Instagram now allows at most 5 hashtags per post.",
  x: "X posts on free accounts are limited to 280 characters, hashtags included.",
  reddit: "Reddit doesn't use hashtags; post titles are limited to 300 characters.",
};

/** Hashtags each app accepts; extra ones are dropped (the AI lists its strongest first). */
const MAX_HASHTAGS: Partial<Record<SeoPlatform, number>> = { instagram: 5 };

export function masterPrompt(details: PostDetails) {
  const apps = details.platforms.map((platform) => LABELS[platform]);
  const appList = apps.length > 1 ? `${apps.slice(0, -1).join(", ")} and ${apps.at(-1)}` : apps[0];
  const context = [
    mediaLine(details),
    details.description?.trim() && `About the post: ${details.description.trim()}`,
    details.brandName?.trim() && `Brand: ${details.brandName.trim()}`,
    details.location?.trim() && `Location: ${details.location.trim()}`,
    details.businessDetails?.trim() && `About the business: ${details.businessDetails.trim()}`,
  ].filter(Boolean);
  const markers = details.platforms.flatMap((platform) => SECTIONS[platform].map((section) => `=== ${section.marker} ===`));
  return [
    `Give me the best of the best, 10/10 social media SEO for this post, for ${appList}. You know what to do.`,
    "",
    ...context,
    ...details.platforms.map((platform) => PLATFORM_FACTS[platform]).filter(Boolean),
    "",
    SECTIONS_INTRO,
    ...markers,
  ].join("\n");
}

const SECTIONS_INTRO = "Put the finished text in these sections, each starting with its marker on its own line, because your answer is shown in an app with a copy button for each part:";

/**
 * For apps that write their richest answer when asked plainly (Gemini): the
 * request without the sections, then a message that only arranges that answer
 * into the sections, word for word.
 */
export function splitPrompt(prompt: string) {
  const at = prompt.indexOf(SECTIONS_INTRO);
  if (at < 0) return null;
  return {
    ask: prompt.slice(0, at).trim(),
    arrange: `Now put your posts above into these sections, word for word. Keep everything you wrote for each app (don't shorten, summarise or rewrite it); leave out only notes about the strategy. ${SECTIONS_INTRO.replace("Put the finished text in these sections, ", "Each section starts with its marker on its own line, ")}\n${prompt.slice(at + SECTIONS_INTRO.length).trim()}`,
  };
}

/** How many section markers an answer has (a rewrite must keep them all). */
export function markerCount(answer: string) {
  return answer.replace(/\r\n?/g, "\n").split("\n").filter((line) => MARKER_LINE.test(line)).length;
}

/**
 * The AIs only see a picture or a few frames, so chapter timestamps in a
 * YouTube description are invented: they are removed with their heading.
 */
export function withoutInventedTimestamps(text: string) {
  return text
    .replace(/^[ \t]*[*_]*(?:timestamps?|chapters|key (?:topics|moments))\b[^\n]*:?[*_]*[ \t]*$/gim, "")
    .replace(/^[ \t]*[-*•]?[ \t]*[*_]*\(?(?:\d{1,2}:)?\d{1,2}:\d{2}\)?[*_]*[ \t]*[-–—:|)]?[ \t]+\S[^\n]*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const MARKER_LINE = /^[\s>*#_`]*={2,}\s*([A-Z][A-Z ]*[A-Z])\s*={2,}[\s*_`]*$/;

function cleanBlock(text: string) {
  return text
    // Gemini shows the source of a sentence as a chip ("post-1.jpg", "+ 1"): not part of the post.
    .replace(/^[ \t]*(?:[\w.-]+\.(?:jpe?g|png|webp|gif|heic)|\+[ \t]*\d+)[ \t]*$/gim, "")
    // ChatGPT shows each app's text in a card headed with the app's name (or a
    // code label like "text"): the heading is not part of the post.
    .replace(/^[ \t]*(?:instagram|facebook|linkedin|youtube|x|twitter|x \(twitter\)|reddit|text|plaintext|markdown)[ \t]*$/gim, "")
    // The app's own message time ("just now", "2 minutes ago") under its answer.
    .replace(/^[ \t]*(?:just now|\d+ (?:seconds?|minutes?|mins?) ago)[ \t]*$/gim, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/^\s*```[a-z]*\s*$/gim, "")
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type ParsedAnswer = {
  results: Partial<Record<SeoPlatform, Record<string, string | string[]>>>;
  /** Every requested section was found. */
  complete: boolean;
};

/** Splits an AI answer into each app's parts by the section markers. */
export function parseAnswer(answer: string, platforms: SeoPlatform[]): ParsedAnswer {
  const blocks = new Map<string, string>();
  let current = "";
  let lines: string[] = [];
  const flush = () => {
    if (current) blocks.set(current, cleanBlock(lines.join("\n")));
  };
  for (const line of answer.replace(/\r\n?/g, "\n").split("\n")) {
    const marker = line.match(MARKER_LINE)?.[1]?.replace(/\s+/g, " ");
    if (marker) {
      flush();
      current = marker;
      lines = [];
    } else if (current) {
      lines.push(line);
    }
  }
  flush();

  const results: ParsedAnswer["results"] = {};
  let complete = true;
  for (const platform of platforms) {
    const entry: Record<string, string | string[]> = {};
    for (const section of SECTIONS[platform]) {
      const block = blocks.get(section.marker) || "";
      if (!block) complete = false;
      if (section.kind === "hashtags") {
        entry[section.key] = [...new Set(block.match(/#[\p{L}\p{N}_]+/gu) || [])].slice(0, MAX_HASHTAGS[platform] ?? 30);
      } else if (section.kind === "tags") {
        const tags = block.split(/[,\n]/).map((tag) => tag.replace(/^[\s\-*•\d.)]+/, "").replace(/^#/, "").trim()).filter(Boolean);
        // Subreddits: only real "r/name" entries (not a note the AI added after the list).
        entry[section.key] = [...new Set(section.key === "subreddits"
          ? tags.map((tag) => tag.match(/^\/?r\/([A-Za-z0-9_]{2,21})\b/)?.[1]).filter(Boolean).map((name) => `r/${name}`)
          : tags)];
      } else {
        entry[section.key] = block;
      }
    }
    // A caption or post that ends with the same hashtags as its own section would
    // repeat them in "Copy everything": the trailing hashtag lines are dropped.
    for (const field of ["caption", "post"]) {
      const tags = entry.hashtags as string[] | undefined;
      if (typeof entry[field] === "string" && tags?.length) {
        entry[field] = (entry[field] as string).replace(/(?:\n[ \t]*(?:#[\p{L}\p{N}_]+[ \t]*)+)+\s*$/u, "").trim();
      }
    }
    if (platform === "youtube" && typeof entry.description === "string") entry.description = withoutInventedTimestamps(entry.description);
    // Copy-everything text, ready to paste into the app.
    if (platform === "instagram") entry.fullText = [entry.caption, (entry.hashtags as string[]).join(" ")].filter(Boolean).join("\n\n");
    if (platform === "facebook" || platform === "linkedin" || platform === "x") entry.fullText = [entry.post, (entry.hashtags as string[]).join(" ")].filter(Boolean).join("\n\n");
    results[platform] = entry;
  }
  return { results, complete };
}
