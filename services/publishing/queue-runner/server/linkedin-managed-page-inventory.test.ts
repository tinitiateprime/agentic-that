import assert from "node:assert/strict";
import test from "node:test";
import { mergeLinkedInManagedPageInventory } from "./linkedin-managed-page-inventory.js";

const page = {
  id: "tinitiate-ai",
  name: "Tinitiate AI Solutions",
  pageUrl: "https://www.linkedin.com/company/tinitiate-ai/admin/",
  pagePostsUrl: "https://www.linkedin.com/company/tinitiate-ai/admin/page-posts/published/",
};

test("a stale central job snapshot cannot erase newly discovered LinkedIn Pages", () => {
  const merged = mergeLinkedInManagedPageInventory(
    { linkedinManagedPages: [page], linkedinManagedPagesUpdatedAt: "2026-09-11T07:02:43.368Z" },
    { linkedinManagedPages: [] },
  );
  assert.deepEqual(merged.linkedinManagedPages, [page]);
  assert.equal(merged.linkedinManagedPagesUpdatedAt, "2026-09-11T07:02:43.368Z");
});

test("a newer explicit LinkedIn discovery can remove revoked Page access", () => {
  const merged = mergeLinkedInManagedPageInventory(
    { linkedinManagedPages: [page], linkedinManagedPagesUpdatedAt: "2026-09-11T07:02:43.368Z" },
    { linkedinManagedPages: [], linkedinManagedPagesUpdatedAt: "2026-09-11T08:00:00.000Z" },
  );
  assert.deepEqual(merged.linkedinManagedPages, []);
  assert.equal(merged.linkedinManagedPagesUpdatedAt, "2026-09-11T08:00:00.000Z");
});
