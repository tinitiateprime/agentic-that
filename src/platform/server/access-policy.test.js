import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAccess } from "./access-policy.js";

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
