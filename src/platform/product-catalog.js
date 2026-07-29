export const productCategories = [
  {
    id: "messaging",
    label: "Messaging",
    eyebrow: "Customer conversations",
    title: "Reach people and keep every conversation moving",
    description: "Connect the channels your customers already use, then manage replies, contacts, campaigns, and follow-ups from one workspace.",
  },
  {
    id: "publishing",
    label: "Publishing",
    eyebrow: "Content operations",
    title: "Create once, publish with control everywhere",
    description: "Prepare platform-ready content, connect each social account, schedule delivery, and review every publishing outcome.",
  },
  {
    id: "scraping",
    label: "Scraping",
    eyebrow: "Public data workflows",
    title: "Turn public web signals into useful datasets",
    description: "Start with a profile, keyword, or URL and collect structured results that are ready to review or export.",
  },
  {
    id: "engagement",
    label: "Post engagement",
    eyebrow: "Coming next",
    title: "Build thoughtful engagement workflows at scale",
    description: "A monitored workspace for replies, interactions, and post-level follow-up is being prepared for a future release.",
  },
];

const publishingCapabilities = [
  { title: "One clean composer", description: "Prepare media, copy, and timing without jumping between social tabs." },
  { title: "Account-level scheduling", description: "Choose the right connected destination and control when each post should run." },
  { title: "Platform-aware checks", description: "Catch incompatible formats and missing details before a post enters the queue." },
  { title: "Delivery history", description: "See queued, processing, posted, and failed work with a clear audit trail." },
];

const publishingSteps = (platform) => [
  { title: `Connect ${platform}`, description: "Add the account once and complete the secure browser login." },
  { title: "Prepare the post", description: "Upload media, write the copy, preview the result, and choose a publish time." },
  { title: "Review delivery", description: "Follow the queue and confirm what was posted or what needs attention." },
];

const publishingService = ({ slug, name, logo, accent, tint, summary, formats, idealFor }) => ({
  slug,
  category: "publishing",
  name: `${name} Publisher`,
  platformName: name,
  provider: "AgenticThat Publishing",
  logo,
  accent,
  tint,
  availability: "live",
  connectionKind: "publishing",
  platform: slug,
  shortDescription: summary,
  promise: `Plan, prepare, and deliver ${name} content from a controlled publishing workspace.`,
  formatLabel: formats,
  configHref: `/config-manager?service=publishing&platform=${slug}`,
  dashboardHref: `/publishing?platform=${slug}`,
  capabilities: publishingCapabilities,
  steps: publishingSteps(name),
  useCases: idealFor,
  requirements: [
    `An active ${name} account you are permitted to manage`,
    "The AgenticThat Publishing Companion and browser extension",
    "A one-time browser sign-in for the publishing account",
  ],
  outcomes: ["Scheduled and queued posts", "Per-account delivery status", "Platform-ready previews", "Publishing activity history"],
  note: "Browser publishing keeps credentials on the computer running the companion. AgenticThat stores the account reference and workflow state, not your social password.",
});

const engagementService = ({ slug, name, logo, accent, tint, description }) => ({
  slug: `${slug}-engagement`,
  category: "engagement",
  name: `${name} Engagement`,
  platformName: name,
  provider: "AgenticThat Labs",
  logo,
  accent,
  tint,
  availability: "coming-soon",
  connectionKind: "unavailable",
  shortDescription: description,
  promise: `A safer, reviewable way to coordinate ${name} post engagement without losing human oversight.`,
  capabilities: [
    { title: "Reply workspace", description: "Review post conversations and prepare relevant responses in one queue." },
    { title: "Approval controls", description: "Keep sensitive or high-impact actions behind a human confirmation step." },
    { title: "Activity safeguards", description: "Use pacing, limits, and verification handling designed for responsible operation." },
    { title: "Outcome tracking", description: "Understand which interactions completed and which need manual review." },
  ],
  steps: [
    { title: "Choose the posts", description: "Bring selected content and conversations into an engagement workspace." },
    { title: "Prepare actions", description: "Review suggested replies and decide what should be approved." },
    { title: "Monitor results", description: "Track completion and keep uncertain actions in a review queue." },
  ],
  useCases: ["Community follow-up", "Campaign response handling", "Comment review", "Customer-care escalation"],
  requirements: ["This service is not available yet", "No account connection is required today"],
  outcomes: ["Planned reply queue", "Human approval history", "Engagement activity ledger"],
  note: "This preview describes the product direction. It will remain unavailable until the workflows and safeguards meet the AgenticThat release standard.",
});

