import crypto from "node:crypto";
import { getDatabaseSql } from "../../../lib/database-document-store.js";

const MAX_REQUEST_BYTES = 1024 * 1024;
const MEDIA_PREFIX = "/storage/v1/object/sign/job-artifacts/";
const METHODS = {
  companion_redeem_pairing: ["p_pairing_code", "p_instance_id", "p_version", "p_platform", "p_architecture", "p_secure_storage"],
  companion_heartbeat: ["p_token", "p_instance_id", "p_version", "p_runtime_status", "p_update_status", "p_last_error", "p_platform", "p_architecture", "p_secure_storage", "p_accounts"],
  companion_claim_jobs: ["p_token", "p_instance_id", "p_limit"],
  companion_update_job: ["p_token", "p_instance_id", "p_job_id", "p_status", "p_progress", "p_message", "p_retry", "p_result", "p_error", "p_final_action"],
};

class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function companionDatabaseApiEnabled(environment = process.env) {
  return environment.COMPANION_RPC_TRANSPORT === "postgres";
}

function origin(value) {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:"))
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("A plain HTTPS origin is required.");
  }
  return url.origin;
}

function apiOrigins(environment) {
  const website = origin(environment.PLATFORM_PUBLIC_URL);
  const storage = origin(environment.NEXT_PUBLIC_SUPABASE_URL || environment.SUPABASE_URL);
  if (website === storage) throw new Error("Companion API and media storage must have different origins.");
  return { website, storage };
}

export function companionPairingConfiguration(configuration, environment = process.env) {
  if (!companionDatabaseApiEnabled(environment)) return configuration;
  return { ...configuration, supabaseUrl: apiOrigins(environment).website };
}

function response(value, status = 200) {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

function publicApiKey(environment) {
  return environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || environment.SUPABASE_PUBLISHABLE_KEY
    || environment.NEXT_PUBLIC_SUPABASE_ANON_KEY || environment.SUPABASE_ANON_KEY || "";
}

function matchingApiKey(request, environment) {
  const expected = Buffer.from(publicApiKey(environment));
  const actual = Buffer.from(request.headers.get("apikey") || "");
  return expected.length > 0 && expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function inputObject(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) {
    throw new RequestError(415, "Send a JSON Companion request.");
  }
  if (Number(request.headers.get("content-length")) > MAX_REQUEST_BYTES) throw new RequestError(413, "Companion request is too large.");
  const reader = request.body?.getReader();
  let size = 0;
  const chunks = [];
  try {
    if (reader) while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new RequestError(413, "Companion request is too large.");
      }
      chunks.push(value);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, "The Companion request must be a JSON object.");
  } finally { reader?.releaseLock(); }
}

function text(input, name, fallback = null, minimum = 0, maximum = 2000) {
  const value = input[name];
  if (value == null && minimum === 0) return fallback;
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) {
    throw new RequestError(400, `Invalid ${name}.`);
  }
  return value;
}

function flag(input, name) {
  if (input[name] == null) return false;
  if (typeof input[name] !== "boolean") throw new RequestError(400, `Invalid ${name}.`);
  return input[name];
}

function json(input, name, fallback) {
  const value = input[name] ?? fallback;
  if (value !== null && (typeof value !== "object" || Array.isArray(value))) throw new RequestError(400, `Invalid ${name}.`);
  return value;
}

export function validateCompanionRpc(name, input) {
  if (!Object.hasOwn(METHODS, name)) throw new RequestError(404, "Unknown Companion operation.");
  if (Object.keys(input).some((key) => !METHODS[name].includes(key))) throw new RequestError(400, "Unknown Companion request parameter.");
  const result = { p_instance_id: text(input, "p_instance_id", null, 8, 120) };
  if (name === "companion_redeem_pairing") {
    result.p_pairing_code = text(input, "p_pairing_code", null, 32, 256);
  } else {
    result.p_token = text(input, "p_token", null, 32, 512);
  }
  if (name === "companion_redeem_pairing" || name === "companion_heartbeat") {
    for (const key of ["p_version", "p_platform", "p_architecture"]) result[key] = text(input, key, null, 0, 120);
    result.p_secure_storage = flag(input, "p_secure_storage");
  }
  if (name === "companion_heartbeat") {
    result.p_runtime_status = text(input, "p_runtime_status", "ready", 0, 80);
    result.p_update_status = text(input, "p_update_status", "idle", 0, 80);
    result.p_last_error = text(input, "p_last_error");
    result.p_accounts = input.p_accounts ?? [];
    if (!Array.isArray(result.p_accounts) || result.p_accounts.length > 250
        || result.p_accounts.some((account) => !account || typeof account !== "object" || Array.isArray(account))) {
      throw new RequestError(400, "Invalid Companion account inventory.");
    }
  }
  if (name === "companion_claim_jobs") {
    result.p_limit = input.p_limit ?? 1;
    if (!Number.isInteger(result.p_limit) || result.p_limit < 1 || result.p_limit > 5) throw new RequestError(400, "Invalid job limit.");
  }
  if (name === "companion_update_job") {
    result.p_job_id = text(input, "p_job_id", null, 1, 240);
    result.p_status = text(input, "p_status", null, 1, 80);
    result.p_progress = json(input, "p_progress", {});
    result.p_message = text(input, "p_message");
    result.p_retry = flag(input, "p_retry");
    result.p_result = json(input, "p_result", null);
    result.p_error = json(input, "p_error", null);
    result.p_final_action = flag(input, "p_final_action");
  }
  return result;
}

