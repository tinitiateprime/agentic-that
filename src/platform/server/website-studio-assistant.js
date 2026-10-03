import {
  createPhoneFrontDeskSessionForProfile,
  normalizePhoneFrontDeskProfile,
} from "./phone-front-desk-store.js";
import {
  getPublishedWebsite,
  getWebsitePreview,
} from "./website-studio-store.js";
import { WebsiteStudioError } from "./website-studio-ai.js";

const globalForWebsiteAssistant = globalThis;
const SESSION_WINDOW_MS = 15 * 60_000;
const SESSION_LIMIT = 8;

function cleanText(value, max = 500) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function sourceValue(input, key, max) {
  return cleanText(input?.[key], max);
}

export async function resolveWebsiteAssistantProject(input) {
  const previewToken = sourceValue(input, "previewToken", 200);
  const theme = sourceValue(input, "theme", 40).toLowerCase();
  const publicSlug = sourceValue(input, "publicSlug", 100).toLowerCase();

  if (previewToken && theme) {
    const preview = await getWebsitePreview(previewToken, theme);
    return { project: preview.project, source: { previewToken, theme } };
  }
  if (publicSlug) {
    return { project: await getPublishedWebsite(publicSlug), source: { publicSlug } };
  }
  throw new WebsiteStudioError("This website assistant is unavailable.", "ASSISTANT_NOT_FOUND", 404);
}

export function websiteAssistantProfile(project) {
  const business = project?.businessProfile || {};
  const site = project?.siteSpec || {};
  const services = Array.isArray(site.services) && site.services.length
    ? site.services.map((service) => cleanText(service?.name, 120)).filter(Boolean)
    : Array.isArray(business.services) ? business.services : [];
  const knowledge = [
    `Business overview: ${cleanText(business.description, 2200)}`,
    business.location ? `Service location or area: ${cleanText(business.location, 240)}` : "",
    business.phone ? `Business phone: ${cleanText(business.phone, 60)}` : "",
    business.email ? `Business email: ${cleanText(business.email, 254)}` : "",
    ...((site.services || []).map((service) => [
      `${cleanText(service?.name, 120)}: ${cleanText(service?.summary, 500)}`,
      ...(service?.details || []).map((detail) => cleanText(detail, 240)),
    ].filter(Boolean).join(" "))),
    ...((site.faq || []).map((item) => `FAQ: ${cleanText(item?.question, 240)} Answer: ${cleanText(item?.answer, 700)}`)),
    "Use general industry knowledge only for helpful explanations. Never invent this business's prices, availability, credentials, guarantees, policies or confirmed appointments.",
  ].filter(Boolean).join("\n");
  const businessName = cleanText(business.businessName || project?.businessName, 120) || "this business";
  const assistantName = "Ava";

  return normalizePhoneFrontDeskProfile({
    businessName,
    businessType: cleanText(business.businessType || project?.businessType, 120) || "service business",
    assistantName,
    language: cleanText(business.language, 60) || "English",
    services,
    businessHours: cleanText(business.hours, 800) || "Please contact the team for current opening hours.",
    greeting: `Hello, welcome to ${businessName}. I'm ${assistantName}, the AI assistant. How can I help you today?`,
    faqNotes: knowledge,
    transferNumber: business.phone,
    notificationEmail: business.email || project?.clientEmail,
  }, { name: businessName, email: business.email || project?.clientEmail });
}

export function assertWebsiteAssistantRateLimit(projectId, visitorKey) {
  const now = Date.now();
  const key = `${cleanText(projectId, 120)}:${cleanText(visitorKey, 160) || "visitor"}`;
  globalForWebsiteAssistant.__websiteAssistantSessions ||= new Map();
  const buckets = globalForWebsiteAssistant.__websiteAssistantSessions;
  const recent = (buckets.get(key) || []).filter((createdAt) => now - createdAt < SESSION_WINDOW_MS);
  if (recent.length >= SESSION_LIMIT) {
    throw new WebsiteStudioError("Please wait a few minutes before starting another AI conversation.", "ASSISTANT_RATE_LIMITED", 429);
  }
  recent.push(now);
  buckets.set(key, recent);
  if (buckets.size > 2_000) {
    for (const [bucketKey, timestamps] of buckets) {
      if (!timestamps.some((createdAt) => now - createdAt < SESSION_WINDOW_MS)) buckets.delete(bucketKey);
    }
  }
}

export async function createWebsiteAssistantSession(input, visitorKey) {
  const { project } = await resolveWebsiteAssistantProject(input);
  assertWebsiteAssistantRateLimit(project.id, visitorKey);
  const profile = websiteAssistantProfile(project);
  const session = await createPhoneFrontDeskSessionForProfile(profile);
  return {
    conversationToken: session.conversationToken,
    signedUrl: session.signedUrl,
    dynamicVariables: session.dynamicVariables,
    provider: session.provider,
    model: session.model,
    expiresAt: session.expiresAt,
    assistant: {
      name: profile.assistantName,
      businessName: profile.businessName,
      greeting: profile.greeting,
      phone: project.businessProfile?.phone || "",
    },
  };
}
