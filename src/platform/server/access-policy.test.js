import assert from "node:assert/strict";
import test from "node:test";
import { CAPABILITY_CATALOG, LIVE_ACCESS_CATALOG, OPERATIONAL_ROLE_CATALOG, fullAccessMap } from "../access-catalog.js";
import { evaluateAccess, evaluateCapabilities, restrictAccessToCapabilities } from "./access-policy.js";

test("category grants flow to apps and an app grant overrides its role category", () => {
  const access = evaluateAccess({
    roleGrants: [
      { roleId: "publisher", resourceKey: "publishing", accessLevel: "operate" },
      { roleId: "publisher", resourceKey: "publishing.x", accessLevel: "none" },
    ],
  });
  assert.equal(access["publishing.instagram"], "operate");
  assert.equal(access["publishing.x"], "none");
});

test("multiple roles combine at the highest level", () => {
  const access = evaluateAccess({
    roleGrants: [
      { roleId: "reader", resourceKey: "messaging", accessLevel: "view" },
      { roleId: "telegram-operator", resourceKey: "messaging.telegram", accessLevel: "operate" },
    ],
  });
  assert.equal(access["messaging.whatsapp"], "view");
  assert.equal(access["messaging.telegram"], "operate");
});

test("direct category and app overrides are final", () => {
  const access = evaluateAccess({
    roleGrants: [{ roleId: "all", resourceKey: "scraping", accessLevel: "configure" }],
    userOverrides: [
      { resourceKey: "scraping", accessLevel: "none" },
      { resourceKey: "scraping.instagram", accessLevel: "operate" },
    ],
  });
  assert.equal(access["scraping"], "none");
  assert.equal(access["scraping.facebook"], "none");
  assert.equal(access["scraping.instagram"], "operate");
});

test("inactive users receive no access and global admins receive configure", () => {
  assert.equal(evaluateAccess({ active: false, globalAdmin: true })["messaging.telegram"], "none");
  assert.equal(evaluateAccess({ active: true, globalAdmin: true })["messaging.telegram"], "configure");
});

test("operational capabilities combine across roles and disappear for inactive members", () => {
  const roleGrants = [
    { roleId: "uploader", resourceKey: "publishing.view", accessLevel: "operate" },
    { roleId: "uploader", resourceKey: "publishing.content.create", accessLevel: "operate" },
    { roleId: "scheduler", resourceKey: "publishing.schedule.manage", accessLevel: "operate" },
  ];
  assert.deepEqual(evaluateCapabilities({ roleGrants }), [
    "publishing.content.create",
    "publishing.schedule.manage",
    "publishing.view",
  ]);
  assert.deepEqual(evaluateCapabilities({ roleGrants, active: false }), []);
});

test("publishing system roles match their job responsibilities exactly", () => {
  const publishingRoles = new Map(
    OPERATIONAL_ROLE_CATALOG
      .filter((role) => role.id.startsWith("role_publishing_"))
      .map((role) => [role.id, role]),
  );

  assert.deepEqual(publishingRoles.get("role_publishing_viewer")?.capabilities, [
    "publishing.view",
  ]);
  assert.deepEqual(publishingRoles.get("role_publishing_uploader")?.capabilities, [
    "publishing.view",
    "publishing.content.create",
    "publishing.content.edit",
    "publishing.destinations.select",
    "publishing.submissions.create",
  ]);
  assert.deepEqual(publishingRoles.get("role_publishing_scheduler")?.capabilities, [
    "publishing.view",
    "publishing.schedule.manage",
  ]);
  assert.deepEqual(publishingRoles.get("role_publishing_manager")?.capabilities, CAPABILITY_CATALOG.publishing);
  assert.equal(publishingRoles.get("role_publishing_uploader")?.name, "Content Uploader");
  assert.equal(publishingRoles.get("role_publishing_scheduler")?.name, "Scheduler");
});

test("scraping and messaging system roles match their job responsibilities exactly", () => {
  const roles = new Map(OPERATIONAL_ROLE_CATALOG.map((role) => [role.id, role.capabilities]));

  assert.deepEqual(roles.get("role_scraping_viewer"), ["scraping.view"]);
  assert.deepEqual(roles.get("role_scraping_operator"), [
    "scraping.view",
    "scraping.run",
    "scraping.analyze",
  ]);
  assert.deepEqual(roles.get("role_scraping_manager"), CAPABILITY_CATALOG.scraping);

  assert.deepEqual(roles.get("role_messaging_viewer"), ["messaging.view"]);
  assert.deepEqual(roles.get("role_messaging_operator"), [
    "messaging.view",
    "messaging.operate",
  ]);
  assert.deepEqual(roles.get("role_messaging_manager"), CAPABILITY_CATALOG.messaging);
});

test("an unlimited workspace plan still follows each assigned operational role", () => {
  const roles = new Map(OPERATIONAL_ROLE_CATALOG.map((role) => [role.id, role]));
  const expected = [
    ["role_publishing_viewer", "publishing", "view"],
    ["role_publishing_uploader", "publishing", "operate"],
    ["role_publishing_scheduler", "publishing", "operate"],
    ["role_publishing_manager", "publishing", "configure"],
    ["role_scraping_viewer", "scraping", "view"],
    ["role_scraping_operator", "scraping", "operate"],
    ["role_scraping_manager", "scraping", "configure"],
    ["role_messaging_viewer", "messaging", "view"],
    ["role_messaging_operator", "messaging", "operate"],
    ["role_messaging_manager", "messaging", "configure"],
  ];

  for (const [roleId, assignedModule, assignedLevel] of expected) {
    const role = roles.get(roleId);
    const capabilities = evaluateCapabilities({
      roleGrants: role.grants.map((grant) => ({ ...grant, roleId })),
    });
    const access = restrictAccessToCapabilities(fullAccessMap(), capabilities);
    for (const [module, apps] of Object.entries(LIVE_ACCESS_CATALOG)) {
      for (const resource of [module, ...apps]) {
        assert.equal(access[resource], module === assignedModule ? assignedLevel : "none", `${roleId}: ${resource}`);
      }
    }
  }
  assert.deepEqual(restrictAccessToCapabilities(fullAccessMap(), []), fullAccessMap("none"));
  assert.deepEqual(
    restrictAccessToCapabilities(fullAccessMap(), roles.get("role_workspace_owner").capabilities),
    fullAccessMap(),
  );
});

test("role permissions combine while app-specific plan limits remain in force", () => {
  const plan = fullAccessMap("none");
  plan["publishing.youtube"] = "view";
  plan["scraping.instagram"] = "configure";
  const access = restrictAccessToCapabilities(plan, [
    "publishing.view",
    "publishing.execute",
    "scraping.view",
    "scraping.run",
  ]);
  assert.equal(access.publishing, "none");
  assert.equal(access["publishing.youtube"], "view");
  assert.equal(access["publishing.instagram"], "none");
  assert.equal(access["scraping.instagram"], "operate");
  assert.equal(access["scraping.facebook"], "none");
  assert.equal(access["messaging.telegram"], "none");
});