export async function executeCompanionRpc(sql, name, input) {
  let rows;
  switch (name) {
    case "companion_redeem_pairing":
      rows = await sql`SELECT public.companion_redeem_pairing(${input.p_pairing_code}::text, ${input.p_instance_id}::text, ${input.p_version}::text, ${input.p_platform}::text, ${input.p_architecture}::text, ${input.p_secure_storage}::boolean) AS result`;
      break;
    case "companion_heartbeat":
      rows = await sql`SELECT public.companion_heartbeat(${input.p_token}::text, ${input.p_instance_id}::text, ${input.p_version}::text, ${input.p_runtime_status}::text, ${input.p_update_status}::text, ${input.p_last_error}::text, ${input.p_platform}::text, ${input.p_architecture}::text, ${input.p_secure_storage}::boolean, ${sql.json(input.p_accounts)}::jsonb) AS result`;
      break;
    case "companion_claim_jobs":
      rows = await sql`SELECT public.companion_claim_jobs(${input.p_token}::text, ${input.p_instance_id}::text, ${input.p_limit}::integer) AS result`;
      break;
    case "companion_update_job":
      rows = await sql`SELECT public.companion_update_job(${input.p_token}::text, ${input.p_instance_id}::text, ${input.p_job_id}::text, ${input.p_status}::text, ${sql.json(input.p_progress)}::jsonb, ${input.p_message}::text, ${input.p_retry}::boolean, ${input.p_result === null ? null : sql.json(input.p_result)}::jsonb, ${input.p_error === null ? null : sql.json(input.p_error)}::jsonb, ${input.p_final_action}::boolean) AS result`;
      break;
    default: throw new RequestError(404, "Unknown Companion operation.");
  }
  return rows[0]?.result ?? null;
}

export function companionDownloadUrls(value, environment = process.env, depth = 0) {
  if (depth > 25 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => companionDownloadUrls(item, environment, depth + 1));
  const { website, storage } = apiOrigins(environment);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (key === "downloadUrl" && typeof item === "string") {
      try {
        const url = new URL(item);
        if (url.origin === storage && url.pathname.startsWith(MEDIA_PREFIX) && url.searchParams.has("token")) {
          return [key, `${website}${url.pathname}${url.search}`];
        }
      } catch { /* Non-URL fields are returned without modification. */ }
    }
    return [key, companionDownloadUrls(item, environment, depth + 1)];
  }));
}

export async function handleCompanionRpc(request, name, { environment = process.env, sqlFactory = getDatabaseSql } = {}) {
  if (!companionDatabaseApiEnabled(environment)) return response({ message: "Companion database API is disabled." }, 404);
  if (!Object.hasOwn(METHODS, name)) return response({ message: "Unknown Companion operation." }, 404);
  if (!matchingApiKey(request, environment)) return response({ message: "Invalid Companion API key." }, 401);
  try {
    const input = validateCompanionRpc(name, await inputObject(request));
    const result = await executeCompanionRpc(await sqlFactory(), name, input);
    return response(name === "companion_claim_jobs" ? companionDownloadUrls(result, environment) : result);
  } catch (error) {
    if (error instanceof RequestError) return response({ message: error.message }, error.status);
    const errors = {
      "28000": [401, "This Companion pairing is invalid, expired, or belongs to another installation."],
      "42501": [403, "This Companion no longer holds the job lease."],
      P0002: [404, "This Companion job was not found."],
      "22023": [400, "The Companion job request is invalid."],
      "55000": [409, "Update Companion to the required version before continuing."],
    };
    if (errors[error.code]) return response({ message: errors[error.code][1] }, errors[error.code][0]);
    console.error("Companion database request failed", { code: error.code || "UNEXPECTED_ERROR" });
    return response({ message: "Companion database is temporarily unavailable." }, 503);
  }
}

export async function handleCompanionMedia(request, { environment = process.env, fetchImplementation = fetch } = {}) {
  if (!companionDatabaseApiEnabled(environment)) return response({ message: "Companion database API is disabled." }, 404);
  try {
    const url = new URL(request.url);
    const path = url.pathname.slice(MEDIA_PREFIX.length);
    if (!url.pathname.startsWith(MEDIA_PREFIX) || path.length > 4096 || path.split("/").length < 2
        || path.split("/").some((part) => { const decoded = decodeURIComponent(part); return !decoded || decoded === "." || decoded === ".." || /[\\/\u0000-\u001f]/.test(decoded); })) {
      return response({ message: "Invalid private media path." }, 400);
    }
    const token = url.searchParams.get("token");
    if (!token || token.length > 16000 || [...url.searchParams.keys()].some((key) => !["token", "download"].includes(key))) {
      return response({ message: "A signed private media URL is required." }, 401);
    }
    const range = request.headers.get("range");
    if (range && !/^bytes=\d+-\d*$/.test(range)) return response({ message: "Invalid media range." }, 416);
    const destination = new URL(`${url.pathname}${url.search}`, apiOrigins(environment).storage);
    const upstream = await fetchImplementation(destination, {
      headers: range ? { range } : {}, redirect: "error", signal: AbortSignal.timeout(20000),
    });
    if (![200, 206].includes(upstream.status)) {
      await upstream.body?.cancel();
      return response({ message: "Private media download is unavailable." }, [400, 401, 403, 404].includes(upstream.status) ? upstream.status : 502);
    }
    const headers = new Headers({ "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
    for (const key of ["content-type", "content-length", "content-range", "accept-ranges", "etag"]) {
      if (upstream.headers.has(key)) headers.set(key, upstream.headers.get(key));
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return response({ message: "Private media download is temporarily unavailable." }, 502);
  }
}
