import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function enabled(value) {
  return TRUE_VALUES.has(String(value || "").trim().toLowerCase());
}

export function resolveAutomationServerBridgeConfig(environment = {}, developmentFallback = {}) {
  const production = String(environment.NODE_ENV || "").trim().toLowerCase() === "production";
  const value = (name) => String(environment[name] ?? (!production ? developmentFallback[name] : "") ?? "").trim();
  const explicitlyEnabled = value("SERVER_AUTOMATION_DASHBOARD_ENABLED");
  const bridgeEnabled = explicitlyEnabled
    ? enabled(explicitlyEnabled)
    : !production && enabled(value("SERVER_EXECUTION_ENABLED"));
  if (!bridgeEnabled) return null;

  const originValue = value("SERVER_AUTOMATION_ORIGIN")
    || `http://${value("SERVER_ARCHITECTURE_HOST") || "127.0.0.1"}:${value("SERVER_ARCHITECTURE_PORT") || "8800"}`;
  const origin = new URL(originValue);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("SERVER_AUTOMATION_ORIGIN must be a plain HTTP(S) origin without credentials or a path.");
  }
  const loopbackOrigin = ["127.0.0.1", "::1", "localhost"].includes(origin.hostname.toLowerCase());
  if (production && origin.protocol !== "https:" && !(origin.protocol === "http:" && loopbackOrigin)) {
    throw new Error("Production server automation requires HTTPS or a private loopback HTTP origin.");
  }
  const internalToken = value("SERVER_AUTOMATION_INTERNAL_TOKEN") || value("SERVER_ARCHITECTURE_INTERNAL_TOKEN");
  if (internalToken.length < 24) {
    throw new Error("Server automation dashboard integration requires an internal token of at least 24 characters.");
  }
  return { origin: origin.origin, internalToken };
}

function localDevelopmentFallback() {
  if (process.env.NODE_ENV === "production") return {};
  const environmentFile = path.join(process.cwd(), "services", "automation-server", ".env.local");
  if (!existsSync(environmentFile)) return {};
  return parse(readFileSync(environmentFile));
}

export function automationServerBridgeConfig() {
  return resolveAutomationServerBridgeConfig(process.env, localDevelopmentFallback());
}

export async function automationServerRequest(config, endpoint, init = {}) {
  if (!config || !endpoint.startsWith("/") || endpoint.startsWith("//")) {
    throw new Error("The server automation request path is invalid.");
  }
  const headers = new Headers(init.headers);
  headers.set("x-agenticthat-internal-token", config.internalToken);
  return fetch(`${config.origin}${endpoint}`, { ...init, headers, cache: "no-store" });
}
