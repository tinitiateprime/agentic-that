import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  beginTelegramLogin,
  completeTelegramLoginWithCode,
  completeTelegramLoginWithPassword,
  revokeTelegramSession,
  sendTelegramMessage,
  listenForAccount,
  fetchRecentTelegramMessages,
  normalizePhone,
  type TelegramApiCredentials
} from "./account-client.ts";
import { readConfig, type AppConfig } from "./config.ts";
import { configuredLoginId, findConfiguredLoginUser, readConfiguredLoginUsers, type ConfiguredLoginUser } from "./login-config.ts";
import { RequestRateLimiter } from "./rate-limit.ts";
import { AccountAlreadyLinkedError, type AppUser, type MessageRecord, MultiUserStore, type TelegramAccountWithSession } from "./store.ts";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonBody = Record<string, unknown>;

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

let config: AppConfig;
let configuredLoginUsers: ConfiguredLoginUser[];
let store: MultiUserStore;
let limiter: RequestRateLimiter;
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const telegramRoot = path.resolve(moduleDir, "..");
const telegramPublicDir = path.join(telegramRoot, "public");
const frontendDistDirs = [
  path.resolve(process.cwd(), "dist"),
  path.resolve(telegramRoot, "..", "..", "dist")
];
const publicFiles = new Map([
  ["/console", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/console/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/console/app.js", { file: "app.js", type: "text/javascript; charset=utf-8" }],
  ["/console/styles.css", { file: "styles.css", type: "text/css; charset=utf-8" }]
]);
type TelegramListenerClient = Awaited<ReturnType<typeof listenForAccount>>;

const telegramListeners = new Map<string, TelegramListenerClient>();
const startingTelegramListeners = new Map<string, Promise<void>>();
const recentHistorySyncs = new Map<string, Promise<void>>();
const recentHistorySyncStartedAt = new Map<string, number>();
const recentHistorySyncIntervalMs = 45_000;
const recentHistorySyncTargetLimit = 50;
const secretEnvironmentNames = [
  "SESSION_ENCRYPTION_KEY",
  "USER_PROVISIONING_KEY",
  "TELEGRAM_BOT_TOKEN"
];

function redactedErrorMessage(error: unknown) {
  let message = error instanceof Error ? error.message : String(error);
  if (!message || message === "undefined") return "Unexpected error.";

  for (const name of secretEnvironmentNames) {
    const value = process.env[name]?.trim();
    if (value && value.length > 3) {
      message = message.split(value).join(`[${name} redacted]`);
    }
  }
  return message;
}

function responseHeaders(request: IncomingMessage, contentType: string) {
  const headers: Record<string, string | number> = {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "content-security-policy": "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; media-src 'self' data: https:; object-src 'none'"
  };
  const origin = request.headers.origin;
  if (config.corsOrigin && origin === config.corsOrigin) {
    headers["access-control-allow-origin"] = config.corsOrigin;
    headers["access-control-allow-methods"] = "GET,POST,DELETE,OPTIONS";
    headers["access-control-allow-headers"] = "content-type,authorization,x-provisioning-key";
    headers["access-control-allow-credentials"] = "true";
    headers.vary = "Origin";
  }
  return headers;
}

function sendJson(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  payload: JsonValue,
  extraHeaders: Record<string, string | number> = {}
) {
  response.writeHead(status, { ...responseHeaders(request, "application/json; charset=utf-8"), ...extraHeaders });
  response.end(status === 204 ? undefined : JSON.stringify(payload, null, 2));
}

function sendBytes(request: IncomingMessage, response: ServerResponse, status: number, body: Buffer, contentType: string) {
  response.writeHead(status, responseHeaders(request, contentType));
  response.end(body);
}

async function servePublicAsset(request: IncomingMessage, response: ServerResponse, pathname: string) {
  if (request.method !== "GET") return false;
  const asset = publicFiles.get(pathname);
  if (!asset) return false;
  try {
    const body = await readFile(path.join(telegramPublicDir, asset.file));
    sendBytes(request, response, 200, body, asset.type);
  } catch {
    sendJson(request, response, 404, { ok: false, error: "UI asset was not found." });
  }
  return true;
}

function contentTypeFor(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".js" || extension === ".mjs") return "text/javascript; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".json") return "application/json; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".ico") return "image/x-icon";
  if (extension === ".mp4") return "video/mp4";
  if (extension === ".webm") return "video/webm";
  return "application/octet-stream";
}