export const productServices = [
  {
    slug: "whatsapp",
    category: "messaging",
    name: "WhatsApp Workflows",
    platformName: "WhatsApp",
    provider: "AgenticThat Messaging",
    logo: "/whatsapp-logo.svg",
    accent: "#14866d",
    tint: "#e8f7f2",
    availability: "live",
    connectionKind: "whatsapp",
    shortDescription: "Manage customer conversations, contacts, templates, broadcasts, and follow-ups through your WhatsApp Business account.",
    promise: "Give your team one clear place to manage WhatsApp conversations and customer outreach.",
    formatLabel: "Cloud API · WATI · Coexistence",
    configHref: "/whatsapp/onboarding",
    dashboardHref: "/dashboard",
    capabilities: [
      { title: "Shared conversation inbox", description: "See incoming messages, unread conversations, response status, and contact history." },
      { title: "Campaign-ready contacts", description: "Organize contacts and groups, then send approved templates to the right audience." },
      { title: "Flexible connection options", description: "Use Meta Cloud API, Embedded Signup, coexistence, or an existing WATI account." },
      { title: "Operational controls", description: "Manage sender numbers, templates, call settings, delivery states, and webhook activity." },
    ],
    steps: [
      { title: "Connect your business", description: "Choose Meta or WATI and securely link the WhatsApp account you control." },
      { title: "Bring in your audience", description: "Sync contacts, confirm sender numbers, and organize the groups you work with." },
      { title: "Run the workflow", description: "Reply from the inbox, send messages, use templates, and monitor delivery." },
    ],
    useCases: ["Customer support", "Lead follow-up", "Template campaigns", "Event reminders", "Team inbox management"],
    requirements: ["A WhatsApp Business account or WATI workspace", "Permission to manage the connected business", "An approved sender number for outbound messaging"],
    outcomes: ["Conversation history", "Contact and group records", "Message delivery status", "Template and sender configuration"],
    note: "Provider credentials are encrypted before storage. AgenticThat never displays a saved access token back to the browser.",
  },
  {
    slug: "telegram",
    category: "messaging",
    name: "Telegram Workflows",
    platformName: "Telegram",
    provider: "AgenticThat Messaging",
    logo: "/telegram-logo.svg",
    accent: "#2588c7",
    tint: "#eaf5fc",
    availability: "live",
    connectionKind: "telegram",
    shortDescription: "Connect Telegram accounts securely, send direct messages, and manage reusable messaging sessions from one console.",
    promise: "Turn repeat Telegram communication into a dependable, account-aware workflow.",
    formatLabel: "Direct messaging · Account sessions",
    configHref: "/config-manager?service=messaging&platform=telegram",
    dashboardHref: process.env.NEXT_PUBLIC_TELEGRAM_DASHBOARD_URL || "/console",
    capabilities: [
      { title: "Multiple account connections", description: "Connect and identify the Telegram accounts available to your workspace." },
      { title: "Secure verification flow", description: "Complete Telegram codes and optional two-factor verification inside a guided setup." },
      { title: "Direct messaging", description: "Select the right account, recipient, and message without managing raw sessions." },
      { title: "Reusable sessions", description: "Keep approved Telegram sessions encrypted so daily work does not require repeated login." },
    ],
    steps: [
      { title: "Connect the workspace", description: "Open Telegram configuration and start a secure account connection." },
      { title: "Verify the account", description: "Enter the code Telegram sends and your two-factor password only if requested." },
      { title: "Open the console", description: "Choose a connected account and start the messaging workflow." },
    ],
    useCases: ["Direct outreach", "Account-based operations", "Community communication", "Internal alerts"],
    requirements: ["Telegram API ID and API hash from my.telegram.org", "A Telegram phone number you control", "Access to the verification code"],
    outcomes: ["Connected account list", "Encrypted reusable session", "Message history and delivery result"],
    note: "Verification codes are used once and are not saved. Connected account sessions are encrypted in the Telegram data store.",
  },
  publishingService({
    slug: "instagram",
    name: "Instagram",
    logo: "/instagram-logo.svg",
    accent: "#d94672",
    tint: "#fff0f4",
    summary: "Prepare image and video posts, tailor captions, preview the result, and schedule delivery to connected Instagram accounts.",
    formats: "Images · Video · Captions",
    idealFor: ["Campaign calendars", "Reels and post scheduling", "Multi-account brands", "Caption review"],
  }),
  publishingService({
    slug: "youtube",
    name: "YouTube",
    logo: "/youtube-logo.svg",
    accent: "#e32626",
    tint: "#fff0f0",
    summary: "Prepare videos and community content with titles, descriptions, previews, schedules, and a clear delivery trail.",
    formats: "Video · Images · Community text",
    idealFor: ["Video release planning", "Channel calendars", "Community posts", "Multi-channel operations"],
  }),
  publishingService({
    slug: "facebook",
    name: "Facebook",
    logo: "/facebook-logo.svg",
    accent: "#2563b8",
    tint: "#edf4ff",
    summary: "Create and schedule Facebook posts with account-specific copy, media previews, and delivery monitoring.",
    formats: "Text · Images · Video",
    idealFor: ["Page publishing", "Campaign scheduling", "Community updates", "Cross-channel launches"],
  }),
  publishingService({
    slug: "x",
    name: "X",
    logo: "/x-logo.svg",
    accent: "#18181b",
    tint: "#f1f1f2",
    summary: "Write concise posts, validate character limits, attach media, and schedule delivery to connected X accounts.",
    formats: "Text · Images · Video",
    idealFor: ["Announcements", "Editorial calendars", "Campaign coordination", "Multi-account publishing"],
  }),
  publishingService({
    slug: "linkedin",
    name: "LinkedIn",
    logo: "/linkedin-logo.png",
    accent: "#17679e",
    tint: "#edf6fb",
    summary: "Prepare professional updates with platform-specific copy, media, scheduling, and reviewable publishing history.",
    formats: "Text · Images · Video",
    idealFor: ["Company updates", "Thought leadership", "Hiring campaigns", "B2B content calendars"],
  }),
  {
    slug: "instagram-public-data",
    category: "scraping",
    name: "Instagram Public Data",
    platformName: "Instagram",
    provider: "AgenticThat Data",
    logo: "/instagram-logo.svg",
    accent: "#a63d8f",
    tint: "#faf0f8",
    availability: "live",
    connectionKind: "none",
    shortDescription: "Collect recent public Instagram posts and reels from a profile, keyword, hashtag, or direct URL and export clean results.",
    promise: "Move from a public Instagram signal to a useful, reviewable dataset in a few clicks.",
    formatLabel: "Profile · Keyword · URL",
    dashboardHref: "/scraper/instagram",
    capabilities: [
      { title: "Flexible starting points", description: "Use a public profile, keyword, hashtag, post URL, or reel URL." },
      { title: "Useful post signals", description: "Collect captions, post links, timestamps, likes, comments, author details, and thumbnails when available." },
      { title: "Recent-first collection", description: "Choose a recent time window and let the workflow expand older only when more results are needed." },
      { title: "Ready-to-use exports", description: "Review the results in a table and download JSON or CSV for further work." },
    ],
    steps: [
      { title: "Choose an input", description: "Select Profile, Keyword, or URL and enter the public Instagram target." },
      { title: "Set the result window", description: "Choose how many results you need and how recent they should be." },
      { title: "Review or export", description: "Inspect the newest results, open source posts, or download JSON and CSV." },
    ],
    useCases: ["Content research", "Public campaign monitoring", "Creator discovery", "Hashtag analysis", "Competitive research"],
    requirements: ["A public Instagram profile, keyword, hashtag, or URL", "No Instagram account connection is required", "Use collected public data responsibly"],
    outcomes: ["Post and reel URLs", "Public engagement signals", "Author and timestamp fields", "JSON and CSV exports"],
    note: "This tool works with publicly available information. Results depend on what Instagram exposes publicly at the time of collection.",
  },
  engagementService({ slug: "instagram", name: "Instagram", logo: "/instagram-logo.svg", accent: "#d94672", tint: "#fff0f4", description: "Plan a reviewable workspace for Instagram comments, replies, and post-level follow-up." }),
  engagementService({ slug: "facebook", name: "Facebook", logo: "/facebook-logo.svg", accent: "#2563b8", tint: "#edf4ff", description: "Coordinate Facebook post replies and engagement review with clear human approval." }),
  engagementService({ slug: "x", name: "X", logo: "/x-logo.svg", accent: "#18181b", tint: "#f1f1f2", description: "Prepare monitored X reply and interaction workflows with pacing and review controls." }),
  engagementService({ slug: "youtube", name: "YouTube", logo: "/youtube-logo.svg", accent: "#e32626", tint: "#fff0f0", description: "Bring YouTube comment follow-up and response review into a focused operational queue." }),
  engagementService({ slug: "linkedin", name: "LinkedIn", logo: "/linkedin-logo.png", accent: "#17679e", tint: "#edf6fb", description: "Plan professional LinkedIn response workflows without losing brand and human oversight." }),
];

export function getProductCategory(categoryId) {
  return productCategories.find((category) => category.id === categoryId) || null;
}

export function getProductService(categoryId, slug) {
  return productServices.find((service) => service.category === categoryId && service.slug === slug) || null;
}

export function getServicesByCategory(categoryId) {
  return productServices.filter((service) => service.category === categoryId);
}

export function serviceDetailHref(service) {
  return `/apps/${service.category}/${service.slug}`;
}
