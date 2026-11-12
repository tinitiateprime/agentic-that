// Quality suite for Instagram Social SEO: real-world posts with expected
// results, quality rules checked on every output, and generated inputs.
// Runs offline (no search suggestions) so results are deterministic.

import assert from "node:assert/strict";
import test from "node:test";
import { SocialSeoInputError, buildInstagramSeo } from "./instagram-engine.js";
import { LOW_VALUE_HASHTAGS } from "./text-analysis.js";

const png = (name, width = 1080, height = 1350) => ({ kind: "image", name, mimeType: "image/png", width, height, sizeBytes: 900_000 });
const jpg = (name, width = 1080, height = 1350) => ({ kind: "image", name, mimeType: "image/jpeg", width, height, sizeBytes: 2_000_000 });
const reel = (name, durationSeconds = 30) => ({ kind: "video", name, mimeType: "video/mp4", width: 1080, height: 1920, durationSeconds, sizeBytes: 30_000_000 });

const run = (post) => buildInstagramSeo({ workspaceName: "Agent01", ...post });
const top = (result) => result.hashtags.selected.map((entry) => entry.tag);
const all = (result) => [...result.hashtags.selected, ...result.hashtags.alternatives].map((entry) => entry.tag);
const caption = (result, id = "polished") => result.captions.find((entry) => entry.id === id)?.text || "";

// ---- Quality rules every result must meet ---------------------------------------

const TAG = /^#[\p{L}\p{M}\p{N}_]{3,30}$/u;

