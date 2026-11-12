// AI Post SEO: one vision pass to understand the media, then one writing pass
// per app. Results are always fitted to each app's published limits so the
// output can be posted as-is.

import { localAi } from "./ai-engine.js";

export const SEO_PLATFORMS = ["instagram", "facebook", "linkedin", "youtube"] as const;
export type SeoPlatform = (typeof SEO_PLATFORMS)[number];

export type PostSeoRequest = {
  platforms: SeoPlatform[];
  images: string[]; // data:image/jpeg;base64,... (a photo, carousel slides, or video frames)
  mediaKind: "image" | "carousel" | "video";
  durationSeconds?: number;
  orientation?: "vertical" | "square" | "landscape";
  description?: string;
  brandName?: string;
  location?: string;
  language?: string;
  /** Saved once by the business: what makes them different (e.g. "live projects, placement support, free trial"). */
  businessDetails?: string;
};

export const POST_TYPES = ["course-or-training", "product", "food-or-menu", "service", "event", "property", "offer-or-sale", "quote-or-motivation", "tips-or-education", "humor-or-meme", "news-or-announcement", "personal-or-lifestyle", "other"] as const;
export type PostType = (typeof POST_TYPES)[number];
const SALES_TYPES = new Set<string>(["course-or-training", "product", "food-or-menu", "service", "event", "property", "offer-or-sale"]);
const CREATOR_TYPES = new Set<string>(["quote-or-motivation", "humor-or-meme", "personal-or-lifestyle"]);

/**
 * A post that sells something (gets the offer list, contacts, DM keyword and
 * local search) versus a creator post (quote, mood, humour, tips, a moment)
 * that is written for feeling, saves and shares.
 */
export function isBusinessPost(analysis: Analysis, facts?: Pick<Facts, "offerings" | "phone" | "email" | "website">) {
  const type = analysis.postType;
  if (!type || SALES_TYPES.has(type)) return true;
  if (CREATOR_TYPES.has(type)) return false;
  // Tips, news or "other": a business post only when it carries business details.
  return Boolean(facts && (facts.offerings.length >= 2 || facts.phone || facts.email || facts.website));
}

export type Analysis = {
  /** What the post is really saying, in one sentence. */
  message?: string;
  /** The feeling it carries ("calm, reflective", "playful", "urgent"). */
  mood?: string;
  /** The main quote or line written on the media, exactly as written. */
  quote?: string;
  mainKeyword: string;
  subject: string;
  details: string[];
  visibleText: string;
  searchKeywords: string[];
  altText: string;
  postType?: PostType;
  audience?: string;
  // Facts read from the media. Our code (not the model) puts these in every post
  // exactly as written, so nothing gets lost or reworded.
  brand?: string;
  tagline?: string;
  offerings?: string[];
  /** Grouped lists on the media ("Snowflake": Warehouses, Databases...), exactly as written. */
  sections?: Array<{ title: string; kind?: "list" | "steps" | "statement"; groups?: Array<{ name: string; items: string[] }>; items?: string[] }>;
  slogan?: string;
  website?: string;
  email?: string;
  phone?: string;
};

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["message", "mood", "postType", "quote", "brand", "mainKeyword", "subject", "audience", "tagline", "sections", "slogan", "details", "visibleText", "website", "email", "phone", "searchKeywords", "altText"],
  properties: {
    message: { type: "string", maxLength: 220, description: "What the post is really saying or offering, in one plain sentence (e.g. 'Quiet time alone helps you hear your own thoughts', 'A 9-course tech training program with placement support'). Read the text on the media: it usually carries the message more than the picture does." },
    mood: { type: "string", maxLength: 40, description: "The feeling the post carries, in 1-3 words (e.g. 'calm, reflective', 'playful', 'urgent, exciting', 'professional')." },
    postType: { type: "string", enum: [...POST_TYPES], description: "What kind of post this is. A quote, saying or reflection over a photo is quote-or-motivation, even when the photo shows an animal or a place." },
    quote: { type: "string", maxLength: 300, description: "The main quote, saying or headline written on the media, exactly as written, as one line. Empty if there is none." },
    audience: { type: "string", maxLength: 60, description: "Who it is for or who will relate to it (e.g. 'students and working engineers', 'biryani lovers', 'overthinkers who need calm'), or an empty string." },
    brand: { type: "string", maxLength: 40, description: "The business or brand name shown in the logo or text, exactly as written, or an empty string." },
    mainKeyword: { type: "string", maxLength: 40, description: "The 2-3 word phrase most people would search for this (e.g. 'chicken biryani', 'data engineering course', 'bridal makeup'). For a quote, tip or mood post, the theme people search (e.g. 'inner peace', 'self love', 'study tips'), not objects in the picture. Lowercase, never the brand name, no props, no #." },
    subject: { type: "string", maxLength: 60, description: "What a customer would call it: the dish, product, service, course, place or event (e.g. 'chicken biryani', 'tech training courses', '3 BHK apartment'). Never the serving dish, container or props." },
    tagline: { type: "string", maxLength: 80, description: "The slogan or headline written in the media (e.g. 'Engineer Your Future with AI'), or an empty string." },
    sections: {
      type: "array", maxItems: 6,
      description: "Every titled block on the media, in order (e.g. 'What You'll Learn', 'Build Real-World Projects', 'Career-Ready Skills', 'Menu'). When a block has sub-headings or columns (e.g. 'AWS Cloud Fundamentals' over 'S3 • IAM • VPC'), put each sub-heading in groups with its own items and leave items empty. Otherwise put each entry in items. kind: 'steps' for a flow joined by arrows, 'statement' for a block that is a sentence or slogan, otherwise 'list'. One entry per item, every word copied exactly; never join several entries into one string. Empty if there is no list.",
      items: {
        type: "object", additionalProperties: false, required: ["title", "kind", "groups", "items"],
        properties: {
          title: { type: "string", maxLength: 50 },
          kind: { type: "string", enum: ["list", "steps", "statement"] },
          groups: {
            type: "array", maxItems: 8,
            items: { type: "object", additionalProperties: false, required: ["name", "items"], properties: { name: { type: "string", maxLength: 70 }, items: { type: "array", maxItems: 10, items: { type: "string", maxLength: 110 } } } },
          },
          items: { type: "array", maxItems: 14, items: { type: "string", maxLength: 110 } },
        },
      },
    },
    slogan: { type: "string", maxLength: 120, description: "The strongest punchline or closing line written on the media, exactly as written (e.g. 'Don't just store data. Build data systems.'), if it differs from the tagline. Empty if there is none." },
    details: { type: "array", items: { type: "string", maxLength: 80 }, maxItems: 5, description: "Other selling points that matter to a customer (benefits, ingredients, style, offer). Never props like plates, tables or placemats." },
    visibleText: { type: "string", maxLength: 400, description: "Other important words written in the media, or an empty string." },
    website: { type: "string", maxLength: 80, description: "Website written in the media, exactly as written, or an empty string." },
    email: { type: "string", maxLength: 80, description: "Email address written in the media, exactly as written, or an empty string." },
    phone: { type: "string", maxLength: 30, description: "Phone or WhatsApp number written in the media, exactly as written, or an empty string." },
    searchKeywords: { type: "array", items: { type: "string", maxLength: 40 }, minItems: 3, maxItems: 6, description: "Plain search phrases (no #) people really type into Instagram, Google or YouTube for this (e.g. 'chicken biryani', 'data engineering course', 'inner peace quotes')." },
    altText: { type: "string", description: "What the image shows for blind and low-vision users (people, product, key words), under 120 characters in total. Quote the text on the image only if it fits; otherwise say what it is about. No contact details." },
  },
};

const stringArray = (max: number, min = 0, itemMax = 60) => ({ type: "array", items: { type: "string", maxLength: itemMax }, maxItems: max, ...(min ? { minItems: min } : {}) });
const text = (max: number) => ({ type: "string", maxLength: max });

// Each post is written in parts (hook, short paragraphs, call to action) so even
// small models produce a complete, well-shaped post without padding. The list of
// offerings and the contact details are added by our code, exactly as written in
// the media, so the model never drops or rewords them.
const AUTO_PARTS = `The list of offerings (if any) and the contact details are added automatically after your paragraphs: never write the list, website, email or phone yourself. You may refer to them (e.g. "Choose from 9 industry-ready courses").`;
const HASHTAG_GUIDE = `Pick the hashtags people really search and follow for this exact post: first the exact names of the main tools, products, dishes, places or skills it shows (e.g. #Snowflake, #ApacheAirflow, #ChickenBiryani), then the field (e.g. #DataEngineering, #HyderabadFood). Avoid broad filler (#TechCareers, #Learning, #Foodie) when specific tags exist, tags with "Courses", "Training" or "Services" tacked on, and single generic words (#Data, #Food). Include the brand hashtag. No #instagood or #viral.`;
const listTitle = { type: "string", maxLength: 40, description: "Short heading for the automatic list, e.g. 'Our courses:' or 'On the menu:'. Empty if there is no list." };

