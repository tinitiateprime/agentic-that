// Deterministic text analysis for Social SEO. No AI or model calls: keyword
// phrases come from word co-occurrence and frequency, post intent comes from a
// transparent lexicon, and hashtags are derived from the post's own words.

const STOPWORDS = new Set(`a about above after again against all also am an and any are aren't as at be because been before
being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each
few for from further get gets got had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers
herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself just let's like make made
me more most mustn't my myself new no nor not now of off on once one only or other ought our ours ourselves out over own
really same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves
then there there's these they they'd they'll they're they've this those through to too under until up us very via was
wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why
why's will with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves today tonight
tomorrow yesterday week weekend day days time times year years every everyone everything something anything thing things
want wanted need needs going go come came check try use used using best great good amazing awesome love loved lovely
beautiful nice cool super perfect favorite favourite little big lot lots much many first last next back still even ever
let lets see look looking take took give given well way ways please dont im ive youre thats enough anymore stay ahead
already always never really truly simply actually literally right whole else may might must shall ok okay yes yeah
hey hi hello guys folks etc via per vs across starting start starts started easy quick simple simplest quickest
highly recommend recommended honestly gone january february march april june july august september october november
december jan feb mar apr jun jul aug sep sept oct nov dec
hai hain ka ki ke ko aur ya pe par se mein karo kar kare kya ho tha thi nahi nahin bhi toh aaj ek yeh ye woh wo hum
aap tum mera meri apna apni sab kuch bahut abhi accha achha chalo wala wali wale ji bhai andi lo ra
spacious stunning gorgeous incredible fantastic wonderful exciting lovely together done mega bring brings freshly
`.split(/\s+/).filter(Boolean));

// Words that start a call to action. Phrases beginning with them ("order
// online", "visit our store") describe what to do, not what the post is about.
const ACTION_VERBS = new Set(["order", "visit", "scan", "call", "click", "tap", "walk", "come", "grab", "book", "dm", "message",
  "follow", "subscribe", "share", "comment", "save", "buy", "contact", "register", "signup", "sign", "enroll", "apply", "join",
  "download", "watch", "read", "swipe", "tag", "drop", "send", "reach", "find", "discover", "explore", "start", "learn", "build",
  "lead", "connect", "master", "become", "don't", "stop", "keep", "hurry", "claim", "avail"]);
