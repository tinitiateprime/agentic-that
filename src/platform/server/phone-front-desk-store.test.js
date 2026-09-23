import assert from "node:assert/strict";
import test from "node:test";
import { normalizePhoneFrontDeskProfile, phoneFrontDeskLiveConfig } from "./phone-front-desk-store.js";

test("phone front desk profile keeps useful data and rejects unsafe contact values", () => {
  const profile = normalizePhoneFrontDeskProfile({
    businessName: "  North Star Plumbing  ",
    businessType: "Emergency plumber",
    assistantName: "Maya",
    services: ["Drain repair", "Drain repair", "Water heater"],
    businessHours: "24 hours",
    transferNumber: "not-a-phone",
    notificationEmail: "not-an-email",
  }, { name: "Workspace", email: "owner@example.com" });

  assert.equal(profile.businessName, "North Star Plumbing");
  assert.deepEqual(profile.services, ["Drain repair", "Water heater"]);
  assert.equal(profile.transferNumber, "");
  assert.equal(profile.notificationEmail, "owner@example.com");
  assert.match(profile.greeting, /North Star Plumbing/);
});

test("live receptionist is audio-first, grounded and equipped for demo outcomes", () => {
  const profile = normalizePhoneFrontDeskProfile({
    businessName: "North Star Plumbing",
    services: ["Emergency plumbing"],
    faqNotes: "Never quote a price on the call.",
  }, {});
  const config = phoneFrontDeskLiveConfig(profile);
  const toolNames = config.tools[0].functionDeclarations.map((tool) => tool.name);

  assert.deepEqual(config.responseModalities, ["AUDIO"]);
  assert.match(config.systemInstruction, /Never invent prices/);
  assert.match(config.systemInstruction, /Emergency plumbing/);
  assert.deepEqual(toolNames, ["capture_lead", "prepare_appointment", "request_human_handoff"]);
});
