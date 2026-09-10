import { platformProductEmailTemplate } from "./auth-email.js";

export const PRODUCT_INVITATION_TEMPLATE_VARIABLES = Object.freeze([
  { key: "recipient_name", label: "Client name" },
  { key: "recipient_email", label: "Client email" },
  { key: "product_name", label: "Product name" },
  { key: "product_description", label: "Product description" },
  { key: "product_url", label: "Product link" },
  { key: "sender_name", label: "Sender name" },
  { key: "company_name", label: "Company name" },
]);

export const STARTER_PRODUCT_INVITATION_TEMPLATE = Object.freeze({
  name: "Client product introduction",
  description: "A polished introduction that shares one AgenticThat product with a prospective client.",
  status: "published",
  subject: "A closer look at {{product_name}} | AgenticThat",
  preheader: "See how {{product_name}} can simplify your workflow.",
  eyebrow: "A product selected for you",
  heading: "Meet {{product_name}}",
  body: "Hi {{recipient_name}},\n\nWe thought {{product_name}} could be useful for your business. Here is what it does: {{product_description}}\n\nTake a look at the product page and see whether it fits your workflow. If you have any questions, our team will be happy to help.",
  buttonLabel: "Explore {{product_name}}",
  footer: "You are receiving this personal introduction from AgenticThat. If you would prefer not to receive product introductions from us, reply and let us know.",
});

const allowedVariables = new Set(PRODUCT_INVITATION_TEMPLATE_VARIABLES.map((item) => item.key));
const templatePattern = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function requiredText(value, label, max) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return normalized;
}

function optionalText(value, label, max) {
  const normalized = String(value || "").trim();
  if (normalized.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return normalized;
}

function validateVariables(value) {
  for (const match of String(value || "").matchAll(templatePattern)) {
    if (!allowedVariables.has(match[1].toLowerCase())) {
      throw new Error(`Unknown template variable: {{${match[1]}}}.`);
    }
  }
}

export function normalizeProductInvitationTemplate(input = {}) {
  const template = {
    name: requiredText(input.name, "Template name", 100),
    description: optionalText(input.description, "Description", 240),
    status: ["draft", "published", "archived"].includes(input.status) ? input.status : "draft",
    subject: requiredText(input.subject, "Subject", 180),
    preheader: optionalText(input.preheader, "Preheader", 180),
    eyebrow: requiredText(input.eyebrow, "Eyebrow", 60),
    heading: requiredText(input.heading, "Heading", 140),
    body: requiredText(input.body, "Message", 2400),
    buttonLabel: requiredText(input.buttonLabel, "Button label", 80),
    footer: requiredText(input.footer, "Footer note", 600),
  };
  for (const value of Object.values(template)) validateVariables(value);
  return template;
}

export function replaceProductInvitationVariables(value, variables = {}) {
  return String(value || "").replace(templatePattern, (match, key) => {
    const normalizedKey = String(key).toLowerCase();
    return Object.prototype.hasOwnProperty.call(variables, normalizedKey)
      ? String(variables[normalizedKey] ?? "")
      : match;
  });
}

export function renderProductInvitationEmail(templateInput, variables) {
  const template = normalizeProductInvitationTemplate(templateInput);
  const productUrl = String(variables?.product_url || "").trim();
  if (!/^https?:\/\//i.test(productUrl)) throw new Error("A valid product URL is required.");
  const render = (value) => replaceProductInvitationVariables(value, variables);
  const rendered = Object.fromEntries(
    ["subject", "preheader", "eyebrow", "heading", "body", "buttonLabel", "footer"]
      .map((key) => [key, render(template[key])]),
  );
  const unresolved = Object.values(rendered)
    .flatMap((value) => [...String(value).matchAll(templatePattern)].map((match) => match[1]));
  if (unresolved.length) {
    throw new Error(`Missing value for template variable: ${[...new Set(unresolved)].join(", ")}.`);
  }
  const productName = String(variables.product_name || "AgenticThat product");
  const productDescription = String(variables.product_description || "");
  const text = `AgenticThat\n\n${rendered.heading}\n\n${rendered.body}\n\n${rendered.buttonLabel}: ${productUrl}\n\n${productName}\n${productDescription}\n\n${rendered.footer}`;
  const html = platformProductEmailTemplate({
    preheader: rendered.preheader,
    eyebrow: rendered.eyebrow,
    title: rendered.heading,
    introduction: rendered.body,
    actionLabel: rendered.buttonLabel,
    actionUrl: productUrl,
    productName,
    productDescription,
    footerNote: rendered.footer,
  });
  return { subject: rendered.subject, text, html };
}