function assertQuality(result, label) {
  const tags = top(result);
  assert.ok(tags.length >= 1 && tags.length <= 5, `${label}: 1-5 hashtags, got ${tags.length}`);
  assert.equal(new Set(tags.map((tag) => tag.toLowerCase())).size, tags.length, `${label}: duplicate hashtags ${tags}`);
  for (const tag of all(result)) {
    assert.match(tag, TAG, `${label}: malformed hashtag ${tag}`);
    assert.ok(!LOW_VALUE_HASHTAGS.has(tag.slice(1).toLowerCase()), `${label}: low-value hashtag ${tag}`);
    assert.ok(!/^#[A-Z0-9]{6,}$/.test(tag), `${label}: shouting hashtag ${tag}`);
  }
  const chosen = new Set(tags.map((tag) => tag.toLowerCase()));
  assert.ok(result.hashtags.alternatives.every((entry) => !chosen.has(entry.tag.toLowerCase())), `${label}: alternatives repeat a selected tag`);

  assert.ok(result.captions.length >= 1, `${label}: no captions`);
  for (const variant of result.captions) {
    const text = variant.text;
    const where = `${label} [${variant.id}]`;
    assert.ok(text.length > 0 && text.length <= 2200, `${where}: length ${text.length}`);
    assert.ok(!/undefined|null|NaN|\[object/.test(text), `${where}: leaked value\n${text}`);
    assert.ok(!/\n{3,}/.test(text), `${where}: blank-line run\n${text}`);
    assert.ok(!/(?<!\.)\.\.(?!\.)/.test(text), `${where}: double full stop\n${text}`);
    assert.ok(!/ [.,!?;:](\s|$)/.test(text), `${where}: space before punctuation\n${text}`);
    assert.ok(!/[^\S\n]{2,}/.test(text), `${where}: double space\n${text}`);
    assert.ok(variant.hook.length <= 125, `${where}: hook longer than the visible first line`);
    assert.ok(!/\b(\w{2,})\s+\1\b/i.test(variant.hook), `${where}: repeated word in hook "${variant.hook}"`);
    if (result.keywords.primary && /[a-z]/i.test(result.keywords.primary.phrase) && result.intent.id !== "teaser") {
      assert.equal(variant.keywordVisible, true, `${where}: keyword not before "… more"\n${text}`);
    }
    const paragraphs = text.split("\n\n").map((paragraph) => paragraph.trim()).filter(Boolean);
    assert.equal(new Set(paragraphs).size, paragraphs.length, `${where}: repeated paragraph\n${text}`);
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      assert.ok(!/^[a-z]/.test(line) || /^(www\.|https?:)/i.test(line), `${where}: line starts lowercase "${line}"`);
    }
    // At most one save/share/tag prompt line.
    const prompts = text.split("\n").filter((line) => /^\p{Extended_Pictographic}/u.test(line) && /\b(save this|share this|tag (the|a|your|who))\b/i.test(line));
    assert.ok(prompts.length <= 1, `${where}: repeated prompt lines\n${text}`);
  }
  for (const entry of result.altText) {
    assert.ok(entry.text.length <= 125, `${label}: alt text too long`);
    assert.ok(!/(?<!\.)\.\.(?!\.)|undefined/.test(entry.text), `${label}: broken alt text "${entry.text}"`);
  }
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.ok(result.tips.every((tip) => typeof tip === "string" && tip.length > 10 && !/undefined/.test(tip)));
}

// ---- Real-world posts -------------------------------------------------------------

const TINITIATE = "One skill isn’t enough to stay ahead in tech anymore—you need a skill stack. Tinitiate AI helps you future-proof your career by mastering the five pillars that work together: Coding, APIs, Data analytics, Cloud, and AI workflows. Don't just learn an isolated tool; learn how to connect them to build smarter applications and lead the future. Scan the QR code in the image or visit www.tinitiateai.com to get started!";

const POSTS = [
  {
    label: "course poster",
    input: { description: TINITIATE, media: [png("Build Your Future Skill Stack (1).png", 1024, 1536)] },
    check(result) {
      assert.equal(result.intent.id, "education");
      assert.equal(result.keywords.primary.phrase, "skill stack");
      assert.deepEqual(result.brand, { name: "Tinitiate AI", source: "website", tag: "#TinitiateAI" });
      for (const tag of ["#SkillStack", "#CareerGrowth", "#LearnToCode", "#TinitiateAI"]) assert.ok(top(result).includes(tag), tag);
      assert.ok(!all(result).some((tag) => /IsnT|Agent01|BuildSmarter|FivePillars/i.test(tag)));
      const text = caption(result);
      assert.match(text, /work together:\n💻 Coding\n🔗 APIs\n📊 Data analytics\n☁️ Cloud\n🤖 AI workflows/);
      assert.match(text, /visit www\.tinitiateai\.com to get started! 🔗 Link in bio/);
      assert.match(result.altText[0].text, /^Graphic from Tinitiate AI about skill stack, featuring Coding, APIs/);
      assert.equal(result.checklist.find((item) => item.id === "location").skipped, true);
    },
  },
  {
    label: "biryani reel",
    input: { description: "Our new Hyderabadi chicken biryani is slow cooked on dum for 4 hours with saffron and fried onions. Available every weekend at our Banjara Hills kitchen. Order online or walk in! #biryani", media: [reel("biryani.mp4")], location: { city: "Hyderabad", area: "Banjara Hills" } },
    check(result) {
      assert.equal(result.intent.id, "food");
      assert.equal(result.keywords.primary.phrase, "Hyderabadi chicken biryani");
      for (const tag of ["#Biryani", "#HyderabadiChickenBiryani", "#HyderabadFoodies"]) assert.ok(top(result).includes(tag), tag);
      assert.match(caption(result), /Order online or walk in!\n.*\n📍 Banjara Hills, Hyderabad$/);
      assert.equal(result.locationTag, "Banjara Hills, Hyderabad");
    },
  },
  {
    label: "gym",
    input: { description: "New 6-week strength training program starting Monday at FitZone Gym in Kondapur, Hyderabad. Personal trainer support, diet plans and small batches. Limited slots, DM to book your free trial session!", media: [reel("VID_20261101_101010.mp4")], location: { city: "Hyderabad", area: "Kondapur" } },
    check(result) {
      assert.equal(result.intent.id, "fitness");
      assert.equal(result.keywords.primary.phrase, "strength training program");
      assert.equal(result.brand.name, "FitZone Gym");
      assert.ok(top(result).includes("#StrengthTraining") && top(result).includes("#HyderabadFitness"));
      assert.ok(!all(result).includes("#HyderabadStudents"));
      const text = caption(result);
      assert.match(text, /Limited slots, DM to book your free trial session!/);
      assert.ok(!/DM us to book your free trial/.test(text), "no second call to action");
    },
  },
  {
    label: "property",
    input: { description: "Spacious 3 BHK apartments for sale in Gachibowli with clubhouse, swimming pool and 24/7 security. Ready to move, possession in December. Call +91 98765 43210 for a site visit.", media: [jpg("IMG_4521.jpg"), jpg("IMG_4522.jpg")], location: { city: "Hyderabad", area: "Gachibowli" } },
    check(result) {
      assert.equal(result.intent.id, "realestate");
      assert.equal(result.keywords.primary.phrase, "3 BHK apartments");
      assert.ok(top(result).includes("#HyderabadRealEstate") && top(result).includes("#RealEstate"));
      assert.ok(!all(result).some((tag) => ["#Swimming", "#ShopOnline", "#Sports", "#Possession"].includes(tag)));
      assert.notEqual(result.altText[0].text, result.altText[1].text);
    },
  },
  {
    label: "bridal makeup",
    input: { description: "Bridal makeup trial for our lovely bride Sneha 💄 Soft glam look with HD makeup and hair styling by our senior artist. Book your bridal package at Glow Studio, Jubilee Hills.", media: [jpg("bride.jpg")], location: { city: "Hyderabad", area: "Jubilee Hills" } },
    check(result) {
      assert.equal(result.intent.id, "beauty");
      assert.match(result.keywords.primary.phrase, /makeup/i);
      assert.equal(result.brand.name, "Glow Studio");
      assert.ok(top(result).includes("#HyderabadMakeupArtist"));
      assert.ok(!result.keywords.secondary.some((entry) => /sneha soft/i.test(entry.phrase)));
    },
  },
  {
    label: "founders meetup",
    input: { description: "Join us for the Startup Founders Meetup on 22 November at T-Hub, Hyderabad. Talks on fundraising, product-market fit and hiring your first 10 engineers. Register now, seats are limited!", media: [png("meetup-poster.png", 1080, 1080)], location: { city: "Hyderabad" } },
    check(result) {
      assert.equal(result.intent.id, "event");
      assert.ok(top(result).includes("#StartupFoundersMeetup"));
      assert.ok(!all(result).some((tag) => /^#(Hiring|NowHiring|JobOpening)$/.test(tag)));
    },
  },
  {
    label: "festive sale",
    input: { description: "Flat 40% off on handmade cotton kurtis this Diwali! Pure cotton, block printed, sizes S to XXL. Free shipping across India. Shop now at www.vastrahandloom.in", media: [jpg("k1.jpg")] },
    check(result) {
      assert.equal(result.intent.id, "sale");
      assert.match(result.keywords.primary.phrase, /cotton kurtis/);
      assert.ok(top(result).includes("#DiwaliSale"));
      assert.ok(!all(result).some((tag) => /HappyDiwali|RealEstate|^#India$/.test(tag)));
      assert.match(result.captions.find((entry) => entry.id === "hook" || entry.id === "short").hook + result.captions.at(-1).hook, /kurtis are|kurtis\?|kurtis 🔥/i);
    },
  },
  {
    label: "recipe reel",
    input: { description: "Easy paneer butter masala recipe at home 🍛 Ingredients: paneer, butter, tomatoes, cashews, cream and kasuri methi. Ready in 30 minutes. Full recipe in the video!", media: [reel("paneer.mov", 58)] },
    check(result) {
      assert.equal(result.intent.id, "recipe");
      assert.equal(result.keywords.primary.phrase, "paneer butter masala");
      assert.match(caption(result), /Ingredients:\n🧀 Paneer\n🧈 Butter\n🍅 Tomatoes/);
      assert.ok(!top(result).includes("#KasuriMethi") && !top(result).includes("#Recipe"));
      assert.ok(top(result).includes("#PaneerButterMasala"));
    },
  },
  {
    label: "hiring",
    input: { description: "We're hiring! Acme Labs is looking for a Senior React Developer with 4+ years of experience in React, TypeScript and Node.js. Remote friendly. Apply at careers@acmelabs.com", media: [png("hiring.png")] },
    check(result) {
      assert.equal(result.intent.id, "jobs");
      assert.equal(result.keywords.primary.phrase, "Senior React Developer");
      assert.equal(result.brand.name, "Acme Labs");
      assert.ok(top(result).includes("#Hiring"));
      assert.match(caption(result), /Apply at careers@acmelabs\.com/);
      assert.ok(result.tips.some((tip) => tip.includes("careers@acmelabs.com") && tip.includes("Contact options")));
    },
  },
  {
    label: "trek",
    input: { description: "Sunrise at Kedarkantha summit after a 4-day trek through snow forests. Best time to visit is December to April. Saving this itinerary for everyone planning their first Himalayan trek.", media: [jpg("DSC_0912.JPG", 4000, 3000)] },
    check(result) {
      assert.equal(result.intent.id, "travel");
      assert.equal(result.keywords.primary.phrase, "Himalayan trek");
      assert.ok(top(result).includes("#Trekking"));
      assert.ok(!all(result).some((tag) => /Networking|PersonalFinance|4Day|December/.test(tag)));
    },
  },
  {
    label: "lowercase writing",
    input: { description: "honestly the best decision i made this year was switching to a standing desk. back pain gone, more focus, and my posture is so much better. highly recommend if you work from home", media: [jpg("desk.jpg")] },
    check(result) {
      assert.equal(result.keywords.primary.phrase, "standing desk");
      assert.match(caption(result), /^Honestly the best decision I made this year was switching to a standing desk\.\n\nBack pain gone/);
      assert.ok(top(result).includes("#StandingDesk") && top(result).includes("#WorkFromHome"));
    },
  },
  {
    label: "hinglish",
    input: { description: "Aaj ka special hai Hyderabadi dum biryani aur double ka meetha 😋 Order karo Swiggy ya Zomato pe. Spice Route, Ameerpet.", media: [jpg("special.jpg")], location: { city: "Hyderabad", area: "Ameerpet" } },
    check(result) {
      assert.equal(result.keywords.primary.phrase, "Hyderabadi dum biryani");
      assert.ok(!result.keywords.secondary.some((entry) => /\b(ka|hai|aur|karo)\b/i.test(entry.phrase)));
    },
  },
  {
    label: "dentist",
    input: { description: "Smile makeovers with clear aligners and teeth whitening at BrightSmile Dental Clinic. Painless treatment by experienced dentists. Book your free consultation this week.", media: [jpg("smile.jpg", 1080, 1080)], location: { city: "Pune", area: "Baner" } },
    check(result) {
      assert.equal(result.intent.id, "service");
      assert.equal(result.brand.name, "BrightSmile Dental Clinic");
      assert.ok(all(result).includes("#ClearAligners") && all(result).includes("#TeethWhitening"));
      assert.ok(!all(result).some((tag) => /Makeup/.test(tag)));
    },
  },
  {
    label: "finance carousel",
    input: { description: "5 money mistakes to avoid in your 20s: not having an emergency fund, ignoring term insurance, using credit cards for EMIs, skipping SIP investments and not tracking expenses. Which one are you guilty of?", media: [png("slide1.png"), png("slide2.png"), png("slide3.png")] },
    check(result) {
      assert.equal(result.keywords.primary.phrase, "money mistakes");
      assert.match(caption(result), /^5 money mistakes to avoid in your 20s 👇\n\n❌ Not having an emergency fund\n❌ Ignoring term insurance/);
      assert.ok(top(result).includes("#PersonalFinance"));
    },
  },
  {
    label: "interior",
    input: { description: "Before and after of this 2BHK living room makeover in Kokapet. Warm wood panelling, a custom TV unit and soft cove lighting made all the difference. Planning your home interiors? Let's talk.", media: [reel("makeover.mp4", 45)], location: { city: "Hyderabad", area: "Kokapet" } },
    check(result) {
      assert.equal(result.intent.id, "service");
      assert.match(caption(result), /Let's talk\. 📩 DM us for a free design consultation\./);
      assert.ok(top(result).includes("#InteriorDesign"));
      assert.ok(!all(result).some((tag) => /Makeup/.test(tag)));
    },
  },
  {
    label: "saree launch",
    input: { description: "Introducing our new Kanjeevaram silk saree collection for the wedding season ✨ Handwoven by master weavers in Kanchipuram with pure zari borders. Limited pieces available, DM to order.", media: [jpg("saree1.jpg"), jpg("saree2.jpg")] },
    check(result) {
      assert.equal(result.intent.id, "sale");
      assert.ok(result.captions.filter((entry) => entry.id !== "polished").every((entry) => /sarees/.test(entry.hook)));
      assert.ok(top(result).includes("#Kanjeevaram"));
    },
  },
  {
    label: "yoga studio",
    input: { description: "Morning yoga batch for beginners starts 1st December at Shanti Yoga Studio. Learn breathing, flexibility and stress relief with certified teachers. Mon to Fri, 6:30 to 7:30 am.", media: [jpg("yoga.jpg")], location: { city: "Chennai", area: "Adyar" } },
    check(result) {
      assert.equal(result.intent.id, "fitness");
      assert.match(result.keywords.primary.phrase, /yoga/i);
      assert.equal(result.brand.name, "Shanti Yoga Studio");
      assert.ok(top(result).includes("#Yoga") && top(result).includes("#ChennaiYoga"));
      assert.ok(!result.captions.some((entry) => /upskilling|gym buddy/.test(entry.text)));
    },
  },
  {
    label: "car detailing",
    input: { description: "Ceramic coating done on this Mahindra Thar 🔥 9H protection, deep gloss finish and 3 years warranty. Book your car detailing appointment at ShineCare, Madhapur.", media: [reel("thar.mp4", 21)], location: { city: "Hyderabad", area: "Madhapur" } },
    check(result) {
      assert.equal(result.intent.id, "service");
      assert.equal(result.keywords.primary.phrase, "ceramic coating");
      assert.equal(result.brand.name, "ShineCare");
      assert.ok(top(result).includes("#CeramicCoating") && top(result).includes("#CarDetailing"));
      assert.ok(!all(result).includes("#HyderabadBikers"));
      assert.ok(!result.captions.some((entry) => /finally here/.test(entry.hook)));
    },
  },
  {
    label: "pet grooming",
    input: { description: "Bruno came in for a full spa day 🐶 Bath, haircut, nail trim and ear cleaning. Book a pet grooming session for your furry friend this weekend.", media: [jpg("bruno.jpg")] },
    check(result) {
      assert.equal(result.intent.id, "pets");
      assert.ok(top(result).includes("#DogsOfInstagram") && top(result).includes("#PetLovers"));
      assert.ok(!all(result).some((tag) => /SalonLife|HairTransformation|BeautySalon/.test(tag)));
      assert.match(caption(result), /Bruno came in/);
      assert.match(caption(result), /✅ Bath\n💇 Haircut/);
    },
  },
  {
    label: "festival greeting",
    input: { description: "Wishing you and your family a very Happy Diwali! May this festival of lights bring joy, peace and prosperity to your home. From all of us at Sharma Jewellers 🪔", media: [png("diwali.png", 1080, 1080)] },
    check(result) {
      assert.equal(result.intent.id, "greeting");
      assert.equal(result.keywords.primary.phrase, "Happy Diwali");
      assert.equal(result.brand.name, "Sharma Jewellers");
      assert.ok(top(result).includes("#HappyDiwali"));
      assert.ok(!result.captions.some((entry) => /Register|seats are limited|Don't miss/.test(entry.text)));
    },
  },
  {
    label: "coding tips",
    input: { description: "3 Python tricks every beginner should know: list comprehensions, f-strings and enumerate. Save this for your next coding session and follow for more Python tips!", media: [reel("python-tips.mp4", 40)] },
    check(result) {
      assert.ok(top(result).includes("#Python") && top(result).includes("#PythonTricks"));
      assert.match(caption(result), /List comprehensions\n.* F-strings\n.* Enumerate/);
      assert.ok(!result.captions.some((entry) => /DM us to know more/.test(entry.text)), "the author's own call to action is enough");
    },
  },
  {
    label: "wedding photography",
    input: { description: "Candid moments from Aarav and Meera's haldi ceremony in Udaipur 💛 Pure joy, colour and laughter. Booking open for 2027 weddings.", media: [jpg("haldi1.jpg"), jpg("haldi2.jpg")], location: { city: "Udaipur" } },
    check(result) {
      assert.ok(all(result).includes("#HaldiCeremony"));
      assert.ok(!all(result).some((tag) => /Meera|Aarav/.test(tag)), "no names as hashtags");
    },
  },
  {
    label: "handmade gifts",
    input: { description: "Personalised resin keychains and photo frames, perfect return gifts for birthdays and weddings 🎁 Bulk orders welcome. Shipping all over India.", media: [jpg("resin.jpg")] },
    check(result) {
      assert.equal(result.intent.id, "sale");
      assert.match(result.keywords.primary.phrase, /resin keychains/);
      assert.ok(!all(result).some((tag) => /IndianWedding|WeddingInspiration/.test(tag)));
    },
  },
  {
    label: "collaboration",
    input: { description: "Had the best time shooting with @priya.styles for our new summer collection! Light linen dresses in five pastel shades. Shop the look at www.lunalabel.com", media: [jpg("summer.jpg")] },
    check(result) {
      assert.ok(result.tips.some((tip) => tip.includes("@priya.styles") && tip.includes("collaborator")));
      assert.match(caption(result), /Shop the look at www\.lunalabel\.com 🔗 Link in bio/);
    },
  },
  {
    label: "all caps",
    input: { description: "MEGA SALE ON ALL SHOES!!! UPTO 70% OFF ON SNEAKERS AND FORMAL SHOES. ONLY THIS WEEKEND AT STEPUP FOOTWEAR, KUKATPALLY", media: [png("sale.png", 1080, 1080)] },
    check(result) {
      assert.match(caption(result), /^(👟|👗|🛍️)? ?(Formal shoes: )?[Mm]ega sale on all shoes!/);
      assert.ok(!/SNEAKERS|FORMAL/.test(caption(result)));
    },
  },
  {
    label: "teaser",
    input: { description: "Something exciting is coming soon... stay tuned 👀", media: [png("teaser.png")] },
    check(result) {
      assert.equal(result.intent.id, "teaser");
      assert.ok(!result.captions.some((entry) => /talking about coming soon|Spotlight: coming soon/.test(entry.text)));
      assert.match(result.altText[0].text, /coming soon\.\.\./);
    },
  },
  {
    label: "telugu script",
    input: { description: "మా కొత్త బిర్యానీ మెనూ ఇప్పుడు అందుబాటులో ఉంది. ఈ వారాంతంలో తప్పకుండా రండి!", media: [jpg("menu.jpg")] },
    check(result) {
      assert.ok(top(result).some((tag) => tag.includes("బిర్యానీ")), "Telugu vowel signs are kept in hashtags");
      assert.equal(result.captions.length, 1, "English hook templates are not mixed into Telugu text");
    },
  },
  {
    label: "one-liner",
    input: { description: "Monday mood ☕ #coffee", media: [jpg("mood.heic", 3024, 4032)] },
    check(result) {
      assert.ok(top(result).includes("#Coffee"));
      assert.equal(result.checklist.find((item) => item.id === "description-detail").met, false);
    },
  },
];

for (const post of POSTS) {
  test(`real post: ${post.label}`, () => {
    const result = run(post.input);
    assertQuality(result, post.label);
    post.check(result);
  });
}

test("a typed brand name always wins", () => {
  const result = run({ description: TINITIATE, media: [png("poster.png")], brandName: "Tinitiate" });
  assert.equal(result.brand.name, "Tinitiate");
  assert.ok(top(result).includes("#Tinitiate"));
});

test("search phrases from other businesses never become hashtags", () => {
  const result = buildInstagramSeo({ description: TINITIATE, media: [png("poster.png")], signals: { searchSuggestions: ["skill stack", "skill stack academy", "skill stack hub"] } });
  assert.equal(result.keywords.primary.searchValidated, true);
  assert.ok(!all(result).some((tag) => /Academy|Hub/.test(tag)));
});

test("identical input gives identical output", () => {
  const input = POSTS[0].input;
  assert.deepEqual(run(input), run(input));
});

// ---- Generated inputs ---------------------------------------------------------------

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const WORDS = ["biryani", "coffee", "sale", "python", "yoga", "apartments", "bridal", "makeup", "trek", "Diwali", "workshop", "hiring", "cake", "kurtis", "gym", "dentist", "interior", "puppy", "festival", "data", "cloud", "AI", "career", "the", "and", "our", "new", "best", "for", "with", "you", "in", "Hyderabad", "today", "offer", "free", "class", "launch", "team", "join", "book", "now", "order", "online", "skills", "learn", "fresh", "weekend", "special", "limited"];
const EXTRAS = ["😍", "🔥", "✨", "👇", "🐶", "!!!", "...", "?", "www.example.com", "hello@brand.in", "+91 98765 43210", "#Foodie", "#instagood", "@friend.name", "4.5", "24/7", "50%", "e.g.", "బిర్యానీ", "बिरयानी", "\n", ":", ","];

function generatedPost(rand) {
  const words = [];
  const length = 3 + Math.floor(rand() * 60);
  for (let index = 0; index < length; index += 1) {
    const roll = rand();
    if (roll < 0.15) words.push(EXTRAS[Math.floor(rand() * EXTRAS.length)]);
    else if (roll < 0.2) words.push("Coding, APIs, Data analytics, Cloud and AI");
    else if (roll < 0.23) words.push("Includes: one thing, another thing and a third thing.");
    else words.push(WORDS[Math.floor(rand() * WORDS.length)]);
    if (rand() < 0.12) words.push(rand() < 0.5 ? "." : "!");
  }
  let description = words.join(" ");
  if (rand() < 0.1) description = description.toUpperCase();
  if (rand() < 0.05) description = description.repeat(30);
  const kinds = Math.floor(rand() * 4);
  const media = Array.from({ length: 1 + kinds }, (_, index) => (rand() < 0.4
    ? { kind: "video", name: `clip${index}.mp4`, width: Math.floor(rand() * 2000), height: Math.floor(rand() * 2000), durationSeconds: rand() * 400 }
    : { kind: "image", name: rand() < 0.5 ? `IMG_${index}.jpg` : `poster ${index}.png`, mimeType: rand() < 0.5 ? "image/png" : "image/jpeg", width: Math.floor(rand() * 4000), height: Math.floor(rand() * 4000) }));
  const location = rand() < 0.3 ? { city: "Hyderabad", area: rand() < 0.5 ? "Kondapur" : "" } : null;
  const signals = rand() < 0.3 ? { searchSuggestions: ["biryani near me", "python course", "yoga for beginners", "skill stack"] } : undefined;
  return { description, media, location, signals, brandName: rand() < 0.2 ? "My Brand" : "" };
}

const FUZZ_CASES = Number(process.env.SOCIAL_SEO_FUZZ_CASES) || 400;
const FUZZ_SEED = Number(process.env.SOCIAL_SEO_FUZZ_SEED) || 20261110;

test(`${FUZZ_CASES} generated posts never crash and always meet the quality rules`, () => {
  const rand = random(FUZZ_SEED);
  let checked = 0;
  for (let index = 0; index < FUZZ_CASES; index += 1) {
    const input = generatedPost(rand);
    let result;
    try {
      result = run(input);
    } catch (error) {
      assert.ok(error instanceof SocialSeoInputError, `case ${index} threw ${error?.stack}\n${JSON.stringify(input.description)}`);
      continue;
    }
    assertQuality(result, `generated #${index}: ${JSON.stringify(input.description.slice(0, 120))}`);
    checked += 1;
  }
  assert.ok(checked > FUZZ_CASES * 0.85, `only ${checked} generated posts produced results`);
});

test("edge inputs are handled", () => {
  assert.throws(() => run({ description: "", media: [jpg("a.jpg")] }), SocialSeoInputError);
  assert.throws(() => run({ description: "😍😍😍🔥🔥", media: [jpg("a.jpg")] }), SocialSeoInputError);
  assert.throws(() => run({ description: "A real description here", media: [] }), SocialSeoInputError);
  const huge = run({ description: `${"Fresh coffee and croissants every morning at our cafe. ".repeat(80)}`, media: [jpg("a.jpg")] });
  assert.ok(huge.captions.every((entry) => entry.text.length <= 2200));
  const noSize = run({ description: "Weekend yoga workshop for beginners at our studio", media: [{ kind: "image" }, { kind: "video" }] });
  assertQuality(noSize, "missing media sizes");
});