const NUMBER_WORDS = new Set(["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "first", "second", "third", "fourth", "fifth", "single", "double", "dozen", "hundred", "thousand", "million"]);
const GENERIC_WORDS = new Set(["future", "life", "people", "world", "thing", "stuff", "part", "kind", "type", "lots", "reason",
  "reasons", "minute", "hour", "hours", "today", "online", "link", "bio", "details", "info", "information", "more", "number",
  "website", "page", "account", "post", "posts", "video", "photo", "image", "picture", "pic", "code", "qr", "india", "usa",
  "uk", "better", "home", "special", "possession", "experience", "years", "slots", "session", "plans", "full", "hiring",
  "recipe", "recipes", "sale", "offer", "offers", "event", "events", "update", "news", "tips", "guide", "course", "courses",
  "training", "class", "classes", "job", "jobs", "deal", "deals", "launch", "shop", "store", "ingredients", "sizes", "isolated", "tool", "tools",
  "booking", "bookings", "open", "beginners", "beginner", "moments", "time", "joy", "pure", "peace", "prosperity", "family",
  "welcome", "bulk", "orders", "order", "all", "teachers", "trial"]);

// Generic engagement-bait hashtags that add no topical signal and are widely
// associated with low-quality reach. They are never suggested.
export const LOW_VALUE_HASHTAGS = new Set([
  "instagood", "photooftheday", "like4like", "likeforlike", "follow4follow", "followforfollow", "f4f", "l4l",
  "tagsforlikes", "instadaily", "picoftheday", "followme", "likes", "follow", "like", "love", "instalike",
  "explorepage", "explore", "viral", "fyp", "foryou", "foryoupage", "trending", "reels", "reelsinstagram",
  "instagram", "insta", "photography", "happy", "cute", "beautiful", "style", "fun", "me", "selfie", "new",
  "today", "online", "future", "life", "best", "amazing", "awesome", "goals", "motivation", "inspiration",
]);

// Intent lexicon. Each intent has trigger words and the generic topic noun used
// for location hashtags (for example #HyderabadFood). `local` intents benefit
// from a location tag; for the rest location is optional.
export const INTENTS = Object.freeze({
  recipe: { label: "Recipe", topic: "Food", local: false, words: ["recipe", "recipes", "cook", "cooking", "bake", "baking", "ingredients", "homemade", "dish", "marinate", "fry", "boil", "oven", "tbsp", "tsp", "teaspoon", "tablespoon", "grams", "cups"] },
  food: { label: "Food & dining", topic: "Food", local: true, words: ["food", "restaurant", "cafe", "café", "menu", "biryani", "pizza", "burger", "coffee", "dessert", "brunch", "lunch", "dinner", "breakfast", "taste", "tasty", "delicious", "spicy", "chef", "eat", "eats", "foodie", "dine", "bakery", "cake", "cooked", "chicken", "mutton", "paneer", "curry", "thali", "dosa", "snacks", "drinks", "juice", "tea", "chai", "croissant", "croissants", "pastry", "pastries", "icecream", "sweets", "cuisine"] },
  education: { label: "Course or training", topic: "Learning", local: false, words: ["course", "courses", "learning", "training", "career", "careers", "skill", "skills", "upskill", "upskilling", "certification", "certified", "bootcamp", "class", "classes", "students", "student", "academy", "institute", "mentor", "mentorship", "enroll", "enrol", "admission", "admissions", "batch", "curriculum", "internship", "placement", "placements", "coding", "programming", "developer", "developers", "tech", "python", "java", "javascript", "data", "cloud", "ai", "apis", "devops", "cybersecurity", "exam", "exams", "coaching", "tuition", "school", "college", "university", "degree", "syllabus", "workshop"] },
  sale: { label: "Product or offer", topic: "Shopping", local: false, words: ["sale", "offer", "discount", "off", "price", "buy", "shop", "order", "available", "launch", "launching", "new arrival", "arrivals", "collection", "stock", "deal", "deals", "free delivery", "limited", "book now", "dm", "store", "product", "products", "shipping", "cod"] },
  event: { label: "Event", topic: "Events", local: true, words: ["event", "join", "register", "registration", "tickets", "live", "webinar", "concert", "meetup", "venue", "rsvp", "conference", "expo", "party", "seats"] },
  service: { label: "Service", topic: "", local: true, words: ["service", "services", "repair", "repairs", "appointment", "appointments", "detailing", "installation", "consultation", "treatment", "treatments", "makeover", "makeovers", "cleaning", "coating", "servicing", "warranty", "before and after"] },
  greeting: { label: "Greeting", topic: "", local: false, words: ["wishing", "wishes", "wish", "greetings", "happy diwali", "happy holi", "eid mubarak", "merry christmas", "happy new year", "festival of lights", "warm wishes", "blessings", "prosperity"] },
  teaser: { label: "Teaser", topic: "", local: false, words: ["coming soon", "stay tuned", "something big", "something exciting", "guess what", "sneak peek", "teaser", "watch this space", "launching soon", "big reveal", "countdown"] },
  pets: { label: "Pets", topic: "Pets", local: true, words: ["dog", "dogs", "puppy", "cat", "cats", "kitten", "pet", "pets", "grooming", "vet", "furry", "paws", "pup"] },
  tutorial: { label: "Tips or tutorial", topic: "Tips", local: false, words: ["how", "tips", "tip", "guide", "steps", "step", "tutorial", "hack", "hacks", "mistakes", "avoid", "beginner", "beginners", "explained", "checklist", "lesson"] },
  travel: { label: "Travel", topic: "Travel", local: true, words: ["travel", "trip", "visited", "beach", "hotel", "resort", "journey", "itinerary", "flight", "vacation", "holiday", "trek", "tour", "destination", "backpacking", "homestay", "sunset", "mountains"] },
  fitness: { label: "Fitness & health", topic: "Fitness", local: true, words: ["yoga", "meditation", "breathing", "flexibility", "workout", "gym", "fitness", "exercise", "yoga", "running", "protein", "weight", "fat", "muscle", "cardio", "health", "healthy", "diet", "trainer", "squats", "strength", "pilates", "zumba", "training", "crossfit"] },
  realestate: { label: "Real estate", topic: "RealEstate", local: true, words: ["property", "apartment", "flats", "villa", "villas", "bhk", "plot", "plots", "rent", "sqft", "real estate", "listing", "possession", "gated", "amenities", "builder", "duplex"] },
  beauty: { label: "Beauty & fashion", topic: "Style", local: true, words: ["makeup", "skincare", "skin", "hair", "salon", "outfit", "fashion", "dress", "saree", "lehenga", "nails", "beauty", "wear", "bridal", "spa", "facial", "haircut", "jewellery", "jewelry"] },
  jobs: { label: "Hiring", topic: "Jobs", local: false, words: ["hiring", "job", "jobs", "vacancy", "vacancies", "openings", "recruiting", "recruitment", "position", "positions", "candidates", "resume", "cv", "apply", "join our team", "fresher", "freshers", "salary", "ctc"] },
  announcement: { label: "Announcement", topic: "", local: false, words: ["announce", "announcing", "excited", "proud", "news", "update", "introducing", "milestone", "hiring", "welcome", "anniversary", "partnership", "award", "congratulations"] },
});

const SUBJECT_INTENTS = new Set(["recipe", "food", "education", "travel", "fitness", "realestate", "beauty", "jobs", "pets"]);

// Domains, URLs and e-mail addresses. Matched first so their dots are never
// treated as sentence ends or keywords.
const LINK_PATTERN = /\b(?:https?:\/\/\S+|www\.[\w-]+(?:\.[\w-]+)+(?:\/\S*)?|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|[\w-]+\.(?:com|in|org|net|io|ai|co|app|dev|me|info|biz|store|shop|online|site|tech|us|uk|edu|gov)(?:\.[a-z]{2})?(?:\/\S*)?)\b/gi;

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”]/g, '"');
}

