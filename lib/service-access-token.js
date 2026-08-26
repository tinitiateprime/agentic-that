import crypto from "node:crypto";

const TOKEN_TTL_SECONDS = 5 * 60;
const DEV_SEED = crypto.createHash("sha256").update("agenticthat-development-service-token-key").digest();
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function envKey(value) {
  const normalized = String(value || "").replace(/\\n/g, "\n").trim();
  if (!normalized) return null;
  if (normalized.includes("BEGIN")) return normalized;
  return Buffer.from(normalized, "base64");
}

function importPrivateKey(configured) {
  return crypto.createPrivateKey(Buffer.isBuffer(configured)
    ? { key: configured, format: "der", type: "pkcs8" }
    : configured);
}

function importPublicKey(configured) {
  return crypto.createPublicKey(Buffer.isBuffer(configured)
    ? { key: configured, format: "der", type: "spki" }
    : configured);
}

function privateKey() {
  const configured = envKey(process.env.SERVICE_TOKEN_PRIVATE_KEY);
  if (configured) return importPrivateKey(configured);
  if (process.env.NODE_ENV === "production") {
    throw new Error("SERVICE_TOKEN_PRIVATE_KEY is required in production.");
  }
  return crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, DEV_SEED]),
    format: "der",
    type: "pkcs8",
  });
}

function publicKeys() {
  const configured = envKey(process.env.SERVICE_TOKEN_PUBLIC_KEY);
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("SERVICE_TOKEN_PUBLIC_KEY is required in production verifiers.");
  }
  const key = configured ? importPublicKey(configured) : crypto.createPublicKey(privateKey());
  return new Map([[process.env.SERVICE_TOKEN_KEY_ID?.trim() || "at-ed25519-v1", key]]);
}

function encodedJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodedJson(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

export function signServiceAccessToken({
  audience,
  subject,
  workspaceId,
  grants,
  capabilities = [],
  name = "",
  email = "",
  billingStatus = "",
  trialStartsAt = null,
  trialEndsAt = null,
}, ttlSeconds = TOKEN_TTL_SECONDS) {
  if (!audience || !subject || !workspaceId) throw new Error("Service token identity is incomplete.");
  const now = Math.floor(Date.now() / 1000);
  const kid = process.env.SERVICE_TOKEN_KEY_ID?.trim() || "at-ed25519-v1";
  const header = encodedJson({ alg: "EdDSA", typ: "JWT", kid });
  const payload = encodedJson({
    iss: process.env.SERVICE_TOKEN_ISSUER?.trim() || "agenticthat",
    aud: audience,
    sub: String(subject),
    workspaceId: String(workspaceId),
    grants: grants && typeof grants === "object" ? grants : {},
    capabilities: Array.isArray(capabilities) ? [...new Set(capabilities.map(String))] : [],
    name: String(name || ""),
    email: String(email || ""),
    billingStatus: String(billingStatus || ""),
    trialStartsAt: trialStartsAt ? String(trialStartsAt) : null,
    trialEndsAt: trialEndsAt ? String(trialEndsAt) : null,
    iat: now,
    exp: now + Math.max(60, Math.min(TOKEN_TTL_SECONDS, Number(ttlSeconds) || TOKEN_TTL_SECONDS)),
    jti: crypto.randomUUID(),
  });
  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign(null, Buffer.from(signingInput), privateKey()).toString("base64url");
  return `${signingInput}.${signature}`;
}

export function verifyServiceAccessToken(token, expectedAudience) {
  try {
    const [headerPart, payloadPart, signaturePart, extra] = String(token || "").split(".");
    if (!headerPart || !payloadPart || !signaturePart || extra) return null;
    if (
      Buffer.from(headerPart, "base64url").toString("base64url") !== headerPart ||
      Buffer.from(payloadPart, "base64url").toString("base64url") !== payloadPart ||
      Buffer.from(signaturePart, "base64url").toString("base64url") !== signaturePart
    ) return null;
    const header = decodedJson(headerPart);
    if (header.alg !== "EdDSA" || header.typ !== "JWT" || !header.kid) return null;
    const key = publicKeys().get(header.kid);
    if (!key) return null;
    const valid = crypto.verify(
      null,
      Buffer.from(`${headerPart}.${payloadPart}`),
      key,
      Buffer.from(signaturePart, "base64url"),
    );
    if (!valid) return null;
    const payload = decodedJson(payloadPart);
    const now = Math.floor(Date.now() / 1000);
    const issuer = process.env.SERVICE_TOKEN_ISSUER?.trim() || "agenticthat";
    if (
      payload.iss !== issuer ||
      payload.aud !== expectedAudience ||
      !payload.sub || !payload.workspaceId || !payload.jti ||
      !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) ||
      payload.iat > now + 30 || payload.exp <= now || payload.exp - payload.iat > TOKEN_TTL_SECONDS
    ) return null;
    return payload;
  } catch {
    return null;
  }
}

export function serviceTokenPublicKeyPem() {
  const configured = envKey(process.env.SERVICE_TOKEN_PUBLIC_KEY);
  const key = configured ? importPublicKey(configured) : crypto.createPublicKey(privateKey());
  return key.export({ format: "pem", type: "spki" }).toString();
}
