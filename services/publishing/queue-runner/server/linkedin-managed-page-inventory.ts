import type { LinkedInManagedPage } from "../shared/schema.js";

type ManagedPageInventory = {
  linkedinManagedPages?: LinkedInManagedPage[];
  linkedinManagedPagesUpdatedAt?: string;
};

function inventoryTime(value?: string) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Central publishing jobs contain an account snapshot taken when the post was
 * created. Never let an older snapshot erase Pages discovered by a later
 * LinkedIn login. A newer explicit discovery (including an empty result) still
 * wins so revoked Page access is removed correctly.
 */
export function mergeLinkedInManagedPageInventory(
  existing: ManagedPageInventory,
  incoming: ManagedPageInventory,
) {
  if (!Array.isArray(incoming.linkedinManagedPages)) return existing;
  const existingTime = inventoryTime(existing.linkedinManagedPagesUpdatedAt);
  const incomingTime = inventoryTime(incoming.linkedinManagedPagesUpdatedAt);
  if (existingTime > 0 && (incomingTime === 0 || incomingTime < existingTime)) return existing;
  return {
    linkedinManagedPages: incoming.linkedinManagedPages,
    linkedinManagedPagesUpdatedAt: incoming.linkedinManagedPagesUpdatedAt || existing.linkedinManagedPagesUpdatedAt,
  };
}
