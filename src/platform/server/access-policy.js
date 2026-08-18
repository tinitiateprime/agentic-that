import {
  ACCESS_LEVELS,
  ACCESS_RESOURCE_KEYS,
  LIVE_ACCESS_CATALOG,
  accessCategory,
  accessLevelRank,
  normalizeAccessLevel,
} from "../access-catalog.js";

function grantMap(rows = []) {
  const result = new Map();
  for (const row of rows) {
    const key = String(row?.resourceKey || row?.resource_key || "");
    if (!ACCESS_RESOURCE_KEYS.includes(key)) continue;
    result.set(key, normalizeAccessLevel(row?.accessLevel || row?.access_level));
  }
  return result;
}

function roleLevelForResource(grants, resourceKey) {
  if (grants.has(resourceKey)) return grants.get(resourceKey);
  return grants.get(accessCategory(resourceKey)) || "none";
}

/**
 * Resolve category/app RBAC deterministically.
 *
 * - Within one role, an app grant replaces the category grant.
 * - Multiple roles are additive and the highest access level wins.
 * - A direct category override replaces the combined role result.
 * - A direct app override is final.
 */
export function evaluateAccess({ roleGrants = [], userOverrides = [], active = true, globalAdmin = false } = {}) {
  if (!active) {
    return Object.fromEntries(ACCESS_RESOURCE_KEYS.map((key) => [key, "none"]));
  }
  if (globalAdmin) {
    return Object.fromEntries(ACCESS_RESOURCE_KEYS.map((key) => [key, "configure"]));
  }

  const roles = new Map();
  for (const row of roleGrants) {
    const roleId = String(row?.roleId || row?.role_id || "");
    if (!roleId) continue;
    if (!roles.has(roleId)) roles.set(roleId, []);
    roles.get(roleId).push(row);
  }
  const roleMaps = [...roles.values()].map(grantMap);
  const overrides = grantMap(userOverrides);
  const effective = {};

  for (const [category, appKeys] of Object.entries(LIVE_ACCESS_CATALOG)) {
    let categoryLevel = "none";
    for (const role of roleMaps) {
      const candidate = role.get(category) || "none";
      if (accessLevelRank(candidate) > accessLevelRank(categoryLevel)) categoryLevel = candidate;
    }
    if (overrides.has(category)) categoryLevel = overrides.get(category);
    effective[category] = categoryLevel;

    for (const appKey of appKeys) {
      let appLevel = "none";
      for (const role of roleMaps) {
        const candidate = roleLevelForResource(role, appKey);
        if (accessLevelRank(candidate) > accessLevelRank(appLevel)) appLevel = candidate;
      }
      if (overrides.has(category)) appLevel = overrides.get(category);
      if (overrides.has(appKey)) appLevel = overrides.get(appKey);
      effective[appKey] = appLevel;
    }
  }

  return effective;
}

export function validateGrantInput(grants) {
  if (!Array.isArray(grants)) throw new Error("Permissions must be an array.");
  const seen = new Set();
  return grants.map((grant) => {
    const resourceKey = String(grant?.resourceKey || "").trim();
    const accessLevel = String(grant?.accessLevel || "").trim();
    if (!ACCESS_RESOURCE_KEYS.includes(resourceKey)) throw new Error(`Unknown resource: ${resourceKey}`);
    if (!ACCESS_LEVELS.includes(accessLevel)) throw new Error(`Unknown access level: ${accessLevel}`);
    if (seen.has(resourceKey)) throw new Error(`Duplicate permission: ${resourceKey}`);
    seen.add(resourceKey);
    return { resourceKey, accessLevel };
  });
}