const PLATFORM_SPECS: Record<SeoPlatform, { schema: object; brief: string }> = {
  instagram: {
    brief: `Instagram post for a business, written in parts (Instagram search reads the caption, so use the words people search for):
- hook: one scroll-stopping opening line (under 110 characters) with the main search keyword and the brand if there is one. Instagram shows only this before "more".
- searchLine: one line in the customer's own search words that says who it is for and what they get, often as a question. Add the location only if it was given.
- paragraphs: 1-2 short paragraphs (1-2 sentences each) that add something new (never repeat the hook or searchLine): what they will be able to do or get, how it is delivered and why this business, using "About the business", the exact names on the media (tools, dishes, products) and natural keyword variations.
- listTitle: heading for a single automatic list (e.g. "What you'll master", "On the menu"). Empty if there is no list.
- sectionHeadings: when the brief shows numbered list sections, one heading for each, in the same order, starting with 1 emoji that fits that section's content and keeping its meaning (e.g. "💡 What You'll Master", "🔄 Build Real-World Projects", "🎯 Career-Ready Outcomes"). Otherwise empty.
- benefits: for each offering in a single list, in the same order, a short benefit of 2-6 words. Empty otherwise.
- cta: one call to action that fits this offer (enroll, order, book, visit, shop, register...), under 90 characters.
- dmKeyword: one short, memorable keyword in capitals that people can DM or comment (the main product, tool or dish, e.g. "AWS", "BIRYANI").
- dmReason: what they get by sending it, using only what the media or "About the business" states (e.g. "the full syllabus and batch details", "today's menu"). Never promise prices, free trials, discounts or jobs unless stated.
- hashtags: 5 different hashtags: the brand, 2 for this exact thing, 1 for the niche, and 1 local hashtag (city + niche, e.g. #HyderabadITTraining) if a location was given, otherwise 1 broader. ${HASHTAG_GUIDE}
- onScreenText: short keyword-rich text for the cover or first frame, under 40 characters.
${AUTO_PARTS}
Emoji: choose them for this post's own topic and mood, like a top creator in this niche: 1-2 at the end of the hook, 1 at the start of each list heading, and the cta may have 1. Never a fixed set for every post.
Use details from "About the business" when they fit. No hashtags inside hook, searchLine, paragraphs or cta.`,
    schema: {
      type: "object", additionalProperties: false,
      required: ["hook", "searchLine", "paragraphs", "listTitle", "sectionHeadings", "benefits", "cta", "dmKeyword", "dmReason", "hashtags", "onScreenText"],
      properties: { hook: text(130), searchLine: text(160), paragraphs: stringArray(2, 1, 300), listTitle: { ...listTitle, maxLength: 50 }, sectionHeadings: stringArray(6, 0, 60), benefits: stringArray(12, 0, 45), cta: text(110), dmKeyword: text(14), dmReason: text(70), hashtags: stringArray(6, 5, 35), onScreenText: text(45) },
    },
  },
  facebook: {
    brief: `Facebook post, written in parts (Facebook search and the feed read the whole post, so use the words people search for):
- hook: a friendly, scroll-stopping first line with the main keyword and the brand if there is one. Facebook shows about 125 characters before "See more".
- paragraphs: 1-2 short, conversational paragraphs that add something new (never repeat the hook): what they get, how it works and why this business, using "About the business", the exact names on the media, the location if it was given, and natural keyword variations.
- listTitle: heading for a single automatic list. Empty if there is no list.
- sectionHeadings: when the brief shows numbered list sections, one heading for each, in the same order, starting with 1 emoji that fits that section and keeping its meaning. Otherwise empty.
- benefits: for each offering in a single list, in the same order, a short benefit of 2-6 words. Empty otherwise.
- cta: one clear next step that invites messages, comments or shares (e.g. "Message us for the full syllabus", "Tag a friend who needs this"), under 120 characters.
- hashtags: 3 hashtags: the brand, 1 for this exact thing and 1 local hashtag if a location was given (otherwise 1 for the field). ${HASHTAG_GUIDE}
${AUTO_PARTS}
Emoji: choose them for this post's topic and mood: 1-2 in the hook, 1 at the start of each list heading, and the cta may have 1. Never a fixed set for every post.
No hashtags inside hook, paragraphs or cta.`,
    schema: {
      type: "object", additionalProperties: false,
      required: ["hook", "paragraphs", "listTitle", "sectionHeadings", "benefits", "cta", "hashtags"],
      properties: { hook: text(160), paragraphs: stringArray(2, 1, 360), listTitle, sectionHeadings: stringArray(6, 0, 60), benefits: stringArray(12, 0, 45), cta: text(140), hashtags: stringArray(4, 3, 35) },
    },
  },
  linkedin: {
    brief: `LinkedIn post, written in parts, professional and specific (LinkedIn search reads the whole post):
- hook: a strong opening line (under 200 characters, shown before "see more") with the main keyword: a problem, a result or a bold, true statement the reader cares about.
- paragraphs: 2-3 short paragraphs with real insight: the problem or opportunity, what this offers, and the outcome for the reader, using "About the business", the exact names on the media and natural keyword variations. One idea per paragraph.
- listTitle: heading for a single automatic list. Empty if there is no list.
- sectionHeadings: when the brief shows numbered list sections, one plain heading for each, in the same order, keeping its meaning. Otherwise empty.
- benefits: for each offering in a single list, in the same order, a short benefit of 2-6 words. Empty otherwise.
- cta: a clear next step and a question that invites professional discussion.
- hashtags: 3-5 professional hashtags, including the brand. ${HASHTAG_GUIDE}
${AUTO_PARTS}
Emoji: at most 2 in the whole post and only where natural; none is fine.
No hashtags inside hook, paragraphs or cta.`,
    schema: {
      type: "object", additionalProperties: false,
      required: ["hook", "paragraphs", "listTitle", "sectionHeadings", "benefits", "cta", "hashtags"],
      properties: { hook: text(210), paragraphs: stringArray(3, 2, 380), listTitle, sectionHeadings: stringArray(6, 0, 60), benefits: stringArray(12, 0, 45), cta: text(160), hashtags: stringArray(5, 3, 35) },
    },
  },
  youtube: {
    brief: `YouTube upload, written in parts (YouTube search reads the title, description and tags):
- title: under 70 characters, main keyword first, clear and specific (no clickbait, no all caps). It may end with " | " and the brand.
- summary: the first 2 lines of the description (under 200 characters) with the main keyword and what the viewer gets. YouTube shows these in search.
- paragraphs: 2 short paragraphs that add detail: what the viewer will learn or see, the exact names on the media, "About the business" and the location if given, with natural keyword variations.
- listTitle: heading for a single automatic list. Empty if there is no list.
- sectionHeadings: when the brief shows numbered list sections, one plain heading for each, in the same order, keeping its meaning. Otherwise empty.
- benefits: for each offering in a single list, in the same order, a short benefit of 2-6 words. Empty otherwise.
- cta: ask viewers to subscribe and comment, and say what to do next (e.g. "Check the links below for the full syllabus").
- tags: 8-12 search tags people really type (keyword variations, tools, products, the brand), each under 30 characters.
- hashtags: 3 hashtags (YouTube shows them above the title).
- thumbnailText: 2-5 bold words for the thumbnail.
${AUTO_PARTS}
No emoji in the title. No hashtags inside title, summary, paragraphs or cta.`,
    schema: {
      type: "object", additionalProperties: false,
      required: ["title", "summary", "paragraphs", "listTitle", "sectionHeadings", "benefits", "cta", "tags", "hashtags", "thumbnailText"],
      properties: { title: text(90), summary: text(220), paragraphs: stringArray(2, 2, 380), listTitle, sectionHeadings: stringArray(6, 0, 60), benefits: stringArray(12, 0, 45), cta: text(140), tags: stringArray(12, 8, 30), hashtags: stringArray(4, 3, 35), thumbnailText: text(40) },
    },
  },
};

/** Quotes, moods, humour, tips and moments on Facebook, LinkedIn and YouTube: no sales template. */
const CREATOR_NOTE = `This post does not sell anything (a quote, a moment, a tip or humour). Write for its message and mood like the best creator in this niche on this app: open with the quote or the idea itself, take it deeper for the reader in a human, specific way, and end with a question that invites real replies (on YouTube, also ask them to subscribe). No sales call to action. Hashtags for the theme and community people follow, not objects in the picture.`;

/**
 * Quotes, moods, humour, tips and personal moments: no sales template. The model
 * first works out what the post means and how it should feel, then writes like
 * the best creator in that niche would.
 */
const INSTAGRAM_CREATOR = {
  brief: `Instagram post for a creator or page (it does not sell anything). First understand the post: its message, its mood and who will relate to it. Then write the caption the best creator in this niche would write, in that mood and voice.
- angle: plan first (not shown to readers): in one sentence, what the reader should feel or take away, and the voice you will write in.
- hook: the first line, shown before "more" (under 125 characters). If the media carries a quote or line of text, open with that line exactly as written. Otherwise a line that captures the feeling or the idea. Never describe the photo ("This cat...", "Look at this view") unless the photo itself is the point.
- paragraphs: 1-3 short paragraphs that take the message deeper for the reader: relatable, specific and human, in the post's mood, not generic. Weave in the words people search for this theme naturally, never as a list.
- cta: what this audience naturally does with a post like this: a question that invites real replies, and/or a reason to save or share it. One or two short lines.
- hashtags: 5 hashtags for the theme, feeling and community people follow and search, not literal objects in the picture unless the picture itself is the topic. No #instagood, #viral or #explore.
- onScreenText: if the media already has text on it, an empty string; otherwise a short cover line under 40 characters.
Emoji: only where they fit the mood, the way that creator would; none is fine. No hashtags inside hook, paragraphs or cta.`,
  schema: {
    type: "object", additionalProperties: false,
    required: ["angle", "hook", "paragraphs", "cta", "hashtags", "onScreenText"],
    properties: { angle: text(200), hook: text(160), paragraphs: stringArray(3, 1, 400), cta: text(180), hashtags: stringArray(6, 5, 35), onScreenText: text(45) },
  },
};

const SYSTEM = `You are an expert social media SEO copywriter for businesses, creators and pages.
First understand what a post is really about: its purpose, its message and its mood. Then write what that audience cares about and searches for: for a business, the dish, product, service, place or experience and why they would want it; for a creator, the idea or feeling and why it matters to the reader.
Never write about the photo itself (camera, framing, background, plates, tables, placemats) and never call the post "food photography" unless the author is a photographer.
Hashtags must be ones people actually follow and search (e.g. #ChickenBiryani, #HyderabadFood), never long literal descriptions (e.g. not #BiryaniInCopperBowl).
Rules you never break:
- Never name a city, area or country unless the author gave it (Location) or it is written in the media. This applies to hashtags too.
- Describe only what is really in the media or stated by the author. Never invent prices, offers, dates, locations, names, awards, claims or urgency ("limited slots", "hurry").
- If the author gives details (offer, price, link, phone, address), keep them exactly.
- Write in natural, human language. No filler like "Unleash", "Elevate", "In today's fast-paced world".
- Use the language of the author's description (default English).
- Answer only with the requested JSON.`;

