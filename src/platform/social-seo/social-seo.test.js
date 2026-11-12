import assert from "node:assert/strict";
import test from "node:test";
import { SocialSeoInputError, analyzeInstagramFormat, buildInstagramSeo, normalizeMedia } from "./instagram-engine.js";
import { readJpegGps, scoreFrame } from "./media-probe.js";
import { authorCasing, splitSentences, detectIntent, extractHashtags, extractKeywordPhrases, placeCandidates, toHashtag, truncateAtWord } from "./text-analysis.js";
import { collectSocialSeoSignals, googleSuggestions } from "../server/social-seo-signals.js";

const biryani = "Our new Hyderabadi chicken biryani is slow cooked on dum for 4 hours with saffron and fried onions. Available every weekend at our Banjara Hills kitchen. Order online or walk in! #biryani";
const reel = { kind: "video", width: 1080, height: 1920, durationSeconds: 42, sizeBytes: 30e6, coverFrame: { time: 4.2 } };

test("keyword extraction ranks multi-word topical phrases first", () => {
  const phrases = extractKeywordPhrases(biryani);
  assert.ok(phrases.slice(0, 3).some((entry) => entry.phrase === "hyderabadi chicken biryani"));
  // Without any search data the engine still picks the dish, not the kitchen name.
  const offline = buildInstagramSeo({ description: biryani, media: [reel] });
  assert.equal(offline.keywords.primary.phrase, "Hyderabadi chicken biryani");
  assert.ok(phrases.every((entry) => entry.words.length <= 3));
  assert.ok(!phrases.some((entry) => entry.phrase.includes("biryani #")));
});

test("intent prefers the subject of the post over its call to action", () => {
  assert.equal(detectIntent(biryani).id, "food");
  assert.equal(detectIntent("Easy paneer butter masala recipe with 6 ingredients, ready in 20 minutes").id, "recipe");
  assert.equal(detectIntent("Flat 30% off on the new summer collection, shop now").id, "sale");
  assert.equal(detectIntent("Just a thought for the day").id, "general");
});

test("hashtag and casing helpers are predictable", () => {
  assert.equal(toHashtag("hyderabadi chicken biryani"), "#HyderabadiChickenBiryani");
  assert.equal(toHashtag("ab"), "");
  assert.equal(toHashtag("2026"), "");
  assert.deepEqual(extractHashtags("Love #Biryani and #biryani and #Food"), ["biryani", "Food"]);
  assert.equal(authorCasing("hyderabadi chicken biryani", biryani), "Hyderabadi chicken biryani");
  assert.equal(authorCasing("slow cooked", "Slow cooked goodness."), "slow cooked");
  assert.equal(truncateAtWord("one two three four five", 12), "one two…");
});

test("Instagram suggestions put the keyword in the visible first line with at most five hashtags", () => {
  const result = buildInstagramSeo({
    description: biryani,
    media: [reel],
    brandName: "Spice Route Kitchen",
    location: { city: "Hyderabad" },
    signals: { searchSuggestions: ["hyderabadi chicken biryani recipe", "chicken biryani near me"] },
  });
  assert.equal(result.platform, "instagram");
  assert.equal(result.format.type, "reel");
  assert.equal(result.keywords.primary.phrase, "Hyderabadi chicken biryani");
  assert.equal(result.keywords.primary.searchValidated, true);
  assert.equal(result.captions.length, 3);
  for (const caption of result.captions) {
    assert.equal(caption.keywordVisible, true, caption.id);
    assert.ok(caption.characters <= 2200);
    assert.ok(!caption.captionOnly.includes("#"), "captionOnly excludes hashtags");
  }
  const tags = result.hashtags.selected.map((entry) => entry.tag);
  assert.ok(tags.length >= 3 && tags.length <= 5);
  assert.ok(tags.includes("#HyderabadiChickenBiryani"));
  assert.ok(tags.includes("#HyderabadFood"));
  assert.ok(tags.includes("#SpiceRouteKitchen"), "brand tag is always kept");
  assert.equal(result.altText.length, 0, "Reels have no alt text");
  assert.equal(result.format.cover.label, "0:04");
  assert.equal(result.score, 100);
});

test("the same input always gives the same output", () => {
  const input = { description: biryani, media: [reel], location: { city: "Hyderabad" } };
  assert.deepEqual(buildInstagramSeo(input), buildInstagramSeo(input));
});

