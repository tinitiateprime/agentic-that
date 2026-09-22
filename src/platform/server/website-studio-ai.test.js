import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWebsitePrompt,
  generateWebsiteSpec,
  normalizeWebsiteBusinessProfile,
  normalizeWebsiteSpec,
  runWebsiteQa,
} from "./website-studio-ai.js";

const profile = {
  businessName: "Aster Dental Studio",
  businessType: "Family dental clinic",
  description: "A patient-focused dental clinic offering clear treatment guidance and a calm, comfortable experience for families and working professionals.",
  services: ["Preventive dental care", "Cosmetic dentistry", "Dental implants"],
  audience: "Families and working professionals",
  goal: "Increase consultation requests",
  location: "Hyderabad",
  phone: "+91 90000 00000",
  email: "hello@aster.example",
};

const longCopy = "Clear explanations, thoughtful preparation, comfortable conversations, and practical next steps help every visitor understand the experience and decide how to continue with confidence.";

function providerSpec(services = profile.services) {
  return {
    visual_direction: { industry_group: "appointments", mood: "trustworthy", primary_color: "#173f35", accent_color: "#e5c247" },
    brand: { tagline: "Thoughtful care, clearly delivered", positioning: `${longCopy} ${longCopy}` },
    seo: { title: "Aster Dental Studio | Family Dental Clinic", description: "Explore preventive care, cosmetic dentistry and dental implant consultations at Aster Dental Studio in Hyderabad." },
    hero: { eyebrow: "Calm, considered dental care", headline: "Feel informed at every step of your dental journey.", subheadline: `${longCopy} ${longCopy}`, primary_cta: "Request a consultation", secondary_cta: "Explore services" },
    services_intro: { eyebrow: "Focused care", title: "Dental services shaped around clear needs.", copy: longCopy },
    services: services.map((name) => ({ name, summary: `${longCopy} The ${name.toLowerCase()} experience is explained in clear language.`, details: ["A clear first conversation", "Practical next-step guidance", "A calm patient experience"], cta_label: "Request details" })),
    about: { eyebrow: "The Aster approach", title: "A more considered way to experience dental care.", body: `${longCopy} ${longCopy} ${longCopy}` },
    benefits: [
      { title: "Clarity first", copy: longCopy },
      { title: "Comfort considered", copy: longCopy },
      { title: "Useful next steps", copy: longCopy },
    ],
    process: [
      { title: "Share your needs", copy: longCopy },
      { title: "Discuss the approach", copy: longCopy },
      { title: "Choose a next step", copy: longCopy },
    ],
    faq: [
      { question: "How can I request a consultation?", answer: longCopy },
      { question: "Which services are available?", answer: longCopy },
      { question: "What should I expect first?", answer: longCopy },
      { question: "Where is the clinic located?", answer: `The clinic is located in ${profile.location}. Contact the clinic for directions before travelling.` },
    ],
    contact: { eyebrow: "Start a conversation", title: "Ready to discuss what you need?", copy: longCopy, cta_label: "Contact Aster" },
  };
}

test("normalizes a verified business profile and rejects incomplete briefs", () => {
  assert.equal(normalizeWebsiteBusinessProfile(profile).services.length, 3);
  assert.throws(() => normalizeWebsiteBusinessProfile({ ...profile, description: "Too short" }), /at least 40 characters/);
});

test("website prompt explicitly grounds generated facts and all service names", () => {
  const prompt = buildWebsitePrompt(profile);
  assert.match(prompt, /only factual source/i);
  assert.match(prompt, /Never invent people/i);
  assert.match(prompt, /Preventive dental care/);
});

test("normalizes a complete site and passes deterministic quality checks", () => {
  const spec = normalizeWebsiteSpec(providerSpec(), profile);
  const qa = runWebsiteQa(spec, profile);
  assert.equal(spec.services.length, 3);
  assert.equal(qa.passed, true);
  assert.equal(qa.checks.every((check) => check.passed), true);
});

