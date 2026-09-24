import assert from "node:assert/strict";
import test from "node:test";
import {
  deliverPhoneFrontDeskSummary,
  normalizePhoneFrontDeskProfile,
  phoneFrontDeskAgentDefinition,
  phoneFrontDeskDynamicVariables,
  phoneFrontDeskIntegrationsEnabled,
  sendPhoneFrontDeskUrgentAlert,
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

test("ElevenLabs receptionist uses the standard demo flow while follow-up is parked", async () => {
  const original = process.env.PHONE_FRONT_DESK_FOLLOW_UP_ENABLED;
  delete process.env.PHONE_FRONT_DESK_FOLLOW_UP_ENABLED;
  try {
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
    assert.match(definition.conversation_config.agent.prompt.prompt, /general knowledge of the business's industry/);
    assert.match(definition.conversation_config.agent.prompt.prompt, /Never invent prices/);
    assert.match(definition.conversation_config.agent.prompt.prompt, /appointment request/);
    assert.doesNotMatch(definition.conversation_config.agent.prompt.prompt, /Google Calendar/);
    assert.equal(phoneFrontDeskIntegrationsEnabled(), false);
    assert.equal(variables.calendar_connected, "no");
    assert.equal(variables.services, "Emergency plumbing");
    assert.equal(variables.faq_notes, "Never quote a price on the call.");
    assert.deepEqual(toolNames, ["capture_lead", "prepare_appointment", "request_human_handoff"]);
    await assert.rejects(deliverPhoneFrontDeskSummary({}, "call-id"), /not enabled/);
    await assert.rejects(sendPhoneFrontDeskUrgentAlert({}, {}), /not enabled/);
  } finally {
    if (original === undefined) delete process.env.PHONE_FRONT_DESK_FOLLOW_UP_ENABLED;
    else process.env.PHONE_FRONT_DESK_FOLLOW_UP_ENABLED = original;
  }
});

test("live follow-up can be deliberately enabled later", () => {
  const original = process.env.PHONE_FRONT_DESK_FOLLOW_UP_ENABLED;
  process.env.PHONE_FRONT_DESK_FOLLOW_UP_ENABLED = "true";
  try {
    const definition = phoneFrontDeskAgentDefinition();
    assert.equal(phoneFrontDeskIntegrationsEnabled(), true);
    assert.match(definition.conversation_config.agent.prompt.prompt, /Google Calendar/);
    assert.deepEqual(definition.conversation_config.agent.prompt.tools.map((tool) => tool.name), [
      "capture_lead", "prepare_appointment", "check_availability", "book_appointment", "request_human_handoff",
    ]);
  } finally {
    if (original === undefined) delete process.env.PHONE_FRONT_DESK_FOLLOW_UP_ENABLED;
    else process.env.PHONE_FRONT_DESK_FOLLOW_UP_ENABLED = original;
  }
});
