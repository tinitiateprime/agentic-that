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
  invitationType: "service",
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

export const STARTER_PLATFORM_INVITATION_TEMPLATE = Object.freeze({
  invitationType: "platform",
  name: "Discover AgenticThat",
  description: "A clear overview of AgenticThat and its live messaging, publishing, and public-data services.",
  status: "published",
  subject: "Meet AgenticThat | Practical automation in one place",
  preheader: "Discover AgenticThat services for messaging, publishing, and public-data workflows.",
  eyebrow: "One platform. Practical automation.",
  heading: "Put everyday digital work in one clear place",
  body: "Hi {{recipient_name}},\n\nAgenticThat brings useful business workflows together so your team can communicate, publish, and collect public data without juggling disconnected tools.\n\nExplore the platform and choose the services that fit your work today.",
  buttonLabel: "Explore AgenticThat",
  footer: "If you have questions, reply to this email and the {{company_name}} team will be happy to help.",
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
    invitationType: input.invitationType === "platform" ? "platform" : "service",
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
  const serviceHighlights = Array.isArray(variables.service_highlights)
    ? variables.service_highlights
      .map((item) => ({
        name: String(item?.name || "").trim(),
        description: String(item?.description || "").trim(),
        services: String(item?.services || "").trim(),
      }))
      .filter((item) => item.name && item.description)
      .slice(0, 6)
    : [];
  const servicesText = serviceHighlights.length
    ? `\n\nWhat you can use:\n${serviceHighlights.map((item) => `- ${item.name}: ${item.description}${item.services ? ` (${item.services})` : ""}`).join("\n")}`
    : "";
  const text = `AgenticThat\n\n${rendered.heading}\n\n${rendered.body}${servicesText}\n\n${rendered.buttonLabel}: ${productUrl}\n\n${productName}\n${productDescription}\n\n${rendered.footer}`;
  const html = platformProductEmailTemplate({
    preheader: rendered.preheader,
    eyebrow: rendered.eyebrow,
    title: rendered.heading,
    introduction: rendered.body,
    actionLabel: rendered.buttonLabel,
    actionUrl: productUrl,
    productName,
    productDescription,
    serviceHighlights,
    footerNote: rendered.footer,
  });
  return { subject: rendered.subject, text, html };
}
