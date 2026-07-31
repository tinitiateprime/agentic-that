import crypto from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { cookies } from "next/headers";
import { signPublishingWorkspaceIdentity } from "../../../lib/publishing-workspace-auth";
import { getSql } from "@whatsapp/lib/db";

export const PLATFORM_SESSION_COOKIE = "agenticthat_session";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
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
  };
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function passwordHash(password) {
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
    workspaceId: String(user.workspace_id),
    name: String(user.name || "Workspace user"),
    businessName: String(user.business_name || user.name || "Workspace"),
    email: String(user.email || ""),
  };
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
  await sql`
    CREATE TABLE IF NOT EXISTS platform_users (
      id                       TEXT PRIMARY KEY,
      workspace_id             TEXT NOT NULL UNIQUE,
      publishing_workspace_key TEXT NOT NULL,
      name                     TEXT NOT NULL,
      business_name            TEXT NOT NULL,
      email                    TEXT NOT NULL,
      password_hash            TEXT NOT NULL,
      created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
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
}

async function getPlatformSql() {
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

export async function registerPlatformUser({ name, businessName, email, password }) {
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

  if (useDatabaseAuth) {
    const sql = await getPlatformSql();
    try {
      return await sql.begin(async (tx) => {
        const [existing] = await tx`
          SELECT id FROM platform_users WHERE LOWER(email) = ${normalizedEmail} LIMIT 1`;
        if (existing) {
          throw new PlatformAuthError("ACCOUNT_EXISTS", "An account already exists for this email.");
        }

        const id = crypto.randomUUID();
        const [user] = await tx`
          INSERT INTO platform_users
            (id, workspace_id, publishing_workspace_key, name, business_name,
             email, password_hash)
          VALUES
            (${id}, ${`workspace_${crypto.randomUUID()}`},
             ${crypto.randomBytes(32).toString("base64url")},
             ${normalizedName}, ${normalizedBusiness}, ${normalizedEmail},
             ${passwordHash(normalizedPassword)})
          RETURNING *`;
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

    const now = new Date();
    const user = {
      id: crypto.randomUUID(),
      workspaceId: `workspace_${crypto.randomUUID()}`,
      publishingWorkspaceKey: crypto.randomBytes(32).toString("base64url"),
      name: normalizedName,
      businessName: normalizedBusiness,
      email: normalizedEmail,
      passwordHash: passwordHash(normalizedPassword),
      createdAt: now.toISOString(),
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
  if (useDatabaseAuth) {
    const sql = await getPlatformSql();
    const [storedUser] = await sql`
      SELECT * FROM platform_users WHERE id = ${String(user.id)} LIMIT 1`;
    if (!storedUser) throw new Error("Platform user not found.");
    const publicIdentity = publicDatabaseUser(storedUser);
    return signPublishingWorkspaceIdentity({
      sub: publicIdentity.id,
      workspaceId: publicIdentity.workspaceId,
      workspaceKey: storedUser.publishing_workspace_key,
      name: publicIdentity.name,
      email: publicIdentity.email,
      businessName: publicIdentity.businessName,
    });
  }

  const store = await readStore();
  const storedUser = store.users.find((candidate) => candidate.id === user.id);
  if (!storedUser) throw new Error("Platform user not found.");
  const publicIdentity = publicUser(storedUser);
  return signPublishingWorkspaceIdentity({
    sub: publicIdentity.id,
    workspaceId: publicIdentity.workspaceId,
    workspaceKey: storedUser.publishingWorkspaceKey,
    name: publicIdentity.name,
    email: publicIdentity.email,
    businessName: publicIdentity.businessName,
  });
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