test("low-value hashtags and the placeholder workspace name are never suggested", () => {
  const result = buildInstagramSeo({
    description: "Morning coffee at our rooftop cafe with fresh croissants #instagood #love #explorepage",
    media: [{ kind: "image", width: 1080, height: 1350, sizeBytes: 2e6 }],
    brandName: "Workspace",
  });
  const tags = [...result.hashtags.selected, ...result.hashtags.alternatives].map((entry) => entry.tag.toLowerCase());
  assert.ok(!tags.includes("#instagood"));
  assert.ok(!tags.includes("#love"));
  assert.ok(!tags.includes("#workspace"));
  assert.equal(result.altText.length, 1);
  assert.ok(result.altText[0].text.length <= 125);
});

test("format checks flag shapes and lengths that don't fit Instagram", () => {
  const landscapeReel = analyzeInstagramFormat(normalizeMedia([{ kind: "video", width: 1920, height: 1080, durationSeconds: 240 }]));
  assert.equal(landscapeReel.checks.find((entry) => entry.id === "reel-ratio").status, "fail");
  assert.equal(landscapeReel.checks.find((entry) => entry.id === "reel-length").status, "fail");

  const lowRes = analyzeInstagramFormat(normalizeMedia([{ kind: "image", width: 500, height: 500 }]));
  assert.equal(lowRes.checks.find((entry) => entry.id === "photo-resolution").status, "fail");

  const carousel = analyzeInstagramFormat(normalizeMedia([
    { kind: "image", width: 1080, height: 1350 },
    { kind: "image", width: 1080, height: 1080 },
  ]));
  assert.equal(carousel.type, "carousel");
  assert.ok(carousel.checks.some((entry) => entry.id === "carousel-shapes" && entry.status === "warn"));
});

test("checklist reports missing location and thin descriptions without hiding them", () => {
  const result = buildInstagramSeo({ description: "New shoes in store now", media: [{ kind: "image", width: 1080, height: 1350 }] });
  const byId = Object.fromEntries(result.checklist.map((item) => [item.id, item]));
  assert.equal(byId.location.met, false);
  assert.equal(byId["description-detail"].met, false);
  assert.equal(byId["searched-keyword"].skipped, true, "no signals means the search check is not scored");
  assert.ok(result.score < 100);
});

test("invalid input is rejected with a clear message", () => {
  assert.throws(() => buildInstagramSeo({ description: "hi", media: [reel] }), SocialSeoInputError);
  assert.throws(() => buildInstagramSeo({ description: biryani, media: [] }), /at least one photo or video/);
  assert.throws(() => buildInstagramSeo({ description: biryani, media: [{ kind: "audio" }] }), /photo or video/);
});

function jpegWithGps({ lat, latRef, lon, lonRef }) {
  // Build a little-endian TIFF with IFD0 -> GPS IFD holding lat/lon rationals.
  const tiff = new DataView(new ArrayBuffer(200));
  let o = 0;
  tiff.setUint16(0, 0x4949); tiff.setUint16(2, 42, true); tiff.setUint32(4, 8, true);
  o = 8; tiff.setUint16(o, 1, true);
  tiff.setUint16(o + 2, 0x8825, true); tiff.setUint16(o + 4, 4, true); tiff.setUint32(o + 6, 1, true); tiff.setUint32(o + 10, 26, true);
  tiff.setUint32(o + 14, 0, true);
  const gps = 26;
  tiff.setUint16(gps, 4, true);
  const entry = (i, tag, type, count, value) => {
    const at = gps + 2 + i * 12;
    tiff.setUint16(at, tag, true); tiff.setUint16(at + 2, type, true); tiff.setUint32(at + 4, count, true);
    if (type === 2) tiff.setUint8(at + 8, value.charCodeAt(0)); else tiff.setUint32(at + 8, value, true);
  };
  const latAt = 80;
  const lonAt = 104;
  entry(0, 1, 2, 2, latRef); entry(1, 2, 5, 3, latAt); entry(2, 3, 2, 2, lonRef); entry(3, 4, 5, 3, lonAt);
  const rationals = (at, [d, m, s]) => { [[d, 1], [m, 1], [s * 100, 100]].forEach(([n, den], i) => { tiff.setUint32(at + i * 8, n, true); tiff.setUint32(at + i * 8 + 4, den, true); }); };
  rationals(latAt, lat); rationals(lonAt, lon);
  const app1Length = 2 + 6 + 200;
  const bytes = new Uint8Array(4 + app1Length);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0xffd8); view.setUint16(2, 0xffe1); view.setUint16(4, app1Length);
  view.setUint32(6, 0x45786966); view.setUint16(10, 0);
  bytes.set(new Uint8Array(tiff.buffer), 12);
  return bytes.buffer;
}

