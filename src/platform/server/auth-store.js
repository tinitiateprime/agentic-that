import crypto from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { cookies } from "next/headers";
import { getSql } from "@whatsapp/lib/db";
import { OPERATIONAL_ROLE_CATALOG, SELF_SERVICE_ROLE_CATALOG } from "../access-catalog.js";

export const PLATFORM_SESSION_COOKIE = "agenticthat_session";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_FREE_TRIAL_DAYS = 7;
const PLATFORM_SCHEMA_MIGRATION_KEY = "platform-rbac-schema-v2";
const useNetlifyBlobs = (
  process.env.DATA_STORE === "netlify-blobs" ||
  process.env.NETLIFY === "true" ||
  Boolean(process.env.NETLIFY_BLOBS_CONTEXT)
);
const useDatabaseAuth = Boolean(
  process.env.DATABASE_URL?.trim() || process.env.SUPABASE_DB_URL?.trim()
);
let blobStorePromise = null;
let platformDatabaseReadyPromise = null;

function resolveDataPath() {
  if (process.env.PLATFORM_AUTH_DATA_PATH?.trim()) {
    return path.resolve(process.env.PLATFORM_AUTH_DATA_PATH.trim());
  }
  if (process.env.NETLIFY === "true") {
    return "/tmp/platform-auth.json";
  }
  return path.join(process.cwd(), "data", "platform-auth.json");
}

const dataPath = path.resolve(resolveDataPath());

let mutationQueue = Promise.resolve();

function emptyStore() {
  return { version: 1, users: [], sessions: [] };
}

function safeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function publicUser(user) {
  const id = safeText(user?.id);
  if (!id) throw new Error("Platform user data is missing a valid ID.");

  const name = safeText(user.name);
  return {
    id,
    workspaceId: safeText(user.workspaceId) || `workspace_${id}`,
    name: name || "Workspace user",
    businessName: safeText(user.businessName) || name || "Workspace",
    email: safeText(user.email),
    status: safeText(user.status) || "active",
    isGlobalAdmin: Boolean(user.isGlobalAdmin),
    billingStatus: safeText(user.billingStatus) || "active",
    trialStartsAt: user.trialStartsAt || null,
    trialEndsAt: user.trialEndsAt || null,
    selectedRoleIds: Array.isArray(user.selectedRoleIds) ? user.selectedRoleIds.map(String) : [],
    assignedRoleIds: Array.isArray(user.assignedRoleIds) ? user.assignedRoleIds.map(String) : [],
    isWorkspaceOwner: user.isWorkspaceOwner !== false,
  };
}

export function configuredFreeTrialDays() {
  const configured = Number(process.env.PLATFORM_FREE_TRIAL_DAYS);
  return Number.isInteger(configured) && configured >= 1 && configured <= 90
    ? configured
    : DEFAULT_FREE_TRIAL_DAYS;
}

function normalizedRoleIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(String).map((id) => id.trim()).filter(Boolean))];
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function hashPlatformPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, expectedHex] = String(storedHash || "").split(":");
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = crypto.scryptSync(password, salt, 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function readStore() {
  if (useNetlifyBlobs) {
    const store = await getBlobStore();
    return normalizeStore(await store.get("store", { type: "json", consistency: "strong" }));
  }

  try {
    return normalizeStore(JSON.parse(await readFile(dataPath, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return emptyStore();
    throw error;
  }
}

async function writeStore(store) {
  if (useNetlifyBlobs) {
    const blobStore = await getBlobStore();
    await blobStore.setJSON("store", store);
    return;
  }

  await mkdir(path.dirname(dataPath), { recursive: true });
  const temporaryPath = `${dataPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, dataPath);
}

function normalizeStore(value) {
  if (!value || typeof value !== "object") return emptyStore();
  if (value.version !== 1 || !Array.isArray(value.users) || !Array.isArray(value.sessions)) {
    throw new Error("Platform authentication data has an invalid structure.");
  }
  return {
    ...value,
    users: value.users.map((user) => ({
      ...user,
      workspaceId: user.workspaceId || `workspace_${user.id}`,
      billingStatus: user.billingStatus || "active",
      trialStartsAt: user.trialStartsAt || null,
      trialEndsAt: user.trialEndsAt || null,
      selectedRoleIds: user.billingStatus === "trialing"
        ? ["role_self_full_access"]
        : normalizedRoleIds(user.selectedRoleIds),
      assignedRoleIds: normalizedRoleIds(user.assignedRoleIds || ["role_workspace_owner"]),
      isWorkspaceOwner: user.isWorkspaceOwner !== false,
      publishingWorkspaceKey: user.publishingWorkspaceKey || crypto
        .createHash("sha256")
        .update(`publishing:${user.id}:${user.passwordHash}`)
        .digest("base64url"),
    })),
  };
}

function getBlobStore() {
  blobStorePromise ??= import("@netlify/blobs")
    .then(({ getStore }) => getStore("agentic-that-platform-auth"));
  return blobStorePromise;
}

function publicDatabaseUser(user) {
  if (!user?.id) throw new Error("Platform user data is missing a valid ID.");
  return {
    id: String(user.id),
    workspaceId: user.workspace_id ? String(user.workspace_id) : null,
    name: String(user.name || "Workspace user"),
    businessName: String(user.business_name || user.name || "Workspace"),
    email: String(user.email || ""),
    status: String(user.status || "active"),
    isGlobalAdmin: Boolean(user.is_global_admin),
    billingStatus: String(user.billing_status || "active"),
    trialStartsAt: user.trial_starts_at || null,
    trialEndsAt: user.trial_ends_at || null,
  };
}

function configuredGlobalAdminEmails() {
  return new Set(
    String(process.env.PLATFORM_SUPER_ADMIN_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

export async function listSignupPlanOptions() {
  return {
    trialDays: configuredFreeTrialDays(),
    plans: [
      { id: "free", status: "coming_soon" },
      { id: "trial", status: "available" },
      { id: "premium", status: "coming_soon" },
    ],
  };
}

async function validateSelectableRoleIds(sql, roleIdsInput, allowEmpty = false) {
  const roleIds = normalizedRoleIds(roleIdsInput);
  if (!roleIds.length && !allowEmpty) {
    throw new PlatformAuthError("ROLE_REQUIRED", "Choose at least one access role for your free trial.");
  }
  if (!roleIds.length) return [];
  const rows = await sql`
    SELECT id FROM rbac_roles
     WHERE id = ANY(${roleIds}) AND is_self_selectable = true`;
  if (rows.length !== roleIds.length) {
    throw new PlatformAuthError("INVALID_ROLE", "One or more selected access roles are unavailable.");
  }
  return roleIds;
}

async function importBlobAccounts(sql) {
  if (!useNetlifyBlobs) return;

  try {
    const blobStore = await getBlobStore();
    const source = normalizeStore(
      await blobStore.get("store", { type: "json", consistency: "strong" })
    );
    if (!source.users.length) return;

    await sql.begin(async (tx) => {
      for (const user of source.users) {
        const normalized = publicUser(user);
        await tx`
          INSERT INTO platform_users
            (id, workspace_id, publishing_workspace_key, name, business_name,
             email, password_hash, created_at)
          VALUES
            (${normalized.id}, ${normalized.workspaceId},
             ${String(user.publishingWorkspaceKey)}, ${normalized.name},
             ${normalized.businessName}, ${normalized.email.toLowerCase()},
             ${String(user.passwordHash)}, ${user.createdAt || new Date().toISOString()})
          ON CONFLICT DO NOTHING`;
      }

      for (const session of source.sessions) {
        if (
          !session?.id ||
          !session?.userId ||
          !session?.tokenHash ||
          !session?.expiresAt
        ) {
          continue;
        }
        await tx`
          INSERT INTO platform_sessions
            (id, user_id, token_hash, created_at, expires_at)
          VALUES
            (${String(session.id)}, ${String(session.userId)},
             ${String(session.tokenHash)},
             ${session.createdAt || new Date().toISOString()},
             ${session.expiresAt})
          ON CONFLICT DO NOTHING`;
      }
    });
  } catch (error) {
    // Blob persistence is not available from every Next.js runtime. Existing
    // accounts are imported whenever it is readable, but PostgreSQL remains
    // authoritative so a Blob outage can never block signup or sign-in.
    console.warn(
      "Platform Blob import skipped:",
      error instanceof Error ? error.name : "unknown error"
    );
  }
}

async function migratePlatformDatabase(sql) {
  if (process.env.NODE_ENV === "production" && configuredGlobalAdminEmails().size === 0) {
    throw new Error("PLATFORM_SUPER_ADMIN_EMAILS is required in production.");
  }
  const [registry] = await sql`
    SELECT to_regclass('public.platform_auth_migrations') AS relation`;
  if (registry?.relation) {
    const [applied] = await sql`
      SELECT key FROM platform_auth_migrations
       WHERE key = ${PLATFORM_SCHEMA_MIGRATION_KEY}
       LIMIT 1`;
    if (applied) {
      const superAdminEmails = [...configuredGlobalAdminEmails()];
      if (superAdminEmails.length) {
        await sql`
          UPDATE platform_users
             SET is_global_admin = true, status = 'active', billing_status = 'exempt'
           WHERE LOWER(email) = ANY(${superAdminEmails})`;
      }
      return;
    }
  }
  await sql`
    CREATE TABLE IF NOT EXISTS platform_users (
      id                       TEXT PRIMARY KEY,
      workspace_id             TEXT,
      publishing_workspace_key TEXT NOT NULL,
      name                     TEXT NOT NULL,
      business_name            TEXT NOT NULL,
      email                    TEXT NOT NULL,
      password_hash            TEXT NOT NULL,
      status                   TEXT NOT NULL DEFAULT 'active',
      is_global_admin          BOOLEAN NOT NULL DEFAULT false,
      requested_business_name TEXT,
      billing_status           TEXT NOT NULL DEFAULT 'active',
      trial_starts_at          TIMESTAMPTZ,
      trial_ends_at            TIMESTAMPTZ,
      created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`ALTER TABLE platform_users ALTER COLUMN workspace_id DROP NOT NULL`;
  await sql`ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'`;
  await sql`ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS is_global_admin BOOLEAN NOT NULL DEFAULT false`;
  await sql`ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS requested_business_name TEXT`;
  await sql`ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS billing_status TEXT NOT NULL DEFAULT 'active'`;
  await sql`ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS trial_starts_at TIMESTAMPTZ`;
  await sql`ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ`;
  await sql`
    UPDATE platform_users SET status = 'active'
     WHERE status NOT IN ('pending', 'active', 'suspended', 'rejected')`;
  await sql`
    DO $$ BEGIN
      ALTER TABLE platform_users ADD CONSTRAINT platform_users_status_check
        CHECK (status IN ('pending', 'active', 'suspended', 'rejected'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$`;
  await sql`
    UPDATE platform_users SET billing_status = 'active'
     WHERE billing_status NOT IN ('trialing', 'payment_pending', 'active', 'past_due', 'canceled', 'expired', 'exempt')`;
  await sql`
    DO $$ BEGIN
      ALTER TABLE platform_users ADD CONSTRAINT platform_users_billing_status_check
        CHECK (billing_status IN ('trialing', 'payment_pending', 'active', 'past_due', 'canceled', 'expired', 'exempt'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$`;
  await sql`ALTER TABLE platform_users DROP CONSTRAINT IF EXISTS platform_users_workspace_id_key`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_users_email
      ON platform_users (LOWER(email))`;
  await sql`
    CREATE TABLE IF NOT EXISTS platform_sessions (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    )`;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_platform_sessions_expiry
      ON platform_sessions (expires_at)`;
  await importBlobAccounts(sql);

  await sql`
    CREATE TABLE IF NOT EXISTS platform_workspaces (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS workspace_memberships (
      user_id     TEXT PRIMARY KEY REFERENCES platform_users(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL REFERENCES platform_workspaces(id) ON DELETE CASCADE,
      status      TEXT NOT NULL DEFAULT 'active',
      approved_at TIMESTAMPTZ,
      approved_by TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_workspace_memberships_workspace ON workspace_memberships(workspace_id)`;
  await sql`
    CREATE TABLE IF NOT EXISTS rbac_roles (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      is_system   BOOLEAN NOT NULL DEFAULT false,
      is_self_selectable BOOLEAN NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`ALTER TABLE rbac_roles ADD COLUMN IF NOT EXISTS is_self_selectable BOOLEAN NOT NULL DEFAULT false`;
  await sql`
    CREATE TABLE IF NOT EXISTS rbac_role_grants (
      role_id      TEXT NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
      resource_key TEXT NOT NULL,
      access_level TEXT NOT NULL,
      PRIMARY KEY (role_id, resource_key)
    )`;
  await sql`
    DO $$ BEGIN
      ALTER TABLE rbac_role_grants ADD CONSTRAINT rbac_role_grants_level_check
        CHECK (access_level IN ('none', 'view', 'operate', 'configure'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$`;
  await sql`
    CREATE TABLE IF NOT EXISTS user_role_assignments (
      user_id    TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
      role_id    TEXT NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
      assigned_by TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, role_id)
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS user_role_entitlements (
      user_id      TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
      role_id      TEXT NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
      source       TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'active',
      starts_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at   TIMESTAMPTZ,
      external_ref TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, role_id, source)
    )`;
  await sql`
    DO $$ BEGIN
      ALTER TABLE user_role_entitlements ADD CONSTRAINT user_role_entitlements_source_check
        CHECK (source IN ('trial', 'payment'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$`;
  await sql`
    DO $$ BEGIN
      ALTER TABLE user_role_entitlements ADD CONSTRAINT user_role_entitlements_status_check
        CHECK (status IN ('active', 'inactive'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$`;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_role_entitlements_active
      ON user_role_entitlements(user_id, expires_at)`;
  await sql`
    CREATE TABLE IF NOT EXISTS user_access_overrides (
      user_id      TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
      resource_key TEXT NOT NULL,
      access_level TEXT NOT NULL,
      assigned_by  TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, resource_key)
    )`;
  await sql`
    DO $$ BEGIN
      ALTER TABLE user_access_overrides ADD CONSTRAINT user_access_overrides_level_check
        CHECK (access_level IN ('none', 'view', 'operate', 'configure'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$`;
  await sql`
    CREATE TABLE IF NOT EXISTS rbac_audit_events (
      id          TEXT PRIMARY KEY,
      actor_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
      target_type TEXT NOT NULL,
      target_id   TEXT,
      action      TEXT NOT NULL,
      before_value JSONB,
      after_value JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS platform_auth_migrations (
      key        TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS platform_billing_events (
      event_id     TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
      provider     TEXT NOT NULL,
      payment_status TEXT NOT NULL,
      details      JSONB,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS rbac_identity_review_queue (
      id              TEXT PRIMARY KEY,
      product         TEXT NOT NULL,
      local_actor_id  TEXT NOT NULL,
      local_email     TEXT,
      reason          TEXT NOT NULL,
      details         JSONB,
      status          TEXT NOT NULL DEFAULT 'pending',
      resolved_by     TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
      resolved_at     TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (product, local_actor_id)
    )`;

  for (const role of SELF_SERVICE_ROLE_CATALOG) {
    const [seededRole] = await sql`
      INSERT INTO rbac_roles (id, name, description, is_system, is_self_selectable)
      VALUES (${role.id}, ${role.name}, ${role.description}, true, true)
      ON CONFLICT (name) DO UPDATE SET
        description = EXCLUDED.description,
        is_self_selectable = true,
        updated_at = now()
      RETURNING id`;
    for (const grant of role.grants) {
      await sql`
        INSERT INTO rbac_role_grants (role_id, resource_key, access_level)
        VALUES (${seededRole.id}, ${grant.resourceKey}, ${grant.accessLevel})
        ON CONFLICT (role_id, resource_key) DO UPDATE SET access_level = EXCLUDED.access_level`;
    }
  }

  for (const role of OPERATIONAL_ROLE_CATALOG) {
    const [seededRole] = await sql`
      INSERT INTO rbac_roles (id, name, description, is_system, is_self_selectable)
      VALUES (${role.id}, ${role.name}, ${role.description}, true, false)
      ON CONFLICT (name) DO UPDATE SET
        description = EXCLUDED.description,
        is_system = true,
        is_self_selectable = false,
        updated_at = now()
      RETURNING id`;
    for (const grant of role.grants) {
      await sql`
        INSERT INTO rbac_role_grants (role_id, resource_key, access_level)
        VALUES (${seededRole.id}, ${grant.resourceKey}, ${grant.accessLevel})
        ON CONFLICT (role_id, resource_key) DO UPDATE SET access_level = EXCLUDED.access_level`;
    }
  }

  // Active trials now include every service. Existing trial workspaces are
  // upgraded to the same bundle without extending an already-started clock.
  await sql`
    INSERT INTO user_role_entitlements
      (user_id, role_id, source, status, starts_at, expires_at, updated_at)
    SELECT trial_user.id, 'role_self_full_access', 'trial', 'active',
           COALESCE(trial_user.trial_starts_at, trial_user.created_at),
           trial_user.trial_ends_at, now()
      FROM platform_users trial_user
     WHERE trial_user.billing_status = 'trialing'
    ON CONFLICT (user_id, role_id, source) DO UPDATE SET
      status = 'active',
      expires_at = EXCLUDED.expires_at,
      updated_at = now()`;

  // Upgrade existing platform accounts without changing their current access.
  const [legacyRbacMigrated] = await sql`
    SELECT key FROM platform_auth_migrations WHERE key = 'legacy-rbac-v1' LIMIT 1`;
  if (!legacyRbacMigrated) {
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO platform_workspaces (id, name)
        SELECT DISTINCT workspace_id, COALESCE(NULLIF(business_name, ''), NULLIF(name, ''), 'Workspace')
          FROM platform_users
         WHERE workspace_id IS NOT NULL
        ON CONFLICT (id) DO NOTHING`;
      await tx`
        INSERT INTO workspace_memberships (user_id, workspace_id, status, approved_at)
        SELECT id, workspace_id, 'active', now()
          FROM platform_users
         WHERE workspace_id IS NOT NULL
        ON CONFLICT (user_id) DO NOTHING`;
      await tx`
        INSERT INTO rbac_roles (id, name, description, is_system)
        VALUES ('role_legacy_full_access', 'Legacy full access',
                'Temporary full access for accounts that predate centralized RBAC.', true)
        ON CONFLICT (id) DO NOTHING`;
      for (const resourceKey of ["messaging", "publishing", "scraping"]) {
        await tx`
          INSERT INTO rbac_role_grants (role_id, resource_key, access_level)
          VALUES ('role_legacy_full_access', ${resourceKey}, 'configure')
          ON CONFLICT (role_id, resource_key) DO UPDATE SET access_level = EXCLUDED.access_level`;
      }
      await tx`
        INSERT INTO user_role_assignments (user_id, role_id)
        SELECT id, 'role_legacy_full_access'
          FROM platform_users
         WHERE status = 'active'
        ON CONFLICT DO NOTHING`;
      await tx`INSERT INTO platform_auth_migrations (key) VALUES ('legacy-rbac-v1')`;
    });
  }

  // Administrator assignments are legacy input only. Convert them once into
  // billing entitlements; effective access reads entitlements exclusively.
  const [roleEntitlementsMigrated] = await sql`
    SELECT key FROM platform_auth_migrations WHERE key = 'billing-role-entitlements-v1' LIMIT 1`;
  if (!roleEntitlementsMigrated) {
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO user_role_entitlements
          (user_id, role_id, source, status, starts_at, expires_at, external_ref)
        SELECT user_id, role_id, 'payment', 'active', created_at, NULL, 'legacy-role-migration'
          FROM user_role_assignments
        ON CONFLICT (user_id, role_id, source) DO NOTHING`;
      await tx`
        UPDATE platform_users SET billing_status = 'active'
         WHERE id IN (SELECT DISTINCT user_id FROM user_role_assignments)`;
      await tx`
        INSERT INTO platform_auth_migrations (key) VALUES ('billing-role-entitlements-v1')`;
    });
  }


  // Every existing workspace needs an explicit owner. This is an idempotent
  // data backfill using the existing role-assignment table; no schema change is
  // required and similarly named companies are never merged.
  await sql`
    INSERT INTO user_role_assignments (user_id, role_id, assigned_by)
    SELECT candidate.user_id, 'role_workspace_owner', candidate.user_id
      FROM (
        SELECT DISTINCT ON (membership.workspace_id)
               membership.workspace_id, membership.user_id
          FROM workspace_memberships membership
          JOIN platform_users member ON member.id = membership.user_id
         WHERE membership.status = 'active' AND member.status = 'active'
           AND NOT EXISTS (
             SELECT 1
               FROM workspace_memberships owner_membership
               JOIN user_role_assignments owner_assignment
                 ON owner_assignment.user_id = owner_membership.user_id
                AND owner_assignment.role_id = 'role_workspace_owner'
              WHERE owner_membership.workspace_id = membership.workspace_id
                AND owner_membership.status = 'active'
           )
         ORDER BY membership.workspace_id, membership.approved_at NULLS LAST, membership.created_at
      ) candidate
    ON CONFLICT (user_id, role_id) DO NOTHING`;

  const superAdminEmails = [...configuredGlobalAdminEmails()];
  if (superAdminEmails.length) {
    await sql`
      UPDATE platform_users
         SET is_global_admin = true, status = 'active', billing_status = 'exempt'
       WHERE LOWER(email) = ANY(${superAdminEmails})`;
  }
  await sql`
    INSERT INTO platform_auth_migrations (key)
    VALUES (${PLATFORM_SCHEMA_MIGRATION_KEY})
    ON CONFLICT (key) DO NOTHING`;
}

export async function getPlatformSql() {
  const sql = await getSql();
  platformDatabaseReadyPromise ??= migratePlatformDatabase(sql);
  await platformDatabaseReadyPromise;
  return sql;
}

async function createDatabaseSession(sql, userId) {
  const now = new Date();
  const token = crypto.randomBytes(32).toString("base64url");
  await sql`
    INSERT INTO platform_sessions
      (id, user_id, token_hash, created_at, expires_at)
    VALUES
      (${crypto.randomUUID()}, ${String(userId)}, ${tokenHash(token)},
       ${now.toISOString()},
       ${new Date(now.getTime() + SESSION_TTL_MS).toISOString()})`;
  return token;
}

export async function createPlatformSessionForUser(sql, userId) {
  return createDatabaseSession(sql, userId);
}

async function pruneDatabaseSessions(sql) {
  await sql`DELETE FROM platform_sessions WHERE expires_at <= now()`;
}

function pruneSessions(store) {
  const now = Date.now();
  store.sessions = store.sessions.filter((session) => new Date(session.expiresAt).getTime() > now);
}

function mutateStore(mutator) {
  const operation = mutationQueue.then(async () => {
    const store = await readStore();
    pruneSessions(store);
    const result = await mutator(store);
    await writeStore(store);
    return result;
  });
  mutationQueue = operation.catch(() => undefined);
  return operation;
}

export class PlatformAuthError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export async function registerPlatformUser({ name, businessName, email, password, plan = "trial" }) {
  const normalizedName = String(name || "").trim();
  const normalizedBusiness = String(businessName || "").trim();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedPassword = String(password || "");

  if (normalizedName.length < 2 || normalizedName.length > 80) {
    throw new PlatformAuthError("INVALID_NAME", "Enter your full name.");
  }
  if (normalizedBusiness.length < 2 || normalizedBusiness.length > 120) {
    throw new PlatformAuthError("INVALID_BUSINESS", "Enter your company or workspace name.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
    throw new PlatformAuthError("INVALID_EMAIL", "Enter a valid work email.");
  }
  if (normalizedPassword.length < 8 || normalizedPassword.length > 128) {
    throw new PlatformAuthError("INVALID_PASSWORD", "Password must contain 8 to 128 characters.");
  }
  if (plan !== "trial") {
    throw new PlatformAuthError("PLAN_UNAVAILABLE", "Only the Trial plan is currently available.");
  }

  if (useDatabaseAuth) {
    const sql = await getPlatformSql();
    const isGlobalAdmin = configuredGlobalAdminEmails().has(normalizedEmail);
    try {
      return await sql.begin(async (tx) => {
        const [existing] = await tx`
          SELECT id FROM platform_users WHERE LOWER(email) = ${normalizedEmail} LIMIT 1`;
        if (existing) {
          throw new PlatformAuthError("ACCOUNT_EXISTS", "An account already exists for this email.");
        }

        const roleIds = isGlobalAdmin
          ? []
          : await validateSelectableRoleIds(tx, ["role_self_full_access"]);
        const id = crypto.randomUUID();
        const workspaceId = `workspace_${crypto.randomUUID()}`;
        const [user] = await tx`
          INSERT INTO platform_users
            (id, workspace_id, publishing_workspace_key, name, business_name,
             email, password_hash, status, is_global_admin, requested_business_name,
             billing_status, trial_starts_at, trial_ends_at)
          VALUES
            (${id}, ${workspaceId},
             ${crypto.randomBytes(32).toString("base64url")},
             ${normalizedName}, ${normalizedBusiness}, ${normalizedEmail},
             ${hashPlatformPassword(normalizedPassword)}, 'active',
             ${isGlobalAdmin}, ${normalizedBusiness},
             ${isGlobalAdmin ? "exempt" : "trialing"},
             NULL,
             NULL)
          RETURNING *`;
        await tx`
          INSERT INTO platform_workspaces (id, name)
          VALUES (${workspaceId}, ${normalizedBusiness})
          ON CONFLICT (id) DO NOTHING`;
        await tx`
          INSERT INTO workspace_memberships (user_id, workspace_id, status, approved_at)
          VALUES (${user.id}, ${workspaceId}, 'active', now())
          ON CONFLICT (user_id) DO NOTHING`;
        await tx`
          INSERT INTO user_role_assignments (user_id, role_id, assigned_by)
          VALUES (${user.id}, 'role_workspace_owner', ${user.id})
          ON CONFLICT DO NOTHING`;
        for (const roleId of roleIds) {
          await tx`
            INSERT INTO user_role_entitlements
              (user_id, role_id, source, status, starts_at, expires_at)
            VALUES
              (${user.id}, ${roleId}, 'trial', 'active', now(), NULL)`;
        }
        if (!isGlobalAdmin) {
          await tx`
            INSERT INTO rbac_audit_events
              (id, actor_user_id, target_type, target_id, action, after_value)
            VALUES
              (${crypto.randomUUID()}, ${user.id}, 'billing', ${user.id}, 'trial.ready',
               ${tx.json({ roleIds, startsOn: "first_service_use" })})`;
        }
        const token = await createDatabaseSession(tx, user.id);
        await pruneDatabaseSessions(tx);
        return { token, user: publicDatabaseUser(user) };
      });
    } catch (error) {
      if (error instanceof PlatformAuthError) throw error;
      if (error?.code === "23505") {
        throw new PlatformAuthError("ACCOUNT_EXISTS", "An account already exists for this email.");
      }
      throw error;
    }
  }

  return mutateStore((store) => {
    if (store.users.some((user) => user.email === normalizedEmail)) {
      throw new PlatformAuthError("ACCOUNT_EXISTS", "An account already exists for this email.");
    }

    const isGlobalAdmin = configuredGlobalAdminEmails().has(normalizedEmail);
    const roleIds = isGlobalAdmin ? [] : ["role_self_full_access"];
    const now = new Date();
    const user = {
      id: crypto.randomUUID(),
      workspaceId: `workspace_${crypto.randomUUID()}`,
      publishingWorkspaceKey: crypto.randomBytes(32).toString("base64url"),
      name: normalizedName,
      businessName: normalizedBusiness,
      email: normalizedEmail,
      passwordHash: hashPlatformPassword(normalizedPassword),
      createdAt: now.toISOString(),
      status: "active",
      isGlobalAdmin,
      billingStatus: isGlobalAdmin ? "exempt" : "trialing",
      trialStartsAt: null,
      trialEndsAt: null,
      selectedRoleIds: roleIds,
      assignedRoleIds: ["role_workspace_owner"],
      isWorkspaceOwner: true,
    };
    const token = crypto.randomBytes(32).toString("base64url");
    store.users.push(user);
    store.sessions.push({
      id: crypto.randomUUID(),
      userId: user.id,
      tokenHash: tokenHash(token),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    });
    return { token, user: publicUser(user) };
  });
}

export async function activateWorkspaceTrial(workspaceIdInput, actorUserIdInput) {
  const workspaceId = String(workspaceIdInput || "").trim();
  const actorUserId = String(actorUserIdInput || "").trim();
  if (!workspaceId || !actorUserId) return null;
  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + configuredFreeTrialDays() * 24 * 60 * 60 * 1000);

  if (!useDatabaseAuth) {
    return mutateStore((store) => {
      const billingUser = store.users.find((user) => (
        user.workspaceId === workspaceId
        && user.billingStatus === "trialing"
      ));
      if (!billingUser) return null;
      if (billingUser.trialStartsAt || billingUser.trialEndsAt) {
        return { trialStartsAt: billingUser.trialStartsAt || null, trialEndsAt: billingUser.trialEndsAt || null };
      }
      billingUser.trialStartsAt = now.toISOString();
      billingUser.trialEndsAt = trialEndsAt.toISOString();
      return { trialStartsAt: billingUser.trialStartsAt, trialEndsAt: billingUser.trialEndsAt };
    });
  }

  const sql = await getPlatformSql();
  return sql.begin(async (tx) => {
    const [billingUser] = await tx`
      SELECT trial_user.id, trial_user.trial_starts_at, trial_user.trial_ends_at
        FROM workspace_memberships membership
        JOIN platform_users trial_user ON trial_user.id = membership.user_id
        JOIN user_role_entitlements entitlement
          ON entitlement.user_id = membership.user_id AND entitlement.source = 'trial'
       WHERE membership.workspace_id = ${workspaceId}
         AND membership.status = 'active'
         AND trial_user.status = 'active'
         AND trial_user.billing_status = 'trialing'
       ORDER BY membership.approved_at NULLS LAST, membership.created_at
       LIMIT 1
       FOR UPDATE OF trial_user`;
    if (!billingUser) return null;
    if (billingUser.trial_starts_at || billingUser.trial_ends_at) {
      return {
        trialStartsAt: billingUser.trial_starts_at || null,
        trialEndsAt: billingUser.trial_ends_at || null,
      };
    }

    await tx`
      UPDATE user_role_entitlements
         SET starts_at = ${now.toISOString()}, expires_at = ${trialEndsAt.toISOString()}, updated_at = now()
       WHERE source = 'trial' AND user_id IN (
         SELECT user_id FROM workspace_memberships WHERE workspace_id = ${workspaceId}
       )`;
    await tx`
      UPDATE platform_users
         SET trial_starts_at = ${now.toISOString()}, trial_ends_at = ${trialEndsAt.toISOString()}
       WHERE id = ${billingUser.id}`;
    await tx`
      INSERT INTO rbac_audit_events
        (id, actor_user_id, target_type, target_id, action, after_value)
      VALUES
        (${crypto.randomUUID()}, ${actorUserId}, 'workspace', ${workspaceId}, 'trial.started',
         ${tx.json({ trialStartsAt: now.toISOString(), trialEndsAt: trialEndsAt.toISOString(), startsOn: "first_service_use" })})`;
    return { trialStartsAt: now.toISOString(), trialEndsAt: trialEndsAt.toISOString() };
  });
}

async function expireTrials(userId = "") {
  const sql = await getPlatformSql();
  return sql.begin(async (tx) => {
    if (userId) {
      await tx`
        UPDATE user_role_entitlements
           SET status = 'inactive', updated_at = now()
         WHERE user_id = ${userId} AND source = 'trial' AND status = 'active'
           AND expires_at IS NOT NULL AND expires_at <= now()`;
    } else {
      await tx`
        UPDATE user_role_entitlements
           SET status = 'inactive', updated_at = now()
         WHERE source = 'trial' AND status = 'active'
           AND expires_at IS NOT NULL AND expires_at <= now()`;
    }
    const expired = userId
      ? await tx`
          UPDATE platform_users
             SET billing_status = 'expired'
           WHERE id = ${userId}
             AND billing_status IN ('trialing', 'payment_pending', 'past_due')
             AND trial_ends_at IS NOT NULL AND trial_ends_at <= now()
             AND NOT EXISTS (
               SELECT 1 FROM user_role_entitlements entitlement
                WHERE entitlement.user_id = platform_users.id
                  AND entitlement.source = 'payment' AND entitlement.status = 'active'
             )
          RETURNING id, trial_ends_at`
      : await tx`
          UPDATE platform_users
             SET billing_status = 'expired'
           WHERE billing_status IN ('trialing', 'payment_pending', 'past_due')
             AND trial_ends_at IS NOT NULL AND trial_ends_at <= now()
             AND NOT EXISTS (
               SELECT 1 FROM user_role_entitlements entitlement
                WHERE entitlement.user_id = platform_users.id
                  AND entitlement.source = 'payment' AND entitlement.status = 'active'
             )
          RETURNING id, trial_ends_at`;
    for (const row of expired) {
      await tx`
        UPDATE user_role_entitlements
           SET status = 'inactive', updated_at = now()
         WHERE user_id = ${row.id} AND source = 'trial' AND status = 'active'`;
      await tx`
        INSERT INTO rbac_audit_events
          (id, actor_user_id, target_type, target_id, action, after_value)
        VALUES
          (${crypto.randomUUID()}, ${row.id}, 'billing', ${row.id}, 'trial.expired',
           ${tx.json({ trialEndsAt: row.trial_ends_at })})`;
    }
    return expired.map((row) => ({ userId: String(row.id), status: "expired", trialEndsAt: row.trial_ends_at }));
  });
}

export async function refreshPlatformBillingState(userIdInput) {
  if (!useDatabaseAuth) return null;
  const userId = String(userIdInput || "").trim();
  if (!userId) return null;
  const expired = await expireTrials(userId);
  return expired[0] || null;
}

export async function refreshExpiredPlatformTrials() {
  if (!useDatabaseAuth) return [];
  return expireTrials();
}

// Payment providers must verify their own webhook signature before calling
// this idempotent transition. No generic public billing webhook is exposed.
export async function applyPlatformPaymentEvent({
  eventId,
  provider,
  userId,
  paymentStatus,
  selectedRoleIds,
  details = {},
}) {
  if (!useDatabaseAuth) throw new Error("Payment events require PostgreSQL.");
  const normalizedEventId = String(eventId || "").trim();
  const normalizedProvider = String(provider || "").trim();
  const normalizedUserId = String(userId || "").trim();
  const status = String(paymentStatus || "").trim();
  const allowedStatuses = new Set(["payment_pending", "active", "past_due", "canceled", "expired"]);
  if (!normalizedEventId || !normalizedProvider || !normalizedUserId || !allowedStatuses.has(status)) {
    throw new Error("The payment event is incomplete or invalid.");
  }

  const sql = await getPlatformSql();
  return sql.begin(async (tx) => {
    const [processed] = await tx`
      SELECT event_id FROM platform_billing_events WHERE event_id = ${normalizedEventId}`;
    if (processed) return { duplicate: true, status };
    const [requestedUser] = await tx`SELECT id, workspace_id, billing_status FROM platform_users WHERE id = ${normalizedUserId}`;
    if (!requestedUser) throw new Error("The payment event user was not found.");
    const [workspaceOwner] = await tx`
      SELECT owner.id, owner.billing_status
        FROM workspace_memberships owner_membership
        JOIN user_role_assignments owner_assignment
          ON owner_assignment.user_id = owner_membership.user_id
         AND owner_assignment.role_id = 'role_workspace_owner'
        JOIN platform_users owner ON owner.id = owner_membership.user_id
       WHERE owner_membership.workspace_id = ${requestedUser.workspace_id}
         AND owner_membership.status = 'active'
         AND owner.status = 'active'
       ORDER BY owner_membership.approved_at NULLS LAST, owner_membership.created_at
       LIMIT 1`;
    const billingUser = workspaceOwner || requestedUser;
    const billingUserId = String(billingUser.id);

    let roleIds = normalizedRoleIds(selectedRoleIds);
    if (!roleIds.length) {
      const selected = await tx`
        SELECT DISTINCT role_id FROM user_role_entitlements
         WHERE source = 'trial' AND user_id IN (
           SELECT user_id FROM workspace_memberships WHERE workspace_id = ${requestedUser.workspace_id}
         )`;
      roleIds = selected.map((row) => String(row.role_id));
    }
    if (status === "active") {
      roleIds = await validateSelectableRoleIds(tx, roleIds);
      for (const roleId of roleIds) {
        await tx`
          INSERT INTO user_role_entitlements
            (user_id, role_id, source, status, starts_at, expires_at, external_ref, updated_at)
          VALUES
            (${billingUserId}, ${roleId}, 'payment', 'active', now(), NULL, ${normalizedEventId}, now())
          ON CONFLICT (user_id, role_id, source) DO UPDATE SET
            status = 'active', expires_at = NULL, external_ref = EXCLUDED.external_ref, updated_at = now()`;
      }
      await tx`
        UPDATE user_role_entitlements SET status = 'inactive', updated_at = now()
         WHERE source = 'trial' AND user_id IN (
           SELECT user_id FROM workspace_memberships WHERE workspace_id = ${requestedUser.workspace_id}
         )`;
    } else if (["past_due", "canceled", "expired"].includes(status)) {
      await tx`
        UPDATE user_role_entitlements SET status = 'inactive', updated_at = now()
         WHERE source = 'payment' AND user_id IN (
           SELECT user_id FROM workspace_memberships WHERE workspace_id = ${requestedUser.workspace_id}
         )`;
    }

    await tx`UPDATE platform_users SET billing_status = ${status} WHERE id = ${billingUserId}`;
    await tx`
      INSERT INTO platform_billing_events
        (event_id, user_id, provider, payment_status, details)
      VALUES
        (${normalizedEventId}, ${billingUserId}, ${normalizedProvider}, ${status},
         ${tx.json(details && typeof details === "object" ? details : {})})`;
    await tx`
      INSERT INTO rbac_audit_events
        (id, actor_user_id, target_type, target_id, action, before_value, after_value)
      VALUES
        (${crypto.randomUUID()}, ${billingUserId}, 'billing', ${billingUserId},
         ${`payment.${status}`}, ${tx.json({ billingStatus: billingUser.billing_status })},
         ${tx.json({ billingStatus: status, roleIds, provider: normalizedProvider, eventId: normalizedEventId })})`;
    return { duplicate: false, status, roleIds, billingUserId };
  });
}

export async function loginPlatformUser({ email, password }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedPassword = String(password || "");

  if (useDatabaseAuth) {
    const sql = await getPlatformSql();
    const [user] = await sql`
      SELECT * FROM platform_users WHERE LOWER(email) = ${normalizedEmail} LIMIT 1`;
    if (!user || !verifyPassword(normalizedPassword, user.password_hash)) {
      throw new PlatformAuthError("INVALID_CREDENTIALS", "Invalid email or password.");
    }
    const token = await createDatabaseSession(sql, user.id);
    await pruneDatabaseSessions(sql);
    return { token, user: publicDatabaseUser(user) };
  }

  return mutateStore((store) => {
    const user = store.users.find((candidate) => candidate.email === normalizedEmail);
    if (!user || !verifyPassword(normalizedPassword, user.passwordHash)) {
      throw new PlatformAuthError("INVALID_CREDENTIALS", "Invalid email or password.");
    }

    const now = new Date();
    const token = crypto.randomBytes(32).toString("base64url");
    store.sessions.push({
      id: crypto.randomUUID(),
      userId: user.id,
      tokenHash: tokenHash(token),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    });
    return { token, user: publicUser(user) };
  });
}

export async function getCurrentPlatformUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(PLATFORM_SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    if (useDatabaseAuth) {
      const sql = await getPlatformSql();
      const [user] = await sql`
        SELECT u.*
          FROM platform_sessions s
          JOIN platform_users u ON u.id = s.user_id
         WHERE s.token_hash = ${tokenHash(token)}
           AND s.expires_at > now()
         LIMIT 1`;
      return user ? publicDatabaseUser(user) : null;
    }

    const store = await readStore();
    const hash = tokenHash(token);
    const session = store.sessions.find(
      (candidate) => candidate.tokenHash === hash && new Date(candidate.expiresAt).getTime() > Date.now()
    );
    if (!session) return null;
    const user = store.users.find((candidate) => candidate.id === session.userId);
    return user ? publicUser(user) : null;
  } catch (error) {
    console.error(
      "Unable to restore the signed-in platform session:",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

export async function createPublishingIdentityToken(user) {
  return createServiceIdentityToken(user, "publishing");
}

export async function createServiceIdentityToken(user, audience) {
  const { getPrincipalForUser } = await import("./access-control.js");
  const { issueServiceToken } = await import("./access-control.js");
  const principal = user?.userId ? user : await getPrincipalForUser(user);
  if (!principal?.workspaceId || principal.status !== "active") {
    throw new Error("An active AgenticThat workspace is required.");
  }
  return issueServiceToken(principal, audience);
}

export async function destroyPlatformSession(token) {
  if (!token) return;
  const hash = tokenHash(token);

  if (useDatabaseAuth) {
    const sql = await getPlatformSql();
    await sql`DELETE FROM platform_sessions WHERE token_hash = ${hash}`;
    return;
  }

  await mutateStore((store) => {
    store.sessions = store.sessions.filter((session) => session.tokenHash !== hash);
  });
}

function cookieAttributes(maxAge) {
  const attributes = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (process.env.NODE_ENV === "production") attributes.push("Secure");
  return attributes.join("; ");
}

export function platformSessionCookieHeader(token) {
  return `${PLATFORM_SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieAttributes(SESSION_TTL_MS / 1000)}`;
}

export function clearPlatformSessionCookieHeader() {
  return `${PLATFORM_SESSION_COOKIE}=; ${cookieAttributes(0)}`;
}
