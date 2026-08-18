import crypto from "node:crypto";
import os from "node:os";

let cachedId = "";

export function publishingCompanionId() {
  if (cachedId) return cachedId;
  const configured = process.env.PUBLISHING_COMPANION_ID?.trim();
  if (configured) return (cachedId = configured);
  let username = process.env.USERNAME || process.env.USER || "local-user";
  try { username = os.userInfo().username || username; } catch { /* use the environment fallback */ }
  const localIdentity = `${os.hostname()}:${username}:${process.platform}`;
  cachedId = `companion_${crypto.createHash("sha256").update(localIdentity).digest("hex").slice(0, 20)}`;
  return cachedId;
}
