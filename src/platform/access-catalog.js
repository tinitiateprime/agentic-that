export const ACCESS_LEVELS = ["none", "view", "operate", "configure"];

export const LIVE_ACCESS_CATALOG = Object.freeze({
  messaging: Object.freeze([
    "messaging.whatsapp",
    "messaging.telegram",
  ]),
  publishing: Object.freeze([
    "publishing.instagram",
    "publishing.youtube",
    "publishing.facebook",
    "publishing.x",
    "publishing.linkedin",
  ]),
  scraping: Object.freeze([
    "scraping.instagram",
    "scraping.facebook",
  ]),
});

export const ACCESS_RESOURCE_KEYS = Object.freeze([
  ...Object.keys(LIVE_ACCESS_CATALOG),
  ...Object.values(LIVE_ACCESS_CATALOG).flat(),
]);

export const SERVICE_AUDIENCE_RESOURCES = Object.freeze({
  telegram: Object.freeze(["messaging.telegram"]),
  publishing: LIVE_ACCESS_CATALOG.publishing,
  scraping: LIVE_ACCESS_CATALOG.scraping,
});

// Public signup bundles are deliberately system-owned. They can grant module
// configuration, but global Admin Center access remains a separate flag.
export const SELF_SERVICE_ROLE_CATALOG = Object.freeze([
  Object.freeze({
    id: "role_self_messaging",
    name: "Messaging access",
    description: "WhatsApp and Telegram messaging, operations, and account connections.",
    grants: Object.freeze([{ resourceKey: "messaging", accessLevel: "configure" }]),
  }),
  Object.freeze({
    id: "role_self_publishing",
    name: "Publishing access",
    description: "Create, schedule, and configure all live publishing destinations.",
    grants: Object.freeze([{ resourceKey: "publishing", accessLevel: "configure" }]),
  }),
  Object.freeze({
    id: "role_self_scraping",
    name: "Scraping access",
    description: "Run and configure the live Instagram and Facebook scrapers.",
    grants: Object.freeze([{ resourceKey: "scraping", accessLevel: "configure" }]),
  }),
  Object.freeze({
    id: "role_self_full_access",
    name: "Full module access",
    description: "All currently live Messaging, Publishing, and Scraping modules.",
    grants: Object.freeze([
      { resourceKey: "messaging", accessLevel: "configure" },
      { resourceKey: "publishing", accessLevel: "configure" },
      { resourceKey: "scraping", accessLevel: "configure" },
    ]),
  }),
]);

export function accessLevelRank(level) {
  const rank = ACCESS_LEVELS.indexOf(level);
  return rank < 0 ? 0 : rank;
}

export function normalizeAccessLevel(level) {
  return ACCESS_LEVELS.includes(level) ? level : "none";
}

export function accessCategory(resourceKey) {
  return String(resourceKey || "").split(".")[0];
}

export function isKnownAccessResource(resourceKey) {
  return ACCESS_RESOURCE_KEYS.includes(resourceKey);
}

export function accessResourceForService(service) {
  if (!service?.category || !service?.slug) return "";
  if (service.category === "publishing") return `publishing.${service.platform || service.slug}`;
  if (service.category === "scraping") {
    return `scraping.${String(service.slug).replace(/-public-data$/, "")}`;
  }
  return `${service.category}.${service.slug}`;
}

export function accessSatisfies(actual, required) {
  return accessLevelRank(actual) >= accessLevelRank(required);
}

export function fullAccessMap(level = "configure") {
  return Object.fromEntries(ACCESS_RESOURCE_KEYS.map((key) => [key, normalizeAccessLevel(level)]));
}
