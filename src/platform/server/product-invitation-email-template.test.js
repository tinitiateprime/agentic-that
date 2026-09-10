import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeProductInvitationTemplate,
  renderProductInvitationEmail,
  STARTER_PRODUCT_INVITATION_TEMPLATE,
} from "./product-invitation-email-template.js";

const variables = {
  recipient_name: "Alex <Buyer>",
  recipient_email: "alex@example.com",
  product_name: "Instagram Publishing & Preview",
  product_description: "Create <safe> previews before publishing.",
  product_url: "https://agenticthat.com/apps/publishing/instagram?from=email&client=one",
  sender_name: "Taylor",
  company_name: "AgenticThat",
};

test("product invitation templates reject workspace and unknown variables", () => {
  assert.throws(
    () => normalizeProductInvitationTemplate({ ...STARTER_PRODUCT_INVITATION_TEMPLATE, body: "Join {{workspace_name}}" }),
    /Unknown template variable/,
  );
});

test("product invitation templates render a safe product introduction", () => {
  const rendered = renderProductInvitationEmail(STARTER_PRODUCT_INVITATION_TEMPLATE, variables);
  assert.equal(rendered.subject, "A closer look at Instagram Publishing & Preview | AgenticThat");
  assert.match(rendered.text, /Explore Instagram Publishing & Preview: https:\/\/agenticthat\.com\/apps\/publishing\/instagram/);
  assert.match(rendered.html, /Alex &lt;Buyer&gt;/);
  assert.match(rendered.html, /Instagram Publishing &amp; Preview/);
  assert.match(rendered.html, /Create &lt;safe&gt; previews before publishing\./);
  assert.match(rendered.html, /from=email&amp;client=one/);
  assert.doesNotMatch(rendered.html, /Alex <Buyer>/);
});

test("product invitation templates require a safe product destination", () => {
  assert.throws(
    () => renderProductInvitationEmail(STARTER_PRODUCT_INVITATION_TEMPLATE, { ...variables, product_url: "javascript:alert(1)" }),
    /valid product URL/,
  );
});

test("product invitation templates fail closed when a variable value is missing", () => {
  const { product_description: _description, ...incomplete } = variables;
  assert.throws(
    () => renderProductInvitationEmail(STARTER_PRODUCT_INVITATION_TEMPLATE, incomplete),
    /Missing value for template variable: product_description/,
  );
});
