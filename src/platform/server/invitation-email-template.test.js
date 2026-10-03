import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeInvitationTemplate,
  renderInvitationEmail,
  STARTER_INVITATION_TEMPLATE,
} from "./invitation-email-template.js";

const variables = {
  recipient_name: "Alex <Admin>",
  recipient_email: "alex@example.com",
  workspace_name: "Northstar & Co",
  role_names: "Publishing Manager",
  inviter_name: "Taylor",
  invitation_url: "https://agenticthat.com/join-workspace?token=one&next=two",
  expires_in: "7 days",
};

test("invitation templates reject unknown variables", () => {
  assert.throws(
    () => normalizeInvitationTemplate({ ...STARTER_INVITATION_TEMPLATE, body: "Hello {{unknown_value}}" }),
    /Unknown template variable/,
  );
});

test("invitation templates render safe branded HTML and a plain-text fallback", () => {
  const rendered = renderInvitationEmail(STARTER_INVITATION_TEMPLATE, variables);
  assert.equal(rendered.subject, "Taylor invited you to Northstar & Co");
  assert.match(rendered.text, /Accept invitation: https:\/\/agenticthat\.com\/join-workspace/);
  assert.match(rendered.html, /Alex &lt;Admin&gt;/);
  assert.match(rendered.html, /Northstar &amp; Co/);
  assert.match(rendered.html, /token=one&amp;next=two/);
  assert.match(rendered.html, /Hi Alex &lt;Admin&gt;,<br><br>Taylor invited you/);
  assert.doesNotMatch(rendered.html, /Alex <Admin>/);
});

test("invitation templates fail closed when a variable value is missing", () => {
  const { workspace_name: _workspaceName, ...incomplete } = variables;
  assert.throws(
    () => renderInvitationEmail(STARTER_INVITATION_TEMPLATE, incomplete),
    /Missing value for template variable: workspace_name/,
  );
});