function safeStaticPath(root: string, pathname: string) {
  try {
    const decoded = decodeURIComponent(pathname);
    if (decoded.includes("\0")) return null;
    const relativePath = decoded.replace(/^\/+/, "");
    const resolved = path.resolve(root, relativePath || "index.html");
    const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
    if (resolved !== root && !resolved.startsWith(rootWithSeparator)) return null;
    return resolved;
  } catch {
    return null;
  }
}

async function findFrontendDistDir() {
  for (const dir of frontendDistDirs) {
    try {
      const details = await stat(dir);
      if (details.isDirectory()) return dir;
    } catch {
      // Try the next common project layout.
    }
  }
  return "";
}

async function serveFrontendAsset(request: IncomingMessage, response: ServerResponse, pathname: string) {
  if (request.method !== "GET") return false;
  if (pathname === "/health" || pathname.startsWith("/v1/") || pathname.startsWith("/console")) return false;

  const distDir = await findFrontendDistDir();
  if (!distDir) return false;

  const requestedPath = pathname === "/" ? path.join(distDir, "index.html") : safeStaticPath(distDir, pathname);
  if (requestedPath) {
    try {
      const details = await stat(requestedPath);
      if (details.isFile()) {
        sendBytes(request, response, 200, await readFile(requestedPath), contentTypeFor(requestedPath));
        return true;
      }
    } catch {
      // Fall through to the SPA index file.
    }
  }

  const indexPath = path.join(distDir, "index.html");
  try {
    sendBytes(request, response, 200, await readFile(indexPath), "text/html; charset=utf-8");
    return true;
  } catch {
    return false;
  }
}

async function readJsonBody(request: IncomingMessage): Promise<JsonBody> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 1024 * 1024) throw new HttpError(413, "Request body is too large.");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HttpError(400, "Request body must be a JSON object.");
    }
    return parsed as JsonBody;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Request body is not valid JSON.");
  }
}

function requiredString(body: JsonBody, name: string, maxLength = 1000) {
  const value = body[name];
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `${name} is required.`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new HttpError(400, `${name} is too long.`);
  return trimmed;
}

function optionalString(body: JsonBody, name: string, maxLength = 1000) {
  const value = body[name];
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw new HttpError(400, `${name} must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new HttpError(400, `${name} is too long.`);
  return trimmed;
}

function readCookie(request: IncomingMessage, name: string) {
  const header = request.headers.cookie;
  if (!header) return "";
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator === -1) continue;
    if (item.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

function sessionCookie(value: string, maxAgeSeconds: number) {
  const attributes = [
    `app_session=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`
  ];
  if (config.sessionCookieSecure) attributes.push("Secure");
  return attributes.join("; ");
}

function clientAddress(request: IncomingMessage) {
  return request.socket.remoteAddress || "unknown";
}

function enforceRateLimit(scope: string, maximum: number) {
  const result = limiter.consume(scope, maximum);
  if (!result.allowed) {
    throw new HttpError(429, `Too many requests. Try again in ${result.retryAfterSeconds} seconds.`);
  }
}

function ensureTrustedOrigin(request: IncomingMessage) {
  const origin = request.headers.origin;
  if (!origin) return;
  if (config.corsOrigin && origin === config.corsOrigin) return;
  const protocol = config.sessionCookieSecure ? "https" : "http";
  const sameHostOrigin = `${protocol}://${request.headers.host ?? "localhost"}`;
  if (origin === sameHostOrigin) return;
  throw new HttpError(403, "This browser origin is not allowed.");
}

async function requireUser(request: IncomingMessage): Promise<AppUser> {
  const authorization = request.headers.authorization ?? "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  if (bearer) {
    const user = await store.findUserByAccessToken(bearer);
    if (user) return user;
  }

  const browserSession = readCookie(request, "app_session");
  if (browserSession) {
    const user = await store.findUserByBrowserSession(browserSession);
    if (user) return user;
  }
  throw new HttpError(401, "Sign in is required.");
}

