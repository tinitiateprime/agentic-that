// Public facts about the site, shared by metadata, robots.txt, sitemap.xml and
// structured data. NEXT_PUBLIC_SITE_URL overrides the domain for staging.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://agenticthat.com").replace(/\/+$/, "");

export const SITE_NAME = "AgenticThat";

export const SITE_TITLE = "AgenticThat — AI agents for websites, messaging and social";

export const CONTACT_EMAIL = "agenticthat@gmail.com";

// Share image (built by scripts/build-brand-kit.mjs). Pages that set their own
// openGraph metadata must list it, or Next.js drops the inherited image.
export const OG_IMAGE = {
  url: "/opengraph-image.png",
  width: 1200,
  height: 630,
  alt: "AgenticThat logo: the Keystone @ symbol in gold beside the AgenticThat name.",
};

export const LOCATION = {
  street: "Vivekananda Nagar, Dilsukhnagar",
  locality: "Hyderabad",
  region: "Telangana",
  postalCode: "500060",
  country: "IN",
  label: "Vivekananda Nagar, Dilsukhnagar, Hyderabad, Telangana 500060, India",
};

// Search-result description: keep under 160 characters (Bing and Google cut longer text).
export const SITE_META_DESCRIPTION =
  "AI agents that write social SEO posts, answer WhatsApp and Telegram, research public data and schedule posts to Instagram, X, LinkedIn, YouTube and more.";

// Longer description for structured data and llms.txt.
export const SITE_DESCRIPTION =
  "AgenticThat runs AI agents for your business from one workspace: social SEO posts written with your ChatGPT, Claude or Gemini, WhatsApp and Telegram messaging, Instagram and Facebook public-data research, and scheduled publishing to Instagram, Facebook, X, LinkedIn, YouTube and Reddit.";

// Paths that need a signed-in account. Search engines are asked not to crawl them.
export const PRIVATE_PATHS = [
  "/api/",
  "/apps",
  "/dashboard",
  "/contacts",
  "/groups",
  "/messages",
  "/settings",
  "/admin-center",
  "/config-manager",
  "/console",
  "/content-manager",
  "/design-preview",
  "/facebook-guide-preview",
  "/__facebook-guide-preview",
  "/home-v2",
  "/join-workspace",
  "/pending-approval",
  "/access-denied",
  "/publishing",
  "/scraper",
  "/whatsapp",
  "/workspace-team",
];

// Public paths that stay crawlable even though a parent path is private.
export const PUBLIC_EXCEPTIONS = ["/publishing/privacy"];
