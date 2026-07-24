import crypto from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { cookies } from "next/headers";
import { signPublishingWorkspaceIdentity } from "../../../lib/publishing-workspace-auth";

export const PLATFORM_SESSION_COOKIE = "agenticthat_session";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const useNetlifyBlobs = (
  process.env.DATA_STORE === "netlify-blobs" ||
  process.env.NETLIFY === "true" ||
  Boolean(process.env.NETLIFY_BLOBS_CONTEXT)
);
let blobStorePromise = null;

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

function publicUser(user) {
  return {
    id: user.id,
    workspaceId: user.workspaceId || `workspace_${user.id}`,
    name: user.name,
    businessName: user.businessName,
    email: user.email,
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
    })),
  };
}

function getBlobStore() {
  blobStorePromise ??= import("@netlify/blobs")
    .then(({ getStore }) => getStore("agentic-that-platform-auth"));
  return blobStorePromise;
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

  return mutateStore((store) => {
    if (store.users.some((user) => user.email === normalizedEmail)) {
      throw new PlatformAuthError("ACCOUNT_EXISTS", "An account already exists for this email.");
    }

    const now = new Date();
    const user = {
      id: crypto.randomUUID(),
      workspaceId: `workspace_${crypto.randomUUID()}`,
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

  const store = await readStore();
  const hash = tokenHash(token);
  const session = store.sessions.find(
    (candidate) => candidate.tokenHash === hash && new Date(candidate.expiresAt).getTime() > Date.now()
  );
  if (!session) return null;
  const user = store.users.find((candidate) => candidate.id === session.userId);
  return user ? publicUser(user) : null;
}

export function createPublishingIdentityToken(user) {
  const publicIdentity = publicUser(user);
  return signPublishingWorkspaceIdentity({
    sub: publicIdentity.id,
    workspaceId: publicIdentity.workspaceId,
    name: publicIdentity.name,
    email: publicIdentity.email,
    businessName: publicIdentity.businessName,
  });
}

export async function destroyPlatformSession(token) {
  if (!token) return;
  const hash = tokenHash(token);
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