function hasProvisioningKey(request: IncomingMessage) {
  const provided = request.headers["x-provisioning-key"];
  if (typeof provided !== "string") return false;
  const expected = Buffer.from(config.userProvisioningKey);
  const received = Buffer.from(provided);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function challengeIdFromPath(pathname: string, suffix: "code" | "password") {
  const match = new RegExp(`^/v1/telegram/login/([^/]+)/${suffix}$`).exec(pathname);
  return match?.[1] ?? null;
}

function accountIdFromPath(pathname: string) {
  const match = /^\/v1\/telegram\/accounts\/([^/]+)$/.exec(pathname);
  return match?.[1] ?? null;
}
async function recordIncomingMessage(accountId: string, message: { chatId: string; chatRef: string; senderId: string; senderRef: string; isPrivate: boolean; messageId: string; text: string; createdAt?: string }) {
  const text = message.text.trim();
  if (!text || !message.messageId) return;
  await store.recordMessage({
    accountId,
    direction: "inbound",
    recipient: message.isPrivate
      ? message.senderRef || message.senderId || message.chatId || "unknown"
      : message.chatRef || message.chatId || message.senderRef || "unknown",
    text,
    telegramMessageId: message.messageId,
    createdAt: message.createdAt
  });
}

function syncRecipientTokens(value: string) {
  return value
    .split(/[\s,|]+/)
    .map((token) => token.trim())
    .filter((token) => token.startsWith("@") || token.startsWith("+"));
}

function recentHistorySyncTargets(requestedRecipients: string[], messages: MessageRecord[]) {
  const seen = new Set<string>();
  const targets: string[] = [];
  const add = (value: string) => {
    for (const token of syncRecipientTokens(value)) {
      const key = token.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push(token);
      if (targets.length >= recentHistorySyncTargetLimit) return;
    }
  };

  for (const recipient of requestedRecipients) {
    add(recipient);
    if (targets.length >= recentHistorySyncTargetLimit) return targets;
  }
  for (const message of messages) {
    add(message.recipient);
    if (targets.length >= recentHistorySyncTargetLimit) return targets;
  }
  return targets;
}

async function syncRecentTelegramHistory(account: TelegramAccountWithSession, recipients: string[], force: boolean) {
  if (!recipients.length) return;
  const inFlight = recentHistorySyncs.get(account.id);
  if (inFlight) {
    await inFlight;
    return;
  }

  const lastStartedAt = recentHistorySyncStartedAt.get(account.id) || 0;
  if (!force && Date.now() - lastStartedAt < recentHistorySyncIntervalMs) return;
  recentHistorySyncStartedAt.set(account.id, Date.now());

  const sync = (async () => {
    try {
      const messages = await fetchRecentTelegramMessages(telegramApiCredentialsFromAccount(account), account.sessionString, 100, recipients);
      for (const message of messages) {
        await store.recordMessage({
          accountId: account.id,
          direction: message.direction,
          recipient: message.recipient,
          text: message.text,
          telegramMessageId: message.messageId,
          createdAt: message.createdAt
        });
      }
    } catch (error) {
      console.error(`Recent Telegram history sync failed for account ${account.id}: ${redactedErrorMessage(error)}`);
    } finally {
      recentHistorySyncs.delete(account.id);
    }
  })();

  recentHistorySyncs.set(account.id, sync);
  await sync;
}

async function startTelegramListener(account: TelegramAccountWithSession) {
  if (telegramListeners.has(account.id) || startingTelegramListeners.has(account.id)) return;
  const startup = (async () => {
    try {
      const client = await listenForAccount(telegramApiCredentialsFromAccount(account), account.sessionString, (message) => recordIncomingMessage(account.id, message));
      telegramListeners.set(account.id, client);
      console.log(`Incoming Telegram listener started for account ${account.id}.`);
    } catch {
      console.error(`Incoming Telegram listener could not start for account ${account.id}.`);
    } finally {
      startingTelegramListeners.delete(account.id);
    }
  })();
  startingTelegramListeners.set(account.id, startup);
  await startup;
}

async function startStoredTelegramListeners() {
  const accounts = await store.getAllAccountsWithSessions();
  if (accounts.length === 0) {
    console.log("No connected Telegram accounts to listen for.");
    return;
  }
  await Promise.all(accounts.map((account) => startTelegramListener(account)));
}

async function stopTelegramListener(accountId: string) {
  await startingTelegramListeners.get(accountId);
  const client = telegramListeners.get(accountId);
  if (!client) return;
  telegramListeners.delete(accountId);
  try {
    await client.disconnect();
  } catch {
    console.error(`Incoming Telegram listener could not stop cleanly for account ${accountId}.`);
  }
}

async function stopAllTelegramListeners() {
  await Promise.all(Array.from(startingTelegramListeners.values()));
  await Promise.all(Array.from(telegramListeners.keys()).map((accountId) => stopTelegramListener(accountId)));
}


function normalizePhoneFromBody(body: JsonBody) {
  try {
    return normalizePhone(requiredString(body, "phone", 32));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, error instanceof Error ? error.message : "Phone number is invalid.");
  }
}

