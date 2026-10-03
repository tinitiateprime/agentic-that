import assert from "node:assert/strict";
import test from "node:test";
import { websiteAssistantProfile } from "./website-studio-assistant.js";

test("generated website assistant learns the individual website business", () => {
  const profile = websiteAssistantProfile({
    businessName: "North Star Plumbing",
    businessType: "Emergency plumber",
    clientEmail: "owner@example.com",
    businessProfile: {
      businessName: "North Star Plumbing",
      businessType: "Emergency plumber",
      description: "Residential plumbing support for urgent leaks and planned repairs.",
      services: ["Plumbing"],
      location: "Leeds",
      phone: "+44 113 555 0100",
      hours: "Open 24 hours",
      language: "English",
    },
    siteSpec: {
      services: [{ name: "Leak repair", summary: "Find and repair household leaks.", details: ["Emergency response", "Pipe repairs"] }],
      faq: [{ question: "Do you handle emergencies?", answer: "Yes, emergency help is available 24 hours." }],
    },
  });

  assert.equal(profile.businessName, "North Star Plumbing");
  assert.deepEqual(profile.services, ["Leak repair"]);
  assert.equal(profile.businessHours, "Open 24 hours");
  assert.match(profile.greeting, /North Star Plumbing/);
  assert.match(profile.faqNotes, /Do you handle emergencies/);
  assert.match(profile.faqNotes, /Never invent this business's prices/);
});
