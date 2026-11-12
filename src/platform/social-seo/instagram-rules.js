// Instagram limits and recommendations used by the Social SEO engine.
// Platform limits change; keep every number here so it can be updated in one
// place without touching the engine.

export const INSTAGRAM_RULES = Object.freeze({
  reviewedAt: "2026-11",
  captionMaxChars: 2200,
  // Text visible in the feed before "… more" on most phones.
  visibleCaptionChars: 125,
  maxHashtags: 5,
  recommendedHashtags: { min: 3, max: 5 },
  altTextRecommendedChars: 125,
  carouselMaxItems: 20,
  photo: {
    minRatio: 0.8, // 4:5 portrait
    maxRatio: 1.91, // 1.91:1 landscape
    gridRatio: 0.75, // profile grid preview is 3:4
    recommendedWidth: 1080,
    minimumWidth: 600,
    recommendedSizes: "1080 × 1350 (4:5) or 1080 × 1440 (3:4)",
    softMaxBytes: 8 * 1024 * 1024,
  },
  reel: {
    ratio: 9 / 16,
    ratioTolerance: 0.02,
    recommendedWidth: 1080,
    recommendedHeight: 1920,
    minimumHeight: 1280,
    minSeconds: 3,
    shortSeconds: 90,
    maxSeconds: 180,
    softMaxBytes: 1024 * 1024 * 1024,
    // Instagram overlays the username, caption and buttons on these areas.
    safeZone: "Keep text and faces out of the top 14% and bottom 35% of the frame.",
  },
});


// ---- Grammar helpers ------------------------------------------------------------

