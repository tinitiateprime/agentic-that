import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeProductInvitationTemplate,
  renderProductInvitationEmail,
  STARTER_PLATFORM_INVITATION_TEMPLATE,
  STARTER_PRODUCT_INVITATION_TEMPLATE,
} from "./product-invitation-email-template.js";

const variables = {
  recipient_name: "Alex <Buyer>",
  recipient_email: "alex@example.com",
  product_name: "Instagram Publishing & Preview",
  product_description: "Create <safe> previews before publishing.",
  product_url: "https://agenticthat.com/apps/publishing/instagram?from=email&client=one",
  product_logo: "https://agenticthat.com/email-icons/instagram-logo.png",
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
  assert.match(rendered.html, /email-icons\/instagram-logo\.png/);
  assert.match(rendered.html, /font-family:Inter,-apple-system/);
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

test("AgenticThat overview templates include a concise services section", () => {
  const rendered = renderProductInvitationEmail(STARTER_PLATFORM_INVITATION_TEMPLATE, {
    ...variables,
    product_name: "AgenticThat",
    product_description: "One platform for practical automation.",
    product_url: "https://agenticthat.com/apps",
    service_highlights: [
      { key: "messaging", name: "Messaging", description: "Manage conversations and outreach.", services: "WhatsApp · Telegram", logos: [{ src: "https://agenticthat.com/email-icons/whatsapp-logo.png", name: "WhatsApp" }] },
      { key: "publishing", name: "Publishing", description: "Prepare and publish social content.", services: "Instagram · LinkedIn", logos: [{ src: "https://agenticthat.com/email-icons/instagram-logo.png", name: "Instagram" }] },
      { key: "scraping", name: "Public data", description: "Collect structured public signals.", services: "Instagram · Facebook", logos: [{ src: "https://agenticthat.com/email-icons/facebook-logo.png", name: "Facebook" }] },
    ],
  });

  assert.equal(rendered.subject, "Meet AgenticThat | Practical automation in one place");
  assert.match(rendered.text, /What you can use:/);
  assert.match(rendered.text, /Messaging: Manage conversations and outreach/);
  assert.match(rendered.html, /Platform introduction/);
  assert.match(rendered.html, /What your team can use/);
  assert.match(rendered.html, /WhatsApp · Telegram/);
  assert.match(rendered.html, /email-icons\/whatsapp-logo\.png/);
  assert.match(rendered.html, /email-icons\/facebook-logo\.png/);
});

test("product invitation templates retain their intended invitation type", () => {
  assert.equal(normalizeProductInvitationTemplate(STARTER_PLATFORM_INVITATION_TEMPLATE).invitationType, "platform");
  assert.equal(normalizeProductInvitationTemplate(STARTER_PRODUCT_INVITATION_TEMPLATE).invitationType, "service");
});
