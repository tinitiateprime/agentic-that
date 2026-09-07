import assert from "node:assert/strict";
import test from "node:test";
import { CAPABILITY_CATALOG, OPERATIONAL_ROLE_CATALOG } from "../access-catalog.js";
import { evaluateAccess, evaluateCapabilities } from "./access-policy.js";

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
