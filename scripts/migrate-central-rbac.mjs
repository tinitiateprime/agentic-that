import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import postgres from "postgres";

dotenv.config({ path: path.resolve(".env.local"), quiet: true });
dotenv.config({ path: path.resolve(".env"), quiet: true });

const apply = process.argv.includes("--apply");
const databaseUrl = process.env.DATABASE_URL?.trim() || process.env.SUPABASE_DB_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL or SUPABASE_DB_URL is required.");

const sql = postgres(databaseUrl, { max: 1, prepare: false });

async function readFirstJson(candidates) {
  for (const candidate of candidates) {
    try {
      return { path: candidate, value: JSON.parse(await readFile(candidate, "utf8")) };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return { path: null, value: null };
}

function review(product, localActorId, localEmail, reason, details = {}) {
  return { product, localActorId: String(localActorId), localEmail: localEmail || null, reason, details };
}

try {
  const [platformUsers, relationRows, publishingStore, telegramStore] = await Promise.all([
    sql`SELECT id, email, workspace_id FROM platform_users`,
    sql`SELECT to_regclass('public.workspace_memberships') AS memberships,
               to_regclass('public.businesses') AS businesses,
               to_regclass('public.users') AS users`,
    readFirstJson([
      path.resolve(process.env.PUBLISH_QUEUE_DATA_PATH || "data/store.json"),
      path.resolve("services/publishing/queue-runner/data/store.json"),
    ]),
    readFirstJson([
      path.resolve(process.env.DATA_DIR || "data", "store.json"),
      path.resolve("services/messaging/telegram/data/store.json"),
    ]),
  ]);
  const relations = relationRows[0] || {};
  const memberships = relations.memberships
    ? await sql`SELECT user_id, workspace_id FROM workspace_memberships`
    : platformUsers.filter(user => user.workspace_id).map(user => ({ user_id: user.id, workspace_id: user.workspace_id }));

  const workspaceByUser = new Map(memberships.map(row => [String(row.user_id), String(row.workspace_id)]));
  const platformUserById = new Map(platformUsers.map(user => [String(user.id), user]));
  const reviews = [];
  const whatsappUpdates = [];
  let whatsappBusinesses = [];

  if (relations.businesses && relations.users) {
    const bridgeColumns = await sql`
      SELECT table_name, column_name
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND ((table_name = 'businesses' AND column_name = 'platform_workspace_id')
           OR (table_name = 'users' AND column_name = 'platform_user_id'))`;
    const hasBusinessWorkspace = bridgeColumns.some(row => row.table_name === "businesses");
    const hasPlatformUser = bridgeColumns.some(row => row.table_name === "users");
    whatsappBusinesses = await sql.unsafe(`
      SELECT b.id, b.name, ${hasBusinessWorkspace ? "b.platform_workspace_id" : "NULL::text AS platform_workspace_id"},
             COALESCE(json_agg(json_build_object(
               'id', u.id, 'email', u.email, 'role', u.role,
               'platformUserId', ${hasPlatformUser ? "u.platform_user_id" : "NULL::text"}
             )) FILTER (WHERE u.id IS NOT NULL), '[]'::json) AS users
        FROM businesses b
        LEFT JOIN users u ON u.business_id = b.id
       GROUP BY b.id
       ORDER BY b.id`);
    for (const business of whatsappBusinesses) {
      const exactLinks = business.users
        .filter(user => user.platformUserId && platformUserById.has(String(user.platformUserId)))
        .map(user => ({ user, workspaceId: workspaceByUser.get(String(user.platformUserId)) }))
        .filter(link => link.workspaceId);
      const workspaceIds = [...new Set(exactLinks.map(link => link.workspaceId))];
      if (workspaceIds.length === 1) {
        if (business.platform_workspace_id && business.platform_workspace_id !== workspaceIds[0]) {
          reviews.push(review("whatsapp", `business:${business.id}`, null, "workspace_conflict", {
            currentWorkspaceId: business.platform_workspace_id,
            exactWorkspaceId: workspaceIds[0],
          }));
        } else if (!business.platform_workspace_id) {
          whatsappUpdates.push({ businessId: business.id, workspaceId: workspaceIds[0] });
        }
      } else {
        reviews.push(review(
          "whatsapp",
          `business:${business.id}`,
          business.users[0]?.email,
          workspaceIds.length > 1 ? "multiple_exact_platform_workspaces" : "no_exact_platform_user_link",
          { businessName: business.name, localUserIds: business.users.map(user => user.id) },
        ));
      }
    }
  }

  const publishingUsers = Array.isArray(publishingStore.value?.users) ? publishingStore.value.users : [];
  for (const user of publishingUsers) {
    if (user.platformUserId && user.workspaceId) {
      const exactWorkspace = workspaceByUser.get(String(user.platformUserId));
      if (exactWorkspace === String(user.workspaceId)) continue;
      reviews.push(review("publishing", user.id, user.email, "central_identity_mismatch", {
        storedWorkspaceId: user.workspaceId,
        centralWorkspaceId: exactWorkspace || null,
        legacyRole: user.role,
      }));
      continue;
    }
    reviews.push(review("publishing", user.id, user.email, "no_exact_platform_user_link", { legacyRole: user.role }));
  }

  const telegramUsers = Array.isArray(telegramStore.value?.appUsers) ? telegramStore.value.appUsers : [];
  for (const user of telegramUsers) {
    if (user.platformWorkspaceId) continue;
    reviews.push(review("telegram", user.id, null, "no_exact_platform_user_link", {
      displayName: user.displayName,
      configuredLogin: Boolean(user.configuredLogin),
    }));
  }

  if (apply) {
    await sql.begin(async tx => {
      await tx`
        CREATE TABLE IF NOT EXISTS platform_auth_migrations (
          key TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      if (relations.businesses) {
        await tx`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS platform_workspace_id TEXT`;
        await tx`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_platform_workspace_id
            ON businesses(platform_workspace_id) WHERE platform_workspace_id IS NOT NULL`;
      }
      if (relations.users) {
        await tx`ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_user_id TEXT`;
        await tx`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_users_platform_user_id
            ON users(platform_user_id) WHERE platform_user_id IS NOT NULL`;
      }
      await tx`
        CREATE TABLE IF NOT EXISTS rbac_identity_review_queue (
          id TEXT PRIMARY KEY,
          product TEXT NOT NULL,
          local_actor_id TEXT NOT NULL,
          local_email TEXT,
          reason TEXT NOT NULL,
          details JSONB,
          status TEXT NOT NULL DEFAULT 'pending',
          resolved_by TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
          resolved_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (product, local_actor_id)
        )`;
      for (const mapping of whatsappUpdates) {
        await tx`
          UPDATE businesses
             SET platform_workspace_id = ${mapping.workspaceId}
           WHERE id = ${mapping.businessId} AND platform_workspace_id IS NULL`;
      }
      for (const item of reviews) {
        await tx`
          INSERT INTO rbac_identity_review_queue
            (id, product, local_actor_id, local_email, reason, details)
          VALUES
            (${`review:${item.product}:${item.localActorId}`}, ${item.product}, ${item.localActorId},
             ${item.localEmail}, ${item.reason}, ${tx.json(item.details)})
          ON CONFLICT (product, local_actor_id) DO UPDATE SET
            local_email = EXCLUDED.local_email,
            reason = EXCLUDED.reason,
            details = EXCLUDED.details
          WHERE rbac_identity_review_queue.status = 'pending'`;
      }
      await tx`
        INSERT INTO platform_auth_migrations (key)
        VALUES ('central-product-identity-v1')
        ON CONFLICT (key) DO NOTHING`;
    });
  }

  const report = {
    mode: apply ? "apply" : "dry-run",
    platform: {
      users: platformUsers.length,
      activeMemberships: memberships.length,
    },
    whatsapp: {
      businesses: whatsappBusinesses.length,
      exactWorkspaceMappingsReady: whatsappUpdates.length,
    },
    publishing: {
      source: publishingStore.path,
      users: publishingUsers.length,
    },
    telegram: {
      source: telegramStore.path,
      users: telegramUsers.length,
    },
    reviewQueue: {
      count: reviews.length,
      items: reviews,
    },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await sql.end();
}