export function cleanText(value, max = 5000) {
  return normalizeText(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .slice(0, max)
    .trim();
}

export function extractLinks(text) {
  const links = (String(text).match(LINK_PATTERN) || []).map((link) => link.replace(/[.,!?)]+$/, ""));
  return [...new Set(links)];
}

/** "www.tinitiateai.com/path" -> "tinitiateai"; e-mails use their domain. */
function domainStem(link) {
  const host = link.replace(/^https?:\/\//i, "").replace(/^[^@]+@/, "").replace(/^www\./i, "").split(/[/?#]/)[0];
  const parts = host.split(".");
  return (parts.length > 2 && parts.at(-2).length <= 3 ? parts.at(-3) : parts.at(-2) || parts[0] || "").toLowerCase();
}

export function extractHashtags(text) {
  const found = [];
  for (const match of String(text).matchAll(/(^|\s)#([\p{L}\p{M}\p{N}_]{2,40})/gu)) found.push(match[2]);
  return [...new Map(found.map((tag) => [tag.toLowerCase(), tag])).values()];
}

export function stripSocialMarkup(text) {
  return String(text)
    .replace(LINK_PATTERN, " ")
    .replace(/(^|\s)#[\p{L}\p{M}\p{N}_]+/gu, " ")
    .replace(/(^|\s)@[\w.]+/g, " ")
    .replace(/\+?\d[\d\s-]{7,}\d/g, " ") // phone numbers
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * Split into sentences only where an end mark is followed by a space and a new
 * sentence start, so "www.site.com", "4.5 stars" and "e.g. this" stay intact.
 */
const ABBREVIATIONS = new Set(["e.g", "i.e", "etc", "vs", "mr", "mrs", "ms", "dr", "st", "no", "approx", "min", "max", "rs", "inc", "ltd", "co"]);

export function splitSentences(text) {
  return normalizeText(text)
    .split(/\n+/)
    .flatMap((line) => {
      // Split after . ! ? followed by a space, unless the word before the dot
      // is an abbreviation or a single letter. Dots inside words and links
      // ("www.site.com", "4.5") have no space after them and never split.
      const pieces = [];
      let start = 0;
      for (const match of line.matchAll(/[.!?]+["')\]]?\s+/g)) {
        const end = match.index + match[0].length;
        const before = line.slice(start, match.index).split(/\s+/).pop().toLowerCase().replace(/[^a-z.]/g, "");
        if (match[0].startsWith(".") && (ABBREVIATIONS.has(before) || /^[a-z]$/.test(before))) continue;
        pieces.push(line.slice(start, end));
        start = end;
      }
      pieces.push(line.slice(start));
      return pieces.flatMap((piece) => piece.split(/(?<=\p{Extended_Pictographic}\uFE0F?)\s+(?=["'(]?\p{Lu})/u));
    })
    .map((sentence) => sentence.trim())
    .filter((sentence) => /[\p{L}\p{N}]/u.test(sentence));
}

function tokenize(text) {
  return (normalizeText(text).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}'-]*/gu) || [])
    .map((word) => word.replace(/'s$/, "").replace(/['-]+$/, ""));
}

function isUsefulWord(word) {
  return word.length >= 2 && !STOPWORDS.has(word) && !/^\d+$/.test(word) && !/'/.test(word);
}

/** Meaningful words from a file name: "Build Your Future Skill Stack (1).png" -> build, future, skill, stack. */
export function fileNameWords(names = []) {
  const words = new Set();
  for (const name of names) {
    const base = String(name || "").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/([a-z])([A-Z])/g, "$1 $2");
    if (/^(img|dsc|pxl|vid|mvimg|screenshot|whatsapp|photo|video|image|untitled|scan)[\s_-]*\d/i.test(base)) continue;
    for (const word of tokenize(base.replace(/[_.-]+/g, " "))) {
      if (isUsefulWord(word) && word.length >= 3 && !/^(copy|final|edit|edited|new|draft|v\d+)$/.test(word)) words.add(word);
    }
  }
  return words;
}

/**
 * Comma lists such as "Coding, APIs, Data analytics, Cloud, and AI workflows".
 * Items are short (1–3 words) and there must be at least three of them.
 */
export function extractListItems(text) {
  const items = [];
  const plain = stripSocialMarkup(normalizeText(text));
  const segments = plain.split(/[.!?;\n]|:\s|\p{Extended_Pictographic}/u);
  for (const segment of segments) {
    if ((segment.match(/,/g) || []).length < 2) continue;
    const parts = segment.split(/,\s*|\s+(?:and|&|or)\s+/i).map((part) => part.replace(/^(and|or|&)\s+/i, "").trim()).filter(Boolean);
    const short = parts.filter((part) => {
      const words = part.split(/\s+/);
      return words.length >= 1 && words.length <= 3 && /^[\p{L}\p{N}][\p{L}\p{N}' +.-]*$/u.test(part);
    });
    if (short.length >= 3) {
      // The first part often carries a lead-in ("mastering the five pillars that work together: Coding").
      for (const part of short) {
        const words = tokenize(part).filter((word) => !STOPWORDS.has(word));
        if (words.length && words.length === tokenize(part).length) items.push(part);
      }
    }
  }
  return [...new Map(items.map((item) => [item.toLowerCase(), item])).values()].slice(0, 8);
}

/**
 * A brand named in the text that matches a website or e-mail domain, for
 * example "Tinitiate AI" with "www.tinitiateai.com". Returns "" when unsure.
 */
export function detectBrand(text) {
  const normalized = normalizeText(text);
  const stems = extractLinks(normalized).map(domainStem).filter((stem) => stem.length >= 3);
  if (!stems.length) return "";
  const names = normalized.match(/\p{Lu}[\p{L}\p{N}&'-]*(?:\s+(?:\p{Lu}[\p{L}\p{N}&'-]*|&|and|of))*/gu) || [];
  for (const stem of stems) {
    for (const name of names) {
      const words = name.split(/\s+/);
      // Try the longest run of words whose letters spell the domain.
      for (let start = 0; start < words.length; start += 1) {
        for (let end = words.length; end > start; end -= 1) {
          const candidate = words.slice(start, end).join(" ");
          const letters = candidate.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
          if (letters.length >= 3 && (letters === stem || (stem.startsWith(letters) && letters.length >= stem.length - 4 && end - start > 1))) return candidate;
        }
      }
    }
  }
  return "";
}

/** True for phrases that describe an action, a count, or nothing specific. */
export function isWeakPhrase(words) {
  if (!words.length) return true;
  if (ACTION_VERBS.has(words[0]) || NUMBER_WORDS.has(words[0])) return true;
  return words.every((word) => GENERIC_WORDS.has(word) || word.length < 3);
}

/**
 * Candidate keyword phrases: runs of non-stopwords (max three words). Scoring:
 * each word counts more when repeated, proper nouns get a small bonus, two- and
 * three-word phrases are preferred, and the opening sentence and file name
 * carry extra weight because they usually state the topic.
 */
export function extractKeywordPhrases(text, { limit = 12, fileNames = [], exclude = [] } = {}) {
  let plain = stripSocialMarkup(normalizeText(text));
  for (const name of exclude.filter((entry) => String(entry).trim().length > 2)) {
    const escaped = String(name).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    plain = plain.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu"), " , ");
  }
  // A possessive ends a phrase: "Meera's haldi ceremony" -> "Meera" | "haldi ceremony".
  plain = plain.replace(/([\p{L}\p{M}]+)'s\b/gu, "$1 ,");
  const sentences = splitSentences(plain);
  const firstSentenceWords = new Set(tokenize(sentences[0] || ""));
  const fileWords = fileNameWords(fileNames);
  const excluded = new Set();
  const properNouns = new Set();
  for (const sentence of sentences) {
    const words = sentence.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}'-]*/gu) || [];
    for (const word of words.slice(1)) {
      if (/^\p{Lu}\p{Ll}/u.test(word) || /^\p{Lu}{2,}s?$/u.test(word)) properNouns.add(word.toLowerCase());
    }
  }

  const phrases = [];
  for (const fragment of plain.toLowerCase().split(/[.,!?;:()\[\]{}"|\n/\\–—\p{Extended_Pictographic}]+/u)) {
    let current = [];
    const flush = () => {
      while (current.length > 3) {
        phrases.push(current.slice(0, 3));
        current = current.slice(3);
      }
      if (current.length) phrases.push(current);
      current = [];
    };
    const tokens = tokenize(fragment);
    tokens.forEach((word, index) => {
      // Numbers only stay when they qualify the next word ("3 bhk"); "6-week"
      // or "24/7" start a new phrase.
      if (/^\d/.test(word)) {
        if (/^\d+$/.test(word) && /^(bhk|bed|bedroom|bedrooms|seater)$/.test(tokens[index + 1] || "")) current.push(word);
        else flush();
        return;
      }
      // A repeated word ("apartments apartments") starts a new phrase.
      if (current.at(-1) === word) flush();
      if (isUsefulWord(word) && !excluded.has(word)) current.push(word);
      else flush();
    });
    flush();
  }

  const frequency = new Map();
  for (const phrase of phrases) for (const word of phrase) frequency.set(word, (frequency.get(word) || 0) + 1);
  const wordWeight = (word) => 1 + 0.8 * Math.min((frequency.get(word) || 1) - 1, 3) + (properNouns.has(word) ? 0.4 : 0) - (GENERIC_WORDS.has(word) ? 0.6 : 0);

  const scored = new Map();
  for (const phrase of phrases) {
    if (phrase.length === 1 && phrase[0].length < 4 && !properNouns.has(phrase[0])) continue;
    const key = phrase.join(" ");
    const lengthBonus = phrase.length === 2 ? 1 : phrase.length === 3 ? 0.6 : 0;
    const opening = phrase.every((word) => firstSentenceWords.has(word)) ? 1.5 : 0;
    const fromFile = Math.min(2, phrase.filter((word) => fileWords.has(word)).length);
    const weak = isWeakPhrase(phrase) ? -4 : 0;
    const score = phrase.reduce((total, word) => total + wordWeight(word), 0) + lengthBonus + opening + fromFile + weak;
    const existing = scored.get(key);
    const proper = phrase.every((word) => properNouns.has(word) || /^\d+$/.test(word));
    scored.set(key, { phrase: key, words: phrase, score: Math.max(existing?.score ?? -Infinity, score), count: (existing?.count || 0) + 1, weak: weak < 0, proper });
  }
  return [...scored.values()]
    .map((entry) => ({ ...entry, score: Number((entry.score + (entry.count - 1) * 0.8).toFixed(2)) }))
    .sort((a, b) => b.score - a.score || b.words.length - a.words.length || a.phrase.localeCompare(b.phrase))
    .slice(0, limit);
}

export function detectIntent(text) {
  const lower = ` ${stripSocialMarkup(normalizeText(text)).toLowerCase()} `;
  const tokens = new Set(tokenize(lower));
  let best = { id: "general", label: "General", topic: "", local: false, hits: [] };
  let bestScore = 0;
  let subjectTopic = "";
  let subjectScore = 0;
  const all = {};
  for (const [id, intent] of Object.entries(INTENTS)) {
    const hits = intent.words.filter((word) => (word.includes(" ") ? lower.includes(` ${word} `) : tokens.has(word)));
    if (!hits.length) continue;
    all[id] = { score: hits.length + (SUBJECT_INTENTS.has(id) ? 1 : 0) + (id === "recipe" ? 0.5 : 0), hits };
    // Subject words win ties so a food offer is still treated as food; recipe
    // beats food when instructions are present.
    const score = hits.length + (SUBJECT_INTENTS.has(id) ? 1 : 0) + (id === "recipe" ? 0.5 : 0);
    if (SUBJECT_INTENTS.has(id) && score > subjectScore) {
      subjectScore = score;
      subjectTopic = intent.topic;
    }
    if (score > bestScore) {
      bestScore = score;
      best = { id, label: intent.label, topic: intent.topic, local: intent.local, hits };
    }
  }
  const topic = best.id === "sale" ? subjectTopic || best.topic : best.topic || subjectTopic;
  return { ...best, topic, all };
}

/** "MEGA SALE ON ALL SHOES!!!" -> "Mega sale on all shoes!" (only for mostly-capital text). */
export function normalizeCaps(text) {
  const letters = String(text).match(/\p{L}/gu) || [];
  const upper = letters.filter((letter) => /\p{Lu}/u.test(letter)).length;
  if (letters.length < 8 || upper / letters.length < 0.6) return text;
  return String(text).toLowerCase().replace(/(^|[.!?]\s+|\n)(\p{Ll})/gu, (_, lead, letter) => lead + letter.toUpperCase());
}

const BUSINESS_SUFFIX = "Studio|Studios|Clinic|Clinics|Gym|Fitness|Cafe|Café|Kitchen|Bakery|Bakers|Jewellers|Jewelers|Jewellery|Salon|Spa|Academy|Institute|Labs|Footwear|Boutique|Store|Stores|Mart|Foods|Restaurant|Hotel|Resort|Realty|Builders|Developers|Interiors|Designs|Photography|Films|Dental|Hospital|Motors|Cars|Travels|Tours|Events|Caterers|Creations|Collective|Co|Company|Technologies|Solutions|Consulting|Pharmacy|Opticals|Sweets";

/**
 * A business named in the text: "Glow Studio", "BrightSmile Dental Clinic",
 * "from all of us at Sharma Jewellers", or a CamelCase name after "at"
 * ("at ShineCare"). Returns "" when nothing looks like a business name.
 */
export function detectBusinessName(text) {
  const source = normalizeText(text);
  const suffixed = source.match(new RegExp(`((?:\\p{Lu}[\\p{L}\\p{N}&'-]*\\s+){1,3}(?:${BUSINESS_SUFFIX}))(?![\\p{L}])`, "u"));
  if (suffixed) return suffixed[1].trim();
  const team = source.match(/\b(?:all of us at|the team at|team at|love from|regards,?)\s+(\p{Lu}[\p{L}\p{N}&'-]*(?:\s+\p{Lu}[\p{L}\p{N}&'-]*){0,3})/u);
  if (team) return team[1].trim();
  const camel = source.match(/\b(?:at|by|from|with)\s+(\p{Lu}\p{Ll}+\p{Lu}\p{L}+)\b/u);
  return camel ? camel[1] : "";
}

/** Return the phrase with the casing the author used, for example "Hyderabadi chicken biryani". */
export function authorCasing(phrase, text) {
  const words = String(phrase).split(/\s+/).filter(Boolean).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return "";
  const source = normalizeText(text);
  const match = source.match(new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${words.join("[\\s-]+")}(?![\\p{L}\\p{M}\\p{N}])`, "iu"));
  if (!match) {
    // Not written as one run: keep each word as the author wrote it ("AI", "Hyderabad").
    return String(phrase).split(/\s+/).map((word) => {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const own = source.match(new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escaped}(?![\\p{L}\\p{M}\\p{N}])`, "iu"))?.[0];
      return own && (/^\p{Lu}{2,}s?$/u.test(own) || /^\p{Lu}\p{Ll}/u.test(own) && !/^(the|a|an|our|my)$/i.test(own)) ? own : word;
    }).join(" ");
  }
  const found = match[0];
  // Keep proper-noun capitals but not a capital that only starts a sentence.
  const index = match.index || 0;
  const before = source.slice(0, index).trimEnd();
  const sentenceStart = !before || /[.!?\n:]$/.test(before);
  if (sentenceStart && /^\p{Lu}\p{Ll}/u.test(found)) {
    const [head, ...rest] = found.split(/(\s+)/);
    const restText = rest.join("");
    const otherCapitals = /\p{Lu}/u.test(restText);
    if (!otherCapitals) return head.charAt(0).toLowerCase() + head.slice(1) + restText;
  }
  return found;
}

const NOT_PLACES = new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "instagram", "facebook", "youtube", "linkedin", "google", "the", "our", "my", "this", "that"]);

/**
 * Capitalized names that follow "in", "at", "near", "from" or "around", plus a
 * name after a following comma ("Indiranagar, Bengaluru"). These are only
 * candidates; the server confirms them with a map lookup before use.
 */
export function placeCandidates(text, { exclude = [] } = {}) {
  const found = [];
  const skip = new Set([...NOT_PLACES, ...exclude.map((entry) => entry.toLowerCase())]);
  const pattern = /(?<![\p{L}\p{N}])(?:in|at|near|from|around)\s+(\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+){0,2})(?:\s*,\s*(\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+){0,2}))?/gu;
  const plain = stripSocialMarkup(normalizeText(text));
  for (const match of plain.matchAll(pattern)) {
    for (const candidate of [match[1], match[2]]) {
      if (candidate && !skip.has(candidate.toLowerCase())) found.push(candidate.trim());
    }
  }
  // Sign-offs such as "Spice Route, Ameerpet." name the area last.
  for (const match of plain.matchAll(/\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)*\s*,\s*(\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+){0,2})\s*[.!]?\s*$/gmu)) {
    if (!skip.has(match[1].toLowerCase())) found.push(match[1].trim());
  }
  return [...new Set(found)].slice(0, 3);
}

export function titleCase(text) {
  return String(text).replace(/[\p{L}\p{M}\p{N}]+/gu, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}

export function sentenceCase(text) {
  const value = String(text).trim();
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function toHashtag(text) {
  const body = titleCase(normalizeText(text).replace(/'/g, ""))
    .replace(/&/g, "And")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "");
  if (body.length < 3 || body.length > 30 || /^\d+$/.test(body)) return "";
  return `#${body}`;
}

export function truncateAtWord(text, max) {
  const value = String(text).trim();
  if (value.length <= max) return value;
  const slice = value.slice(0, max - 1);
  const cut = slice.lastIndexOf(" ");
  return `${(cut > max * 0.5 ? slice.slice(0, cut) : slice).replace(/[\s,;:.\-–—]+$/, "")}…`;
}

export function containsPhrase(text, phrase) {
  if (!phrase) return false;
  const words = tokenize(phrase);
  const haystack = ` ${tokenize(text).join(" ")} `;
  return haystack.includes(` ${words.join(" ")} `);
}
