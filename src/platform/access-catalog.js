export const ACCESS_LEVELS = ["none", "view", "operate", "configure"];

export const CAPABILITY_CATALOG = Object.freeze({
  workspace: Object.freeze([
    "workspace.team.manage",
  ]),
  publishing: Object.freeze([
    "publishing.view",
    "publishing.content.create",
    "publishing.content.edit",
    "publishing.destinations.select",
    "publishing.submissions.create",
    "publishing.schedule.manage",
    "publishing.accounts.configure",
    "publishing.execute",
  ]),
  scraping: Object.freeze([
    "scraping.view",
    "scraping.run",
    "scraping.analyze",
    "scraping.configure",
  ]),
  messaging: Object.freeze([
    "messaging.view",
    "messaging.operate",
    "messaging.configure",
  ]),
});

export const CAPABILITY_KEYS = Object.freeze(Object.values(CAPABILITY_CATALOG).flat());

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

const publishingViewer = Object.freeze(["publishing.view"]);
const publishingUploader = Object.freeze([
  ...publishingViewer,
  "publishing.content.create",
  "publishing.content.edit",
  "publishing.destinations.select",
  "publishing.submissions.create",
]);
const publishingScheduler = Object.freeze([
  ...publishingViewer,
  "publishing.schedule.manage",
]);
const publishingManager = CAPABILITY_CATALOG.publishing;
const scrapingViewer = Object.freeze(["scraping.view"]);
const scrapingOperator = Object.freeze([
  ...scrapingViewer,
  "scraping.run",
  "scraping.analyze",
]);
const scrapingManager = CAPABILITY_CATALOG.scraping;
const messagingViewer = Object.freeze(["messaging.view"]);
const messagingOperator = Object.freeze([...messagingViewer, "messaging.operate"]);
const messagingManager = CAPABILITY_CATALOG.messaging;

function capabilityGrants(capabilities) {
  return capabilities.map((resourceKey) => Object.freeze({ resourceKey, accessLevel: "operate" }));
}

export const OPERATIONAL_ROLE_CATALOG = Object.freeze([
  Object.freeze({
    id: "role_workspace_owner",
    name: "Workspace Owner",
    description: "Manages the workspace team and has manager capability inside entitled modules.",
    capabilities: Object.freeze([
      ...CAPABILITY_CATALOG.workspace,
      ...CAPABILITY_CATALOG.publishing,
      ...CAPABILITY_CATALOG.scraping,
      ...CAPABILITY_CATALOG.messaging,
    ]),
  }),
  Object.freeze({ id: "role_publishing_viewer", name: "Publishing Viewer", description: "Read-only Publishing access.", capabilities: publishingViewer }),
  Object.freeze({ id: "role_publishing_uploader", name: "Legacy Content Uploader", description: "Read-only while publishing handoffs are paused.", capabilities: publishingUploader }),
  Object.freeze({ id: "role_publishing_scheduler", name: "Legacy Scheduler", description: "Read-only while publishing scheduling is paused.", capabilities: publishingScheduler }),
  Object.freeze({ id: "role_publishing_manager", name: "Publishing Manager", description: "Full Publishing operations and configuration.", capabilities: publishingManager }),
  Object.freeze({ id: "role_scraping_viewer", name: "Scraping Viewer", description: "Views and exports workspace scraping results.", capabilities: scrapingViewer }),
  Object.freeze({ id: "role_scraping_operator", name: "Scraping Operator", description: "Runs scrapers, comparisons, and supported analysis.", capabilities: scrapingOperator }),
  Object.freeze({ id: "role_scraping_manager", name: "Scraping Manager", description: "Full Scraping operations and configuration.", capabilities: scrapingManager }),
  Object.freeze({ id: "role_messaging_viewer", name: "Messaging Viewer", description: "Read-only Messaging access.", capabilities: messagingViewer }),
  Object.freeze({ id: "role_messaging_operator", name: "Messaging Operator", description: "Operates workspace messaging.", capabilities: messagingOperator }),
  Object.freeze({ id: "role_messaging_manager", name: "Messaging Manager", description: "Full Messaging operations and configuration.", capabilities: messagingManager }),
].map((role) => Object.freeze({
  ...role,
  grants: Object.freeze(capabilityGrants(role.capabilities)),
})));

export const OPERATIONAL_ROLE_IDS = Object.freeze(OPERATIONAL_ROLE_CATALOG.map((role) => role.id));

export const SERVICE_AUDIENCE_CAPABILITIES = Object.freeze({
  telegram: CAPABILITY_CATALOG.messaging,
  publishing: CAPABILITY_CATALOG.publishing,
  scraping: CAPABILITY_CATALOG.scraping,
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
    description: "Create, publish, and configure all live publishing destinations.",
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

export function isKnownCapability(capability) {
  return CAPABILITY_KEYS.includes(capability);
}

export function capabilityModule(capability) {
  const category = String(capability || "").split(".")[0];
  return Object.hasOwn(CAPABILITY_CATALOG, category) ? category : "";
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