function telegramApiCredentialsFromBody(body: JsonBody): TelegramApiCredentials {
  const rawApiId = requiredString(body, "telegramApiId", 20);
  const apiId = Number(rawApiId);
  if (!Number.isInteger(apiId) || apiId <= 0) {
    throw new HttpError(400, "Telegram API ID must be a positive number from my.telegram.org.");
  }

  const apiHash = requiredString(body, "telegramApiHash", 128);
  if (!/^[a-f0-9]{32}$/i.test(apiHash)) {
    throw new HttpError(400, "Telegram API hash must be the 32-character hash from my.telegram.org.");
  }

  return { apiId, apiHash };
}

function telegramApiCredentialsFromAccount(account: TelegramAccountWithSession): TelegramApiCredentials {
  if (!account.telegramApiId || !account.telegramApiHash) {
    throw new HttpError(400, "This Telegram account was connected before per-user API credentials were enabled. Delete it and connect it again.");
  }
  return { apiId: account.telegramApiId, apiHash: account.telegramApiHash };
}

function operationalTelegramError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toUpperCase();
  if (normalized.includes("TIMEOUT") || normalized.includes("ETIMEDOUT")) {
    return new HttpError(504, "Telegram request timed out. Please try again in a minute.");
  }
  if (
    normalized.includes("ECONNRESET") ||
    normalized.includes("ECONNREFUSED") ||
    normalized.includes("NETWORK") ||
    normalized.includes("CONNECTION")
  ) {
    return new HttpError(502, "Telegram connection failed. Please try again.");
  }
  return null;
}

function telegramRawMessage(error: unknown) {
  if (error && typeof error === "object" && "errorMessage" in error) {
    return String((error as { errorMessage: unknown }).errorMessage);
  }
  return error instanceof Error ? error.message : String(error);
}

function telegramLoginError(error: unknown) {
  if (error instanceof HttpError) return error;
  const operational = operationalTelegramError(error);
  if (operational) return operational;
  const message = telegramRawMessage(error);
  const normalized = message.toUpperCase();
  if (normalized.includes("PHONE_CODE_INVALID")) {
    return new HttpError(400, "Verification code is incorrect. Enter the latest Telegram code and try again.");
  }
  if (normalized.includes("PHONE_CODE_EXPIRED")) {
    return new HttpError(400, "Verification code expired. Click Start over and request a new code.");
  }
  if (normalized.includes("PHONE_NUMBER_INVALID")) {
    return new HttpError(400, "Phone number is invalid. Use full country code, for example +91XXXXXXXXXX.");
  }
  if (normalized.includes("PHONE_NUMBER_BANNED")) {
    return new HttpError(400, "Telegram rejected this phone number because it is banned or restricted.");
  }
  if (normalized.includes("SESSION_PASSWORD_NEEDED")) {
    return new HttpError(400, "This Telegram account requires two-factor password. Continue with the password step.");
  }
  if (normalized.includes("PASSWORD_HASH_INVALID")) {
    return new HttpError(400, "Two-factor password is incorrect. Please try again.");
  }
  if (normalized.includes("AUTH_KEY") || normalized.includes("SESSION_REVOKED") || normalized.includes("SESSION_EXPIRED")) {
    return new HttpError(400, "Telegram login session expired. Click Start over and request a new code.");
  }
  return new HttpError(502, message || "Telegram login failed. Please try again.");
}
function telegramSendError(error: unknown) {
  if (error instanceof HttpError) return error;
  const operational = operationalTelegramError(error);
  if (operational) return operational;
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toUpperCase();
  const floodWait = message.match(/wait (?:of )?(\d+) seconds|FLOOD_WAIT_(\d+)/i);
  if (normalized.includes("FLOOD") || floodWait) {
    const seconds = Number(floodWait?.[1] || floodWait?.[2] || 0);
    const waitText = Number.isFinite(seconds) && seconds > 0 ? `${seconds} seconds` : "a few minutes";
    return new HttpError(429, `Telegram is rate-limiting contact imports. Use the contact's @username if available, or try again after ${waitText}.`);
  }
  if (
    normalized.includes("PHONE") ||
    normalized.includes("USERNAME") ||
    normalized.includes("ENTITY") ||
    normalized.includes("PEER") ||
    normalized.includes("PRIVACY") ||
    normalized.includes("RECIPIENT")
  ) {
    return new HttpError(400, message || "Telegram could not resolve this recipient.");
  }
  if (
    normalized.includes("MEDIA") ||
    normalized.includes("FILE") ||
    normalized.includes("PHOTO") ||
    normalized.includes("DOCUMENT") ||
    normalized.includes("URL")
  ) {
    return new HttpError(400, message || "Telegram could not send this media. Use a direct public http(s) image/video URL.");
  }
  return new HttpError(502, message || "Telegram could not send this message right now.");
}