// "kurtis", "apartments" -> plural; "glass", "status", "analysis" -> singular.
export function isPlural(phrase) {
  const last = String(phrase).trim().split(/\s+/).pop().toLowerCase();
  // "analytics", "news" and "series" are singular.
  return /[^su']s$/.test(last) && !/(sis|ics|news|series|species)$/.test(last);
}

export function capital(value) {
  const text = String(value);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const be = (k) => (isPlural(k) ? "are" : "is");
const verb = (k, singular, pluralForm) => (isPlural(k) ? pluralForm : singular);
const article = (k) => (/^[aeiou]/i.test(k) && !/^(uni|use|one|eu)/i.test(k) ? "an" : "a");
// "silk saree" -> "silk sarees" for product hooks; collections and offers stay singular.
export function pluralize(phrase) {
  const words = String(phrase).trim().split(/\s+/);
  const last = words.at(-1);
  if (isPlural(last) || /(ed|ing|ful|ous|ive|al|ic|less|able|ible|est|er)$/i.test(last) || /^(collection|sale|range|line|launch|edition|menu|offer|deal|stock|wear|clothing|jewellery|jewelry|furniture|decor|gear|equipment|coating|service|care|makeup|food)$/i.test(last)) return phrase;
  const plural = /[^aeiou]y$/i.test(last) ? `${last.slice(0, -1)}ies` : /(s|x|z|ch|sh)$/i.test(last) ? `${last}es` : `${last}s`;
  return [...words.slice(0, -1), plural].join(" ");
}

const greet = (k) => /^(happy|merry|eid|season|wishing)/i.test(k);
const local = (k, city) => (city && !k.toLowerCase().includes(city.toLowerCase()) ? `${k} in ${city}` : k);

// ---- Hooks ------------------------------------------------------------------------
// Three hooks per post type; one is picked by a stable hash of the description so
// different posts get different openings. Every template takes any noun phrase.

export const INSTAGRAM_HOOKS = Object.freeze({
  general: [
    (k) => `${capital(k)} — here's what you need to know 👇`,
    (k) => `Spotlight: ${k} ✨`,
    (k) => `Here's why everyone's talking about ${k} 👀`,
  ],
  food: [
    (k, city) => `Looking for the best ${local(k, city)}? 🤤`,
    (k) => `This is your sign to try ${k} 😋`,
    (k) => `${capital(k)} that ${verb(k, "'s", " are").trim()} worth every bite 🍽️`.replace(" that 's", " that's"),
  ],
  recipe: [
    (k) => (/\brecipe\b/i.test(k) ? `Save this ${k} for later 📌` : `Save this ${k} recipe for later 📌`),
    (k) => `${capital(k)} at home? Easier than you think 👇`,
    (k) => `Craving ${k}? Make it at home in no time 🍳`,
  ],
  sale: [
    (k) => `${capital(pluralize(k))} ${be(pluralize(k))} finally here 🛍️`,
    (k) => `Looking for ${pluralize(k)}? You'll love this 👇`,
    (k) => `Don't miss out on ${pluralize(k)} 🔥`,
  ],
  service: [
    (k) => `${capital(k)}, done right ✨`,
    (k) => `Before & after: ${k} 🔥`,
    (k) => `Need ${k}? We've got you 👇`,
  ],
  greeting: [
    (k) => (greet(k) ? `${capital(k)} from all of us ✨` : "Warm wishes from all of us ✨"),
    (k) => (greet(k) ? `${capital(k)} to you and your loved ones 🎉` : "Wishing you and your loved ones the very best 🎉"),
    (k) => (greet(k) ? `${capital(k)}! ✨` : "Season's greetings from our family to yours ✨"),
  ],
  teaser: [
    () => "Something big is coming 👀",
    () => "Can you guess what's next? 🤔",
    () => "Mark your calendars ⏳",
  ],
  pets: [
    (k) => `Pampered and happy: ${k} 🐶`,
    (k) => `Tails are wagging for ${k} 🐾`,
    (k) => `${capital(k)} — because they deserve the best 🐾`,
  ],
  event: [
    (k, city) => `Save the date: ${local(k, city)} 📅`,
    (k, city) => `Are you joining us at ${local(k, city)}? 🎟️`,
    (k) => `Don't miss ${k} 🙌`,
  ],
  tutorial: [
    (k) => `Save this for later: ${k} 📌`,
    (k) => `${capital(k)}, explained simply 👇`,
    (k) => `${capital(k)} — read this before you start 👇`,
  ],
  education: [
    (k) => `Why ${k} ${verb(k, "matters", "matter")} more than ever 🚀`,
    (k) => `${isPlural(k) ? "Are" : "Is"} ${k} on your learning list? 📚`,
    (k) => `Here's how to start with ${k} 👇`,
  ],
  travel: [
    (k) => `Add ${k} to your travel list ✈️`,
    (k) => `Your quick guide to ${k} 🗺️`,
    (k) => `${capital(k)} ${verb(k, "is", "are")} worth every step 🥾`,
  ],
  fitness: [
    (k) => `Level up your fitness: ${k} 💪`,
    (k) => `Real results start here: ${k} 🏋️`,
    (k) => `${capital(k)} — your next fitness upgrade 💪`,
  ],
  realestate: [
    (k, city) => `Looking for ${local(k, city)}? 🏡`,
    (k, city) => `${capital(local(k, city))} — here's why ${verb(k, "it stands", "they stand")} out 🔑`,
    (k, city) => `Your next home could be ${isPlural(k) ? "one of these " : "this "}${local(k, city)} 🔑`,
  ],
  beauty: [
    (k) => `This is your sign to book ${k} ✨`,
    (k) => `Obsessed with ${isPlural(k) ? "these" : "this"} ${k} 😍`,
    (k) => `${capital(k)} that ${verb(k, "turns", "turn")} heads 💄`,
  ],
  jobs: [
    (k) => `We're hiring: ${capital(k)} 🚀`,
    (k) => `Know ${article(k)} ${k}? Tag them below 👇`,
    (k) => `Join our team as ${article(k)} ${capital(k)} 💼`,
  ],
  announcement: [
    (k) => `Big news: ${k} 🎉`,
    (k) => `Introducing ${k} ✨`,
    (k) => `${capital(k)} ${be(k)} here 🎉`,
  ],
});

// ---- Calls to action ----------------------------------------------------------------
// `action`: what to do when the author wrote no call to action.
// `engage`: a save/share/comment prompt that helps reach.

export const INSTAGRAM_CTAS = Object.freeze({
  general: { action: "Follow for more 🙌", engage: "💾 Save this and share it with someone who'd love it." },
  food: { action: "📍 Visit us or order online today.", engage: "👯 Tag the friend you're bringing next time!" },
  recipe: { action: "👩‍🍳 Try it and tell us how it turned out in the comments.", engage: "💾 Save this recipe and share it with a fellow foodie." },
  sale: { action: "🛒 Send us a DM to order.", engage: "📤 Share this with someone who needs it." },
  event: { action: "🎟️ Register now — seats are limited.", engage: "👥 Tag who you're bringing!" },
  tutorial: { action: "Follow for more tips like this 🙌", engage: "💾 Save this so you can find it later." },
  education: { action: "📩 DM us to know more.", engage: "💾 Save this and share it with a friend who's upskilling." },
  travel: { action: "✈️ DM us to plan your trip.", engage: "💾 Save this for your next trip and tag your travel buddy." },
  fitness: { action: "📩 DM us to book your free trial.", engage: "💪 Save this and tag your workout buddy." },
  realestate: { action: "📞 DM us to book a site visit.", engage: "📤 Share this with someone looking for a new home." },
  beauty: { action: "📅 DM us to book your appointment.", engage: "💾 Save this look for later." },
  jobs: { action: "📩 Apply today.", engage: "👇 Know someone who'd be a great fit? Tag them below." },
  announcement: { action: "Follow along for what's next 🙌", engage: "💬 Tell us what you think in the comments!" },
  service: { action: "📅 DM us to book your appointment.", engage: "📤 Share this with someone who needs it." },
  greeting: { action: "💛 Share this with your loved ones.", engage: "💬 Send your wishes in the comments!" },
  teaser: { action: "🔔 Turn on post notifications so you don't miss it.", engage: "💬 Drop your guesses in the comments!" },
  pets: { action: "📅 DM us to book a slot for your pet.", engage: "🐾 Tag a pet parent who'd love this!" },
});

/** Stable small hash so the same description always picks the same template. */
export function pickIndex(seed, length) {
  let hash = 0;
  for (const char of String(seed)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return length ? hash % length : 0;
}
