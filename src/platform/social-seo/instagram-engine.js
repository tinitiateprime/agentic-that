// Instagram Social SEO engine. Pure and deterministic: the same input always
// produces the same suggestions, so results are explainable and testable.

import { INSTAGRAM_CTAS, INSTAGRAM_HOOKS, INSTAGRAM_RULES as RULES, capital, pickIndex, pluralize } from "./instagram-rules.js";
import { emojiForItem, localTagsFor, matchTopics } from "./topics.js";
import {
  INTENTS,
  LOW_VALUE_HASHTAGS,
  authorCasing,
  cleanText,
  containsPhrase,
  detectBrand,
  detectBusinessName,
  detectIntent,
  extractHashtags,
  extractKeywordPhrases,
  extractLinks,
  extractListItems,
  normalizeCaps,
  sentenceCase,
  splitSentences,
  toHashtag,
  truncateAtWord,
} from "./text-analysis.js";

export class SocialSeoInputError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
    this.code = "SOCIAL_SEO_INVALID_INPUT";
  }
}

const finite = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0);

export function normalizeMedia(items) {
  if (!Array.isArray(items) || !items.length) throw new SocialSeoInputError("Add at least one photo or video.");
  if (items.length > 30) throw new SocialSeoInputError("Add up to 30 media files.");
  return items.map((item, index) => {
    const kind = item?.kind === "video" ? "video" : item?.kind === "image" ? "image" : "";
    if (!kind) throw new SocialSeoInputError(`Media ${index + 1} must be a photo or video.`);
    const cover = item?.coverFrame && Number.isFinite(Number(item.coverFrame.time))
      ? { time: Math.max(0, Number(item.coverFrame.time)) }
      : null;
    return {
      kind,
      name: cleanText(item?.name, 160),
      mimeType: cleanText(item?.mimeType, 60).toLowerCase(),
      width: Math.round(finite(item?.width)),
      height: Math.round(finite(item?.height)),
      durationSeconds: kind === "video" ? Number(finite(item?.durationSeconds).toFixed(2)) : 0,
      sizeBytes: Math.round(finite(item?.sizeBytes)),
      coverFrame: kind === "video" ? cover : null,
    };
  });
}

function normalizeLocation(location) {
  const city = cleanText(location?.city, 80);
  if (!city) return null;
  const area = cleanText(location?.area, 80);
  return { city, area: area.toLowerCase() === city.toLowerCase() ? "" : area, region: cleanText(location?.region, 80), country: cleanText(location?.country, 80) };
}

