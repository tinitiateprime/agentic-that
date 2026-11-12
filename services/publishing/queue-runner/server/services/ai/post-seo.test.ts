import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { signServiceAccessToken } from "../../../../../../lib/service-access-token.js";
import { recommendedTier, tierById, engineAssetFor, MODEL_TIERS } from "./ai-catalog.js";
import { localAi } from "./ai-engine.js";
import { benefitOk, cleanAltText, cleanHashtags, dropFiller, dropUnstatedClaims, dropPropPhrases, endCleanly, factsOf, fitToPlatform, fixCapitals, instagramScore, fixBrandSpelling, generatePostSeo, headlineCase, listBlocksOf, livePreview, schemaFor, mainKeywordOf, writerBrief, type PostSeoRequest } from "./post-seo.js";
import { registerAiRoutes } from "./ai-routes.js";

const IMAGE = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

const analysis = {
  mainKeyword: "chicken biryani",
  subject: "Hyderabadi chicken biryani",
  details: ["fried onions", "boiled egg", "raita"],
  visibleText: "",
  searchKeywords: ["hyderabadi chicken biryani", "best biryani hyderabad", "dum biryani"],
  altText: "A plate of Hyderabadi chicken biryani topped with fried onions and a boiled egg, served with raita.",
};

// The model's answers are realistic but messy, to prove the output is always fitted.
const messy: Record<string, Record<string, unknown>> = {
  instagram: {
    caption: `Hyderabadi chicken biryani, slow cooked on dum 🍛\n\nEvery grain packed with saffron and spice.\n\nTag your biryani buddy!\n\n#biryani #HyderabadFood #foodie`,
    hashtags: ["#Biryani", "hyderabadi biryani", "#instagood", "#viral", "DumBiryani", "#HyderabadFoodies", "#FoodLovers", "#IndianFood"],
    altText: "x".repeat(300),
    onScreenText: "Hyderabadi Chicken Biryani you have to try this weekend",
    searchKeywords: ["hyderabadi biryani", "biryani near me"],
  },
  facebook: { post: "Craving Hyderabadi biryani? 🍛 Ours is slow cooked on dum. What's your favourite side?", hashtags: ["#Biryani", "#Hyderabad", "#Food", "#More", "#TooMany"], altText: "Chicken biryani plate" },
  linkedin: { post: "What makes a great Hyderabadi biryani?\n\nPatience: 4 hours on dum.", hashtags: ["#FoodBusiness", "#Hyderabad", "#SmallBusiness", "#Entrepreneurship", "#Food", "#Extra"], altText: "Chicken biryani plate" },
  youtube: {
    title: "Hyderabadi Chicken Biryani — slow cooked on dum for four hours, the real traditional way at home",
    description: "Hyderabadi chicken biryani the traditional way.\n\nSubscribe for more!\n\n#biryani #food #hyderabad",
    tags: ["hyderabadi biryani", "chicken biryani", "Chicken Biryani", "dum biryani", ...Array.from({ length: 40 }, (_, index) => `biryani recipe variation ${index}`)],
    hashtags: ["#Biryani", "#HyderabadiBiryani", "#Food", "#Extra"],
    thumbnailText: "4 HOUR DUM BIRYANI",
  },
};

function withMockedModel<T>(fn: () => Promise<T>) {
  const original = localAi.chat.bind(localAi);
  const calls: Array<{ messages: unknown[] }> = [];
  (localAi as unknown as { chat: unknown }).chat = async (request: { messages: Array<{ content: unknown }>; schema: { required?: string[] } }) => {
    calls.push(request);
    const required = request.schema.required || [];
    if (required.includes("visibleText")) return analysis;
    const text = JSON.stringify(request.messages);
    if (text.includes("Instagram post")) return messy.instagram;
    if (required.includes("title")) return messy.youtube;
    return text.includes("LinkedIn post") ? messy.linkedin : messy.facebook;
  };
  return fn().then((result) => ({ result, calls })).finally(() => {
    (localAi as unknown as { chat: unknown }).chat = original;
  });
}

const request: PostSeoRequest = {
  platforms: ["instagram", "facebook", "linkedin", "youtube"],
  images: [IMAGE],
  mediaKind: "video",
  durationSeconds: 42,
  orientation: "vertical",
  description: "Our new Hyderabadi chicken biryani, slow cooked on dum. Available every weekend.",
  brandName: "Spice Route",
  location: "Banjara Hills, Hyderabad",
};

test("one vision pass, then one writing pass per app", async () => {
  const { result, calls } = await withMockedModel(() => generatePostSeo(request));
  assert.equal(calls.length, 5);
  const first = JSON.stringify(calls[0].messages);
  assert.match(first, /image_url/, "the first call looks at the media");
  assert.ok(calls.slice(1).every((call) => !JSON.stringify(call.messages).includes("image_url")), "writing passes are text only");
  assert.match(JSON.stringify(calls[1].messages), /Location: Banjara Hills, Hyderabad/);
  assert.match(JSON.stringify(calls[1].messages), /Brand: Spice Route/);
  assert.deepEqual(Object.keys(result.results).sort(), ["facebook", "instagram", "linkedin", "youtube"]);
});

