import {
  Braces,
  Facebook,
  Heart,
  Instagram,
  Linkedin,
  MapPin,
  MessageCircle,
  MessagesSquare,
  Rocket,
  ScanSearch,
  Send,
  SlidersHorizontal,
  Table2,
  Link2,
  type LucideIcon,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

export type NavLink = { label: string; href: string };

export const NAV_LINKS: NavLink[] = [
  { label: "Store", href: "/apps" },
  { label: "Scraping", href: "#capabilities" },
  { label: "Publishing", href: "#capabilities" },
  { label: "Messaging", href: "#capabilities" },
  { label: "Pricing", href: "#pricing" },
];

/* ------------------------------------------------------------------ */
/* Hero terminal                                                       */
/* ------------------------------------------------------------------ */

export type TerminalLineKind = "cmd" | "ok" | "info" | "data" | "warn";

export type TerminalLine = { kind: TerminalLineKind; text: string };

export const TERMINAL_LINES: TerminalLine[] = [
  { kind: "cmd", text: "agentic deploy instagram_scraper.py --target=profiles" },
  { kind: "info", text: "booting headless session · region=eu-west-1" },
  { kind: "ok", text: "session authenticated in 412ms" },
  { kind: "data", text: "1,420 profiles scraped · 0 duplicates" },
  { kind: "data", text: "8,930 reels indexed · 24 hashtags expanded" },
  { kind: "warn", text: "rate limit guard engaged — throttling to 6 req/s" },
  { kind: "ok", text: "export written → profiles_2026-08-10.json (4.2 MB)" },
  { kind: "cmd", text: "agentic queue publish --channel=linkedin --at=09:00" },
  { kind: "ok", text: "3 posts queued · engagement agent listening" },
];

/* ------------------------------------------------------------------ */
/* Supported ecosystem                                                 */
/* ------------------------------------------------------------------ */

export type Platform = { name: string; icon: LucideIcon; tint: string };

export const PLATFORMS: Platform[] = [
  { name: "Instagram", icon: Instagram, tint: "text-pink-400" },
  { name: "LinkedIn", icon: Linkedin, tint: "text-sky-400" },
  { name: "Telegram", icon: Send, tint: "text-cyan-400" },
  { name: "WhatsApp", icon: MessageCircle, tint: "text-emerald-400" },
  { name: "Google Maps", icon: MapPin, tint: "text-amber-400" },
  { name: "Facebook", icon: Facebook, tint: "text-blue-400" },
];

/* ------------------------------------------------------------------ */
/* Core capabilities                                                   */
/* ------------------------------------------------------------------ */

export type CapabilityStatus = "Active" | "Coming Soon";

export type Capability = {
  icon: LucideIcon;
  title: string;
  status: CapabilityStatus;
  description: string;
  badges: string[];
  href: string;
};

export const CAPABILITIES: Capability[] = [
  {
    icon: ScanSearch,
    title: "Auto-Scrape Intelligence",
    status: "Active",
    description:
      "Point an agent at profiles, hashtags, reels or comment threads. It paginates, de-duplicates and normalises every field before it lands.",
    badges: ["Instagram", "Facebook", "JSON / CSV"],
    href: "/apps",
  },
  {
    icon: MessagesSquare,
    title: "Chat & Messaging Automation",
    status: "Active",
    description:
      "Drive multi-step conversations from real, authenticated sessions with templated flows, delays and per-contact branching rules.",
    badges: ["Telegram", "WhatsApp", "Workflows"],
    href: "/whatsapp",
  },
  {
    icon: Send,
    title: "Publish Queue Runner",
    status: "Active",
    description:
      "Prepare, queue and track browser-driven publishing across every connected channel, with preflight checks before anything ships.",
    badges: ["Publish now", "Multi-channel", "Receipts"],
    href: "/publishing",
  },
  {
    icon: Heart,
    title: "Post Engagement Agent",
    status: "Coming Soon",
    description:
      "Monitored browser sessions run queued likes, follows and comments, then hand back verified interaction receipts for every action.",
    badges: ["Monitored", "Verified", "Safety Governor"],
    href: "#capabilities",
  },
];

/* ------------------------------------------------------------------ */
/* Pipeline                                                            */
/* ------------------------------------------------------------------ */

export type PipelineStep = {
  icon: LucideIcon;
  index: string;
  title: string;
  description: string;
};

export const PIPELINE_STEPS: PipelineStep[] = [
  {
    icon: Link2,
    index: "01",
    title: "Connect & Select Target",
    description:
      "Link an account or paste a public URL. AgenticThat resolves the platform, verifies the session and previews what it can reach.",
  },
  {
    icon: SlidersHorizontal,
    index: "02",
    title: "Configure Workflow & Rules",
    description:
      "Set fields, filters, rate limits and execution rules. Safety governors cap throughput so runs stay well inside platform tolerances.",
  },
  {
    icon: Rocket,
    index: "03",
    title: "Deploy Agents & Export Data",
    description:
      "Ship it and watch live logs stream in. Export to JSON or CSV, or push straight to your warehouse over a webhook.",
  },
];

/* ------------------------------------------------------------------ */
/* Live data preview                                                   */
/* ------------------------------------------------------------------ */

export type ScrapedProfile = {
  username: string;
  followers: string;
  engagement: string;
  category: string;
  status: "Verified" | "Active";
};

export const SAMPLE_PROFILES: ScrapedProfile[] = [
  { username: "@nordic.design", followers: "128,430", engagement: "4.8%", category: "Design", status: "Verified" },
  { username: "@dev.tooling", followers: "84,120", engagement: "6.2%", category: "SaaS", status: "Active" },
  { username: "@growth.lab", followers: "52,908", engagement: "3.1%", category: "Marketing", status: "Active" },
  { username: "@studio.mono", followers: "41,775", engagement: "7.4%", category: "Creative", status: "Verified" },
];

export const SAMPLE_JSON = `{
  "run_id": "run_8f21c4",
  "source": "instagram",
  "scraped_at": "2026-08-10T09:14:22Z",
  "count": 1420,
  "records": [
    {
      "username": "@nordic.design",
      "followers": 128430,
      "engagement_rate": 4.8,
      "category": "Design",
      "verified": true,
      "top_hashtags": ["#studio", "#typography"]
    },
    {
      "username": "@dev.tooling",
      "followers": 84120,
      "engagement_rate": 6.2,
      "category": "SaaS",
      "verified": false,
      "top_hashtags": ["#devtools", "#ship"]
    }
  ]
}`;

export const PREVIEW_TABS = [
  { id: "json", label: "JSON View", icon: Braces },
  { id: "table", label: "Table View", icon: Table2 },
] as const;

export type PreviewTabId = (typeof PREVIEW_TABS)[number]["id"];

/* ------------------------------------------------------------------ */
/* Footer                                                              */
/* ------------------------------------------------------------------ */

export type FooterColumn = { heading: string; links: NavLink[] };

export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    heading: "Product",
    links: [
      { label: "Auto-Scrape", href: "/apps" },
      { label: "Publish Queue", href: "/publishing" },
      { label: "Messaging Hub", href: "/whatsapp" },
      { label: "Engagement Agent", href: "#capabilities" },
      { label: "Pricing", href: "#pricing" },
    ],
  },
  {
    heading: "Platform",
    links: [
      { label: "App Store", href: "/apps" },
      { label: "Integrations", href: "#ecosystem" },
      { label: "API Reference", href: "#" },
      { label: "Changelog", href: "#" },
      { label: "Status", href: "#" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "Documentation", href: "#" },
      { label: "Guides", href: "#" },
      { label: "Blog", href: "#" },
      { label: "Community", href: "#" },
      { label: "Support", href: "#" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "#" },
      { label: "Careers", href: "#" },
      { label: "Privacy", href: "#" },
      { label: "Terms", href: "#" },
      { label: "Contact", href: "#" },
    ],
  },
];