function formatTime(seconds) {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function ratioLabel(width, height) {
  if (!width || !height) return "unknown shape";
  const ratio = width / height;
  const known = [[9 / 16, "9:16"], [3 / 4, "3:4"], [4 / 5, "4:5"], [1, "1:1"], [16 / 9, "16:9"], [1.91, "1.91:1"], [4 / 3, "4:3"], [2 / 3, "2:3"], [3 / 2, "3:2"]];
  const match = known.find(([value]) => Math.abs(value - ratio) < 0.015);
  return match ? match[1] : `${ratio.toFixed(2)}:1`;
}

function check(id, status, title, detail) {
  return { id, status, title, detail };
}

function photoChecks(item, label = "Photo") {
  const checks = [];
  const { width, height } = item;
  if (!width || !height) {
    checks.push(check("photo-size", "warn", `${label}: size unknown`, "We could not read the dimensions. Use 1080 px wide for a sharp result."));
    return checks;
  }
  const ratio = width / height;
  const shape = ratioLabel(width, height);
  if (ratio >= 0.74 && ratio <= 0.81) {
    checks.push(check("photo-ratio", "pass", `${label}: ${shape} portrait`, "Portrait photos take up the most space in the feed."));
  } else if (ratio < RULES.photo.minRatio) {
    checks.push(check("photo-ratio", "warn", `${label}: ${shape} is taller than Instagram allows`, "The feed will crop it to 4:5. Crop it yourself first so nothing important is cut off."));
  } else if (ratio > RULES.photo.maxRatio) {
    checks.push(check("photo-ratio", "fail", `${label}: ${shape} is wider than Instagram allows`, "It will be cropped to 1.91:1. Crop to 4:5 or 3:4 portrait instead."));
  } else if (Math.abs(ratio - 1) < 0.02) {
    checks.push(check("photo-ratio", "warn", `${label}: 1:1 square`, "Square works, but a 4:5 or 3:4 portrait shows larger in the feed and fits the profile grid better."));
  } else {
    checks.push(check("photo-ratio", "warn", `${label}: ${shape} landscape`, "Landscape photos show small in the feed. Crop to 4:5 or 3:4 portrait if you can."));
  }
  if (width < RULES.photo.minimumWidth) {
    checks.push(check("photo-resolution", "fail", `${label}: low resolution (${width} × ${height})`, `This will look blurry. Use at least ${RULES.photo.recommendedWidth} px wide.`));
  } else if (width < RULES.photo.recommendedWidth) {
    checks.push(check("photo-resolution", "warn", `${label}: ${width} × ${height}`, `Instagram shows photos at ${RULES.photo.recommendedWidth} px wide. A larger original will look sharper.`));
  } else {
    checks.push(check("photo-resolution", "pass", `${label}: ${width} × ${height}`, "The resolution is sharp enough for the feed."));
  }
  if (item.sizeBytes > RULES.photo.softMaxBytes) {
    checks.push(check("photo-file", "warn", `${label}: large file (${(item.sizeBytes / 1048576).toFixed(1)} MB)`, "Instagram compresses large photos heavily. Export at 1080 px wide as a high-quality JPEG."));
  }
  return checks;
}

function reelChecks(item) {
  const checks = [];
  const { width, height, durationSeconds } = item;
  if (width && height) {
    const ratio = width / height;
    const shape = ratioLabel(width, height);
    if (Math.abs(ratio - RULES.reel.ratio) <= RULES.reel.ratioTolerance) {
      checks.push(check("reel-ratio", "pass", "Vertical 9:16", "The Reel fills the whole phone screen."));
    } else if (ratio < 1) {
      checks.push(check("reel-ratio", "warn", `${shape} vertical`, "It will not fill the screen. Re-export at 9:16 (1080 × 1920)."));
    } else {
      checks.push(check("reel-ratio", "fail", `${shape} ${ratio > 1.02 ? "landscape" : "square"}`, "Reels are watched full-screen and vertical. Re-edit at 9:16 (1080 × 1920)."));
    }
    const shortSide = Math.min(width, height);
    const longSide = Math.max(width, height);
    if (longSide >= RULES.reel.recommendedHeight && shortSide >= RULES.reel.recommendedWidth) {
      checks.push(check("reel-resolution", "pass", `${width} × ${height}`, "Full HD, so it stays sharp after Instagram compresses it."));
    } else if (longSide >= RULES.reel.minimumHeight) {
      checks.push(check("reel-resolution", "warn", `${width} × ${height}`, "Upload at 1080 × 1920 for the sharpest result."));
    } else {
      checks.push(check("reel-resolution", "fail", `Low resolution (${width} × ${height})`, "This will look blurry. Export at 1080 × 1920."));
    }
  } else {
    checks.push(check("reel-ratio", "warn", "Video size unknown", "We could not read the video. Use 1080 × 1920 (9:16)."));
  }
  if (durationSeconds) {
    if (durationSeconds < RULES.reel.minSeconds) {
      checks.push(check("reel-length", "fail", `${durationSeconds.toFixed(1)} s is too short`, `Reels need at least ${RULES.reel.minSeconds} seconds.`));
    } else if (durationSeconds <= RULES.reel.shortSeconds) {
      checks.push(check("reel-length", "pass", `${formatTime(durationSeconds)} long`, "A short Reel is easier to watch to the end, which helps it get shown to more people."));
    } else if (durationSeconds <= RULES.reel.maxSeconds) {
      checks.push(check("reel-length", "warn", `${formatTime(durationSeconds)} long`, "This is allowed. If you can trim it under 1:30, more people are likely to watch it to the end."));
    } else {
      checks.push(check("reel-length", "fail", `${formatTime(durationSeconds)} is over the Reel limit`, `Reels can be up to ${RULES.reel.maxSeconds / 60} minutes. Trim it, or longer videos may not be recommended as Reels.`));
    }
  }
  if (item.sizeBytes > RULES.reel.softMaxBytes) {
    checks.push(check("reel-file", "warn", `Large file (${(item.sizeBytes / 1073741824).toFixed(1)} GB)`, "Large uploads are slow and compressed heavily. Export as H.264 MP4 at 1080 × 1920."));
  }
  checks.push(check("reel-safe-zone", "info", "Keep text inside the safe zone", RULES.reel.safeZone));
  return checks;
}

export function analyzeInstagramFormat(media) {
  const images = media.filter((item) => item.kind === "image");
  const videos = media.filter((item) => item.kind === "video");
  let type;
  let label;
  let checks = [];
  let cover = null;

  if (media.length > 1) {
    type = "carousel";
    label = `Carousel · ${media.length} slides`;
    if (media.length > RULES.carouselMaxItems) {
      checks.push(check("carousel-count", "fail", `${media.length} slides is over the limit`, `Instagram carousels hold up to ${RULES.carouselMaxItems} photos and videos. Split it into two posts.`));
    } else {
      checks.push(check("carousel-count", "pass", `${media.length} slides`, "Carousels give people a reason to swipe, and every swipe counts as engagement."));
    }
    const shapes = new Set(media.filter((item) => item.width && item.height).map((item) => ratioLabel(item.width, item.height)));
    if (shapes.size > 1) {
      checks.push(check("carousel-shapes", "warn", "Slides have different shapes", `Instagram crops every slide to the first slide's shape (${ratioLabel(media[0].width, media[0].height)}). Crop them all to 4:5 first.`));
    }
    media.forEach((item, index) => {
      const itemChecks = item.kind === "image" ? photoChecks(item, `Slide ${index + 1}`) : reelChecks(item).filter((entry) => entry.id !== "reel-safe-zone");
      checks.push(...itemChecks.filter((entry) => entry.status !== "pass" || index === 0));
    });
  } else if (videos.length) {
    type = "reel";
    label = "Reel";
    checks = reelChecks(videos[0]);
    if (videos[0].coverFrame) cover = { time: videos[0].coverFrame.time, label: formatTime(videos[0].coverFrame.time) };
  } else {
    type = "photo";
    label = "Photo post";
    checks = photoChecks(images[0]);
  }
  if (type === "photo" || type === "carousel") {
    checks.push(check("grid-crop", "info", "Profile grid preview", "Your profile grid shows posts as 3:4 rectangles. Keep the subject near the centre so the preview isn't cut off."));
  }
  return { type, label, checks, cover };
}


// ---- Brand ------------------------------------------------------------------

const PLACEHOLDER_BRANDS = /^(workspace|workspace user|my business|business|test|demo)$/i;

/**
 * Brand priority: what the user typed, then a brand named in the description
 * that matches its website, then the workspace name.
 */
export function resolveBrand({ brandName, workspaceName, description }) {
  const typed = cleanText(brandName, 60);
  if (typed && !PLACEHOLDER_BRANDS.test(typed)) return { name: typed, source: "you" };
  const detected = detectBrand(description);
  if (detected) return { name: detected, source: "website" };
  const named = detectBusinessName(description);
  if (named) return { name: named, source: "description" };
  const workspace = cleanText(workspaceName, 60);
  if (workspace && !PLACEHOLDER_BRANDS.test(workspace)) return { name: workspace, source: "workspace" };
  return null;
}

// ---- Keywords ---------------------------------------------------------------

/** The phrases worth checking against search suggestions (used by the server). */
export function searchQueriesFor({ description, fileNames = [], brandName = "" }) {
  const brand = resolveBrand({ brandName, description });
  const phrases = extractKeywordPhrases(description, { limit: 6, fileNames, exclude: brand ? [brand.name] : [] })
    .filter((entry) => !entry.weak);
  const multi = phrases.filter((entry) => entry.words.length >= 2).slice(0, 3).map((entry) => entry.phrase);
  return multi.length ? multi : phrases.slice(0, 1).map((entry) => entry.phrase);
}

function chooseKeywords({ description, signals, intent, fileNames, brand, topicWords }) {
  const phrases = extractKeywordPhrases(description, { limit: 18, fileNames, exclude: brand ? [brand.name] : [] });
  const colonList = splitSentences(description).map((sentence) => findList(sentence, [])).find(Boolean);
  const leadText = colonList?.lead || "";
  const itemsText = colonList ? colonList.items.join(" , ") : "";
  const intentWords = new Set(intent.hits.flatMap((hit) => hit.split(" ")));
  const suggestions = (signals?.searchSuggestions || []).map((entry) => cleanText(entry, 120).toLowerCase()).filter(Boolean);
  const ranked = phrases.map((entry) => {
    const validated = suggestions.some((suggestion) => containsPhrase(suggestion, entry.phrase));
    // Partial credit when people search the core of a longer phrase
    // ("cotton kurtis" for "handmade cotton kurtis").
    const core = entry.words.length === 3 ? entry.words.slice(1).join(" ") : "";
    const partlyValidated = !validated && core && suggestions.some((suggestion) => containsPhrase(suggestion, core));
    // Phrases that name the subject ("biryani", "skill stack") beat incidental
    // phrases such as a street or kitchen name.
    const subjectBonus = entry.words.some((word) => intentWords.has(word)) ? 2 : 0;
    const topicBonus = entry.words.some((word) => topicWords.has(word)) || topicWords.has(entry.phrase) ? 1.5 : 0;
    // Business and person names make poor topic keywords (they get the brand
    // tag instead), except for named events and job titles.
    const namePenalty = entry.proper && !["event", "jobs"].includes(intent.id) ? 3 : 0;
    const listLead = leadText && containsPhrase(leadText, entry.phrase) ? 3 : 0;
    const listDetail = itemsText && containsPhrase(itemsText, entry.phrase) && !listLead ? 2 : 0;
    return {
      ...entry,
      display: authorCasing(entry.phrase, description),
      validated,
      rank: entry.score + subjectBonus + topicBonus + listLead - listDetail + (validated ? 2.5 : partlyValidated ? 1.5 : 0) - namePenalty,
    };
  }).sort((a, b) => b.rank - a.rank || a.phrase.localeCompare(b.phrase));

  for (const entry of [...ranked]) {
    if (entry.validated || entry.weak || entry.words.length !== 3) continue;
    // "personalised resin keychains" -> "resin keychains" (keeps the noun);
    // "bridal makeup trial" -> "bridal makeup" (the last word only qualifies it).
    const modifierLast = /^(trial|session|sessions|package|packages|collection|class|classes|course|courses|offer|offers|sale|service|services|menu|combo|program|programme|plan|plans|day|look|looks|batch|tips|ideas)$/.test(entry.words[2]);
    for (const words of modifierLast ? [entry.words.slice(0, 2), entry.words.slice(1)] : [entry.words.slice(1)]) {
      const phrase = words.join(" ");
      if (ranked.some((other) => other.phrase === phrase) || !suggestions.some((suggestion) => containsPhrase(suggestion, phrase))) continue;
      ranked.push({ ...entry, phrase, words, display: authorCasing(phrase, description), validated: true, rank: entry.rank + 1.5 });
    }
  }
  ranked.sort((a, b) => b.rank - a.rank || a.phrase.localeCompare(b.phrase));
  const strong = ranked.filter((entry) => !entry.weak);
  let primary = strong[0] || null;
  // A single word ("trek") is less useful than the phrase that names it
  // ("Himalayan trek"), so prefer the strongest phrase containing it.
  if (primary?.words.length === 1) {
    const fuller = strong.find((entry) => entry.words.length > 1 && entry.words.includes(primary.words[0]));
    if (fuller) primary = fuller;
  }
  const secondary = [];
  for (const entry of strong) {
    if (secondary.length >= 5) break;
    if (entry === primary || secondary.some((existing) => existing.phrase === entry.phrase)) continue;
    // Skip phrases that only repeat words of the main keyword ("skill" for "skill stack").
    if (primary && entry.words.every((word) => primary.words.includes(word))) continue;
    secondary.push(entry);
  }
  // Comma lists ("Coding, APIs, Data analytics, Cloud") name the topics directly.
  const listItems = extractListItems(description).filter((item) => !primary || item.toLowerCase() !== primary.phrase);

  const primaryWords = new Set(primary?.words || []);
  const needed = Math.min(2, primaryWords.size);
  const searchPhrases = [...new Set(suggestions)]
    .filter((suggestion) => {
      const words = suggestion.split(/\s+/);
      return words.length >= 2 && words.length <= 6 && words.filter((word) => primaryWords.has(word)).length >= needed;
    })
    .slice(0, 6);
  return { primary, secondary, listItems, searchPhrases, signalsUsed: suggestions.length > 0 };
}

// ---- Hashtags ---------------------------------------------------------------

const HASHTAG_GROUPS = Object.freeze([
  { id: "post", label: "About this post" },
  { id: "niche", label: "Your niche" },
  { id: "local", label: "Local" },
  { id: "yours", label: "From your description" },
  { id: "brand", label: "Brand" },
]);

function normalizeTag(tag) {
  const body = String(tag || "").replace(/^#/, "").replace(/[^\p{L}\p{M}\p{N}_]/gu, "");
  if (body.length < 3 || body.length > 30 || /^\d+$/.test(body)) return "";
  const calm = /^[\p{Lu}\d_]{5,}$/u.test(body) ? body.charAt(0) + body.slice(1).toLowerCase() : body;
  return `#${calm}`;
}

// "#Biryani" and "#BiryaniLovers", or "#Kurti" and "#Kurtis", say the same thing.
function sameFamily(a, b) {
  const x = a.slice(1).toLowerCase().replace(/s$/, "");
  const y = b.slice(1).toLowerCase().replace(/s$/, "");
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  const shortWords = (x.length <= y.length ? a : b).slice(1).split(/(?=\p{Lu}\p{Ll})/u).filter(Boolean).length;
  if (short.length >= 6 && long.endsWith(short) && shortWords > 1) return true;
  return short.length >= 5 && long.startsWith(short)
    && /^(lover|lovers|love|life|gram|daily|vibes|time|of\w*|session|sessions|trial|package|packages|service|services|class|classes|course|courses|offer|offers|tips|ideas|day|look)?$/.test(long.slice(short.length));
}

// How many chosen tags share a core word with this one (#Kurti, #CottonKurtis, #HandmadeCottonKurtis).
function headWord(tag) {
  const words = tag.slice(1).split(/(?=\p{Lu}\p{Ll})/u).filter(Boolean);
  return (words.at(-1) || "").toLowerCase().replace(/s$/, "");
}

function familyCount(selected, tag) {
  const head = headWord(tag);
  if (head.length < 4) return 0;
  return selected.filter((entry) => headWord(entry.tag) === head).length;
}

function containsAllWords(text, phrase) {
  return phrase.split(/\s+/).every((word) => containsPhrase(text, word));
}

function buildHashtags({ description, primary, secondary, listItems, searchPhrases, userTags, location, brand, intent, topics }) {
  const candidates = new Map();
  const add = (rawTag, group, score, reason, topicId = "") => {
    const tag = normalizeTag(rawTag);
    if (!tag) return;
    const key = tag.toLowerCase();
    if (LOW_VALUE_HASHTAGS.has(key.slice(1))) return;
    const existing = candidates.get(key);
    if (!existing || existing.score < score) candidates.set(key, { tag: existing?.tag || tag, group: existing && existing.group === "yours" ? "yours" : group, score, reason, topicId: topicId || existing?.topicId || "" });
  };
  const topScore = topics[0]?.score || 0;
  const relevantTopics = topics.filter((match, rank) => rank === 0 || match.topic.intent === intent.id || match.score >= topScore * 0.5);
  const topicWordSet = new Set(relevantTopics.flatMap((match) => [match.hits, match.hits.flatMap((hit) => hit.split(" "))].flat()));
  const usablePrimary = primary && !primary.weak && primary.words.length <= 3;

  userTags.forEach((tag) => add(toHashtag(tag) || `#${tag}`, "yours", 95, "You used this in your description"));
  if (usablePrimary) {
    const strongKeyword = primary.validated || primary.words.some((word) => topicWordSet.has(word)) || topicWordSet.has(primary.phrase);
    add(toHashtag(primary.display), "post", strongKeyword ? 90 : 74, primary.validated ? "Your main keyword, and people search for it" : "Your main keyword");
    // A shorter form is only used when people search for it on its own, so
    // "cold brew coffee" never becomes the meaningless #BrewCoffee.
    const broader = primary.words.length === 3 ? primary.words.slice(1).join(" ") : "";
    if (broader && searchPhrases.some((phrase) => containsPhrase(phrase, broader) && !containsPhrase(phrase, primary.phrase))) {
      add(toHashtag(broader), "post", 76, "A shorter form people search for");
    }
  }
  // Search phrases are only used when every word is the author's own: other
  // businesses ("skill stack academy") must never become a tag.
  const searchTag = searchPhrases.find((phrase) => phrase.split(/\s+/).length <= 3 && phrase !== primary?.phrase && containsAllWords(description, phrase));
  if (searchTag) add(toHashtag(searchTag), "post", 72, "Matches a phrase people search for");

  // Library tags for the detected topics: exact trigger tags first ("#Python"),
  // then each topic's tags from most to least specific.
  const relevant = topics.filter((match, rank) => rank === 0 || match.topic.intent === intent.id || match.score >= topScore * 0.5
    || (match.topic.id === "festivals" && intent.id === "sale"));
  relevant.slice(0, 4).forEach((match, rank) => {
    const base = 80 - rank * 4;
    match.triggerTags.forEach(({ tag, hit, strength, index = 0 }) => {
      // A festival in a sale post becomes the sale tag (#DiwaliSale), not a greeting.
      if (match.topic.id === "festivals" && intent.id === "sale") {
        add(`#${capital(hit.replace(/[^\p{L}]/gu, ""))}Sale`, "niche", 86, `Festive sale tag for ${hit}`, match.topic.id);
        return;
      }
      const boost = strength === 2 ? 6 : strength === 1 ? 1 : rank === 0 ? 0 : -4;
      add(tag, "niche", base + boost - index * 2, `Popular tag for ${hit}`, match.topic.id);
    });
    match.topic.tags.forEach((tag, index) => add(tag, "niche", base - index * 3 + (index === 0 ? 2 : 0), `Popular tag for ${topicLabel(match.topic)}`, match.topic.id));
  });

  if (location) {
    const localScore = intent.local ? 82 : 58;
    localTagsFor(relevant.slice(0, 2), location).forEach((tag, index) => add(tag, "local", localScore - index * 2, "Reaches people searching your city"));
    if (location.area) add(toHashtag(location.area), "local", localScore - 14, "Your neighbourhood");
    add(toHashtag(location.city), "local", localScore - 12, "Your city");
  }

  // Specific two-word phrases and listed topics from the description.
  const listed = new Set(listItems.map((item) => item.toLowerCase()));
  secondary.filter((entry) => entry.words.length === 2 && !entry.weak && !listed.has(entry.phrase)).forEach((entry) => {
    const onTopic = entry.words.some((word) => topicWordSet.has(word));
    const score = onTopic ? (entry.validated ? 66 : 58) : entry.validated ? 56 : 48;
    add(toHashtag(entry.display), "post", score, "Supporting keyword from your description");
  });
  // Listed items (ingredients, amenities) are supporting tags, never the main ones.
  listItems.forEach((item) => add(toHashtag(item), "post", intent.id === "recipe" ? 40 : item.includes(" ") ? 56 : 48, "A topic you listed"));

  const all = [...candidates.values()].sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag));
  const brandTag = brand ? normalizeTag(toHashtag(brand.name)) : "";
  const brandEntry = brandTag ? { tag: brandTag, group: "brand", score: 100, reason: "Your brand tag, so people can find all your posts" } : null;

  // Pick a balanced set: specific tags about this post, niche tags people follow,
  // a local tag when it matters, and the brand tag.
  const limits = { post: 2, niche: 3, local: 1, yours: 2 };
  const counts = { post: 0, niche: 0, local: 0, yours: 0 };
  const slots = brandEntry ? RULES.maxHashtags - 1 : RULES.maxHashtags;
  const selected = [];
  const perTopic = {};
  for (const entry of all) {
    if (selected.length >= slots) break;
    if (entry.score < 60) break;
    if (entry.topicId && (perTopic[entry.topicId] || 0) >= 1) continue;
    if (familyCount(selected, entry.tag) >= 2) continue;
    if (brandEntry && entry.tag.toLowerCase() === brandEntry.tag.toLowerCase()) continue;
    if (counts[entry.group] >= limits[entry.group]) continue;
    if (selected.some((chosen) => chosen.group !== "local" && entry.group !== "local" && sameFamily(chosen.tag, entry.tag))) continue;
    selected.push(entry);
    counts[entry.group] += 1;
    if (entry.topicId) perTopic[entry.topicId] = (perTopic[entry.topicId] || 0) + 1;
  }
  // Fill any remaining slots without group limits.
  for (const entry of all) {
    if (selected.length >= slots) break;
    if (selected.includes(entry) || (brandEntry && entry.tag.toLowerCase() === brandEntry.tag.toLowerCase())) continue;
    if (selected.some((chosen) => chosen.group !== "local" && entry.group !== "local" && sameFamily(chosen.tag, entry.tag)) || familyCount(selected, entry.tag) >= 2) continue;
    selected.push(entry);
  }
  if (brandEntry) selected.push(brandEntry);

  const chosen = new Set(selected.map((entry) => entry.tag.toLowerCase()));
  const alternatives = all.filter((entry) => !chosen.has(entry.tag.toLowerCase())).slice(0, 14);
  const groups = HASHTAG_GROUPS
    .map((group) => ({ ...group, tags: [...selected, ...alternatives].filter((entry) => entry.group === group.id).map((entry) => entry.tag) }))
    .filter((group) => group.tags.length);
  const strip = ({ score, topicId, ...entry }) => entry;
  return { selected: selected.map(strip), alternatives: alternatives.map(strip), groups };
}