async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (await servePublicAsset(request, response, url.pathname)) return;

  if (request.method === "OPTIONS") {
    sendJson(request, response, 204, {});
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(request, response, 200, { ok: true, service: "telegram-multi-user", storage: "json" });
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/users") {
    ensureTrustedOrigin(request);
    enforceRateLimit(`provision:${clientAddress(request)}`, Math.max(3, Math.floor(config.rateLimitMaxRequests / 10)));
    if (!hasProvisioningKey(request)) throw new HttpError(401, "A valid provisioning key is required.");
    const body = await readJsonBody(request);
    const created = await store.createUser(requiredString(body, "displayName", 120));
    sendJson(request, response, 201, { ok: true, user: created.user, accessToken: created.accessToken });
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/auth/password") {
    ensureTrustedOrigin(request);
    enforceRateLimit(`password-login:${clientAddress(request)}`, Math.max(5, Math.floor(config.rateLimitMaxRequests / 6)));
    const body = await readJsonBody(request);
    const username = requiredString(body, "username", 120);
    const password = requiredString(body, "password", 1000);
    const passwordUser = await store.findUserByPassword(username, password);
    if (passwordUser) {
      const session = await store.createBrowserSessionForUser(passwordUser, config.appSessionTtlHours);
      sendJson(request, response, 201, { ok: true, user: session.user, expiresAt: session.expiresAt }, {
        "set-cookie": sessionCookie(session.sessionToken, config.appSessionTtlHours * 60 * 60)
      });
      return;
    }

    const configuredUser = findConfiguredLoginUser(
      configuredLoginUsers,
      username,
      password
    );
    if (!configuredUser) throw new HttpError(401, "Sign in failed.");
    const user = await store.findOrCreateConfiguredUser(configuredLoginId(configuredUser), configuredUser.displayName);
    const session = await store.createBrowserSessionForUser(user, config.appSessionTtlHours);
    sendJson(request, response, 201, { ok: true, user: session.user, expiresAt: session.expiresAt }, {
      "set-cookie": sessionCookie(session.sessionToken, config.appSessionTtlHours * 60 * 60)
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/auth/register") {
    ensureTrustedOrigin(request);
    enforceRateLimit(`password-register:${clientAddress(request)}`, Math.max(3, Math.floor(config.rateLimitMaxRequests / 10)));
    const body = await readJsonBody(request);
    let created;
    try {
      created = await store.createPasswordUser(
        requiredString(body, "username", 120),
        requiredString(body, "password", 1000),
        optionalString(body, "displayName", 120)
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create account.";
      throw new HttpError(message.includes("taken") ? 409 : 400, message);
    }
    const session = await store.createBrowserSessionForUser(created.user, config.appSessionTtlHours);
    sendJson(request, response, 201, { ok: true, user: session.user, expiresAt: session.expiresAt }, {
      "set-cookie": sessionCookie(session.sessionToken, config.appSessionTtlHours * 60 * 60)
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/auth/session") {
    ensureTrustedOrigin(request);
    enforceRateLimit(`browser-login:${clientAddress(request)}`, Math.max(5, Math.floor(config.rateLimitMaxRequests / 6)));
    const body = await readJsonBody(request);
    const session = await store.createBrowserSession(requiredString(body, "accessToken", 512), config.appSessionTtlHours);
    if (!session) throw new HttpError(401, "Sign in failed.");
    sendJson(request, response, 201, { ok: true, user: session.user, expiresAt: session.expiresAt }, {
      "set-cookie": sessionCookie(session.sessionToken, config.appSessionTtlHours * 60 * 60)
    });
    return;
  }

  if (request.method === "DELETE" && url.pathname === "/v1/auth/session") {
    ensureTrustedOrigin(request);
    const sessionToken = readCookie(request, "app_session");
    if (sessionToken) await store.deleteBrowserSession(sessionToken);
    sendJson(request, response, 200, { ok: true }, { "set-cookie": sessionCookie("", 0) });
    return;
  }

  if (await serveFrontendAsset(request, response, url.pathname)) return;

  const user = await requireUser(request);
  enforceRateLimit(`api:${user.id}:${clientAddress(request)}`, config.rateLimitMaxRequests);
  if (request.method !== "GET" && request.method !== "HEAD") ensureTrustedOrigin(request);

  if (request.method === "GET" && url.pathname === "/v1/me") {
    sendJson(request, response, 200, { ok: true, user });
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/telegram/login/start") {
    enforceRateLimit(`telegram-login:${user.id}`, config.loginStartRateLimitMax);
    const body = await readJsonBody(request);
    const credentials = telegramApiCredentialsFromBody(body);
    const phone = normalizePhoneFromBody(body);
    let start;
    try {
      start = await beginTelegramLogin(credentials, phone);
    } catch (error) {
      throw telegramLoginError(error);
    }
    const challenge = await store.createLoginChallenge(
      user.id,
      credentials.apiId,
      credentials.apiHash,
      phone,
      start.phoneCodeHash,
      start.sessionString,
      config.loginChallengeTtlMinutes
    );
    sendJson(request, response, 202, {
      ok: true,
      challengeId: challenge.id,
      expiresAt: challenge.expiresAt,
      codeDelivery: start.codeDelivery
    });
    return;
  }

  const codeChallengeId = challengeIdFromPath(url.pathname, "code");
  if (request.method === "POST" && codeChallengeId) {
    const body = await readJsonBody(request);
    const challenge = await store.getLoginChallenge(user.id, codeChallengeId);
    if (!challenge || challenge.status !== "code_sent") throw new HttpError(404, "Active login challenge was not found.");
    const credentials = { apiId: challenge.telegramApiId, apiHash: challenge.telegramApiHash };
    let result;
    try {
      result = await completeTelegramLoginWithCode(credentials, {
        sessionString: challenge.sessionString,
        phone: challenge.phone,
        phoneCodeHash: challenge.phoneCodeHash,
        code: requiredString(body, "code", 16)
      });
    } catch (error) {
      throw telegramLoginError(error);
    }
    if (result.kind === "password_required") {
      await store.markPasswordRequired(user.id, challenge.id, result.sessionString);
      sendJson(request, response, 202, { ok: true, status: "password_required", challengeId: challenge.id });
      return;
    }
    const account = await store.saveTelegramAccount(user.id, {
      telegramApiId: credentials.apiId,
      telegramApiHash: credentials.apiHash,
      ...result.profile,
      sessionString: result.sessionString
    });
    void startTelegramListener({
      ...account,
      telegramApiId: credentials.apiId,
      telegramApiHash: credentials.apiHash,
      sessionString: result.sessionString
    });
    await store.deleteLoginChallenge(user.id, challenge.id);
    sendJson(request, response, 201, { ok: true, status: "connected", account });
    return;
  }

  const passwordChallengeId = challengeIdFromPath(url.pathname, "password");
  if (request.method === "POST" && passwordChallengeId) {
    const body = await readJsonBody(request);
    const challenge = await store.getLoginChallenge(user.id, passwordChallengeId);
    if (!challenge || challenge.status !== "password_required") throw new HttpError(404, "Password login challenge was not found.");
    const credentials = { apiId: challenge.telegramApiId, apiHash: challenge.telegramApiHash };
    let result;
    try {
      result = await completeTelegramLoginWithPassword(
        credentials,
        challenge.sessionString,
        requiredString(body, "password", 1000)
      );
    } catch (error) {
      throw telegramLoginError(error);
    }
    const account = await store.saveTelegramAccount(user.id, {
      telegramApiId: credentials.apiId,
      telegramApiHash: credentials.apiHash,
      ...result.profile,
      sessionString: result.sessionString
    });
    void startTelegramListener({
      ...account,
      telegramApiId: credentials.apiId,
      telegramApiHash: credentials.apiHash,
      sessionString: result.sessionString
    });
    await store.deleteLoginChallenge(user.id, challenge.id);
    sendJson(request, response, 201, { ok: true, status: "connected", account });
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/telegram/accounts") {
    sendJson(request, response, 200, { ok: true, accounts: await store.listAccounts(user.id) });
    return;
  }

  const accountId = accountIdFromPath(url.pathname);
  if (request.method === "DELETE" && accountId) {
    const account = await store.deleteAccount(user.id, accountId);
    if (!account) throw new HttpError(404, "Telegram account was not found.");
    await stopTelegramListener(account.id);
    try {
      await revokeTelegramSession(telegramApiCredentialsFromAccount(account), account.sessionString);
    } catch {
      // Local ownership is removed even if Telegram is temporarily unavailable.
    }
    sendJson(request, response, 200, { ok: true, status: "disconnected" });
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/messages") {
    const body = await readJsonBody(request);
    const account = await store.getAccountWithSession(user.id, requiredString(body, "accountId", 64));
    if (!account) throw new HttpError(404, "Telegram account was not found.");
    enforceRateLimit(`message:${user.id}:${account.id}`, config.messageRateLimitMax);
    const recipient = requiredString(body, "recipient", 256);
    const text = requiredString(body, "message", 50000);
    const mediaUrl = optionalString(body, "mediaUrl", 900000);
    const mediaType = optionalString(body, "mediaType", 32);
    let sent;
    try {
      sent = await sendTelegramMessage(telegramApiCredentialsFromAccount(account), account.sessionString, {
        recipient,
        message: text,
        mediaUrl,
        mediaType,
        firstName: optionalString(body, "firstName", 120),
        lastName: optionalString(body, "lastName", 120)
      });
    } catch (error) {
      throw telegramSendError(error);
    }
    void startTelegramListener(account);
    const message = await store.recordMessage({
      accountId: account.id,
      direction: "outbound",
      recipient: sent.recipient,
      text,
      telegramMessageId: sent.messageId
    });
    sendJson(request, response, 200, { ok: true, sent, message });
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/messages") {
    const accountId = url.searchParams.get("accountId") ?? "";
    if (!accountId) throw new HttpError(400, "accountId is required.");
    const requestedLimit = Number(url.searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 50;
    const account = await store.getAccountWithSession(user.id, accountId);
    if (!account) throw new HttpError(404, "Telegram account was not found.");
    void startTelegramListener(account);

    const existingMessages = await store.listMessages(user.id, accountId, limit);
    const syncMode = url.searchParams.get("sync") ?? "";
    if (syncMode === "1" || syncMode === "force") {
      const targets = recentHistorySyncTargets(url.searchParams.getAll("recipient"), existingMessages);
      await syncRecentTelegramHistory(account, targets, syncMode === "force");
    }

    sendJson(request, response, 200, { ok: true, messages: await store.listMessages(user.id, accountId, limit) });
    return;
  }

  throw new HttpError(404, "Route not found.");
}

async function main() {
  config = readConfig();
  configuredLoginUsers = readConfiguredLoginUsers();
  store = new MultiUserStore(config.dataDir, config.sessionEncryptionKey);
  limiter = new RequestRateLimiter(config.rateLimitWindowSeconds * 1_000);

  await store.initialize();
  const server = createServer((request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      const operational = operationalTelegramError(error);
      const known = error instanceof HttpError;
      const linkedElsewhere = error instanceof AccountAlreadyLinkedError;
      if (!known && !linkedElsewhere && !operational) console.error("Request failed without logging request data.");
      sendJson(request, response, known ? error.status : linkedElsewhere ? 409 : operational ? operational.status : 500, {
        ok: false,
        error: known || linkedElsewhere ? error.message : operational ? operational.message : "Internal server error."
      });
    });
  });
  server.listen(config.servicePort, config.serviceHost, () => {
    console.log(`Telegram multi-user API listening on http://${config.serviceHost}:${config.servicePort}`);
    void startStoredTelegramListeners();
  });

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    server.close();
    await stopAllTelegramListeners();
    await store.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

main().catch((error: unknown) => {
  console.error(`Server startup failed: ${redactedErrorMessage(error)}`);
  process.exitCode = 1;
});