test("EXIF GPS is read from JPEG and rounded to about 1 km", () => {
  const gps = readJpegGps(jpegWithGps({ lat: [17, 24, 45.36], latRef: "N", lon: [78, 26, 53.52], lonRef: "E" }));
  assert.deepEqual(gps, { latitude: 17.41, longitude: 78.45 });
  const south = readJpegGps(jpegWithGps({ lat: [33, 52, 0], latRef: "S", lon: [151, 12, 0], lonRef: "E" }));
  assert.deepEqual(south, { latitude: -33.87, longitude: 151.2 });
  assert.equal(readJpegGps(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer), null);
});

test("frame scoring prefers sharp, well-exposed frames over flat or black ones", () => {
  const width = 32;
  const height = 32;
  const frame = (fn) => {
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const v = fn(x, y);
      pixels.set([v, v, v, 255], (y * width + x) * 4);
    }
    return pixels;
  };
  const black = scoreFrame(frame(() => 0), width, height);
  const flat = scoreFrame(frame(() => 128), width, height);
  const detailed = scoreFrame(frame((x, y) => ((x + y) % 2 ? 200 : 60)), width, height);
  assert.ok(detailed > flat && detailed > black);
});

test("free signals are optional, filtered and never throw", async () => {
  const fakeFetch = async (url) => {
    if (url.includes("suggestqueries")) {
      return { ok: true, json: async () => ["q", ["hyderabadi chicken biryani recipe", "hyderabadi chicken biryani pdf", "hyderabadi chicken biryani in hindi"]] };
    }
    if (url.includes("nominatim")) {
      assert.match(url, /lat=17\.41&lon=78\.45/, "only rounded coordinates are sent");
      return { ok: true, json: async () => ({ address: { city: "Hyderabad", state: "Telangana", country: "India" } }) };
    }
    throw new Error(`unexpected ${url}`);
  };
  const signals = await collectSocialSeoSignals({ description: `${biryani} unique-${Date.now()}`, gps: { latitude: 17.4126, longitude: 78.4482 } }, { fetchImpl: fakeFetch });
  assert.deepEqual(signals.searchSuggestions, ["hyderabadi chicken biryani recipe"]);
  assert.equal(signals.location.city, "Hyderabad");

  const failing = await collectSocialSeoSignals({ description: "Totally different sunset beach photo walk", gps: null }, { fetchImpl: async () => { throw new Error("offline"); } });
  assert.deepEqual(failing, { searchSuggestions: [], location: null });
  assert.deepEqual(await googleSuggestions("ab", { fetchImpl: fakeFetch }), []);
});

test("place candidates come only from capitalized names after location words", () => {
  assert.deepEqual(placeCandidates("Our rooftop cafe in Indiranagar, Bengaluru is open daily"), ["Indiranagar", "Bengaluru"]);
  assert.deepEqual(placeCandidates("Visit us at Banjara Hills this weekend"), ["Banjara Hills"]);
  assert.deepEqual(placeCandidates("Open from Monday, in the morning"), []);
  assert.deepEqual(placeCandidates("no capital letters in here"), []);
});

test("text place names are confirmed with an exact map match", async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url.includes("suggestqueries")) return { ok: true, json: async () => ["q", []] };
    if (url.includes("q=Koramangala")) return { ok: true, json: async () => [{ name: "Koramangala", addresstype: "suburb", address: { city: "Bengaluru", state: "Karnataka", country: "India" } }] };
    if (url.includes("q=Style")) return { ok: true, json: async () => [{ name: "Style Avenue", addresstype: "road", address: {} }] };
    return { ok: true, json: async () => [] };
  };
  const found = await collectSocialSeoSignals({ description: `Weekend pastry box now in Koramangala ${Date.now()}` }, { fetchImpl: fakeFetch });
  assert.deepEqual(found.location, { city: "Bengaluru", area: "Koramangala", region: "Karnataka", country: "India" });
  const rejected = await collectSocialSeoSignals({ description: `Dress up in Style tonight ${Date.now()}` }, { fetchImpl: fakeFetch });
  assert.equal(rejected.location, null);
});

// ---- Regression corpus: real-world posts of different kinds --------------------

const png = (name, width = 1080, height = 1350) => ({ kind: "image", name, mimeType: "image/png", width, height, sizeBytes: 1e6 });
const jpg = (name, width = 1080, height = 1350) => ({ kind: "image", name, mimeType: "image/jpeg", width, height, sizeBytes: 2e6 });
const tagsOf = (result) => [...result.hashtags.selected, ...result.hashtags.alternatives].map((entry) => entry.tag);

const tinitiate = "One skill isn’t enough to stay ahead in tech anymore—you need a skill stack. Tinitiate AI helps you future-proof your career by mastering the five pillars that work together: Coding, APIs, Data analytics, Cloud, and AI workflows. Don't just learn an isolated tool; learn how to connect them to build smarter applications and lead the future. Scan the QR code in the image or visit www.tinitiateai.com to get started!";