function topicLabel(topic) {
  return topic.id.replace(/-/g, " ");
}

// ---- Caption text -----------------------------------------------------------

const ACTION_START = /^(?:\p{Extended_Pictographic}\s*)*(order|book|call|visit|dm|message|whatsapp|register|enrol|enroll|apply|shop|scan|click|tap|join us|join now|grab|contact|reach out|sign up|signup|buy|hurry|walk in|drop by|swing by|come visit|link in bio|check out our|follow us|follow for|download|save this|share this|tag (a|your|someone)|comment|let's talk|get in touch|contact us|turn on)\b/iu;

/** Tidy one sentence: spacing, "i" -> "I", a capital start and an end mark. */
export function polishSentence(sentence) {
  let text = String(sentence).replace(/\s+/g, " ").trim()
    .replace(/^[\s:;,.!?\-–—]+(?=\S)/, "")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([!?])\1+/g, "$1")
    .replace(/\.{4,}/g, "…")
    .replace(/(?<!\.)\.\.(?!\.)/g, ".")
    // "the the" is a typo; "very very" and "bye bye" are kept.
    .replace(/\b([\p{L}\p{M}]{2,})(\s+\1\b)+/giu, (run, word) => (/^(very|so|bye|no|ha|haha|la|really|more|hey|yes|go|knock)$/i.test(word) ? run : word))
    .replace(/(^|[\s"(])i(?=['’]?(?:m|ve|ll|d)?\b)/g, "$1I");
  text = text.replace(/^([^\p{L}\p{N}]*)(\p{Ll})/u, (_, lead, letter) => lead + letter.toUpperCase());
  if (/[\p{L}\p{N})"']$/u.test(text) && !/(\S+\.[a-z]{2,}(\/\S*)?|@\S+)$/i.test(text)) text += ".";
  return text;
}

const ACTION_ANYWHERE = /\b(dm (us|to|now|for)|call (us|now|\+?\d)|whatsapp (us|now|\+?\d)|book (now|your|a|today)|order (now|online|today|yours)|register (now|today|here|at)|enrol+ (now|today)|apply (now|today|at|here)|shop (now|the look|online)|visit (us|our|www)|link in (the |our )?bio|tap the link)\b/i;

function isCallToAction(sentence, links) {
  return ACTION_START.test(sentence.trim())
    || ACTION_ANYWHERE.test(sentence)
    || links.some((link) => sentence.includes(link))
    || /\+?\d[\d\s-]{8,}\d/.test(sentence);
}

/** A list introduced by a colon: "5 mistakes to avoid: not saving, overspending and ...". */
function colonList(sentence) {
  const colon = sentence.indexOf(":");
  if (colon < 3) return null;
  const lead = sentence.slice(0, colon).trim();
  const rest = sentence.slice(colon + 1).replace(/[.!?…]+\s*$/, "").trim();
  if ((rest.match(/,/g) || []).length < 1) return null;
  if (rest.includes(":")) return null;
  const items = rest.split(/,\s*|\s+(?:and|&|or)\s+/i)
    .map((item) => item.replace(/^(and|or|&)\s+/i, "").replace(/^[^\p{L}\p{N}]+/u, "").trim())
    .filter(Boolean);
  if (items.length < 3 || items.length > 10 || items.some((item) => item.split(/\s+/).length > 7)) return null;
  return { lead, items, tail: "" };
}

function findList(sentence, strictItems) {
  return colonList(sentence) || (strictItems.length >= 3 && strictItems.length <= 8 ? locateList(sentence, strictItems) : null);
}

/** Find "A, B, C and D" in a sentence and split it into lead-in, items and tail. */
function locateList(sentence, items) {
  const lower = sentence.toLowerCase();
  const positions = [];
  let limit = lower.length;
  for (const item of [...items].reverse()) {
    const index = lower.lastIndexOf(item.toLowerCase(), limit);
    if (index < 0) continue;
    positions.unshift({ item, index });
    limit = index - 1;
  }
  if (positions.length < 3) return null;
  const first = positions[0];
  const last = positions.at(-1);
  const lead = sentence.slice(0, first.index).replace(/[\s,;:–—-]+$/, "").replace(/\s+(?:like|such as|including)$/i, "").trim();
  const tail = sentence.slice(last.index + last.item.length).replace(/^[\s.,;:!]+/, "").trim();
  return { lead, items: positions.map((entry) => entry.item), tail };
}

function bulletLines(items, topics, lead = "") {
  // Lists of mistakes or myths get a cross; everything else a matching emoji.
  const negative = /\b(mistakes?|avoid|don'?t|never|stop|myths?|wrong|bad habits?)\b/i.test(lead);
  return items.map((item) => `${negative ? "❌" : emojiForItem(item, topics)} ${capital(item)}`).join("\n");
}

/** Group sentences into short paragraphs (two sentences or ~220 characters). */
function paragraphs(sentences) {
  const out = [];
  let current = [];
  for (const sentence of sentences) {
    const length = current.join(" ").length;
    if (current.length && (current.length >= 2 || length + sentence.length > 220)) {
      out.push(current.join(" "));
      current = [];
    }
    current.push(sentence);
  }
  if (current.length) out.push(current.join(" "));
  return out;
}

/** Body paragraphs, with a comma list rendered as emoji bullet points. */
function renderBody(sentences, listItems, topics) {
  const blocks = [];
  let pending = [];
  const flush = () => { if (pending.length) blocks.push(...paragraphs(pending)); pending = []; };
  for (const sentence of sentences) {
    if (/^\S+ .+\n\S+ /u.test(sentence) && sentence.includes("\n")) { flush(); blocks.push(sentence); continue; }
    const list = findList(sentence, listItems);
    if (list) {
      flush();
      // The lead-in sits directly above its bullets: "Ingredients:\n🧀 Paneer".
      const lead = list.lead ? `${list.lead}${/[:!?]$/.test(list.lead) ? "" : ":"}` : "";
      blocks.push([lead, bulletLines(list.items, topics, list.lead)].filter(Boolean).join("\n"));
      if (list.tail) pending.push(polishSentence(list.tail));
    } else {
      pending.push(sentence);
    }
  }
  flush();
  // A list or paragraph pasted twice appears once.
  return blocks.filter((block, index) => blocks.findIndex((other) => other.trim() === block.trim()) === index).join("\n\n");
}

const COMMON_OPENERS = /^(our|the|this|these|those|my|we|we're|a|an|new|introducing|meet|join|get|fresh|freshly|easy|one|just|it|its|it's|here|here's|today|when|why|how|what|wishing|sunrise|candid|spacious|flat|before|after|limited|book|learn|smile|ceramic|unboxing|personalised|personalized|had|honestly|morning|mega|something|bridal|aaj)\b/i;

function lowerOpening(sentence) {
  return COMMON_OPENERS.test(sentence) ? sentence.replace(/^(\p{Lu})(?=\p{Ll})/u, (letter) => letter.toLowerCase()) : sentence;
}

function hookScore(sentence, keyword, index) {
  let score = 0;
  if (keyword && containsPhrase(sentence, keyword)) score += 3;
  if (sentence.length >= 20 && sentence.length <= 110) score += 2;
  if (/^(don't|do not|stop|why|how|what|did you|ever|want|looking|are you|is your|still|imagine|one|the secret|here's|\d)/i.test(sentence)) score += 2;
  if (/\b(you|your)\b/i.test(sentence)) score += 1;
  if (/\?$/.test(sentence)) score += 1;
  if (index === 0) score += 1;
  return score;
}

function assemble(parts) {
  return parts.filter((part) => part && String(part).trim()).join("\n\n");
}

function fitCaption(build, body) {
  let text = build(body);
  if (text.length <= RULES.captionMaxChars) return text;
  const overflow = text.length - RULES.captionMaxChars;
  text = build(truncateAtWord(body, Math.max(0, body.length - overflow - 2)));
  return text.length <= RULES.captionMaxChars ? text : truncateAtWord(text, RULES.captionMaxChars);
}

function buildCaptions({ description, primary, intent, location, topics, listItems, links }) {
  const bodyText = description.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, " ").replace(/[ \t]+/g, " ").trim();
  const seenSentences = new Set();
  const sentences = splitSentences(bodyText).map(polishSentence)
    .filter((sentence) => sentence.replace(/[^\p{L}\p{N}]/gu, "").length > 1)
    // A sentence repeated in the description appears once in the caption.
    .filter((sentence) => {
      const key = sentence.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
      if (seenSentences.has(key)) return false;
      seenSentences.add(key);
      return true;
    });
  const keyword = primary && !primary.weak ? primary.display : "";
  const city = location?.city || "";
  const hooks = INSTAGRAM_HOOKS[intent.id] || INSTAGRAM_HOOKS.general;
  const ctaRules = INSTAGRAM_CTAS[intent.id] || INSTAGRAM_CTAS.general;
  const seed = description;

  // The author's own call to action goes last; otherwise use the post type's.
  const ctaSentences = sentences.filter((sentence, index) => index > 0 && isCallToAction(sentence, links));
  const content = sentences.filter((sentence) => !ctaSentences.includes(sentence));
  const hasSite = links.some((link) => !link.includes("@"));
  const hasEmail = links.some((link) => link.includes("@"));
  const saysLinkInBio = /\blink in (the |our )?bio\b/i.test(description);
  let action = ctaSentences.join(" ");
  if (hasSite && !saysLinkInBio) action = `${action} 🔗 Link in bio`.trim();
  else if (hasEmail && !hasSite && !action) action = "📩 Contact details in our bio";
  const defaultAction = topics[0]?.topic.cta && intent.id === topics[0].topic.intent ? topics[0].topic.cta : ctaRules.action;
  const conversion = ["service", "sale", "realestate", "beauty", "fitness", "food", "event", "pets", "travel"].includes(intent.id);
  if (action && conversion && !/\b(dm|call|whatsapp|link|visit|book|order|register|apply|shop|bio|contact|email|website|www|message|walk in|\d{6,})/i.test(action)) action = `${action} ${defaultAction}`;
  if (!action) action = defaultAction;
  const engage = /\b(save|share|tag|comment)\b/i.test(action) ? "" : ctaRules.engage;
  const ctaBlock = [action, engage].filter(Boolean).join("\n");
  const place = location ? `📍 ${location.area ? `${location.area}, ` : ""}${location.city}` : "";
  const closing = [ctaBlock, place].filter(Boolean).join("\n");

  const first = content[0] || sentences[0] || "";
  const firstHasKeyword = keyword && containsPhrase(first, keyword)
    && first.toLowerCase().indexOf(keyword.toLowerCase()) + keyword.length <= RULES.visibleCaptionChars - 5;
  const topicEmoji = topics[0]?.topic.emoji || "";

  const variants = [];

  // 1. Your words, polished: keep the author's opening when the keyword already
  // shows before "… more"; otherwise lead with the keyword.
  {
    const openingList = findList(first, listItems);
    const leadHasKeyword = openingList && keyword && containsPhrase(openingList.lead, keyword);
    let hook;
    let rest = content.slice(1);
    const leadFits = openingList && openingList.lead && openingList.lead.length <= 110;
    if (leadFits && (leadHasKeyword || !keyword)) {
      hook = `${openingList.lead} 👇`;
      rest = [`${bulletLines(openingList.items, topics, openingList.lead)}`, ...rest];
    } else {
      hook = firstHasKeyword || !keyword
        ? first
        : `${topicEmoji ? `${topicEmoji} ` : ""}${capital(keyword)}: ${lowerOpening(first)}`;
    }
    const build = (body) => assemble([hook, body, closing]);
    variants.push({ id: "polished", label: "Your words, polished", description: "Your own text, tidied up and laid out for easy reading, with the keyword in the first line.", hook: truncateAtWord(hook, RULES.visibleCaptionChars), text: fitCaption(build, renderBody(rest, listItems, topics)) });
  }

  if (keyword && /[a-z]/i.test(keyword)) {
    // 2. Scroll-stopping hook + your full text.
    // A template hook must show the keyword (teasers stay mysterious on purpose).
    const withKeyword = (line) => (intent.id === "teaser" || containsPhrase(line, keyword) || containsPhrase(line, pluralize(keyword)) ? line : `${capital(keyword)}: ${line}`);
    const hookIndex = pickIndex(seed, hooks.length);
    const hook = withKeyword(hooks[hookIndex](keyword, city));
    const build = (body) => assemble([hook, body, closing]);
    variants.push({ id: "hook", label: "Scroll-stopping hook", description: "A strong opening line written for this post type, followed by your text.", hook, text: fitCaption(build, renderBody(content, listItems, topics)) });

    // 3. Short & punchy, for Reels: hook, the strongest sentence, the list, one CTA line.
    const shortHook = withKeyword(hooks[(hookIndex + 1) % hooks.length](keyword, city));
    const ranked = content
      .map((sentence, index) => ({ sentence, score: hookScore(sentence, keyword, index) }))
      .filter((entry) => entry.sentence.length <= 180)
      .sort((a, b) => b.score - a.score);
    const listSentence = content.find((sentence) => findList(sentence, listItems)) || null;
    const best = ranked.find((entry) => entry.sentence !== listSentence)?.sentence || "";
    const shortParts = [shortHook];
    const question = /\?$/.test(best);
    if (!question) shortParts.push(best);
    if (listSentence) {
      const list = findList(listSentence, listItems);
      shortParts.push(bulletLines(list.items, topics, list.lead));
    }
    if (question) shortParts.push(best);
    shortParts.push([action, place].filter(Boolean).join("\n"));
    variants.push({ id: "short", label: "Short & punchy", description: "A quick version for Reels and busy feeds.", hook: shortHook, text: assemble(shortParts) });
  }

  return variants.map((variant) => {
    // Final safety net: a paragraph never appears twice in one caption.
    const blocks = variant.text.split("\n\n");
    const unique = blocks.filter((block, index) => blocks.findIndex((other) => other.trim() === block.trim()) === index).join("\n\n");
    const text = unique.length <= RULES.captionMaxChars ? unique : truncateAtWord(unique, RULES.captionMaxChars);
    const firstLine = text.slice(0, RULES.visibleCaptionChars);
    return {
      ...variant,
      text,
      captionOnly: text,
      characters: text.length,
      keywordVisible: keyword ? containsPhrase(firstLine, keyword) || containsPhrase(firstLine, pluralize(keyword)) : false,
    };
  });
}

// ---- Alt text ---------------------------------------------------------------

function imageNoun(item, description) {
  const named = description.toLowerCase().match(/\b(poster|flyer|banner|infographic|brochure|menu card|invitation|quote|meme|screenshot|logo)\b/);
  if (named) return capital(named[1]);
  // Designed images are usually exported as PNG, WebP or SVG; camera photos as JPEG or HEIC.
  if (/png|webp|svg|gif/.test(item.mimeType || "") || /\.(png|webp|svg|gif)$/i.test(item.name || "")) return "Graphic";
  return "Photo";
}

function joinList(items) {
  return items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items[0] || "";
}

function buildAltText({ media, primary, location, description, brand, listItems, links }) {
  const sentences = splitSentences(description.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, " "))
    .map(polishSentence)
    .filter((sentence) => !isCallToAction(sentence, links));
  const subject = primary && !primary.weak
    ? `${primary.display}${location && !primary.phrase.includes(location.city.toLowerCase()) ? ` in ${location.city}` : ""}`
    : "";
  const images = media.map((item, index) => ({ item, index })).filter(({ item }) => item.kind === "image");
  return images.map(({ item, index }, imageIndex) => {
    const noun = imageNoun(item, description);
    let base = `${noun}${brand ? ` from ${brand.name}` : ""}${subject ? ` about ${subject}` : ""}`;
    // Designed graphics usually show the listed topics, so name them.
    if (noun !== "Photo" && listItems.length >= 3 && imageIndex === 0) base += `, featuring ${joinList(listItems.slice(0, 6))}`;
    // Each slide gets a different sentence from the description where possible.
    const sentence = sentences[Math.min(imageIndex, Math.max(0, sentences.length - 1))] || "";
    const prefix = media.length > 1 ? `Slide ${index + 1} of ${media.length}: ` : "";
    const text = base.length < 95 && sentence ? `${prefix}${base}. ${sentence}` : `${prefix}${base}.`;
    return { slide: index + 1, text: truncateAtWord(text.replace(/\s+/g, " ").replace(/([^.])\.\s+\./g, "$1.").trim(), RULES.altTextRecommendedChars) };
  });
}

// ---- Main ---------------------------------------------------------------------

export function buildInstagramSeo(input = {}) {
  const description = normalizeCaps(cleanText(input.description, 2200));
  if (description.replace(/[^\p{L}\p{M}\p{N}]/gu, "").length < 8) throw new SocialSeoInputError("Describe the post in at least a short sentence.");
  const media = normalizeMedia(input.media);
  const location = normalizeLocation(input.location);
  const brand = resolveBrand({ brandName: input.brandName, workspaceName: input.workspaceName, description });
  const signals = {
    searchSuggestions: Array.isArray(input.signals?.searchSuggestions) ? input.signals.searchSuggestions.slice(0, 40) : [],
  };

  const firstSentence = splitSentences(description)[0] || "";
  let topics = matchTopics(description, { emphasis: firstSentence });
  const detected = detectIntent(description);
  // Post type = intent words plus the library topics that point to each type.
  const votes = Object.fromEntries(Object.entries(detected.all).map(([id, entry]) => [id, entry.score]));
  for (const match of topics) votes[match.topic.intent] = (votes[match.topic.intent] || 0) + match.score * 0.6;
  const ordered = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  const detectedVote = votes[detected.id] || 0;
  const winner = detected.id !== "general" && ordered[0] && ordered[0][0] !== detected.id && ordered[0][1] < detectedVote * 1.2
    ? detected.id
    : ordered[0]?.[0] || "general";
  const intent = winner === detected.id
    ? detected
    : { id: winner, label: INTENTS[winner]?.label || "General", topic: INTENTS[winner]?.topic || "", local: INTENTS[winner]?.local ?? false, hits: detected.all[winner]?.hits || [] };
  const topicWords = new Set(topics.flatMap((match) => [match.hits, match.hits.flatMap((hit) => hit.split(" "))].flat()));

  const userTags = extractHashtags(description);
  const links = extractLinks(description);
  const mentions = [...new Set((description.match(/(^|\s)@([\w.]{2,30})/g) || []).map((mention) => mention.trim()))];
  const fileNames = media.map((item) => item.name);
  const { primary, secondary, listItems, searchPhrases, signalsUsed } = chooseKeywords({ description, signals, intent, fileNames, brand, topicWords });
  // Re-rank topics now that the main keyword is known.
  topics = matchTopics(description, { emphasis: firstSentence, keyword: primary?.phrase || "", intentId: intent.id });

  const hashtags = buildHashtags({ description, primary, secondary, listItems, searchPhrases, userTags, location, brand, intent, topics });
  const format = analyzeInstagramFormat(media);
  const captions = buildCaptions({ description, primary, intent, location, topics, listItems, links });
  const altText = buildAltText({ media, primary, location, description, brand, listItems, links });
  const hasVideo = media.some((item) => item.kind === "video");
  const wordCount = description.split(/\s+/).filter(Boolean).length;
  const usablePrimary = primary && !primary.weak ? primary : null;

  const onScreenText = usablePrimary ? truncateAtWord(capital(usablePrimary.display), 40) : "";
  const tips = [];
  const site = links.find((link) => !link.includes("@"));
  const email = links.find((link) => link.includes("@"));
  if (site) tips.push(`Links in Instagram captions aren't clickable. Put ${site.replace(/^https?:\/\//i, "")} in your bio and say "link in bio" in the caption.`);
  if (email) tips.push(`Add ${email} to your profile's contact options (Edit profile → Contact options) so people can tap to email you.`);
  if (mentions.length) tips.push(`Tag ${joinList(mentions)} on the post or invite them as a collaborator, so it also appears on their profile.`);
  if (usablePrimary && hasVideo) tips.push(`Say "${usablePrimary.display}" in the first few seconds. Instagram can turn speech into captions, which helps it understand the Reel.`);
  if (usablePrimary) tips.push(`Put "${onScreenText}" as on-screen text${hasVideo ? " in the opening frame and on the cover" : " on the first image"} if it fits the design.`);
  if (hasVideo) tips.push("Turn on auto-generated captions when you post the Reel, so it can be watched with the sound off.");
  if (location) tips.push(`Add the location tag "${location.area ? `${location.area}, ` : ""}${location.city}" when posting, so people nearby can find you.`);
  else if (intent.local) tips.push("Add a location tag in Instagram when posting. It helps people nearby find your post.");
  if (usablePrimary) tips.push(`Use "${usablePrimary.display}" in your profile Name field if it describes what you do. Instagram search reads names and usernames.`);
  tips.push("Public posts from professional accounts can appear in Google search, so the first line also works as your Google title.");

  // The score only counts what the author controls.
  const formatIssues = format.checks.filter((entry) => ["fail", "warn"].includes(entry.status) && /ratio|shapes|count|length/.test(entry.id));
  const qualityIssues = format.checks.filter((entry) => ["fail", "warn"].includes(entry.status) && /resolution|file|size/.test(entry.id));
  const best = captions[0];
  const checklist = [
    { id: "keyword-visible", label: "A clear keyword appears in the visible first line", weight: 20, met: Boolean(usablePrimary && best?.keywordVisible), tip: "Name the product, service or topic in your first sentence so we can find a clear keyword." },
    { id: "description-detail", label: "Description gives search enough to match", weight: 15, met: wordCount >= 15, tip: "Add a little more detail (what, who it's for, where). More specific words give search more to match." },
    { id: "searched-keyword", label: "Keyword matches real search suggestions", weight: 15, met: Boolean(usablePrimary?.validated), tip: "Your keyword didn't match a common search. Consider using one of the search phrases below.", skipped: !signalsUsed },
    { id: "hashtags", label: `${RULES.recommendedHashtags.min}–${RULES.recommendedHashtags.max} focused hashtags`, weight: 10, met: hashtags.selected.length >= RULES.recommendedHashtags.min, tip: "Add a few more specific words to your description so we can build more hashtags." },
    { id: "location", label: "Location known for local discovery", weight: 10, met: Boolean(location), tip: "Add a location tag in Instagram when posting, or mention your area in the description.", skipped: !intent.local && !location },
    { id: "format", label: "Media shape fits Instagram", weight: 20, met: formatIssues.length === 0, tip: formatIssues[0]?.detail || "" },
    { id: "quality", label: "Media resolution and file are post-ready", weight: 10, met: qualityIssues.length === 0, tip: qualityIssues[0]?.detail || "" },
  ];
  const scored = checklist.filter((item) => !item.skipped);
  const total = scored.reduce((sum, item) => sum + item.weight, 0);
  const earned = scored.reduce((sum, item) => sum + (item.met ? item.weight : 0), 0);

  return {
    platform: "instagram",
    rulesReviewedAt: RULES.reviewedAt,
    intent: { id: intent.id, label: intent.label },
    topics: topics.slice(0, 4).map((match) => ({ id: match.topic.id, label: capital(topicLabel(match.topic)), emoji: match.topic.emoji })),
    brand: brand ? { ...brand, tag: normalizeTag(toHashtag(brand.name)) } : null,
    keywords: {
      primary: usablePrimary ? { phrase: usablePrimary.display, searchValidated: usablePrimary.validated } : null,
      secondary: [...secondary.map((entry) => entry.display), ...listItems]
        .filter((phrase, index, all) => all.findIndex((other) => other.toLowerCase() === phrase.toLowerCase()) === index)
        .slice(0, 8)
        .map((phrase) => ({ phrase, searchValidated: false })),
      searchPhrases,
      onScreenText,
    },
    captions,
    hashtags,
    altText,
    format,
    location,
    locationTag: location ? `${location.area ? `${location.area}, ` : ""}${location.city}` : "",
    links,
    mentions,
    tips,
    checklist: checklist.map(({ skipped, ...item }) => ({ ...item, skipped: Boolean(skipped) })),
    score: total ? Math.round((earned / total) * 100) : 0,
    signals: { searchSuggestions: signalsUsed },
  };
}