test("Instagram output always fits Instagram", async () => {
  const { result } = await withMockedModel(() => generatePostSeo(request));
  const ig = result.results.instagram as Record<string, any>;
  assert.equal(ig.hashtags.length, 5, "exactly the allowed number of hashtags");
  assert.ok(!ig.hashtags.some((tag: string) => /instagood|viral/i.test(tag)), "generic tags removed");
  assert.ok(ig.hashtags.includes("#HyderabadiBiryani"), "multi-word tags become CamelCase");
  assert.ok(!/#biryani/i.test(ig.caption), "hashtags written in the caption move to the hashtag list");
  assert.ok(ig.fullText.length <= 2200);
  assert.ok(ig.altText.length <= 125);
  assert.ok(ig.onScreenText.length <= 40);
  assert.equal(ig.locationTag, "Banjara Hills, Hyderabad", "location comes from the author, never invented");
});

test("Facebook, LinkedIn and YouTube outputs fit their limits", async () => {
  const { result } = await withMockedModel(() => generatePostSeo(request));
  const fb = result.results.facebook as Record<string, any>;
  const li = result.results.linkedin as Record<string, any>;
  const yt = result.results.youtube as Record<string, any>;
  assert.equal(fb.hashtags.length, 3);
  assert.equal(li.hashtags.length, 5);
  assert.ok(yt.title.length <= 100);
  assert.equal(yt.hashtags.length, 3);
  assert.ok(yt.tags.join(",").length <= 500, "YouTube tags stay within 500 characters");
  assert.equal(new Set(yt.tags.map((tag: string) => tag.toLowerCase())).size, yt.tags.length, "no duplicate tags");
  assert.equal(yt.format, "Short", "a vertical video under 3 minutes is a Short");
  assert.ok(yt.description.endsWith("#Biryani #HyderabadiBiryani #Food"), "hashtags go at the end of the description");
});

test("hashtag cleaning handles messy input", () => {
  assert.deepEqual(cleanHashtags(["##Coffee", "cold brew", "cold-brew", "#CafeVibes!", "1234", "a", "#coffee"], 10), ["#Coffee", "#ColdBrew", "#CafeVibes"]);
  assert.deepEqual(cleanHashtags(["బిర్యానీ", "#मिठाई"], 5), ["#బిర్యానీ", "#मिठाई"], "Telugu and Hindi tags keep their vowel signs");
  assert.deepEqual(cleanHashtags("not an array", 5), []);
});

test("fitting never crashes on missing fields", () => {
  for (const platform of ["instagram", "facebook", "linkedin", "youtube"] as const) {
    const fitted = fitToPlatform(platform, {}, { ...request, location: undefined }, analysis) as Record<string, unknown>;
    assert.ok(fitted);
    assert.ok(!JSON.stringify(fitted).includes("undefined"));
  }
});

test("model catalog: pinned, verified and commercially licensed", () => {
  for (const tier of MODEL_TIERS) {
    for (const file of [tier.model, tier.projector]) {
      assert.match(file.sha256, /^[0-9a-f]{64}$/);
      assert.match(file.url, /^https:\/\/huggingface\.co\/(Qwen|ggml-org)\//);
    }
    assert.notEqual(tier.licence, "", tier.id);
  }
  assert.ok(!MODEL_TIERS.some((tier) => /Qwen2\.5-VL-3B/.test(tier.model.name)), "research-only Qwen 3B is never offered");
  assert.equal(recommendedTier(16 * 1024 ** 3).id, "standard");
  assert.equal(recommendedTier(4 * 1024 ** 3).id, "lite");
  assert.ok(engineAssetFor("win32", "x64")?.url.includes("win-cpu-x64"));
  assert.equal(engineAssetFor("sunos", "x64"), null);
  assert.equal(tierById("nope"), null);
});

test("routes: status is open, everything else needs a valid AgenticThat token", async () => {
  const app = express();
  registerAiRoutes(app);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/api/social-seo/ai`;
  try {
    const status = await fetch(`${base}/status`);
    assert.equal(status.status, 200);
    assert.ok(["not-installed", "installed", "unsupported", "ready", "error", "downloading"].includes((await status.json()).phase));

    assert.equal((await fetch(`${base}/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 401);
    assert.equal((await fetch(`${base}/generate`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer forged.token.value" }, body: "{}" })).status, 401);

    const wrongAudience = signServiceAccessToken({ audience: "scraping", subject: "u1", workspaceId: "w1" });
    assert.equal((await fetch(`${base}/install`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${wrongAudience}` }, body: "{}" })).status, 401);

    const token = signServiceAccessToken({ audience: "social-seo", subject: "u1", workspaceId: "w1" });
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
    const invalid = await fetch(`${base}/generate`, { method: "POST", headers, body: JSON.stringify({ platforms: ["myspace"], images: [IMAGE], mediaKind: "image" }) });
    assert.equal(invalid.status, 400);
    const notImage = await fetch(`${base}/generate`, { method: "POST", headers, body: JSON.stringify({ platforms: ["instagram"], images: ["data:text/html;base64,PHNjcmlwdD4="], mediaKind: "image" }) });
    assert.equal(notImage.status, 400, "only image data is accepted");
    const badTier = await fetch(`${base}/install`, { method: "POST", headers, body: JSON.stringify({ tier: "huge" }) });
    assert.equal(badTier.status, 400);
  } finally {
    server.close();
  }
});

test("structured parts become one clean post", () => {
  const raw = {
    hook: "Hyderabadi chicken biryani, slow cooked on dum 🍛",
    paragraphs: ["Every grain carries saffron and spice. #Biryani", "Every grain carries saffron and spice.", "Available every weekend 并"],
    cta: "Tag the friend who owes you a biryani! #FoodLovers",
    hashtags: ["#ChickenBiryani"],
    altText: "Chicken biryani", onScreenText: "Dum Biryani", searchKeywords: ["chicken biryani"],
  };
  const ig = fitToPlatform("instagram", raw, { ...request, description: "Weekend special" }, analysis) as Record<string, any>;
  assert.equal(ig.caption, [
    "Hyderabadi chicken biryani, slow cooked on dum 🍛",
    "Every grain carries saffron and spice.",
    "Available every weekend",
    "Tag the friend who owes you a biryani!",
  ].join("\n\n"), "parts joined, repeats and stray characters removed (no DM line: the call to action already names the dish)");
  assert.deepEqual(ig.hashtags, ["#ChickenBiryani", "#Biryani", "#FoodLovers", "#SpiceRoute", "#HyderabadChickenBiryani"], "inline hashtags move to the list, plus the brand tag");

  const yt = fitToPlatform("youtube", { title: "Chicken Biryani", summary: "How we make it.", paragraphs: ["Four hours on dum."], cta: "Subscribe!", tags: ["biryani"], hashtags: ["#Biryani"], thumbnailText: "DUM" }, request, analysis) as Record<string, any>;
  assert.equal(yt.description, ["How we make it.", "Four hours on dum.", "Subscribe!", "#Biryani"].join("\n\n"));
});


test("near-duplicate calls to action are removed and the brand tag is always added", () => {
  const raw = {
    hook: "Skill stack is your new tech superpower.",
    paragraphs: ["Tinitiate AI teaches Coding, APIs, Data, Cloud and AI.", "Scan the QR code or visit www.tinitiateai.com to start building your stack today."],
    cta: "Scan QR or visit www.tinitiateai.com now.",
    hashtags: ["#SkillStack", "#LearnToCode", "#DataAnalytics", "#CloudComputing", "#AI", "#TechCareers"],
    altText: "Poster", onScreenText: "Skill stack", searchKeywords: ["skill stack"],
  };
  const ig = fitToPlatform("instagram", raw, { ...request, brandName: "Tinitiate AI" }, analysis) as Record<string, any>;
  assert.equal((ig.caption.match(/tinitiateai\.com/g) || []).length, 1, "the call to action appears once");
  assert.equal(ig.hashtags.length, 5);
  assert.equal(ig.hashtags.at(-1), "#TinitiateAI");
  const li = fitToPlatform("linkedin", { hook: "Hook", paragraphs: ["One", "Two"], cta: "Question?", hashtags: ["#TinitiateAI", "#Coding"], altText: "" }, { ...request, brandName: "Tinitiate AI" }, analysis) as Record<string, any>;
  assert.deepEqual(li.hashtags.filter((tag: string) => /tinitiate/i.test(tag)), ["#TinitiateAI"], "no duplicate when the AI already added it");
  assert.ok(li.hashtags.some((tag: string) => /^#Hyderabad/.test(tag)), "a local hashtag when the location is known");
});

test("lowercase hashtags get readable capitals from the known keywords", () => {
  assert.deepEqual(cleanHashtags(["#skillstack", "#chickenbiryani", "#iPhone", "#random"], 5, "", ["skill stack", "chicken biryani"]), ["#SkillStack", "#ChickenBiryani", "#iPhone", "#random"]);
  const fb = fitToPlatform("facebook", { hook: "Hook", paragraphs: ["One"], cta: "Order?", hashtags: ["#chickenbiryani"], altText: "" }, request, analysis) as Record<string, any>;
  assert.equal(fb.hashtags[0], "#ChickenBiryani");
});

test("the writer never sees photo props, and alt text comes from the image study", () => {
  const brief = writerBrief({ ...analysis, details: ["served in copper bowl", "crispy fried onions"], searchKeywords: ["#ChickenBiryani", "biryani in copper bowl"] });
  assert.deepEqual(brief.details, ["crispy fried onions"]);
  assert.deepEqual(brief.searchKeywords, ["Chicken Biryani"]);
  assert.ok(!("altText" in brief));
  assert.deepEqual(writerBrief({ ...analysis, details: ["served in copper bowl"] }, "Served in our famous copper bowl").details, ["served in copper bowl"], "kept when the author mentions it");
  const fb = fitToPlatform("facebook", { hook: "Hook", paragraphs: ["One"], cta: "Order?", hashtags: [], altText: "chicken biryany typo" }, request, analysis) as Record<string, any>;
  assert.equal(fb.altText, analysis.altText);
});

test("safety nets fix weak small-model output", () => {
  assert.equal(mainKeywordOf({ ...analysis, mainKeyword: "Tinitiate AI", subject: "skill stack" }, "Tinitiate AI"), "skill stack", "the brand is never the main keyword");
  assert.equal(mainKeywordOf({ ...analysis, mainKeyword: "", subject: "dish", searchKeywords: ["Chicken Biryani"] }), "chicken biryani");
  assert.equal(dropFiller("In today’s fast-paced world, it’s no longer enough to learn one tool."), "It’s no longer enough to learn one tool.");
  const cut = "It's not about isolated skills anymore. It’s about how they connect to build smarter applications and lead the future of the whole industry for everyone who wants a great career in tech and lead your next in";
  assert.equal(endCleanly(cut), "It's not about isolated skills anymore.");
  assert.equal(endCleanly("Visit tinitiateai.com to get started"), "Visit tinitiateai.com to get started", "short endings are left alone");
  const li = fitToPlatform("linkedin", { hook: "chicken biryani", paragraphs: ["Our signature dish is slow cooked for four hours. Every grain is perfect.", "Second."], cta: "What is yours?", hashtags: [] }, request, analysis) as Record<string, any>;
  assert.ok(li.post.startsWith("Our signature dish is slow cooked for four hours."), "a bare-keyword hook is replaced by a real sentence");
  const yt = fitToPlatform("youtube", { title: "Tinitiate AI", summary: "Learn the skill stack that future-proofs your tech career.", paragraphs: ["x", "y"], cta: "Subscribe", tags: ["skillstack"], hashtags: [], thumbnailText: "" }, { ...request, brandName: "Tinitiate AI" }, { ...analysis, mainKeyword: "skill stack" }) as Record<string, any>;
  assert.match(yt.title, /^Learn the skill stack that future-proofs your tech career( #Shorts)?$/);
  assert.deepEqual(yt.tags, ["skill stack"]);
});

test("real small-model slips: misread brand, invented props, generic tags", () => {
  assert.equal(fixBrandSpelling("Tinitize Ai: Skill Stack, Future Proof | Tinitiate AI", "Tinitiate AI"), "Tinitiate AI: Skill Stack, Future Proof | Tinitiate AI");
  assert.equal(fixBrandSpelling("Visit www.tinitiateai.com today", "Tinitiate AI"), "Visit www.tinitiateai.com today", "links are left alone");
  assert.equal(fixBrandSpelling("Spice routes are old. Order from spice route today.", "Spice Route"), "Spice Route are old. Order from Spice Route today.");
  assert.equal(dropPropPhrases("Delicious chicken biryani, slow-cooked to perfection in a copper bowl."), "Delicious chicken biryani, slow-cooked to perfection.");
  assert.ok(!/bowl|plate/i.test(dropPropPhrases("Served in a beautiful copper bowl on a white plate, it’s an experience.")));
  assert.equal(dropPropPhrases("Served in our famous copper bowl.", "our famous copper bowl"), "Served in our famous copper bowl.", "kept when the author mentions it");
  const brandRequest = { ...request, brandName: "Tinitiate AI", mediaKind: "image" as const };
  const ig = fitToPlatform("instagram", { hook: "Build a skill stack with Tinitize AI today.", paragraphs: ["One.", "Two."], cta: "Visit now.", hashtags: ["#TinitiateAi", "#SkillStack", "#Data"], onScreenText: "" }, brandRequest, { ...analysis, mainKeyword: "skill stack" }) as Record<string, any>;
  assert.ok(ig.caption.startsWith("Build a skill stack with Tinitiate AI today."));
  assert.deepEqual(ig.hashtags.filter((tag: string) => /tinit/i.test(tag)), ["#TinitiateAI"], "one brand tag, spelled right");
  const yt = fitToPlatform("youtube", { title: "Chicken biryani slow cooked dum style", summary: "S.", paragraphs: ["a", "b"], cta: "c", tags: ["Chicken Biryani", "dish", "food", "biryani"], hashtags: [], thumbnailText: "" }, request, analysis) as Record<string, any>;
  assert.deepEqual(yt.tags, ["Chicken Biryani", "biryani"]);
});

test("a prop in the middle of a sentence drops that sentence instead of leaving a gap", () => {
  assert.equal(dropPropPhrases("Layered with fried onions. Served in copper bowl — rich and fragrant. Order now!"), "Layered with fried onions. Order now!");
  assert.equal(dropPropPhrases("It fills your belly — served in copper bowl for that authentic touch. Try it."), "Try it.");
  assert.equal(dropPropPhrases("Our copper bowl holds history. A humble vessel, full of love. Every grain is perfect."), "Every grain is perfect.");
  assert.deepEqual(cleanHashtags(["#AIlearning"], 5, "", ["AI learning"]), ["#AILearning"]);
});

test("course poster: brand, every course and exact contact details are always in the post", () => {
  const poster = {
    brand: "TINITIATE AI", mainKeyword: "tech training courses", subject: "tech training courses", tagline: "Engineer Your Future with AI",
    offerings: ["Azure Data Engineering", "SnowFlake Data Engineering", "AWS Data Engineering", "GCP Data Engineering", "Machine Learning", "React Web Development", "Agentic AI", "Power BI", "Java Full Stack"],
    details: [], visibleText: "LEARN.BUILD.GROW.", website: "tinitiateai.com", email: "contact@tinitiaeai.com", phone: "+91 6309123485",
    searchKeywords: ["data engineering course", "agentic ai course", "machine learning course"], altText: "Student with backpack next to the Tinitiate AI course list",
  };
  const facts = factsOf(poster, {});
  assert.equal(facts.brand, "Tinitiate AI", "brand read from the logo, in readable capitals");
  assert.equal(facts.email, "contact@tinitiateai.com", "a misread email domain is matched to the website");
  assert.equal(facts.phone, "+91 6309123485");
  assert.equal(facts.offerings.length, 9);
  assert.equal(factsOf(poster, { description: "Call 98480 22338 or mail hello@tinitiate.com" }).email, "hello@tinitiate.com", "the author's own details win");

  const imageRequest = { platforms: [], images: [], mediaKind: "image" as const };
  const ig = fitToPlatform("instagram", { hook: "Engineer your future in tech 🚀", paragraphs: ["Industry-ready training for the next generation of engineers."], listTitle: "Our courses", cta: "Enroll now and start building real projects!", hashtags: ["#DataEngineering", "#AgenticAI", "#MachineLearning", "#TechCareers", "#LearnToCode"], onScreenText: "Engineer Your Future" }, imageRequest, poster) as Record<string, any>;
  for (const course of poster.offerings) assert.ok(ig.caption.includes(course.replace("SnowFlake", "SnowFlake")), `missing ${course}`);
  assert.match(ig.caption, /Our courses:\n✅ Azure Data Engineering/);
  assert.ok(ig.caption.indexOf("Java Full Stack") < ig.caption.indexOf("Enroll now"), "list comes before the call to action");
  assert.match(ig.caption, /📞 \+91 6309123485\n✉️ contact@tinitiateai\.com\n🌐 tinitiateai\.com$/);
  assert.equal(ig.hashtags.length, 5);
  assert.ok(ig.hashtags.includes("#TinitiateAI"), "brand hashtag from the logo");
  assert.ok(!/agent01/i.test(ig.fullText));

  const yt = fitToPlatform("youtube", { title: "Tech Courses", summary: "Industry-ready tech training courses.", paragraphs: ["a.", "b."], listTitle: "", cta: "Subscribe!", tags: ["tech courses"], hashtags: [], thumbnailText: "" }, imageRequest, poster) as Record<string, any>;
  assert.ok(yt.tags.includes("azure data engineering"), "each course is also a YouTube search tag");
  assert.match(yt.description, /What we offer:\n• Azure Data Engineering/);
});

test("capitals and alt text are tidied the way a person would write them", () => {
  assert.equal(fixCapitals("Ai training for engineers"), "AI training for engineers");
  assert.equal(fixCapitals("ENROLL NOW — Your future starts here."), "Enroll now — Your future starts here.");
  assert.equal(fixCapitals("Order at KFC now"), "Order at KFC now", "short brand acronyms stay");
  assert.equal(fixCapitals("master power bi", ["Power BI"]), "Master power BI");
  assert.equal(cleanAltText("TINITIATE AI - Industry-Ready Training for the Next Generation of Engineers. Enroll Now! Contact: contact@tinitiateai.com, +91 6309123485, tinitiateai.com"), "Tinitiate AI - Industry-Ready Training for the Next Generation of Engineers.");
  assert.ok(cleanAltText("x ".repeat(100)).length <= 126);
});

test("Instagram reaches 10/10 with business details, and 9/10 with a local tip without them", () => {
  const poster = {
    postType: "course-or-training" as const, audience: "students and working engineers",
    brand: "TINITIATE AI", mainKeyword: "tech skill stack", subject: "IT training courses", tagline: "Engineer Your Future with AI",
    offerings: ["Coding", "APIs", "Data Engineering", "Cloud Computing", "Artificial Intelligence"],
    details: [], visibleText: "", website: "www.tinitiateai.com", email: "contact@tinitiateai.com", phone: "+91 6309123485",
    searchKeywords: ["it training", "data engineering course"], altText: "Tinitiate AI poster showing the five pillars of a tech skill stack",
  };
  const written = {
    hook: "🚀 Build your tech skill stack with Tinitiate AI!",
    searchLine: "Looking for industry-ready IT training in Hyderabad with live projects and placement support?",
    paragraphs: ["Connect coding, APIs, data, cloud and AI to build real-world technology solutions."],
    listTitle: "💡 What you can learn",
    benefits: ["Build real-world applications", "Connect modern systems", "Transform data into insights", "Deploy and scale solutions", "Build smarter workflows"],
    cta: "Your next step in technology starts here! 🎯",
    dmKeyword: "SkillStack",
    hashtags: ["#TinitiateAI", "#DataEngineering", "#AgenticAI", "#MachineLearning", "#TechCareers"],
    onScreenText: "Build your skill stack",
  };
  const base = { platforms: [], images: [], mediaKind: "image" as const };
  const local = fitToPlatform("instagram", written, { ...base, location: "Hyderabad", businessDetails: "Live projects, placement support, free trial sessions" }, poster) as Record<string, any>;
  assert.match(local.caption, /^🚀 Build your tech skill stack with Tinitiate AI!\n\nLooking for industry-ready IT training in Hyderabad/);
  assert.match(local.caption, /💡 What you can learn:\n✅ Coding – Build real-world applications\n✅ APIs – Connect modern systems/);
  assert.match(local.caption, /📩 DM "SKILLSTACK" for details\.\n\n📞 \+91 6309123485/);
  assert.ok(local.hashtags.some((tag: string) => /Hyderabad/.test(tag)), "a local hashtag is added");
  assert.ok(local.hashtags.includes("#TinitiateAI"));
  assert.equal(local.seoScore.score, 10, JSON.stringify(local.seoScore.checks.filter((check: any) => !check.passed)));

  const plain = fitToPlatform("instagram", { ...written, searchLine: "Looking for industry-ready IT training with real projects?" }, base, poster) as Record<string, any>;
  assert.equal(plain.seoScore.score, 9);
  assert.equal(plain.seoScore.checks.find((check: any) => !check.passed).id, "local", "the only missing point is local search, with a tip");
});

test("a quote post is written as a creator post, not a sales template", () => {
  const quotePost = {
    message: "Quiet time alone helps you hear your own thoughts", mood: "calm, reflective", postType: "quote-or-motivation" as const,
    quote: "Sometimes you just need to be somewhere quiet enough to hear your own thoughts.", audience: "overthinkers who need calm",
    brand: "Fp", mainKeyword: "inner peace", subject: "quote about quiet", tagline: "", offerings: [], details: [], visibleText: "",
    website: "", email: "", phone: "", searchKeywords: ["inner peace", "quiet mind", "self reflection"], altText: "A white cat sits on sunlit grass under a quote about needing quiet.",
  };
  const written = {
    angle: "Gentle permission to step away and listen to yourself.",
    hook: "Sometimes you just need to be somewhere quiet enough to hear your own thoughts. 🌿",
    paragraphs: ["Not every answer comes from talking, scrolling, or being around people. Some only show up in stillness, when the noise settles and you finally hear what you have been feeling all along.", "You are allowed to step away. Inner peace is not running from life, it is returning to yourself. 🤍"],
    cta: "💬 Where do you go to find your quiet?\n🔖 Save this for the days your mind feels too loud.",
    hashtags: ["#InnerPeace", "#QuietMind", "#SelfReflection", "#HealingJourney", "#Mindfulness"], onScreenText: "",
  };
  const ig = fitToPlatform("instagram", written, { platforms: [], images: [], mediaKind: "image" }, quotePost) as Record<string, any>;
  assert.ok(ig.caption.startsWith("Sometimes you just need to be somewhere quiet"), "opens with the quote");
  assert.ok(!/Looking for|📩|DM "/.test(ig.caption), "no sales parts");
  assert.deepEqual(ig.hashtags, written.hashtags, "theme hashtags kept, no forced brand or local tag");
  assert.equal(ig.seoScore.score, 10, JSON.stringify(ig.seoScore.checks.filter((check: any) => !check.passed)));

  // The weak version a sales template produced is now scored honestly.
  const weak = fitToPlatform("instagram", { hook: "Quiet thoughts? This cat knows how to find them 🐱", paragraphs: ["A still moment in sunlight."], cta: "What's your favorite quiet spot?", hashtags: ["#QuietThoughts", "#CatInSunlight", "#PeacefulMoment", "#AnimalMoments", "#NatureCalm"], onScreenText: "" }, { platforms: [], images: [], mediaKind: "image" }, quotePost) as Record<string, any>;
  assert.ok(weak.seoScore.score <= 6, `weak caption scored ${weak.seoScore.score}`);

  assert.equal(
    cleanAltText("A white cat sits on grass, backlit by sunbeams, with text overlay: 'Sometimes you just need to be somewhere quiet enough to hear your own thoughts.'"),
    "A white cat sits on grass, backlit by sunbeams, with text overlay: 'Sometimes you just need to be somewhere quiet enough…'",
    "a long quote in alt text ends with an ellipsis instead of mid-sentence",
  );
});

test("grouped poster lists are complete, the slogan is kept and no urgency is invented", () => {
  const poster = {
    postType: "course-or-training" as const, message: "Snowflake data engineering training with dbt and Airflow", mood: "professional, exciting",
    brand: "TINITIATE AI", mainKeyword: "snowflake data engineering", subject: "Snowflake data engineering training", tagline: "Learn. Build. Lead. The Future.",
    slogan: "Don't just store data. Build data systems.",
    sections: [
      { title: "SNOWFLAKE", items: ["Warehouses", "Databases", "Schemas", "Stages", "File Formats", "COPY INTO", "Snowpipe"] },
      { title: "DBT", items: ["SQL Transformations", "Models", "Tests", "Sources", "Documentation", "Data Quality"] },
      { title: "APACHE AIRFLOW", items: ["DAGs", "Scheduling", "Dependencies", "Operators", "Monitoring", "Pipeline Automation"] },
      { title: "Career-Ready Skills", items: ["Modern Data Stack", "SQL & ELT", "Cloud Data Warehousing", "Real-World Projects"] },
    ],
    details: [], visibleText: "", website: "www.tinitiateai.com", email: "contact@tinitiateai.com", phone: "+91 630 912 3485",
    searchKeywords: ["snowflake course", "dbt airflow"], altText: "Tinitiate AI Snowflake data engineering course poster",
  };
  const ig = fitToPlatform("instagram", {
    hook: "Master Snowflake data engineering with Tinitiate AI",
    searchLine: "Want to become a data engineer?",
    paragraphs: ["Build real pipelines with Snowflake, dbt and Apache Airflow."],
    listTitle: "What you'll master", benefits: [], cta: "Enroll now — limited slots.", dmKeyword: "", hashtags: ["#Snowflake", "#DataEngineering", "#ApacheAirflow", "#dbt"], onScreenText: "",
  }, { platforms: [], images: [], mediaKind: "image" }, poster) as Record<string, any>;
  assert.match(ig.caption, /What you'll master:\n✅ Snowflake: Warehouses, Databases, Schemas, Stages, File Formats, COPY INTO & Snowpipe\n✅ DBT: SQL Transformations/);
  assert.match(ig.caption, /✅ Apache Airflow: DAGs, Scheduling, Dependencies, Operators, Monitoring & Pipeline Automation/);
  assert.match(ig.caption, /✅ Career-Ready Skills: Modern Data Stack, SQL & ELT, Cloud Data Warehousing & Real-World Projects/);
  assert.match(ig.caption, /Don't just store data\. Build data systems\./);
  assert.ok(!/limited slots/i.test(ig.caption), "invented urgency removed");
  assert.match(ig.caption, /📩 DM "SNOWFLAKE"/, "a DM keyword even when the model gave none");
  assert.ok(ig.hashtags.includes("#TinitiateAI"));
  assert.equal(ig.seoScore.checks.find((check: any) => check.id === "facts").passed, true);
  assert.equal(dropUnstatedClaims("Enroll now — limited slots."), "Enroll now.");
  assert.equal(dropUnstatedClaims("Enroll now — limited seats.", "Limited seats for the March batch"), "Enroll now — limited seats.", "kept when the author said it");
});

test("nested poster sections: columns, a project flow and outcomes each get their own fitting block", () => {
  const base = {
    postType: "course-or-training" as const, brand: "TINITIATE AI", mainKeyword: "aws data engineering", subject: "AWS data engineering with AI training",
    tagline: "Learn AWS. Engineer Data. Integrate AI. Build the Future.", slogan: "Learn Technology. Integrate AI. Build What's Next.",
    details: [], visibleText: "", website: "www.tinitiateai.com", email: "contact@tinitiateai.com", phone: "+91 630 912 3485",
    searchKeywords: ["aws data engineering course"], altText: "Tinitiate AI AWS data engineering with AI course poster",
  };
  const nested = {
    ...base,
    sections: [
      { title: "WHAT YOU'LL LEARN", kind: "list" as const, items: [], groups: [
        { name: "AWS Cloud Fundamentals", items: ["S3", "IAM", "VPC", "Cloud Architecture"] },
        { name: "AWS Data Services", items: ["AWS Glue", "Amazon S3", "Amazon Athena", "Amazon Redshift"] },
      ] },
      { title: "BUILD REAL-WORLD PROJECTS", kind: "steps" as const, groups: [], items: ["Raw Data", "AWS S3", "Glue ETL", "Data Warehouse", "Athena", "AI Insights"] },
      { title: "WHY AWS + AI?", kind: "statement" as const, groups: [], items: ["Data + Cloud + AI = The Modern Data Engineer"] },
      { title: "CAREER-READY SKILLS", kind: "list" as const, groups: [], items: ["Cloud Data Engineering", "SQL + Python + PySpark", "Real-World Project Experience"] },
    ],
  };
  const written = {
    hook: "AWS Data Engineering with AI: build AI-ready pipelines ☁️🤖", searchLine: "Want to turn raw data into intelligent AI workflows?",
    paragraphs: ["Master cloud data engineering with mentor-led, live project training."], listTitle: "",
    sectionHeadings: ["💡 What You'll Master", "🔄 Build Real-World Projects", "🎯 Career-Ready Outcomes"],
    benefits: [], cta: "Start your data engineering journey today! 🚀", dmKeyword: "AWS", dmReason: "the full syllabus and free trial sessions",
    hashtags: ["#AWSDataEngineering", "#DataEngineering", "#TinitiateAI", "#AWS", "#CloudComputing"], onScreenText: "",
  };
  const request = { platforms: [], images: [], mediaKind: "image" as const, businessDetails: "Mentor-led live projects, Hyderabad and online, free trial sessions" };
  const ig = fitToPlatform("instagram", written, request, nested) as Record<string, any>;
  assert.match(ig.caption, /💡 What You'll Master:\n✅ AWS Cloud Fundamentals: S3, IAM, VPC & Cloud Architecture\n✅ AWS Data Services: AWS Glue, Amazon S3, Amazon Athena & Amazon Redshift/);
  assert.match(ig.caption, /🔄 Build Real-World Projects:\nRaw Data → AWS S3 → Glue ETL → Data Warehouse → Athena → AI Insights/);
  assert.match(ig.caption, /🎯 Career-Ready Outcomes:\nCloud Data Engineering • SQL \+ Python \+ PySpark • Real-World Project Experience/);
  assert.ok(!/Modern Data Engineer/.test(ig.caption), "statement blocks are not forced into a list");
  assert.match(ig.caption, /📩 DM "AWS" for the full syllabus and free trial sessions\./, "the DM reason, because the owner stated free trials");
  assert.equal(ig.seoScore.checks.find((check: any) => check.id === "facts").passed, true);

  const noTrial = fitToPlatform("instagram", written, { ...request, businessDetails: "" }, nested) as Record<string, any>;
  assert.match(noTrial.caption, /📩 DM "AWS" for details\./, "an unstated free trial is never promised");

  // What a small model really sent: whole columns and the flow packed into single entries.
  const packed = { ...base, sections: [{ title: "What You'll Learn", items: ["AWS Cloud Fundamentals (S3 • IAM • VPC • Cloud Architecture)", "AWS Data Services: AWS Glue • Amazon S3 • Amazon Athena"] }, { title: "Build Real-world Projects", items: ["Raw Data → AWS S3 → Glue ETL → AI Insights"] }] } as any;
  const fixed = fitToPlatform("instagram", { ...written, sectionHeadings: [], dmKeyword: "" }, { ...request, businessDetails: "" }, packed) as Record<string, any>;
  assert.match(fixed.caption, /What You'll Learn:\n✅ AWS Cloud Fundamentals: S3, IAM, VPC & Cloud Architecture\n✅ AWS Data Services: AWS Glue, Amazon S3 & Amazon Athena/);
  assert.match(fixed.caption, /Build Real-world Projects:\nRaw Data → AWS S3 → Glue ETL → AI Insights/);
  assert.match(fixed.caption, /📩 DM "AWS"/, "DM keyword from the subject when the model gave none");
});

test("step-by-step posters: no repeated headings, no lowercase slips in the DM line, alt text always present", () => {
  const poster = {
    postType: "service" as const, brand: "Tinitiate AI", mainKeyword: "agentic ai", subject: "how agentic AI works", message: "How agentic AI works in 6 steps",
    details: [], visibleText: "", website: "www.tinitiateai.com", email: "contact@tinitiateai.com", phone: "+916309123485", searchKeywords: ["agentic ai"], altText: "",
    sections: [
      { title: "Understand", kind: "list" as const, items: [], groups: [{ name: "Receives a goal or task", items: ["Find the best way to analyze this data"] }] },
      { title: "Take Action", kind: "list" as const, items: [], groups: [{ name: "Executes the planned steps", items: ["The agent performs tasks instead of just replying"] }] },
    ],
  };
  const ig = fitToPlatform("instagram", {
    hook: "Agentic AI doesn't just answer — it thinks, plans and acts 🤖", searchLine: "How does agentic AI work?", paragraphs: ["Six clear steps."], listTitle: "",
    sectionHeadings: ["💡 Understand: Receive your goal or task", "✅ Take Action: Let AI perform tasks"], benefits: [], cta: "Book your demo today and see AI at work.",
    dmKeyword: "AGENTICAI", dmReason: "Get the full workflow breakdown", hashtags: [], onScreenText: "",
  }, { platforms: [], images: [], mediaKind: "image" }, poster) as Record<string, any>;
  assert.match(ig.caption, /💡 Understand: Receive your goal or task:\n✅ Find the best way to analyze this data/);
  assert.match(ig.caption, /✅ Take Action: Let AI perform tasks:\n✅ Executes the planned steps: The agent performs tasks instead of just replying/);
  assert.match(ig.caption, /📩 DM "AGENTICAI" for the full workflow breakdown\./);
  assert.equal(ig.altText, "Graphic by Tinitiate AI: How agentic AI works in 6 steps.");
});

test("speed: live text is readable mid-answer, and only usable fields are requested", () => {
  assert.equal(livePreview(`{"hook":"AWS Data Engineering with AI ☁️","searchLine":"Want to build`), "AWS Data Engineering with AI ☁️\n\nWant to build");
  assert.equal(livePreview(`{"angle":"plan","hook":"Line one\\nstill \\"quoted\\"","paragraphs":["First.","Sec`), "Line one\nstill \"quoted\"\n\nFirst.\n\nSec", "the hidden plan is not shown; escapes are read");
  assert.equal(livePreview(`{"hook":"Hi","hashtags":["#AWS"`), "Hi", "hashtags are not part of the live caption");
  const empty = { brand: "", tagline: "", offerings: [], blocks: [], listHeading: "", slogan: "", website: "", email: "", phone: "" };
  const instagram = { required: ["hook", "listTitle", "sectionHeadings", "benefits", "cta"], properties: { hook: {}, listTitle: {}, sectionHeadings: {}, benefits: {}, cta: {} } };
  assert.deepEqual((schemaFor(instagram, empty) as any).required, ["hook", "cta"], "no lists: no list fields");
  assert.deepEqual((schemaFor(instagram, { ...empty, offerings: ["A", "B"] }) as any).required, ["hook", "listTitle", "benefits", "cta"], "one list: heading and benefits");
  assert.deepEqual((schemaFor(instagram, { ...empty, blocks: [{ title: "X", kind: "list", groups: [], items: ["a", "b"] }] } as any) as any).required, ["hook", "listTitle", "sectionHeadings", "cta"], "sections: headings, no benefits");
});

test("real 4B run: flows get arrows, sentences are not lists, headings are never skipped", () => {
  const clean = (values: unknown) => (Array.isArray(values) ? values.map(String) : []);
  const blocks = listBlocksOf([
    { title: "Build Real-World Projects", kind: "list", groups: [], items: ["Raw Data", "AWS S3", "Glue ETL", "Data Warehouse", "Athena", "AI Insights"] },
    { title: "WHY AWS + AI?", kind: "list", groups: [], items: ["Data + Cloud + AI = The Modern Data Engineer", "Learn how to build scalable data pipelines and prepare high-quality data for analytics, machine learning, and "] },
    { title: "Career-Ready Skills", kind: "list", groups: [], items: ["Cloud Data Engineering", "SQL + Python + PySpark"] },
  ], clean);
  assert.equal(blocks[0].kind, "steps");
  assert.deepEqual(blocks.map((block) => block.title), ["Build Real-World Projects", "Career-Ready Skills"], "the cut-off sentence block is dropped");
  const schema = schemaFor({ required: ["sectionHeadings"], properties: { sectionHeadings: { type: "array" } } }, { brand: "", tagline: "", offerings: [], blocks, listHeading: "", slogan: "", website: "", email: "", phone: "" }) as any;
  assert.equal(schema.properties.sectionHeadings.minItems, 2);
});

test("Facebook, LinkedIn and YouTube: full posts reach 10/10, weak ones are scored honestly", () => {
  const poster = {
    postType: "course-or-training" as const, brand: "Tinitiate AI", mainKeyword: "aws data engineering", subject: "AWS data engineering training",
    tagline: "", slogan: "Learn Technology. Integrate AI. Build What's Next.", details: [], visibleText: "", website: "www.tinitiateai.com", email: "contact@tinitiateai.com", phone: "+91 630 912 3485",
    searchKeywords: ["aws data engineering course"], altText: "Tinitiate AI poster for an AWS data engineering with AI course",
    sections: [
      { title: "What You'll Learn", kind: "list" as const, items: [], groups: [{ name: "AWS Data Services", items: ["AWS Glue", "Amazon S3", "Amazon Athena"] }] },
      { title: "Build Real-World Projects", kind: "steps" as const, groups: [], items: ["Raw Data", "AWS S3", "Glue ETL", "AI Insights"] },
    ],
  };
  const request = { platforms: [], images: [], mediaKind: "image" as const, location: "Hyderabad", businessDetails: "Mentor-led live projects, online and in Hyderabad" };
  const fb = fitToPlatform("facebook", {
    hook: "AWS data engineering with AI at Tinitiate AI ☁️🤖",
    paragraphs: ["Learn to turn raw data into AI-ready pipelines with AWS Glue, Amazon S3 and Athena, through mentor-led live projects in Hyderabad and online.", "You build real pipelines from day one, so you finish with project experience employers ask for."],
    listTitle: "", sectionHeadings: ["💡 What You'll Learn", "🔄 Build Real-World Projects"], benefits: [], cta: "Message us for the full syllabus and batch timings! 💬", hashtags: ["#TinitiateAI", "#AWSDataEngineering"],
  }, request, poster) as Record<string, any>;
  assert.equal(fb.seoScore.score, 10, JSON.stringify(fb.seoScore.checks.filter((check: any) => !check.passed)));
  assert.match(fb.post, /🔄 Build Real-World Projects:\nRaw Data → AWS S3 → Glue ETL → AI Insights/);

  const li = fitToPlatform("linkedin", {
    hook: "AWS data engineering is where cloud, data and AI meet, and it is one of the most in-demand skills in tech.",
    paragraphs: ["Most teams struggle to turn raw data into reliable pipelines that AI can actually use.", "At Tinitiate AI, learners build those pipelines with AWS Glue, Amazon S3 and Athena through mentor-led live projects, online and in Hyderabad.", "The result is hands-on experience with the same tools data teams use every day, and a portfolio of real projects."],
    listTitle: "", sectionHeadings: ["What You'll Learn", "Build Real-World Projects"], benefits: [], cta: "Which AWS service do you rely on most for your pipelines? Message us for the syllabus.", hashtags: ["#TinitiateAI", "#AWSDataEngineering", "#DataEngineering", "#AWS"],
  }, request, poster) as Record<string, any>;
  assert.equal(li.seoScore.score, 10, JSON.stringify(li.seoScore.checks.filter((check: any) => !check.passed)));

  const yt = fitToPlatform("youtube", {
    title: "AWS Data Engineering with AI | Tinitiate AI", summary: "Learn AWS data engineering with AI: build pipelines with AWS Glue, Amazon S3 and Athena.",
    paragraphs: ["In this course you go from raw data to AI insights, building real pipelines on AWS step by step with mentor-led live projects.", "Training runs online and in Hyderabad, with the same tools data teams use every day, so you leave with a portfolio of real-world projects to show."],
    listTitle: "", sectionHeadings: ["What You'll Learn", "Build Real-World Projects"], benefits: [], cta: "Subscribe for more data engineering lessons and comment with your questions.",
    tags: ["aws data engineering", "aws glue", "amazon s3", "amazon athena", "data pipelines", "data engineering course", "aws course hyderabad", "tinitiate ai"], hashtags: ["#AWS", "#DataEngineering", "#TinitiateAI"], thumbnailText: "AWS Data Engineering",
  }, request, poster) as Record<string, any>;
  assert.equal(yt.seoScore.score, 10, JSON.stringify(yt.seoScore.checks.filter((check: any) => !check.passed)));
  assert.ok(!/\p{Extended_Pictographic}/u.test(yt.title), "no emoji in YouTube titles");

  const weak = fitToPlatform("linkedin", { hook: "New course!", paragraphs: ["Join now."], cta: "", hashtags: ["#Course"] }, { ...request, location: "" }, poster) as Record<string, any>;
  assert.ok(weak.seoScore.score <= 5, `weak LinkedIn post scored ${weak.seoScore.score}`);
});

test("real Facebook/LinkedIn/YouTube run: local tag, tag splitting and title case", () => {
  const poster = { postType: "course-or-training" as const, brand: "Tinitiate AI", mainKeyword: "aws data engineering with ai", subject: "AWS data engineering", details: [], visibleText: "", searchKeywords: ["#AWSDataEngineering"], altText: "Course poster for AWS data engineering", website: "", email: "", phone: "" };
  const request = { platforms: [], images: [], mediaKind: "image" as const, location: "Hyderabad" };
  const fb = fitToPlatform("facebook", { hook: "AWS data engineering with AI", paragraphs: ["One."], cta: "Message us!", hashtags: ["#AWSDataEngineering", "#TinitiateAI"] }, request, poster) as Record<string, any>;
  assert.ok(fb.hashtags.includes("#HyderabadDataEngineering"), fb.hashtags.join(" "));
  const yt = fitToPlatform("youtube", { title: "AWS data engineering with AI | Tinitiate AI", summary: "S.", paragraphs: ["a", "b"], cta: "Subscribe", tags: ["AWSDataEngineering", "AWSData Engineering", "PySpark"], hashtags: [], thumbnailText: "" }, request, poster) as Record<string, any>;
  assert.equal(yt.title, "AWS Data Engineering with AI | Tinitiate AI");
  assert.ok(yt.tags.includes("aws data engineering") && !yt.tags.some((tag: string) => /awsdata/i.test(tag)), yt.tags.join(", "));
  assert.equal(headlineCase("how to use iPhone with eBay"), "How to Use iPhone with eBay");
  assert.equal(headlineCase("Learn the skill stack that future-proofs your tech career"), "Learn the skill stack that future-proofs your tech career", "sentences keep sentence case");
});

test("shifted or empty benefits from a small model never reach the post", () => {
  const courses = ["Azure Data Engineering", "SnowFlake Data Engineering", "AWS Data Engineering", "GCP Data Engineering", "Machine Learning", "React Web Development", "Agentic AI", "Power BI", "Java Full Stack"];
  assert.equal(benefitOk("Learn Machine Learning", "AWS Data Engineering", courses), "", "another course's name");
  assert.equal(benefitOk("Master Data Engineering", "SnowFlake Data Engineering", courses), "", "only the item's own words");
  assert.equal(benefitOk("Transform data into insights", "Data Engineering", ["Coding", "Data Engineering", "Cloud Computing"]), "Transform data into insights");
  const poster = { postType: "course-or-training" as const, brand: "Tinitiate AI", mainKeyword: "tech training courses", subject: "tech courses", offerings: courses, details: [], visibleText: "", searchKeywords: [], altText: "Course poster", phone: "", email: "", website: "" };
  const shifted = ["Build real-world applications", "Master Data Engineering", "Learn Machine Learning", "Develop React Apps", "Work with Agentic AI", "Power BI Analytics", "Java Full Stack", "Azure & AWS Prep", "GCP & SnowFlake Skills"];
  const ig = fitToPlatform("instagram", { hook: "Tech training courses that get you hired 🚀", searchLine: "Looking for tech training?", paragraphs: ["Real projects."], listTitle: "🎯 Our courses", benefits: shifted, cta: "Visit now 📲", dmKeyword: "COURSES", hashtags: [], onScreenText: "" }, { platforms: [], images: [], mediaKind: "image" }, poster) as Record<string, any>;
  assert.match(ig.caption, /🎯 Our courses:\n✅ Azure Data Engineering\n✅ SnowFlake Data Engineering\n/, "plain list when most benefits are wrong");
  assert.ok(!/Visit now/.test(ig.caption), "a two-word call to action is replaced");
  assert.match(ig.caption, /📩 DM "COURSES" to get all the details today!/);
});