test("the user-typed brand beats a detected one, and the workspace name is only a fallback", () => {
  assert.equal(buildInstagramSeo({ description: tinitiate, media: [png("a.png")], brandName: "Tinitiate" }).brand.name, "Tinitiate");
  const plain = buildInstagramSeo({ description: "Fresh sourdough loaves baked every morning in our wood-fired oven.", media: [jpg("bread.jpg")], workspaceName: "Crust & Crumb" });
  assert.deepEqual(plain.brand, { name: "Crust & Crumb", source: "workspace", tag: "#CrustAndCrumb" });
  assert.ok(tagsOf(plain).includes("#CrustAndCrumb"));
});

test("recipe, property and trek posts pick the phrase people would search", () => {
  const recipe = buildInstagramSeo({ description: "Easy paneer butter masala recipe at home 🍛 Ingredients: paneer, butter, tomatoes, cashews, cream and kasuri methi. Ready in 30 minutes. Full recipe in the video!", media: [reel] });
  assert.equal(recipe.keywords.primary.phrase, "paneer butter masala");
  assert.ok(!tagsOf(recipe).includes("#Recipe"));

  const property = buildInstagramSeo({ description: "Spacious 3 BHK apartments for sale in Gachibowli with clubhouse, swimming pool and 24/7 security. Ready to move, possession in December. Call +91 98765 43210 for a site visit.", media: [jpg("IMG_1.jpg"), jpg("IMG_2.jpg")], location: { city: "Hyderabad", area: "Gachibowli" } });
  assert.equal(property.keywords.primary.phrase, "3 BHK apartments");
  assert.ok(tagsOf(property).includes("#HyderabadRealEstate"));
  assert.ok(!tagsOf(property).includes("#Possession"));
  assert.notEqual(property.altText[0].text, property.altText[1].text, "carousel slides get different alt text");

  const trek = buildInstagramSeo({ description: "Sunrise at Kedarkantha summit after a 4-day trek through snow forests. Best time to visit is December to April. Saving this itinerary for everyone planning their first Himalayan trek.", media: [jpg("DSC_0912.JPG", 4000, 3000)] });
  assert.equal(trek.keywords.primary.phrase, "Himalayan trek");
  assert.ok(!tagsOf(trek).some((tag) => /4Day|December/.test(tag)));
});

test("emoji, lowercase writing and Hinglish don't produce junk phrases", () => {
  const salon = buildInstagramSeo({ description: "Bridal makeup trial for our lovely bride Sneha 💄 Soft glam look with HD makeup and hair styling by our senior artist. Book your bridal package at Glow Studio, Jubilee Hills.", media: [jpg("bride.jpg")] });
  assert.equal(salon.keywords.primary.phrase, "bridal makeup trial");
  assert.ok(!salon.keywords.secondary.some((entry) => /sneha soft/i.test(entry.phrase)));

  const lower = buildInstagramSeo({ description: "honestly the best decision i made this year was switching to a standing desk. back pain gone, more focus, and my posture is so much better. highly recommend if you work from home", media: [jpg("desk.jpg")] });
  assert.equal(lower.keywords.primary.phrase, "standing desk");
  assert.match(lower.captions[0].captionOnly, /standing desk\.\n\nBack pain gone/);

  const hinglish = buildInstagramSeo({ description: "Aaj ka special hai Hyderabadi dum biryani aur double ka meetha 😋 Order karo Swiggy ya Zomato pe. Spice Route, Ameerpet.", media: [jpg("special.jpg")] });
  assert.equal(hinglish.keywords.primary.phrase, "Hyderabadi dum biryani");
  assert.ok(!hinglish.keywords.secondary.some((entry) => /\b(ka|hai|aur|karo)\b/i.test(entry.phrase)));
  assert.deepEqual(placeCandidates("Order karo Swiggy pe. Spice Route, Ameerpet."), ["Ameerpet"]);
});

test("search phrases from other businesses never become hashtags", () => {
  const result = buildInstagramSeo({ description: tinitiate, media: [png("poster.png")], signals: { searchSuggestions: ["skill stack", "skill stack academy", "skill stack hub"] } });
  assert.equal(result.keywords.primary.searchValidated, true);
  assert.ok(!tagsOf(result).some((tag) => /Academy|Hub/.test(tag)));
});

test("sentences split safely around links, decimals and abbreviations", () => {
  assert.deepEqual(splitSentences("Rated 4.5 stars, e.g. by locals. Visit www.site.com today! see you"), ["Rated 4.5 stars, e.g. by locals.", "Visit www.site.com today!", "see you"]);
});
