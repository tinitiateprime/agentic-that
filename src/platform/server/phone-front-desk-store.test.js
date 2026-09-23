import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePhoneFrontDeskProfile,
  phoneFrontDeskAgentDefinition,
  phoneFrontDeskDynamicVariables,
} from "./phone-front-desk-store.js";

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

test("ElevenLabs receptionist is grounded, private and equipped for demo outcomes", () => {
  const profile = normalizePhoneFrontDeskProfile({
    businessName: "North Star Plumbing",
    services: ["Emergency plumbing"],
    faqNotes: "Never quote a price on the call.",
  }, {});
  const definition = phoneFrontDeskAgentDefinition();
  const variables = phoneFrontDeskDynamicVariables(profile);
  const toolNames = definition.conversation_config.agent.prompt.tools.map((tool) => tool.name);

  assert.equal(definition.platform_settings.auth.enable_auth, true);
  assert.doesNotMatch(definition.conversation_config.agent.prompt.llm, /gemini/i);
  assert.match(definition.conversation_config.agent.prompt.prompt, /Never invent prices/);
  assert.equal(variables.services, "Emergency plumbing");
  assert.equal(variables.faq_notes, "Never quote a price on the call.");
  assert.deepEqual(toolNames, ["capture_lead", "prepare_appointment", "request_human_handoff"]);
});
