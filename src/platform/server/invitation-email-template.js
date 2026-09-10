import { platformAuthEmailTemplate } from "./auth-email.js";

export const INVITATION_TEMPLATE_VARIABLES = Object.freeze([
  { key: "recipient_name", label: "Recipient name" },
  { key: "recipient_email", label: "Recipient email" },
  { key: "workspace_name", label: "Workspace name" },
  { key: "role_names", label: "Assigned roles" },
  { key: "inviter_name", label: "Inviter name" },
  { key: "invitation_url", label: "Invitation link" },
  { key: "expires_in", label: "Expiry period" },
]);

export const STARTER_INVITATION_TEMPLATE = Object.freeze({
  name: "Modern workspace invitation",
  description: "Primary invitation for new AgenticThat workspace members.",
  status: "published",
  subject: "{{inviter_name}} invited you to {{workspace_name}}",
  preheader: "Your secure invitation to join {{workspace_name}} is ready.",
  eyebrow: "Workspace invitation",
  heading: "You’re invited to {{workspace_name}}",
  body: "Hi {{recipient_name}},\n\n{{inviter_name}} invited you to join {{workspace_name}}. Your assigned access is: {{role_names}}.",
  buttonLabel: "Accept invitation",
  footer: "If you were not expecting this invitation, you can safely ignore this email. No account will be created unless you accept.",
});

const allowedVariables = new Set(INVITATION_TEMPLATE_VARIABLES.map((item) => item.key));
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

export function normalizeInvitationTemplate(input = {}) {
  const template = {
    name: requiredText(input.name, "Template name", 100),
    description: optionalText(input.description, "Description", 240),
    status: ["draft", "published", "archived"].includes(input.status) ? input.status : "draft",
    subject: requiredText(input.subject, "Subject", 180),
    preheader: optionalText(input.preheader, "Preheader", 180),
    eyebrow: requiredText(input.eyebrow, "Eyebrow", 60),
    heading: requiredText(input.heading, "Heading", 140),
    body: requiredText(input.body, "Message", 2400),
    buttonLabel: requiredText(input.buttonLabel, "Button label", 60),
    footer: requiredText(input.footer, "Security footer", 600),
  };
  for (const value of Object.values(template)) validateVariables(value);
  return template;
}

export function replaceInvitationVariables(value, variables = {}) {
  return String(value || "").replace(templatePattern, (match, key) => {
    const normalizedKey = String(key).toLowerCase();
    return Object.prototype.hasOwnProperty.call(variables, normalizedKey)
      ? String(variables[normalizedKey] ?? "")
      : match;
  });
}

export function renderInvitationEmail(templateInput, variables) {
  const template = normalizeInvitationTemplate(templateInput);
  const invitationUrl = String(variables?.invitation_url || "").trim();
  if (!/^https?:\/\//i.test(invitationUrl)) throw new Error("A valid invitation URL is required.");
  const render = (value) => replaceInvitationVariables(value, variables);
  const subject = render(template.subject);
  const preheader = render(template.preheader);
  const eyebrow = render(template.eyebrow);
  const heading = render(template.heading);
  const body = render(template.body);
  const buttonLabel = render(template.buttonLabel);
  const footer = render(template.footer);
  const unresolved = [subject, preheader, eyebrow, heading, body, buttonLabel, footer]
    .flatMap((value) => [...String(value).matchAll(templatePattern)].map((match) => match[1]));
  if (unresolved.length) {
    throw new Error(`Missing value for template variable: ${[...new Set(unresolved)].join(", ")}.`);
  }
  const expiry = `This secure invitation expires in ${String(variables.expires_in || "7 days")}`;
  const text = `AgenticThat\n\n${heading}\n\n${body}\n\n${buttonLabel}: ${invitationUrl}\n\n${expiry}.\n\n${footer}`;
  const html = platformAuthEmailTemplate({
    preheader,
    eyebrow,
    title: heading,
    introduction: body,
    actionLabel: buttonLabel,
    actionUrl: invitationUrl,
    expiry,
    securityNote: footer,
  });
  return { subject, text, html };
}