test("rejects services that were not supplied by the admin", () => {
  const value = providerSpec();
  value.services.push({ name: "Orthodontics", summary: longCopy, details: ["One", "Two"], cta_label: "Learn more" });
  assert.throws(() => normalizeWebsiteSpec(value, profile), /invented service/i);
});

test("preserves an arbitrary multi-service catalogue without a built-in service list", () => {
  const services = Array.from({ length: 12 }, (_, index) => `Custom capability ${index + 1}`);
  const customProfile = { ...profile, services };
  const value = providerSpec();
  value.services = services.map((name) => ({
    name,
    summary: `${longCopy} This capability is presented using only the supplied business context.`,
    details: ["Clear scope", "Useful next step"],
    cta_label: "Request details",
  }));
  const spec = normalizeWebsiteSpec(value, customProfile);
  assert.deepEqual(spec.services.map((service) => service.name), services);
  assert.equal(runWebsiteQa(spec, customProfile).passed, true);
});

test("accepts large service catalogues without silently dropping entries", () => {
  const services = Array.from({ length: 37 }, (_, index) => `Capability ${index + 1}`);
  assert.deepEqual(normalizeWebsiteBusinessProfile({ ...profile, services }).services, services);
});

test("quality checks reject unsupported credentials and performance claims", () => {
  const value = providerSpec();
  value.about.body = `${value.about.body} We are an award-winning clinic with 99% success.`;
  const spec = normalizeWebsiteSpec(value, profile);
  const qa = runWebsiteQa(spec, profile);
  assert.equal(qa.passed, false);
  assert.equal(qa.checks.find((check) => check.key === "no-unsupported-claims")?.passed, false);
});

test("Gemini generation uses structured data and returns QA evidence", async () => {
  let requestedUrl = "";
  let requestBody = null;
  const fetchImpl = async (url, init) => {
    requestedUrl = String(url);
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(providerSpec()) }] } }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 200, totalTokenCount: 300 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await generateWebsiteSpec(profile, { apiKey: "test-key", model: "gemini-test", fetchImpl, timeoutMs: 10_000 });
  assert.match(requestedUrl, /gemini-test:generateContent$/);
  assert.equal(requestBody.generationConfig.responseFormat.text.mimeType, "APPLICATION_JSON");
  assert.equal(result.qa.passed, true);
  assert.equal(result.usage.totalTokens, 300);
});

test("large catalogues are generated in bounded batches and merged in source order", async () => {
  const services = Array.from({ length: 29 }, (_, index) => `Specialist service ${index + 1}`);
  const customProfile = { ...profile, services };
  const requests = [];
  const fetchImpl = async (_url, init) => {
    const request = JSON.parse(init.body);
    const prompt = request.contents[0].parts[0].text;
    const marker = "SERVICES_FOR_THIS_RESPONSE:\n";
    const serviceBatch = JSON.parse(prompt.slice(prompt.lastIndexOf(marker) + marker.length));
    const schema = request.generationConfig.responseFormat.text.schema;
    const isCore = Boolean(schema.properties.brand);
    requests.push({
      size: serviceBatch.length,
      isCore,
      minimum: schema.properties.services.minItems,
      maximum: schema.properties.services.maxItems,
    });
    const value = isCore ? providerSpec(serviceBatch) : { services: providerSpec(serviceBatch).services };
    return new Response(JSON.stringify({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const result = await generateWebsiteSpec(customProfile, { apiKey: "test-key", model: "gemini-test", fetchImpl, timeoutMs: 10_000 });
  assert.deepEqual(result.spec.services.map((service) => service.name), services);
  assert.deepEqual(requests.map((request) => request.size).sort((left, right) => left - right), [5, 12, 12]);
  assert.equal(requests.filter((request) => request.isCore).length, 1);
  assert.equal(requests.every((request) => request.minimum === request.size && request.maximum === request.size), true);
  assert.equal(result.attempts, 3);
  assert.equal(result.usage.totalTokens, 90);
  assert.equal(result.qa.passed, true);
});
