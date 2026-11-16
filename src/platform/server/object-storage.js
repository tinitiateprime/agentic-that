// Private media storage on Hetzner Object Storage (S3-compatible). Posts'
// photos and videos and scraping files are kept here, never public:
//  - browsers upload straight to the bucket with short-lived signed PUT links;
//  - the website reads, sizes and deletes objects with its own credentials;
//  - the Companion downloads through AgenticThat links (signed by the website,
//    valid as long as a scheduled post needs them) that redirect to a
//    short-lived signed GET link on the bucket.
// Requests are signed with AWS Signature Version 4, which Hetzner supports.

import crypto from "node:crypto";

const SERVICE = "s3";
const MAX_PRESIGN_SECONDS = 7 * 24 * 60 * 60;

/** The bucket settings from the environment, or null when they're missing. */
export function objectStorageConfiguration(environment = process.env) {
  const endpoint = String(environment.MEDIA_S3_ENDPOINT || "").trim().replace(/\/$/, "");
  const bucket = String(environment.MEDIA_S3_BUCKET || "").trim();
  const accessKeyId = String(environment.MEDIA_S3_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(environment.MEDIA_S3_SECRET_ACCESS_KEY || "").trim();
  const region = String(environment.MEDIA_S3_REGION || "").trim() || "us-east-1";
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  const url = new URL(endpoint);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("MEDIA_S3_ENDPOINT must use HTTPS.");
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error("MEDIA_S3_BUCKET is not a valid bucket name.");
  return { endpoint: url.origin, bucket, accessKeyId, secretAccessKey, region };
}

export function requireObjectStorage(environment = process.env) {
  const configuration = objectStorageConfiguration(environment);
  if (!configuration) {
    throw new Error("Private media storage isn't set up: MEDIA_S3_ENDPOINT, MEDIA_S3_BUCKET, MEDIA_S3_ACCESS_KEY_ID and MEDIA_S3_SECRET_ACCESS_KEY are required.");
  }
  return configuration;
}

// ---- Signature Version 4 ------------------------------------------------------------------

const sha256Hex = (value) => crypto.createHash("sha256").update(value).digest("hex");
const hmac = (key, value) => crypto.createHmac("sha256", key).update(value).digest();

/** RFC 3986 encoding, as S3 expects it. */
function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** "workspace/file.jpg.parts/0001" → "/bucket/workspace/file.jpg.parts/0001" (path-style, each segment encoded). */
function objectPath(configuration, key) {
  const clean = String(key || "");
  if (!clean || clean.startsWith("/") || clean.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("The private media storage path is invalid.");
  }
  return `/${configuration.bucket}/${clean.split("/").map(encodeRfc3986).join("/")}`;
}

function amzDates(now = new Date()) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function signingKey(configuration, dateStamp) {
  const dateKey = hmac(`AWS4${configuration.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, configuration.region);
  const serviceKey = hmac(regionKey, SERVICE);
  return hmac(serviceKey, "aws4_request");
}

function canonicalQuery(params) {
  return Object.keys(params).sort().map((name) => `${encodeRfc3986(name)}=${encodeRfc3986(String(params[name]))}`).join("&");
}

/** A signed link anyone holding it can use until it expires (no credentials needed). */
export function presignObjectUrl(configuration, method, key, { expiresIn = 3600, now = new Date(), query = {} } = {}) {
  const seconds = Math.max(1, Math.min(MAX_PRESIGN_SECONDS, Math.floor(expiresIn)));
  const { amzDate, dateStamp } = amzDates(now);
  const host = new URL(configuration.endpoint).host;
  const path = objectPath(configuration, key);
  const scope = `${dateStamp}/${configuration.region}/${SERVICE}/aws4_request`;
  const params = {
    ...query,
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${configuration.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(seconds),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalRequest = [method, path, canonicalQuery(params), `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = crypto.createHmac("sha256", signingKey(configuration, dateStamp)).update(stringToSign).digest("hex");
  return `${configuration.endpoint}${path}?${canonicalQuery(params)}&X-Amz-Signature=${signature}`;
}

/** A request signed with the website's credentials (Authorization header). */
async function signedFetch(configuration, method, key, { body, headers = {}, query = {}, fetchImplementation = fetch } = {}) {
  const { amzDate, dateStamp } = amzDates();
  const host = new URL(configuration.endpoint).host;
  const path = key === null ? `/${configuration.bucket}` : objectPath(configuration, key);
  const payload = body === undefined ? "" : body;
  const payloadHash = sha256Hex(typeof payload === "string" ? payload : Buffer.from(payload));
  const allHeaders = { ...headers, host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const names = Object.keys(allHeaders).map((name) => name.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(allHeaders).map(([name, value]) => [name.toLowerCase(), String(value).trim()]));
  const signedHeaders = names.join(";");
  const scope = `${dateStamp}/${configuration.region}/${SERVICE}/aws4_request`;
  const canonicalRequest = [method, path, canonicalQuery(query), names.map((name) => `${name}:${lower[name]}\n`).join(""), signedHeaders, payloadHash].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = crypto.createHmac("sha256", signingKey(configuration, dateStamp)).update(stringToSign).digest("hex");
  const requestHeaders = { ...Object.fromEntries(Object.entries(lower).filter(([name]) => name !== "host")), authorization: `AWS4-HMAC-SHA256 Credential=${configuration.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
  const queryString = canonicalQuery(query);
  return fetchImplementation(`${configuration.endpoint}${path}${queryString ? `?${queryString}` : ""}`, { method, headers: requestHeaders, body: body === undefined ? undefined : body, cache: "no-store" });
}

async function storageError(response, fallback) {
  const text = await response.text().catch(() => "");
  const code = text.match(/<Code>([^<]+)<\/Code>/)?.[1];
  const message = text.match(/<Message>([^<]+)<\/Message>/)?.[1];
  return new Error(message || code ? `${fallback} (${[code, message].filter(Boolean).join(": ")})` : `${fallback} (${response.status})`);
}

// ---- Objects ------------------------------------------------------------------------------

export async function putObject(configuration, key, bytes, contentType = "application/octet-stream", options = {}) {
  const response = await signedFetch(configuration, "PUT", key, { body: bytes, headers: { "content-type": contentType || "application/octet-stream" }, ...options });
  if (!response.ok) throw await storageError(response, "Private media upload failed");
}

/** The object's size in bytes, or null when it doesn't exist. */
export async function objectSize(configuration, key, options = {}) {
  const response = await signedFetch(configuration, "HEAD", key, options);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Private media check failed (${response.status}).`);
  const size = Number(response.headers.get("content-length"));
  return Number.isInteger(size) ? size : null;
}

/** The object's bytes (or a byte range of it: { start, end } inclusive). */
export async function getObject(configuration, key, range = null, options = {}) {
  const headers = range ? { range: `bytes=${range.start}-${range.end}` } : {};
  const response = await signedFetch(configuration, "GET", key, { headers, ...options });
  if (!response.ok) throw new Error(`Private media could not be read (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(configuration, key, options = {}) {
  const response = await signedFetch(configuration, "DELETE", key, options);
  if (!response.ok && response.status !== 404) throw await storageError(response, "Private media could not be removed");
}

/** Lets browsers on these sites upload straight to the bucket (set once). */
export async function setBucketCors(configuration, origins, options = {}) {
  const rules = `<CORSConfiguration><CORSRule>${origins.map((origin) => `<AllowedOrigin>${origin}</AllowedOrigin>`).join("")}<AllowedMethod>PUT</AllowedMethod><AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule></CORSConfiguration>`;
  const md5 = crypto.createHash("md5").update(rules).digest("base64");
  const response = await signedFetch(configuration, "PUT", null, { body: rules, headers: { "content-type": "application/xml", "content-md5": md5 }, query: { cors: "" }, ...options });
  if (!response.ok) throw await storageError(response, "The bucket's upload permissions couldn't be set");
}

// ---- AgenticThat download links --------------------------------------------------------------

function linkSecret(configuration, environment = process.env) {
  return String(environment.MEDIA_URL_SIGNING_SECRET || "").trim() || `media-link:${configuration.secretAccessKey}`;
}

/** A token for one object, valid until `expiresAt` (ms). Verified by the website before it redirects. */
export function signMediaToken(configuration, key, expiresAt, environment = process.env) {
  const payload = Buffer.from(JSON.stringify({ k: key, e: Math.floor(expiresAt / 1000) })).toString("base64url");
  const signature = crypto.createHmac("sha256", linkSecret(configuration, environment)).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

/** The object key a token is for, or null if it's forged, for another object, or expired. */
export function verifyMediaToken(configuration, token, key, environment = process.env, now = Date.now()) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return null;
  const expected = crypto.createHmac("sha256", linkSecret(configuration, environment)).update(payload).digest("base64url");
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) return null;
  try {
    const { k, e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (k !== key || !Number.isFinite(e) || e * 1000 < now) return null;
    return k;
  } catch {
    return null;
  }
}