function contextBlock(request: PostSeoRequest) {
  const lines = [
    `Media: ${request.mediaKind}${request.mediaKind === "video" ? ` (${Math.round(request.durationSeconds || 0)} seconds, ${request.orientation || "unknown"} orientation; images are frames from the video)` : request.mediaKind === "carousel" ? ` (${request.images.length} slides)` : ""}.`,
    request.description?.trim() ? `Author's description: """${request.description.trim().slice(0, 2000)}"""` : "Author's description: none (rely on the media).",
    request.brandName?.trim() ? `Brand: ${request.brandName.trim()} (spell it exactly like this; text read from the image may be misspelled. Call the business only by this name, never by other names read from the image)` : "Brand: not given (do not invent one).",
    request.location?.trim() ? `Location: ${request.location.trim()}` : "Location: not given (do not mention a specific place unless it is clearly visible).",
    request.businessDetails?.trim() ? `About the business (from the owner, true and safe to use): """${request.businessDetails.trim().slice(0, 400)}"""` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

// ---- Fitting results to each app's limits ----------------------------------------

function cleanText(value: unknown, max: number) {
  const text = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const boundary = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(". "), cut.lastIndexOf(" "));
  return `${cut.slice(0, boundary > max * 0.6 ? boundary : cut.length).trimEnd()}…`;
}

// Serving dishes and photo props are never what people search for.
const PROP_WORDS = /(bowl|plate|platter|placemat|table|tray|copper|background|closeup|photo|camera|picture)/i;

// "aws data engineering" -> "AWSDataEngineering" (acronyms stay in capitals).
const camel = (phrase: string) => phrase.split(/[\s_-]+/).filter(Boolean)
  .map((word) => COMMON_ACRONYMS.find((known) => known.toLowerCase() === word.toLowerCase()) || word.charAt(0).toUpperCase() + word.slice(1)).join("");
const capitals = (text: string) => (text.match(/\p{Lu}/gu) || []).length;

export function cleanHashtags(values: unknown, max: number, context = "", phrases: string[] = []) {
  const seen = new Set<string>();
  const out: string[] = [];
  // "#skillstack" -> "#SkillStack" when it matches a known phrase (easier to read, and screen readers say it right).
  const casing = new Map(phrases.map((phrase) => camel(String(phrase).replace(/^#+/, ""))).filter((tag) => tag.length > 1).map((tag) => [tag.toLowerCase(), tag]));
  for (const value of Array.isArray(values) ? values : []) {
    const words = String(value).replace(/^#+/, "").split(/[\s_-]+/).filter(Boolean);
    const body = words.length > 1
      ? words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("")
      : words[0] || "";
    let tag = body.normalize("NFKC").replace(/[^\p{L}\p{M}\p{N}]/gu, "");
    // Known phrases decide the capitals ("#AIlearning" -> "#AILearning"); others are kept as written.
    // ...unless the AI's own capitals are richer ("#AWSDataEngineering" stays).
    const known = casing.get(tag.toLowerCase());
    if (known && capitals(known) >= capitals(tag)) tag = known;
    if (tag.length < 2 || tag.length > 30 || /^\d+$/.test(tag)) continue;
    const key = tag.toLowerCase();
    if (seen.has(key) || ["instagood", "viral", "fyp", "foryou", "explorepage", "like4like", "follow4follow", "photooftheday"].includes(key)) continue;
    const prop = key.match(PROP_WORDS)?.[1];
    if (prop && !context.toLowerCase().includes(prop)) continue;
    seen.add(key);
    out.push(`#${tag}`);
    if (out.length >= max) break;
  }
  return out;
}

/** Hashtags the model wrote inside the text move to the hashtag list. */
function splitTrailingHashtags(text: string) {
  const lines = text.split("\n");
  const moved: string[] = [];
  while (lines.length && /^\s*(#[\p{L}\p{M}\p{N}_]+\s*)+$/u.test(lines.at(-1)!)) {
    moved.unshift(...(lines.pop()!.match(/#[\p{L}\p{M}\p{N}_]+/gu) || []));
  }
  return { text: lines.join("\n").trim(), moved };
}

// "AWSDataEngineering" -> "AWS Data Engineering" (capital runs stay together).
const CAMEL_ACRONYM = /(\p{Lu}{2,})(\p{Lu}\p{Ll})/gu;
const CAMEL_WORD = /([\p{Ll}\d])(\p{Lu})/gu;
const spaceCamel = (value: string) => value.replace(CAMEL_ACRONYM, "$1 $2").replace(CAMEL_WORD, "$1 $2");

function youtubeTags(values: unknown, phrases: string[] = []) {
  const tags: string[] = [];
  let total = 0;
  const spacedPhrases = new Map(phrases.map((phrase) => [squash(phrase), String(phrase).toLowerCase().replace(/^#/, "").trim()]));
  for (const value of Array.isArray(values) ? values : []) {
    // "ChickenBiryani" -> "chicken biryani": tags are search phrases, not hashtags.
    const original = String(value).replace(/^#/, "").replace(/[<>,]/g, "").trim();
    const raw = /\s/.test(original) ? original : spacedPhrases.get(squash(original)) || original;
    const spaced = /\s/.test(raw) ? raw.replace(CAMEL_ACRONYM, "$1 $2") : spaceCamel(raw);
    const tag = (spaced === raw ? raw : spaced.toLowerCase()).slice(0, 30);
    if (PROP_WORDS.test(tag) || GENERIC_PHRASES.test(tag)) continue;
    if (!tag || tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) continue;
    // YouTube allows 500 characters of tags in total.
    if (total + tag.length + (tags.length ? 1 : 0) > 500) break;
    tags.push(tag);
    total += tag.length + (tags.length > 1 ? 1 : 0);
  }
  return tags;
}

// Removes inline hashtags (collected separately), stray characters from scripts
// the author did not use, and repeated sentences.
function tidyPart(value: unknown, collected: string[], allowHan: boolean) {
  let part = String(value ?? "").replace(/(^|\s)#[\p{L}\p{M}\p{N}_]+/gu, (match) => {
    collected.push(match.trim());
    return " ";
  });
  if (!allowHan) part = part.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, "");
  part = part.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
  return endCleanly(dropFiller(part));
}

// "In today's fast-paced world, ..." and similar openers add nothing.
const FILLER = /(^|(?<=[.!?]\s))(in today['’]s [^,.]{2,40}|in this (?:fast|ever)[^,.]{2,30}|in a world where[^,.]{2,60}),\s*/giu;

export function dropFiller(text: string) {
  return text.replace(FILLER, "").replace(/(^|[.!?]\s+)(\p{Ll})/gu, (match, lead, letter) => lead + letter.toUpperCase());
}

/** A long part that stops mid-sentence (it hit the length limit) ends at its last full sentence. */
export function endCleanly(text: string) {
  if (text.length < 200 || /[.!?…)"'”\p{Extended_Pictographic}]$/u.test(text)) return text;
  const end = Math.max(text.lastIndexOf(". "), text.lastIndexOf("! "), text.lastIndexOf("? "));
  return end > 0 ? text.slice(0, end + 1) : text;
}

function words(text: string) {
  return new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 2));
}

/** Two parts say the same thing when most of the shorter one's words are in the other. */
function nearDuplicate(a: Set<string>, b: Set<string>) {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  if (!small.size) return false;
  let shared = 0;
  for (const word of small) if (large.has(word)) shared += 1;
  return shared / small.size >= 0.7;
}

type Extras = { beforeKey?: string; before?: string[]; after?: string[] };

function assemble(raw: Record<string, unknown>, keys: string[], collected: string[], allowHan: boolean, extras: Extras = {}) {
  const kept: Array<Set<string>> = [];
  const blocks: string[] = [];
  const before = (extras.before || []).filter(Boolean);
  let inserted = false;
  for (const key of keys) {
    // Fixed blocks (the list of offerings) go in just before the call to action.
    if (key === extras.beforeKey && !inserted) {
      blocks.push(...before);
      inserted = true;
    }
    const values = Array.isArray(raw[key]) ? (raw[key] as unknown[]) : [raw[key]];
    for (const value of values) {
      const part = tidyPart(value, collected, allowHan);
      if (!part) continue;
      const fingerprint = words(part);
      if (kept.some((other) => nearDuplicate(fingerprint, other))) continue;
      kept.push(fingerprint);
      blocks.push(part);
    }
  }
  if (!inserted) blocks.push(...before);
  // The contact block always closes the post.
  blocks.push(...(extras.after || []).filter(Boolean));
  return blocks.join("\n\n");
}

/** The brand hashtag (#TinitiateAI) always goes in when the brand is known. */
function withBrandTag(hashtags: string[], brandName: string | undefined, max: number, force = true) {
  const brand = cleanHashtags([brandName || ""], 1)[0];
  if (!brand) return hashtags.slice(0, max);
  const fixed = [...new Set(hashtags.map((tag) => (looksLikeBrand(tag.slice(1), brandName!) ? brand : tag)))];
  if (!force || fixed.includes(brand)) return fixed.slice(0, max);
  return [...fixed.slice(0, max - 1), brand];
}

function editDistance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

/** True for the brand itself or a near-miss spelling (text misread from an image). */
function looksLikeBrand(value: string, brandName: string) {
  const a = squash(value);
  const b = squash(brandName);
  if (!a || !b || b.length < 5) return a === b;
  return editDistance(a, b) <= Math.max(1, Math.floor(b.length / 5));
}

/** Writes the brand exactly as the author spells it, everywhere in the text. */
export function fixBrandSpelling(text: string, brandName = "") {
  const brand = brandName.trim();
  if (!brand || squash(brand).length < 5) return text;
  // Compare every run of as many words as the brand has ("Tinitize AI" vs "Tinitiate AI").
  const count = brand.split(/\s+/).length;
  const words = [...text.matchAll(/[\p{L}\p{N}]+/gu)];
  const fixes: Array<[number, number]> = [];
  for (let i = 0; i + count <= words.length; i += 1) {
    const from = words[i].index!;
    const last = words[i + count - 1];
    const to = last.index! + last[0].length;
    const run = text.slice(from, to);
    if (/[^\p{L}\p{N} \t]/u.test(run) || run === brand || !looksLikeBrand(run, brand)) continue;
    fixes.push([from, to]);
    i += count - 1;
  }
  let output = text;
  for (const [from, to] of fixes.reverse()) output = output.slice(0, from) + brand + output.slice(to);
  return output;
}

/** Serving dishes and surfaces ("in a copper bowl", "on a white plate") are removed unless the author mentioned them. */
export function dropPropPhrases(text: string, description = "") {
  const mentioned = description.toLowerCase();
  const phrasesRemoved = text
    .replace(/(,?\s*)((?:(?:served|presented|plated)\s+)?(?:(?:hot|fresh|beautifully)\s+)?)(?:in|on)\s+(?:(?:a|an|our|the|this)\s+)?(?:[\p{L}-]+\s+){0,2}(bowls?|plates?|platters?|placemats?|trays?)\b(?:\s+(?:on|in)\s+(?:(?:a|an|the)\s+)?(?:[\p{L}-]+\s+){0,2}(?:bowls?|plates?|platters?|placemats?|trays?)\b)?/giu,
      (match, lead, verb, prop, offset, whole) => {
        if (mentioned.includes(String(prop).toLowerCase().replace(/s$/, ""))) return match;
        // Only a phrase that ends a clause can be cut cleanly; otherwise the
        // sentence is left whole here and dropped below.
        const after = String(whole).slice(offset + match.length);
        if (!/^\s*([.,!?;:]|$)/u.test(after)) return match;
        // "is presented beautifully on a plate" keeps "is presented beautifully".
        const before = String(whole).slice(0, offset);
        return verb && /\b(is|are|was|were|be|been|gets?|comes?|and)\s*$/i.test(before) ? `${lead}${verb}`.trimEnd() : "";
      });
  // Sentences that are still about the dish or surface ("Our copper bowl holds history.") go too.
  const propWord = /\b(copper|bowls?|plates?|platters?|placemats?|trays?|vessels?)\b/giu;
  const unmentioned = (sentence: string) => [...sentence.matchAll(propWord)].some((match) => !mentioned.includes(match[1].toLowerCase().replace(/s$/, "")));
  return phrasesRemoved
    .split("\n")
    .map((line) => line.split(/(?<=[.!?])\s+/).filter((sentence) => !unmentioned(sentence)).join(" "))
    .join("\n")
    .replace(/[ \t]+([,.!?])/g, "$1")
    .replace(/^[,\s—–-]+/, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/(^|[.!?]\s+)(\p{Ll})/gu, (match, lead, letter) => lead + letter.toUpperCase())
    .trim();
}

const TEXT_KEYS = ["hook", "searchLine", "paragraphs", "sectionHeadings", "dmReason", "cta", "summary", "title", "caption", "post", "description", "thumbnailText", "onScreenText"];

// Pressure the author never claimed: false scarcity hurts trust (and breaks ad rules).
const UNSTATED_URGENCY = /\s*[—–,-]?\s*\b(limited (?:slots?|seats?|spots?|time(?: offer)?|period|offer|availability|batch(?:es)?)|hurry(?: up)?|few (?:seats|slots|spots) left|(?:seats|slots|spots) (?:are )?filling (?:up )?fast|first come,? first served|only \d+ (?:seats|slots|spots)(?: left)?|last chance|don'?t miss out)\b[.!]*/giu;

export function dropUnstatedClaims(text: string, stated = "") {
  const source = stated.toLowerCase();
  let removed = false;
  const out = text
    .replace(UNSTATED_URGENCY, (match, phrase: string) => {
      if (source.includes(phrase.toLowerCase())) return match;
      removed = true;
      return "";
    })
    .replace(/[ \t]+([.!?,])/g, "$1")
    .replace(/\s*[—–-]\s*([.!?]|$)/g, "$1")
    .trim();
  // "Enroll now — limited slots." -> "Enroll now."
  return removed && out && /[.!]$/.test(text.trim()) && !/[.!?…]$/.test(out) ? `${out}${text.trim().slice(-1)}` : out;
}

const COMMON_ACRONYMS = ["AI", "ML", "AWS", "GCP", "BI", "API", "APIs", "SEO", "UI", "UX", "SQL", "HR", "CEO", "EV", "BHK", "GST", "USA", "UK", "UAE", "NYC"];
const SHOUTED_SHORT_WORDS = /^(NOW|NEW|OFF|FOR|THE|AND|YOU|OUR|GET|BUY|TOP|HOT|ALL|ONE|ARE|YES|WIN|DAY|BIG)$/;

/**
 * "Ai training" -> "AI training", and copied poster shouting ("ENROLL NOW") ->
 * "Enroll now". Acronyms seen in the author's text or the media keep their capitals.
 */
export function fixCapitals(text: string, known: string[] = []) {
  const acronyms = new Map<string, string>();
  for (const word of [...COMMON_ACRONYMS, ...known.flatMap((phrase) => String(phrase).split(/[^\p{L}\p{N}]+/u))]) {
    if (/^\p{Lu}{2,4}s?$/u.test(word) || COMMON_ACRONYMS.includes(word)) acronyms.set(word.toLowerCase(), word);
  }
  const fixWords = (part: string) => part.replace(/[\p{L}\p{N}]+/gu, (word) => {
    const acronym = acronyms.get(word.toLowerCase());
    if (acronym) return acronym;
    const shouted = word === word.toUpperCase() && /\p{Lu}/u.test(word) && !/\d/.test(word);
    return shouted && (word.length >= 4 || SHOUTED_SHORT_WORDS.test(word)) ? word.toLowerCase() : word;
  });
  // Quoted words (DM "COURSES") are left exactly as written.
  const fixed = text.split(/("[^"\n]{1,30}"|“[^”\n]{1,30}”)/).map((part, index) => (index % 2 ? part : fixWords(part))).join("");
  return fixed.replace(/(^|[.!?]\s+|\n)(\p{Ll})/gu, (match, lead, letter) => lead + letter.toUpperCase());
}

/** Alt text describes the image: no contact details, and never cut off mid-word. */
export function cleanAltText(value: unknown) {
  let alt = String(value ?? "")
    .replace(EMAIL, "").replace(WEBSITE, "").replace(PHONE, (match) => (phoneDigits(match) >= 10 ? "" : match))
    .replace(/[\s,;:|-]*\b(contact( us)?|call|email|e-mail|visit|whatsapp|enroll now|scan the qr)\b[\s:,!]*(?=[,.;!|]|$)/giu, "")
    .replace(/\s*[,;:|]\s*(?=[,;:.|]|$)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/([.!?])[\s.!?]+/g, "$1 ")
    .replace(/[\s,;:|…-]+$/u, "")
    .trim();
  alt = fixCapitals(alt);
  if (alt.length > 125) {
    const cut = alt.slice(0, 122);
    // Cut inside a quote ("...text: 'Sometimes you just need to be somewhere"):
    // end it with an ellipsis and close the quote, so it reads as shortened.
    const opening = [...cut.matchAll(/(?:^|[\s:(])(["“‘'])(?=\p{L})/gu)].at(-1);
    const close = opening ? ({ "“": "”", "‘": "’" } as Record<string, string>)[opening[1]] || opening[1] : "";
    const rest = opening ? cut.slice((opening.index || 0) + opening[0].length) : "";
    const insideQuote = Boolean(opening) && !(close === "'" ? /'(?=[\s.,!?;:]|$)/.test(rest) : rest.includes(close));
    if (insideQuote && rest.includes(" ")) {
      alt = `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[\s,;:|-]+$/, "")}…${close}`;
    } else {
      const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(", "), cut.lastIndexOf(" - "));
      alt = (end > 60 ? cut.slice(0, end) : cut.slice(0, cut.lastIndexOf(" "))).replace(/[\s,;:|-]+$/, "");
    }
  }
  return alt && !/[.!?…]["'”’]?$/.test(alt) ? `${alt}.` : alt;
}

/** Brand spelling and prop clean-up for every written part, before the post is assembled. */
function polishRaw(raw: Record<string, unknown>, request: PostSeoRequest, known: string[] = []) {
  const polish = (value: unknown) => fixBrandSpelling(fixCapitals(dropPropPhrases(String(value ?? ""), request.description || ""), known), request.brandName || "").trim();
  const out: Record<string, unknown> = { ...raw };
  for (const key of TEXT_KEYS) {
    if (Array.isArray(out[key])) out[key] = (out[key] as unknown[]).map(polish).filter(Boolean);
    else if (typeof out[key] === "string") out[key] = polish(out[key]);
  }
  return out;
}

// Single words that say nothing (no one searches for "dish").
const GENERIC_PHRASES = /^(dish|food|image|photo|picture|post|product|item|thing|ai|data|cloud|coding|apis?)$/i;

const titleCase = (text: string) => text.replace(/(^|\s)(\p{Ll})/gu, (match, lead, letter) => lead + letter.toUpperCase());
const wordCount = (value: unknown) => String(value || "").trim().split(/\s+/).filter(Boolean).length;

/** Weak openers (a bare keyword or brand) are replaced by the first real sentence that follows. */
function strengthenOpening(raw: Record<string, unknown>, hookKey: string, bodyKey: string) {
  if (wordCount(raw[hookKey]) >= 4) return raw;
  const body = Array.isArray(raw[bodyKey]) ? [...(raw[bodyKey] as unknown[])] : [];
  const first = String(body[0] || "");
  const sentence = first.match(/^.+?[.!?](\s|$)/u)?.[0]?.trim();
  if (!sentence || sentence.length > 220) return raw;
  body[0] = first.slice(sentence.length).trim();
  return { ...raw, [hookKey]: sentence, [bodyKey]: body.filter((part) => String(part).trim()) };
}

const SMALL_TITLE_WORDS = /^(a|an|and|as|at|but|by|for|in|of|on|or|the|to|vs|via|with)$/i;

/**
 * "AWS data engineering with AI" -> "AWS Data Engineering with AI": short, name-like
 * title parts get title case; full sentences ("Learn the skill stack that...") keep sentence case.
 */
export function headlineCase(title: string) {
  return title.split(/(\s*[|:–—]\s*)/).map((part) => {
    if (wordCount(part) > 6 || /^\s*[|:–—]\s*$/.test(part)) return part;
    return part.split(/(\s+)/).map((word, index) => {
      // Leave spaces, capitalised words and brand spellings ("iPhone", "eBay") as they are.
      if (/^\s+$/.test(word) || !/^\p{Ll}/u.test(word) || /\p{Lu}/u.test(word.slice(1))) return word;
      return index > 0 && SMALL_TITLE_WORDS.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1);
    }).join("");
  }).join("");
}

function youtubeTitle(raw: Record<string, unknown>, keyword: string, brandName = "") {
  const title = cleanText(dropFiller(String(raw.title || "")), 100);
  const brand = squash(brandName);
  if (wordCount(title) >= 4 && squash(title) !== brand) return title;
  const summary = String(raw.summary || "").match(/^.+?[.!?](\s|$)/u)?.[0]?.trim().replace(/[.!]$/, "") || "";
  const base = titleCase(keyword || title);
  if (summary && summary.length <= 95 && summary.toLowerCase().includes(keyword.split(" ")[0] || "")) return summary;
  const extra = cleanText(raw.thumbnailText, 40);
  const built = [base, extra && squash(extra) !== squash(base) ? titleCase(extra.toLowerCase()) : "", brandName && !squash(base).includes(brand) ? brandName : ""].filter(Boolean);
  return cleanText(built.length > 1 ? `${built[0]}: ${built.slice(1).join(" | ")}` : built[0] || title, 100);
}

// ---- Facts read from the media: brand, offerings and contact details ------------

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
const WEBSITE = /(?<![@\p{L}\p{N}.])(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|in|ai|co|org|net|io|app|shop|store|me|info|biz|academy|edu|tech|dev)(?:\.[a-z]{2})?(?:\/[^\s,)]*)?/giu;
const PHONE = /(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s-]?)?\d{3,5}[\s-]?\d{3,6}/g;

/** The first match that passes the check, looking at each source in order (the author's own text first). */
function findFirst(pattern: RegExp, accept: (value: string) => boolean, ...sources: Array<string | undefined>) {
  for (const source of sources) {
    for (const match of String(source || "").matchAll(pattern)) {
      const value = match[0].trim().replace(/[.,)]+$/, "");
      if (accept(value)) return value;
    }
  }
  return "";
}

const phoneDigits = (value: string) => value.replace(/\D/g, "").length;
const domainOf = (value: string) => value.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("@").pop()!.split("/")[0];

export type ListBlock = { title: string; kind: "list" | "steps"; groups: Array<{ name: string; items: string[] }>; items: string[] };

const PACKED_SEPARATOR = /\s*(?:•|·|\||;|,|\/(?=\s))\s*/u;

/**
 * The poster's lists, cleaned and complete. Small models sometimes pack a
 * column into one entry ("AWS Cloud Fundamentals (S3 • IAM • VPC)") or a flow
 * into one line ("Raw Data → S3 → Glue"): those are unpacked here.
 */
export function listBlocksOf(sections: Analysis["sections"], cleanList: (values: unknown) => string[]): ListBlock[] {
  const blocks: ListBlock[] = [];
  for (const section of Array.isArray(sections) ? sections : []) {
    if (!section || section.kind === "statement") continue;
    const title = cleanList([section.title])[0] || "";
    const groups = (Array.isArray(section.groups) ? section.groups : [])
      .map((group) => ({ name: cleanList([group?.name])[0] || "", items: cleanList((Array.isArray(group?.items) ? group.items : []).flatMap((item) => String(item).split(PACKED_SEPARATOR))) }))
      .filter((group) => group.name);
    const items: string[] = [];
    let kind: ListBlock["kind"] = section.kind === "steps" ? "steps" : "list";
    for (const raw of Array.isArray(section.items) ? section.items : []) {
      const entry = String(raw).trim();
      if (/→|->|➜|⟶/.test(entry)) {
        kind = "steps";
        items.push(...entry.split(/\s*(?:→|->|➜|⟶)\s*/u));
        continue;
      }
      const packed = entry.match(/^([^(:•·|]{2,40}?)\s*(?:\(|:)\s*(.+?)\)?$/u);
      if (packed && PACKED_SEPARATOR.test(packed[2])) {
        groups.push({ name: cleanList([packed[1]])[0] || packed[1], items: cleanList(packed[2].split(PACKED_SEPARATOR)) });
        continue;
      }
      items.push(...(/[•·|]/u.test(entry) ? entry.split(/\s*[•·|]\s*/u) : [entry]));
    }
    // Sentences are a statement, not a list ("Learn how to build scalable data pipelines and..."): they are left to the writer.
    const sentences = items.filter((item) => wordCount(item) >= 9 || /\b(and|or|the|to|for|with|of)[,\s]*$/i.test(item.trim()));
    if (!groups.length && items.length && sentences.length >= Math.ceil(items.length / 2)) continue;
    const cleanItems = cleanList(items.filter((item) => !sentences.includes(item)));
    // A short run of names under a flow-like heading ("Build Real-World Projects": Raw Data, S3, Glue ETL...) is a flow.
    if (kind === "list" && !groups.length && cleanItems.length >= 4 && cleanItems.every((item) => wordCount(item) <= 3)
      && /\b(flow|pipeline|process|steps?|workflow|how it works|journey|roadmap|projects?)\b/i.test(title)) kind = "steps";
    if (groups.length || cleanItems.length) blocks.push({ title, kind, groups, items: groups.length ? [] : cleanItems });
  }
  // Several short plain lists in a row ("Snowflake", "DBT", "Airflow") read best as one grouped list.
  const merged: ListBlock[] = [];
  for (const block of blocks) {
    const plain = block.kind === "list" && !block.groups.length && block.title && block.title.split(/\s+/).length <= 3 && block.items.length >= 2;
    const previous = merged.at(-1);
    const next = blocks[blocks.indexOf(block) + 1];
    const nextPlain = next && next.kind === "list" && !next.groups.length && next.title && next.title.split(/\s+/).length <= 3 && next.items.length >= 2;
    if (plain && previous && previous.title === "" && previous.kind === "list") {
      previous.groups.push({ name: block.title, items: block.items });
    } else if (plain && nextPlain) {
      merged.push({ title: "", kind: "list", groups: [{ name: block.title, items: block.items }], items: [] });
    } else {
      merged.push(block);
    }
  }
  return merged.slice(0, 6);
}

/** True when most of a phrase's words ("Receives a goal or task") are already in the other text ("Understand: Receive your goal or task"). */
function sameWords(phrase: string, other: string) {
  const stems = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 2).map((word) => word.replace(/(es|s)$/, ""));
  const mine = stems(phrase);
  const theirs = new Set(stems(other));
  return mine.length > 0 && mine.filter((word) => theirs.has(word)).length / mine.length >= 0.6;
}

/** "S3, IAM, VPC & Cloud Architecture". */
const joinNice = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} & ${items.at(-1)}`);

/** "TINITIATE AI" -> "Tinitiate AI" (short acronyms stay in capitals). */
function readableName(value: string) {
  const name = String(value || "").replace(/\s+/g, " ").trim();
  if (name !== name.toUpperCase() || !/\p{Lu}/u.test(name)) return name;
  return name.split(" ").map((word) => (word.length <= 3 ? word : word.charAt(0) + word.slice(1).toLowerCase())).join(" ");
}

export type Facts = {
  brand: string; tagline: string; offerings: string[];
  /** The poster's lists when there is more than one simple list, each with its own heading. */
  blocks: ListBlock[];
  listHeading: string; slogan: string;
  website: string; email: string; phone: string;
};

/** Brand, offerings and contact details, exactly as written (the author's text wins over text read from the image). */
export function factsOf(analysis: Analysis, request: { description?: string; brandName?: string }): Facts {
  const description = request.description || "";
  const imageText = [analysis.website, analysis.email, analysis.phone, analysis.visibleText].join("\n");
  let email = findFirst(EMAIL, () => true, description, analysis.email, imageText);
  let website = findFirst(WEBSITE, (value) => !email || !value.includes("@"), description, analysis.website, imageText);
  const phone = findFirst(PHONE, (value) => phoneDigits(value) >= 10 && phoneDigits(value) <= 13, description, analysis.phone, imageText);

  const imageBrand = readableName(analysis.brand || "");
  const brand = request.brandName?.trim() || (imageBrand.length <= 40 && imageBrand.split(" ").length <= 5 ? imageBrand : "");

  // Text read from an image can be off by a letter ("tinitiaeai.com"): when the
  // website and email domains nearly match, use the one that matches the brand.
  // The author's own details are never changed.
  const authorEmail = Boolean(email) && description.includes(email);
  const authorWebsite = Boolean(website) && description.includes(website);
  if (website && email && !(authorEmail && authorWebsite) && domainOf(website) !== domainOf(email) && editDistance(domainOf(website), domainOf(email)) <= 2) {
    const target = squash(brand);
    const websiteFits = editDistance(squash(domainOf(website).split(".")[0]), target) <= editDistance(squash(domainOf(email).split(".")[0]), target);
    const better = authorWebsite ? domainOf(website) : authorEmail ? domainOf(email) : websiteFits ? domainOf(website) : domainOf(email);
    if (!authorWebsite) website = website.replace(new RegExp(domainOf(website).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), better);
    if (!authorEmail) email = `${email.split("@")[0]}@${better}`;
  }

  const cleanList = (values: unknown) => {
    const out: string[] = [];
    const list = Array.isArray(values) ? values.map(String) : [];
    // A whole list in capitals is poster shouting; one capital item among others ("COPY INTO") is deliberate.
    const shouting = list.length > 0 && list.every((item) => item === item.toUpperCase());
    for (const item of list) {
      const clean = (shouting ? readableName : (value: string) => value)(String(item).replace(/^[\s\-–—•*>➤▶►✅✔️→]+/u, "").replace(/[\s,;]+$/u, "").replace(/\s+/g, " ").trim());
      if (clean.length < 2 || squash(clean) === squash(brand) || clean.includes("@") || out.some((existing) => squash(existing) === squash(clean))) continue;
      out.push(clean);
    }
    return out;
  };
  const blocks = listBlocksOf(analysis.sections, cleanList);
  // One simple list keeps the classic "✅ item – benefit" layout.
  const simple = blocks.length === 1 && blocks[0].kind === "list" && !blocks[0].groups.length;
  const offerings = simple
    ? blocks[0].items
    : blocks.length
      ? cleanList(blocks.flatMap((block) => (block.groups.length ? block.groups.map((group) => group.name) : block.kind === "list" ? block.items : [])))
      : cleanList(analysis.offerings || []);
  const slogan = cleanText(analysis.slogan, 120);
  return {
    brand, tagline: cleanText(analysis.tagline, 80), offerings: offerings.slice(0, 14), blocks: simple ? [] : blocks,
    listHeading: simple ? blocks[0].title : "",
    slogan: squash(slogan) && squash(slogan) !== squash(analysis.tagline || "") ? slogan : "",
    website, email, phone,
  };
}

const BENEFIT_STOP_WORDS = new Set(["the", "and", "for", "with", "your", "you", "our", "learn", "master", "build", "get", "into", "from", "real", "skills", "skill"]);
const meaningfulWords = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3 && !BENEFIT_STOP_WORDS.has(word));

/**
 * A benefit is kept only if it really says something about its own item: not
 * another item's name ("AWS Data Engineering – Learn Machine Learning") and not
 * the item's own words again ("SnowFlake Data Engineering – Master Data Engineering").
 */
export function benefitOk(value: string, item: string, all: string[]) {
  const note = cleanText(dropFiller(value), 45).replace(/[.!]+$/, "").trim();
  if (note.length < 4 || squash(note) === squash(item) || /^(n\/?a|none|-+)$/i.test(note)) return "";
  const noteText = note.toLowerCase();
  const namesOther = all.some((other) => other !== item && squash(other).length >= 4 && (noteText.includes(other.toLowerCase()) || meaningfulWords(other).some((word) => word.length >= 4 && !meaningfulWords(item).includes(word) && noteText.includes(word))));
  if (namesOther) return "";
  const words = meaningfulWords(note);
  const own = meaningfulWords(item);
  if (words.length && words.filter((word) => own.includes(word)).length / words.length >= 0.6) return "";
  return note;
}

/** The automatic list of offerings and the contact block, in each app's style. */
function factBlocks(facts: Facts, platform: SeoPlatform, title: unknown, benefits: unknown = [], headings: unknown = []) {
  const bullet = platform === "instagram" || platform === "facebook" ? "✅" : "•";
  const heading = cleanText(title, 50).replace(/[.:\s]*$/, "") || facts.listHeading || "What we offer";
  const contact = [facts.phone && `📞 ${facts.phone}`, facts.email && `✉️ ${facts.email}`, facts.website && `🌐 ${facts.website}`].filter(Boolean).join("\n");
  if (facts.blocks.length) {
    // Each section keeps its own heading: the AI's (with an emoji that fits) when it
    // keeps the poster's meaning, otherwise the poster's own.
    const written = Array.isArray(headings) ? headings.map((value) => cleanText(value, 60).replace(/[.:\s]*$/, "")) : [];
    const plainEmoji = platform === "linkedin" || platform === "youtube";
    const list = facts.blocks.map((block, index) => {
      const own = block.title || (index === 0 ? heading : "");
      const mine = written[index] || "";
      const fits = mine && (!own || meaningfulWords(mine).some((word) => meaningfulWords(own).includes(word)) || own === heading);
      const label = (fits ? mine : own || heading).replace(plainEmoji ? /\p{Extended_Pictographic}️?\s*/gu : /$^/u, "");
      // A step with one entry ("Understand" -> "Receives a goal or task: ...") must not say its heading twice.
      const repeats = (name: string) => sameWords(name, `${label} ${own}`);
      const body = block.groups.length
        ? block.groups.map((group) => {
          const items = joinNice(group.items);
          if (block.groups.length === 1 && repeats(group.name)) return `${bullet} ${items || group.name}`;
          return `${bullet} ${group.name}${items ? `: ${items}` : ""}`;
        }).join("\n")
        : block.kind === "steps" ? block.items.join(" → ") : block.items.join(" • ");
      return `${label}${/[?!:]$/.test(label) ? "" : ":"}\n${body}`;
    }).join("\n\n");
    return { list, contact };
  }
  // "✅ Coding – Build real-world applications": the item stays exactly as written; the benefit is the AI's.
  const notes = Array.isArray(benefits) ? benefits : [];
  const valid = facts.offerings.map((item, index) => benefitOk(String(notes[index] ?? ""), item, facts.offerings));
  // Benefits for only some items read oddly, and small models sometimes shift
  // them by one: unless most are sound, the list shows the items alone.
  const useBenefits = valid.filter(Boolean).length >= Math.ceil(facts.offerings.length * 0.7);
  const list = facts.offerings.length >= 2
    ? `${heading}:\n${facts.offerings.map((item, index) => {
      const note = useBenefits ? valid[index] : "";
      return `${bullet} ${item}${note ? ` – ${note.charAt(0).toUpperCase()}${note.slice(1)}` : ""}`;
    }).join("\n")}`
    : "";
  return { list, contact };
}

const GENERIC_DM_WORDS = /^(course|courses|training|engineering|classes|class|program|programs|services?|products?|offer|sale|data|best|online)$/i;

/** The DM keyword when the model gave none: the main subject ("SNOWFLAKE", "AWS", "BIRYANI"). */
function dmFallback(facts: Facts, keyword: string) {
  // "aws data engineering" -> AWS; "snowflake data engineering" -> SNOWFLAKE; "chicken biryani" -> BIRYANI.
  const nouns = keyword.split(/\s+/).filter((word) => word.length >= 3 && !GENERIC_DM_WORDS.test(word));
  const acronym = nouns.find((word) => COMMON_ACRONYMS.some((known) => known.toLowerCase() === word.toLowerCase()));
  const name = facts.blocks[0]?.groups[0]?.name || "";
  return acronym || nouns.at(-1) || (/\s/.test(name) ? "" : name);
}

// Benefits a model might promise in a DM line without anyone saying so.
const PROMISE_WORDS = /\b(free|price|prices|pricing|fees?|discounts?|offers?|trials?|scholarships?|certificates?|certification|placements?|jobs?|internships?)\b/giu;

/** 📩 DM "AWS" for the full syllabus and batch details: a keyword call to action for business posts. */
function dmLine(raw: Record<string, unknown>, business: boolean, fallback = "", stated = "") {
  if (!business) return "";
  const asKey = (value: unknown) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 14);
  const key = asKey(raw.dmKeyword).length >= 3 ? asKey(raw.dmKeyword) : asKey(fallback);
  if (key.length < 3 || String(raw.cta || "").toUpperCase().includes(key)) return "";
  // What they get: the AI's words, unless it promises something nobody stated.
  // "Get the full guide." -> "the full guide" (it follows "for").
  let reason = cleanText(raw.dmReason, 70).replace(/^(for|to get|to receive|to|get|receive)\s+/i, "").replace(/[.!\s]+$/, "")
    .replace(/^(\p{Lu})(\p{Ll})/u, (match, first, next) => first.toLowerCase() + next)
    // "full syllabus and batch details available" -> "the full syllabus and batch details"
    .replace(/\s+(available|here|now|today)$/i, "")
    .replace(/^(full|complete|latest|detailed)\b/i, "the $1");
  const promised = [...reason.matchAll(PROMISE_WORDS)].map((match) => match[1].toLowerCase().replace(/s$/, ""));
  if (promised.some((word) => !stated.toLowerCase().includes(word)) || wordCount(reason) < 1) reason = "details";
  return `📩 DM "${key}" for ${reason}${/[!?]$/.test(reason) ? "" : "."}`;
}

const HASHTAG_ACRONYMS = new Set(["ai", "it", "ml", "bi", "aws", "gcp", "ui", "ux", "seo", "sql"]);

/** The city people search with: "Banjara Hills, Hyderabad" -> "Hyderabad". */
function cityOf(location: string) {
  const parts = location.split(",").map((part) => part.trim()).filter(Boolean);
  return (parts.length >= 3 ? parts[parts.length - 2] : parts[parts.length - 1]) || "";
}

/** One local hashtag (#HyderabadTechTraining) when the location is known: a strong local search signal. */
function withLocalTag(hashtags: string[], location: string, keyword: string, brandName = "", max = 5) {
  const city = cityOf(location);
  if (!city || hashtags.some((tag) => squash(tag).includes(squash(city)))) return hashtags;
  // The field people search locally: "aws data engineering course" -> "data engineering".
  // "aws data engineering with ai" -> "aws data engineering": the topic is before a joining word.
  const parts = keyword.split(/\s+/).filter(Boolean);
  const joiner = parts.findIndex((word, index) => index >= 2 && /^(with|for|in|at|using|and|by|on|to)$/i.test(word));
  const topic = (joiner > 0 ? parts.slice(0, joiner) : parts).filter((word) => !/^(with|for|in|at|using|and|by|on|to|the|a|an|of)$/i.test(word));
  while (topic.length > 2 && /^(course|courses|classes|class|program|programs)$/i.test(topic.at(-1)!)) topic.pop();
  const words = [...city.split(/\s+/), ...topic.slice(-2)].filter(Boolean)
    .map((word) => (HASHTAG_ACRONYMS.has(word.toLowerCase()) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()));
  const local = words.join("").replace(/[^\p{L}\p{N}]/gu, "");
  const tag = `#${local.length <= 28 ? local : city.replace(/[^\p{L}\p{N}]/gu, "")}`;
  const brand = squash(brandName);
  // Replace the last tag that is not the brand.
  const index = [...hashtags].reverse().findIndex((existing) => !brand || squash(existing) !== brand);
  if (index < 0) return [...hashtags, tag].slice(0, max);
  const position = hashtags.length - 1 - index;
  return hashtags.length < max ? [...hashtags, tag] : hashtags.map((existing, i) => (i === position ? tag : existing));
}

export type SeoCheck = { id: string; label: string; passed: boolean; tip: string };

/** The Instagram SEO scorecard (10 checks) shown with every result. */
export function instagramScore(input: { caption: string; hashtags: string[]; altText: string; facts: Facts; analysis: Analysis; request: PostSeoRequest; searchLine: string; cta: string }) {
  const { caption, hashtags, altText, facts, analysis, request } = input;
  if (!isBusinessPost(analysis, facts)) return creatorScore(input);
  const lower = caption.toLowerCase();
  const firstLine = caption.split("\n")[0] || "";
  const keyword = mainKeywordOf(analysis, facts.brand);
  const keywordWords = keyword.split(/\s+/).filter((word) => word.length > 2);
  const inFirstLine = keywordWords.filter((word) => firstLine.toLowerCase().includes(word.replace(/s$/, ""))).length;
  const city = cityOf(request.location || "");
  const brandTag = facts.brand ? cleanHashtags([facts.brand], 1)[0] : "";
  const checks: SeoCheck[] = [
    { id: "keyword", label: "Search keyword in the first line", passed: keywordWords.length > 0 && inFirstLine >= Math.ceil(keywordWords.length / 2), tip: `Start the caption with "${keyword}".` },
    { id: "hook", label: "First line fits before \"more\"", passed: firstLine.length <= 125 && firstLine.split(/\s+/).length >= 4, tip: "Keep the first line short and clear (under 125 characters)." },
    { id: "brand", label: "Brand named", passed: Boolean(facts.brand) && lower.includes(facts.brand.toLowerCase()), tip: "Add your brand name so people can find you by name." },
    { id: "search-line", label: "Says who it's for in search words", passed: input.searchLine.trim().length > 10, tip: "Add a line like \"Looking for …?\" in your customers' words." },
    { id: "structure", label: "Easy to scan", passed: caption.split(/\n\s*\n/).length >= 4 || /\n✅ /.test(caption), tip: "Break the caption into short blocks or a list." },
    { id: "facts", label: "All key details included", passed: facts.offerings.every((item) => caption.includes(item)) && facts.blocks.every((block) => [...block.items, ...block.groups.flatMap((group) => [group.name, ...group.items])].every((item) => caption.includes(item))) && [facts.phone, facts.email, facts.website].every((value) => !value || caption.includes(value)), tip: "Include every product or course and your contact details." },
    { id: "cta", label: "Clear call to action", passed: input.cta.trim().length > 5 || /📩 DM "/.test(caption), tip: "End with what to do next: DM, order, book or visit." },
    { id: "local", label: "Local search signal", passed: Boolean(city) && (lower.includes(city.toLowerCase()) || hashtags.some((tag) => squash(tag).includes(squash(city)))), tip: "Add your city or area in Business details (or keep the photo's location) for local search." },
    { id: "hashtags", label: "5 strong hashtags with your brand", passed: hashtags.length === 5 && (!brandTag || hashtags.includes(brandTag)), tip: "Use exactly 5 specific hashtags, including your brand." },
    { id: "alt", label: "Alt text for accessibility and search", passed: altText.length >= 20, tip: "Add alt text that describes the image." },
  ];
  return { score: checks.filter((check) => check.passed).length, max: checks.length, checks };
}

const wordsOf = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean);

/**
 * Creator posts (quotes, moods, humour, tips) are judged on what makes them
 * found and saved: the message up front, depth, conversation, saves and
 * hashtags for the theme, not on brand, offers or local search.
 */
function creatorScore(input: { caption: string; hashtags: string[]; altText: string; facts: Facts; analysis: Analysis; cta: string }) {
  const { caption, hashtags, altText, analysis } = input;
  const blocks = caption.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  const firstLine = caption.split("\n")[0] || "";
  const lower = caption.toLowerCase();
  const keyword = mainKeywordOf(analysis);
  const theme = [keyword, ...(analysis.searchKeywords || [])].flatMap((phrase) => wordsOf(String(phrase))).filter((word) => word.length >= 4 && !/^(quote|quotes|post|image|photo)$/.test(word));
  const keywordWords = wordsOf(keyword).filter((word) => word.length > 2);
  const quoteWords = wordsOf(analysis.quote || "");
  const captionWords = new Set(wordsOf(caption));
  const quoteUsed = quoteWords.length < 3 || quoteWords.filter((word) => captionWords.has(word)).length / quoteWords.length >= 0.8;
  const body = blocks.slice(1, -1).join(" ");
  const ending = blocks.slice(1).join("\n");
  const themeTags = hashtags.filter((tag) => theme.some((word) => squash(tag).includes(word))).length;
  const checks: SeoCheck[] = [
    { id: "message", label: "Leads with the post's message", passed: quoteUsed && !/^(this|look at|check out)\b/i.test(firstLine), tip: analysis.quote ? `Open with the line on your post: "${analysis.quote.slice(0, 80)}".` : "Open with the idea or feeling, not a description of the photo." },
    { id: "hook", label: "First line fits before \"more\"", passed: firstLine.length <= 125 && firstLine.split(/\s+/).length >= 4, tip: "Keep the first line short and clear (under 125 characters)." },
    { id: "keyword", label: "Theme words people search", passed: keywordWords.length > 0 && keywordWords.filter((word) => lower.includes(word.replace(/s$/, ""))).length >= Math.ceil(keywordWords.length / 2), tip: `Use "${keyword}" naturally in the caption.` },
    { id: "depth", label: "Goes deeper than the image", passed: wordsOf(body).length >= 30, tip: "Add 2-3 sentences that take the message further for your reader." },
    { id: "structure", label: "Easy to read", passed: blocks.length >= 3, tip: "Break the caption into short blocks." },
    { id: "conversation", label: "Invites replies", passed: /\?/.test(ending), tip: "Ask your audience a real question they will want to answer." },
    { id: "save", label: "Gives a reason to save or share", passed: /\b(save|share|send (this|it)|tag|bookmark|keep this)\b/i.test(ending), tip: "Add a reason to save or share it (saves and shares push posts the most)." },
    { id: "hashtags", label: "3-5 hashtags", passed: hashtags.length >= 3 && hashtags.length <= 5, tip: "Use 3-5 hashtags." },
    { id: "theme-tags", label: "Hashtags about the theme, not the picture", passed: themeTags >= 2, tip: `Use hashtags people follow for the theme, like #${camel(keyword)}.` },
    { id: "alt", label: "Alt text for accessibility and search", passed: altText.length >= 20, tip: "Add alt text that describes the image." },
  ];
  return { score: checks.filter((check) => check.passed).length, max: checks.length, checks };
}

export function fitToPlatform(platform: SeoPlatform, raw: Record<string, unknown>, request: PostSeoRequest, analysis: Analysis) {
  const facts = factsOf(analysis, request);
  // The brand read from the media counts as the brand when none was typed.
  request = { ...request, brandName: facts.brand || undefined };
  const business = isBusinessPost(analysis, facts);
  // Claims the author never made ("limited slots", "hurry") are removed.
  const stated = [request.description, request.businessDetails, analysis.visibleText, analysis.tagline, analysis.slogan, analysis.quote].join("\n");
  raw = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, TEXT_KEYS.includes(key) ? (Array.isArray(value) ? value.map((part) => dropUnstatedClaims(String(part), stated)).filter(Boolean) : typeof value === "string" ? dropUnstatedClaims(value, stated) : value) : value]));
  const blocks = factBlocks(facts, platform, raw.listTitle, raw.benefits, raw.sectionHeadings);
  let dm = platform === "instagram" ? dmLine(raw, business, dmFallback(facts, mainKeywordOf(analysis, facts.brand)), stated) : "";
  // A two-word call to action ("Visit now 📲") gives way to a fuller DM line.
  if (dm && wordCount(String(raw.cta || "").replace(/\p{Extended_Pictographic}/gu, "")) < 4) {
    raw = { ...raw, cta: "" };
    dm = dm.replace("for details.", "to get all the details today!");
  }
  raw = polishRaw(raw, request, [request.description || "", request.businessDetails || "", facts.brand, ...facts.offerings]);
  raw = platform === "youtube" ? raw : strengthenOpening(raw, "hook", "paragraphs");
  const allowHan = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(request.description || "");
  const collected: string[] = [];
  // The poster's own punchline ("Don't just store data. Build data systems.") closes the post, unless the AI already used it.
  const written = squash(TEXT_KEYS.map((key) => [raw[key]].flat().join(" ")).join(" "));
  const slogan = business && facts.slogan && !written.includes(squash(facts.slogan)) ? facts.slogan : "";
  const extras = { beforeKey: "cta", before: [blocks.list, slogan], after: [dm, blocks.contact] };
  if (platform === "instagram" && !raw.caption) raw = { ...raw, caption: assemble(raw, ["hook", "searchLine", "paragraphs", "cta"], collected, allowHan, extras) };
  if ((platform === "facebook" || platform === "linkedin") && !raw.post) raw = { ...raw, post: assemble(raw, ["hook", "paragraphs", "cta"], collected, allowHan, extras) };
  if (platform === "youtube" && !raw.description) raw = { ...raw, description: assemble(raw, ["summary", "paragraphs", "cta"], collected, allowHan, extras) };
  raw = { ...raw, hashtags: [...(Array.isArray(raw.hashtags) ? raw.hashtags : []), ...collected] };
  // No usable alt text from the image study: describe the post from what it says.
  const studied = cleanAltText(analysis.altText || raw.altText);
  const about = String(analysis.message || analysis.subject || mainKeywordOf(analysis, facts.brand) || "").trim();
  const alt = studied.length >= 20 || !about
    ? studied
    : cleanAltText(`${request.mediaKind === "video" ? "Video" : "Graphic"}${facts.brand ? ` by ${facts.brand}` : ""}: ${about.charAt(0).toUpperCase()}${about.slice(1)}`);
  const locationTag = request.location?.trim() || "";
  const phrases = [analysis.mainKeyword, analysis.subject, ...(analysis.searchKeywords || []), ...facts.offerings, request.brandName || "", locationTag].filter(Boolean);
  if (platform === "instagram") {
    const { text, moved } = splitTrailingHashtags(cleanText(raw.caption, 2200));
    const cleaned = cleanHashtags([...(raw.hashtags as string[] || []), ...moved], 5, request.description || "", phrases);
    // Creator posts keep the AI's theme hashtags: no forced brand or local tag.
    const hashtags = business
      ? withLocalTag(withBrandTag(cleaned, request.brandName, 5), locationTag, mainKeywordOf(analysis, request.brandName), request.brandName)
      : cleaned;
    const caption = cleanText(text, 2200 - hashtags.join(" ").length - 2);
    return {
      caption,
      hashtags,
      fullText: [caption, hashtags.join(" ")].filter(Boolean).join("\n\n"),
      seoScore: instagramScore({ caption, hashtags, altText: alt, facts, analysis, request, searchLine: String(raw.searchLine || ""), cta: String(raw.cta || "") }),
      altText: alt,
      onScreenText: cleanText(raw.onScreenText, 40),
      searchKeywords: [...new Set((Array.isArray(raw.searchKeywords) ? raw.searchKeywords : analysis.searchKeywords).map((keyword) => spaceCamel(String(keyword).replace(/^#/, "")).trim()).filter((keyword) => keyword && !PROP_WORDS.test(keyword) && !GENERIC_PHRASES.test(keyword)))].slice(0, 6),
      locationTag,
    };
  }
  if (platform === "facebook" || platform === "linkedin") {
    const limit = platform === "linkedin" ? 3000 : 5000;
    const { text, moved } = splitTrailingHashtags(cleanText(raw.post, limit));
    const max = platform === "linkedin" ? 5 : 3;
    const cleaned = cleanHashtags([...(raw.hashtags as string[] || []), ...moved], max, request.description || "", phrases);
    const hashtags = business
      ? withLocalTag(withBrandTag(cleaned, request.brandName, max), locationTag, mainKeywordOf(analysis, request.brandName), request.brandName, max)
      : cleaned;
    const post = cleanText(text, limit - hashtags.join(" ").length - 2);
    const seoScore = appScore(platform, { text: post, hashtags, altText: alt, facts, analysis, request, business });
    return { post, hashtags, fullText: [post, hashtags.join(" ")].filter(Boolean).join("\n\n"), seoScore, altText: alt, locationTag };
  }
  // YouTube
  const hashtags = withBrandTag(cleanHashtags(raw.hashtags, 3, request.description || "", phrases), request.brandName, 3, false);
  const description = cleanText(splitTrailingHashtags(String(raw.description || "")).text, 4800);
  const isShort = request.mediaKind === "video" && (request.durationSeconds || 0) <= 180 && request.orientation === "vertical";
  const title = headlineCase(youtubeTitle(raw, mainKeywordOf(analysis, request.brandName), request.brandName)).replace(/\p{Extended_Pictographic}️?\s*/gu, "").trim();
  const tags = youtubeTags([...(Array.isArray(raw.tags) ? raw.tags : []), ...facts.offerings.map((item) => item.toLowerCase())], phrases.map((phrase) => spaceCamel(String(phrase))));
  const thumbnailText = cleanText(raw.thumbnailText, 40);
  const finalTitle = isShort && !/#shorts/i.test(title) && title.length <= 92 ? `${title} #Shorts` : title;
  return {
    title: finalTitle,
    description: [description, hashtags.join(" ")].filter(Boolean).join("\n\n"),
    // Each offering is also a search phrase ("azure data engineering").
    tags,
    hashtags,
    thumbnailText,
    format: request.mediaKind === "video" ? (isShort ? "Short" : "Video") : "Community post",
    seoScore: appScore("youtube", { text: description, title: finalTitle, tags, thumbnailText, hashtags, altText: alt, facts, analysis, request, business }),
    locationTag,
  };
}

type ScoreInput = { text: string; title?: string; tags?: string[]; thumbnailText?: string; hashtags: string[]; altText: string; facts: Facts; analysis: Analysis; request: PostSeoRequest; business: boolean };

/**
 * SEO scorecard (10 checks) for Facebook, LinkedIn and YouTube, each by its own
 * rules: what that app shows before "more", how it ranks and what its people expect.
 */
export function appScore(platform: Exclude<SeoPlatform, "instagram">, input: ScoreInput) {
  const { text, hashtags, altText, facts, analysis, request, business } = input;
  const lower = text.toLowerCase();
  const blocks = text.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  const firstLine = text.split("\n")[0] || "";
  const keyword = mainKeywordOf(analysis, facts.brand);
  const keywordWords = keyword.split(/\s+/).filter((word) => word.length > 2);
  const hasKeyword = (part: string) => keywordWords.length > 0 && keywordWords.filter((word) => part.toLowerCase().includes(word.replace(/s$/, ""))).length >= Math.ceil(keywordWords.length / 2);
  const city = cityOf(request.location || "");
  const local = !business || (Boolean(city) && (lower.includes(city.toLowerCase()) || hashtags.some((tag) => squash(tag).includes(squash(city)))));
  const brandNamed = !business || (Boolean(facts.brand) && lower.includes(facts.brand.toLowerCase()));
  const allFacts = !business || (facts.offerings.every((item) => text.includes(item))
    && facts.blocks.every((block) => [...block.items, ...block.groups.flatMap((group) => [group.name, ...group.items])].every((item) => text.includes(item)))
    && [facts.phone, facts.email, facts.website].every((value) => !value || text.includes(value)));
  const ending = blocks.slice(-4).join("\n");
  const invites = /\?|\b(message|comment|call|book|order|visit|dm|share|tag|enrol|enroll|register|shop|join|reply|subscribe|check)\b/i.test(ending);
  const words = wordCount(text);
  const emoji = (text.match(/\p{Extended_Pictographic}/gu) || []).length;
  const altCheck: SeoCheck = { id: "alt", label: "Alt text for accessibility and search", passed: altText.length >= 20, tip: "Add alt text that describes the image." };
  const localTip = "Add your city in Business details for local search.";
  let checks: SeoCheck[];
  if (platform === "facebook") {
    checks = [
      { id: "keyword", label: "Search keyword in the first line", passed: hasKeyword(firstLine), tip: `Start with "${keyword}".` },
      { id: "hook", label: "First line fits before \"See more\"", passed: firstLine.length <= 125 && wordCount(firstLine) >= 4, tip: "Keep the first line under 125 characters." },
      { id: "brand", label: business ? "Brand named" : "Leads with the post's message", passed: brandNamed && !/^(this|look at|check out)\b/i.test(firstLine), tip: business ? "Name your brand so people can find you." : "Open with the idea, not a description of the photo." },
      { id: "structure", label: "Easy to read", passed: blocks.length >= 3, tip: "Use short paragraphs." },
      { id: "facts", label: business ? "All key details included" : "Goes deeper than the image", passed: business ? allFacts : wordCount(blocks.slice(1, -1).join(" ")) >= 25, tip: business ? "Include every item and your contact details." : "Add a few sentences that take the message further." },
      { id: "cta", label: "Invites messages, comments or shares", passed: invites, tip: "End with a question or a clear next step." },
      { id: "local", label: "Local search signal", passed: local, tip: localTip },
      { id: "hashtags", label: "1-3 focused hashtags", passed: hashtags.length >= 1 && hashtags.length <= 3, tip: "Use 1-3 specific hashtags on Facebook." },
      { id: "length", label: "Right length for the feed", passed: words >= 40 && words <= 450, tip: "Aim for 40-450 words." },
      altCheck,
    ];
  } else if (platform === "linkedin") {
    const opening = text.slice(0, 210);
    checks = [
      { id: "keyword", label: "Search keyword before \"see more\"", passed: hasKeyword(opening), tip: `Use "${keyword}" in the first lines.` },
      { id: "hook", label: "Opening fits before \"see more\"", passed: firstLine.length <= 210 && wordCount(firstLine) >= 5, tip: "Open with one strong line under 210 characters." },
      { id: "brand", label: business ? "Brand named" : "Leads with the post's message", passed: brandNamed, tip: "Name your company so people can find it." },
      { id: "structure", label: "Short paragraphs with white space", passed: blocks.length >= 4, tip: "Use 1-2 sentence paragraphs." },
      { id: "insight", label: "Real insight, not just an ad", passed: wordCount(blocks.slice(1, 4).join(" ")) >= 45, tip: "Add the problem, the approach and the outcome." },
      { id: "facts", label: business ? "All key details included" : "Invites discussion", passed: business ? allFacts : /\?/.test(ending), tip: business ? "Include every item and your contact details." : "End with a question for your network." },
      { id: "cta", label: "Clear next step or question", passed: invites, tip: "End with a next step or a question." },
      { id: "hashtags", label: "3-5 professional hashtags", passed: hashtags.length >= 3 && hashtags.length <= 5, tip: "Use 3-5 hashtags." },
      { id: "tone", label: "Professional (few emoji)", passed: emoji <= 6, tip: "Keep emoji to a few." },
      { id: "length", label: "Right length", passed: words >= 80 && words <= 600, tip: "Aim for 80-600 words." },
    ];
  } else {
    const title = input.title || "";
    const tags = input.tags || [];
    checks = [
      { id: "title-keyword", label: "Keyword at the start of the title", passed: hasKeyword(title.split(/\s+/).slice(0, 6).join(" ")), tip: `Start the title with "${keyword}".` },
      { id: "title-length", label: "Title fits in search (under 70)", passed: title.replace(/ #Shorts$/, "").length <= 70 && wordCount(title) >= 3, tip: "Keep the title under 70 characters." },
      { id: "summary", label: "Keyword in the first 2 lines", passed: hasKeyword(text.slice(0, 200)), tip: "Use the keyword in the first lines of the description." },
      { id: "description", label: "Detailed description", passed: words >= 80, tip: "Write at least 80 words: YouTube ranks on them." },
      { id: "facts", label: business ? "Details and links included" : "Invites comments", passed: business ? allFacts : /\?/.test(ending), tip: business ? "Include every item and your contact details or link." : "Ask viewers a question." },
      { id: "cta", label: "Asks to subscribe or comment", passed: /\b(subscribe|comment|like)\b/i.test(text), tip: "Ask viewers to subscribe and comment." },
      { id: "tags", label: "8+ search tags within 500 characters", passed: tags.length >= 8 && tags.join(",").length <= 500, tip: "Add 8-15 tags people search for." },
      { id: "tag-keyword", label: "Main keyword in the tags", passed: tags.some((tag) => hasKeyword(tag)), tip: `Add "${keyword}" as a tag.` },
      { id: "hashtags", label: "3 hashtags", passed: hashtags.length === 3, tip: "Add 3 hashtags; YouTube shows them above the title." },
      { id: "thumbnail", label: "Short thumbnail text", passed: wordCount(input.thumbnailText) >= 2 && wordCount(input.thumbnailText) <= 5, tip: "Use 2-5 bold words on the thumbnail." },
    ];
  }
  return { score: checks.filter((check) => check.passed).length, max: checks.length, checks };
}

// ---- Generation -----------------------------------------------------------------

const ANALYSIS_TASK = `Task: study the post the author gives you. First understand it as its audience would: what it is saying or offering, the feeling it carries, and what kind of post it is (selling something, a quote or reflection, a tip, humour, news or a personal moment). Text on the media usually carries the message. Use only what is really visible or stated. Read the brand, every listed product, course, service or menu item, and any website, email and phone number exactly as written. Keep other fields short.`;

/** Step 1: look at the media once. */
export async function analyzeMedia(request: Omit<PostSeoRequest, "platforms">): Promise<Analysis> {
  const analysis = await localAi.chat<Analysis>({
    temperature: 0.2,
    // Room for a full list of offerings and the contact details.
    // Room for nested lists (sections with columns) and the contact details.
    maxTokens: 1200,
    schema: ANALYSIS_SCHEMA,
    // Fixed instructions first (cached between posts), then this post's media and details.
    messages: [
      { role: "system", content: `${SYSTEM}\n\n${ANALYSIS_TASK}` },
      {
        role: "user",
        content: [
          ...request.images.slice(0, 6).map((url) => ({ type: "image_url", image_url: { url } })),
          { type: "text", text: `${contextBlock({ ...request, platforms: [] })}\n\nStudy this post now.` },
        ],
      },
    ],
  });
  return { ...analysis, altText: cleanAltText(analysis.altText) };
}

const squash = (value: string) => String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** The phrase posts are built around: never the brand name, never a prop. */
export function mainKeywordOf(analysis: Analysis, brandName = "") {
  const brand = squash(brandName);
  const candidates = [analysis.mainKeyword, analysis.subject, ...(analysis.searchKeywords || [])]
    .map((value) => spaceCamel(String(value || "").replace(/^#/, "")).trim());
  const usable = (value: string) => value.length > 2
    && !(brand && (squash(value) === brand || brand.includes(squash(value))))
    && !PROP_WORDS.test(value)
    && !/^(dish|food|product|service|image|poster|photo)$/i.test(value);
  return (candidates.find(usable) || candidates.find(Boolean) || "").toLowerCase();
}

/** The facts the writer works from, without photo props or stray '#'. */
export function writerBrief(analysis: Analysis, description = "", brandName = "") {
  const keep = (value: string) => {
    const prop = value.match(PROP_WORDS)?.[1];
    return !prop || description.toLowerCase().includes(prop.toLowerCase());
  };
  const facts = factsOf(analysis, { description, brandName });
  return {
    message: String(analysis.message || ""),
    mood: String(analysis.mood || ""),
    postType: analysis.postType || "",
    quoteOnMedia: String(analysis.quote || ""),
    audience: String(analysis.audience || ""),
    brand: facts.brand,
    tagline: facts.tagline,
    offerings: facts.blocks.length
      ? `${facts.blocks.length} list sections, added automatically in this order: ${facts.blocks.map((block, index) => `${index + 1}. ${block.title || "(no heading)"}${block.kind === "steps" ? " (steps)" : ""}: ${block.groups.length ? block.groups.map((group) => `${group.name} (${group.items.join(", ")})`).join("; ") : block.items.join(", ")}`).join(" | ")}`
      : facts.offerings.length ? `${facts.offerings.length} items, listed automatically: ${facts.offerings.join(", ")}` : "none",
    closingLine: facts.slogan ? `"${facts.slogan}" (added automatically before the call to action)` : "",
    contactDetails: facts.phone || facts.email || facts.website ? "added automatically" : "none",
    mainKeyword: mainKeywordOf(analysis, facts.brand || brandName),
    subject: dropPropPhrases(String(analysis.subject || ""), description) || mainKeywordOf(analysis, brandName),
    details: (analysis.details || []).filter(keep),
    visibleText: String(analysis.visibleText || "").split(/(?<=[.!?\n])\s*/).filter((line) => keep(line)).join(" ").trim(),
    searchKeywords: (analysis.searchKeywords || []).map((keyword) => spaceCamel(String(keyword).replace(/^#/, "")).trim()).filter((keyword) => keyword && keep(keyword)),
  };
}

const LIVE_KEYS = new Set(["hook", "searchLine", "paragraphs", "cta", "title", "summary"]);

/**
 * The caption so far, read from the AI's unfinished JSON answer
 * ({"hook":"AWS Data Eng...), so the page can show it while it is written.
 */
export function livePreview(partial: string) {
  const parts: string[] = [];
  let key = "";
  let index = 0;
  while (index < partial.length) {
    if (partial[index] !== "\"") { index += 1; continue; }
    let end = index + 1;
    let value = "";
    while (end < partial.length && partial[end] !== "\"") {
      if (partial[end] === "\\") {
        const next = partial[end + 1];
        if (next === undefined) break;
        if (next === "u") {
          const hex = partial.slice(end + 2, end + 6);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) value += String.fromCharCode(parseInt(hex, 16));
          end += 6;
          continue;
        }
        value += next === "n" ? "\n" : next === "t" ? " " : next;
        end += 2;
        continue;
      }
      value += partial[end];
      end += 1;
    }
    let after = end + 1;
    while (after < partial.length && /\s/.test(partial[after])) after += 1;
    if (end < partial.length && partial[after] === ":") key = value;
    else if (LIVE_KEYS.has(key) && value.trim()) parts.push(value.trim());
    index = end + 1;
  }
  return parts.join("\n\n");
}

/**
 * Only ask for the parts this post can use: a poster with several sections
 * needs section headings but no single-list benefits, a post without lists
 * needs neither. Fewer empty fields to write means a faster answer, and the
 * finished post is the same.
 */
export function schemaFor(schema: object, facts: Facts) {
  const base = schema as { required?: string[]; properties?: Record<string, unknown> };
  if (!base.properties) return schema;
  const singleList = facts.blocks.length === 0 && facts.offerings.length >= 2;
  const unused = new Set<string>([
    ...(facts.blocks.length ? [] : ["sectionHeadings"]),
    ...(singleList ? [] : ["benefits"]),
    ...(singleList || facts.blocks.length ? [] : ["listTitle"]),
  ]);
  if (facts.blocks.length && "listTitle" in base.properties) unused.delete("listTitle"); // the heading for an untitled first section
  const properties: Record<string, unknown> = Object.fromEntries(Object.entries(base.properties).filter(([key]) => !unused.has(key)));
  // Exactly one heading per section, so none is skipped.
  if (facts.blocks.length && properties.sectionHeadings) {
    properties.sectionHeadings = { ...(properties.sectionHeadings as object), minItems: facts.blocks.length, maxItems: facts.blocks.length };
  }
  return { ...schema, properties, required: (base.required || []).filter((key) => !unused.has(key)) };
}

/** Step 2: write a ready-to-post result for one app from the analysis (text only, so it is quicker). */
export async function writeForPlatform(platform: SeoPlatform, original: Omit<PostSeoRequest, "platforms" | "images">, analysis: Analysis, onLive?: (text: string) => void) {
  // The brand read from the media (e.g. the logo) is used when none was typed.
  const facts = factsOf(analysis, original);
  const request = { ...original, brandName: facts.brand || undefined };
  const business = isBusinessPost(analysis, facts);
  const creator = !business;
  const base = platform === "instagram" && creator ? INSTAGRAM_CREATOR : PLATFORM_SPECS[platform];
  // Creator posts on the other apps keep the app's format, written for message and mood.
  const spec = creator && platform !== "instagram" ? { ...base, brief: `${base.brief}\n${CREATOR_NOTE}` } : base;
  const context = contextBlock({ ...request, images: [], platforms: [] });
  const keyword = mainKeywordOf(analysis, request.brandName);
  const keywordUse = creator ? "use it naturally in the caption and the hashtags" : "use it in the first line and the hashtags";
  const finish = creator
    ? "Make it a caption people feel, save and share, and that Instagram search can find: true to the post's message and mood, specific and human."
    : "Make it the best possible SEO post for this app: specific, keyword-rich and natural.";
  const raw = await localAi.chat<Record<string, unknown>>({
    temperature: 0.7,
    maxTokens: platform === "youtube" ? 900 : 800,
    schema: schemaFor(spec.schema, facts),
    onText: onLive ? (soFar) => onLive(livePreview(soFar)) : undefined,
    // The fixed instructions come first, so the engine's prompt cache reuses them
    // from the previous post for this app and only reads this post's details.
    messages: [
      { role: "system", content: `${SYSTEM}\n\n${spec.brief}\n\n${finish}` },
      {
        role: "user",
        content: `${context}\n\nWhat the post is (from careful analysis):\n${JSON.stringify(writerBrief(analysis, request.description, request.brandName))}\n\nMain keyword: "${keyword}" (${keywordUse})\n\nWrite the ${platform === "youtube" ? "YouTube upload" : `${platform.charAt(0).toUpperCase()}${platform.slice(1)} post`} now.`,
      },
    ],
  });
  return fitToPlatform(platform, raw, { ...request, images: [], platforms: [platform] }, analysis);
}

/** Both steps for several apps in one call. */
export async function generatePostSeo(request: PostSeoRequest) {
  const started = Date.now();
  const analysis = await analyzeMedia(request);
  const analysedAt = Date.now();
  const results: Partial<Record<SeoPlatform, unknown>> = {};
  for (const platform of request.platforms) results[platform] = await writeForPlatform(platform, request, analysis);
  return { analysis, results, timings: { analysisMs: analysedAt - started, totalMs: Date.now() - started } };
}
