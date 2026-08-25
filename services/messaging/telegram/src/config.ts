import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function parseEnvFile(envPath: string) {
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // First definition wins, so later (higher-precedence) files must be read first.
    process.env[key] ??= value;
  }
}

function loadEnvFiles() {
  // The service is launched with its own working directory, but the shared
  // credentials live in the monorepo root .env.local / .env. Walk from the
  // current directory up to the filesystem root so those files are picked up
  // regardless of where the process was started. .env.local takes precedence
  // over .env (matching Next.js), and closer directories win over ancestors.
  const dirs: string[] = [];
  let dir = process.cwd();
  while (true) {
    dirs.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const candidate of dirs) {
    parseEnvFile(path.join(candidate, ".env.local"));
    parseEnvFile(path.join(candidate, ".env"));
  }
}

loadEnvFiles();

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required. Add it to .env or the deployment environment.`);
  return value;
}

function optionalEnv(name: string, fallback = "") {
  return process.env[name]?.trim() || fallback;
}

function positiveInteger(name: string, fallback: number) {
  const value = Number(optionalEnv(name, String(fallback)));
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function requiredPositiveInteger(name: string) {
  const value = Number(requiredEnv(name));
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function booleanEnv(name: string, fallback: boolean) {
  const value = optionalEnv(name, String(fallback)).toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

export type AppConfig = {
  dataDir: string;
  sessionEncryptionKey: string;
  userProvisioningKey: string;
  serviceHost: string;
  servicePort: number;
  corsOrigin: string;
  loginChallengeTtlMinutes: number;
  appSessionTtlHours: number;
  sessionCookieSecure: boolean;
  rateLimitWindowSeconds: number;
  rateLimitMaxRequests: number;
  loginStartRateLimitMax: number;
  messageRateLimitMax: number;
  telegramApiId: number;
  telegramApiHash: string;
};

export type BotConfig = {
  telegramBotToken: string;
  botPollTimeoutSeconds: number;
  botAnswersPath: string;
  botFallbackReply: string;
  botResponderUrl: string;
  botResponderTimeoutSeconds: number;
  botClearWebhookOnStart: boolean;
};

export function readConfig(): AppConfig {
  const servicePort = process.env.SERVICE_PORT?.trim()
    ? positiveInteger("SERVICE_PORT", 8787)
    : positiveInteger("PORT", 8787);

  const telegramApiHash = requiredEnv("TELEGRAM_API_HASH");
  if (!/^[a-f0-9]{32}$/i.test(telegramApiHash)) {
    throw new Error("TELEGRAM_API_HASH must be the 32-character hash from my.telegram.org.");
  }

  return {
    dataDir: optionalEnv("DATA_DIR", "data"),
    sessionEncryptionKey: requiredEnv("SESSION_ENCRYPTION_KEY"),
    userProvisioningKey: requiredEnv("USER_PROVISIONING_KEY"),
    serviceHost: optionalEnv("SERVICE_HOST", "127.0.0.1"),
    servicePort,
    corsOrigin: optionalEnv("CORS_ORIGIN"),
    loginChallengeTtlMinutes: positiveInteger("LOGIN_CHALLENGE_TTL_MINUTES", 10),
    appSessionTtlHours: positiveInteger("APP_SESSION_TTL_HOURS", 24),
    sessionCookieSecure: booleanEnv("SESSION_COOKIE_SECURE", process.env.NODE_ENV === "production" || process.env.NETLIFY === "true"),
    rateLimitWindowSeconds: positiveInteger("RATE_LIMIT_WINDOW_SECONDS", 60),
    rateLimitMaxRequests: positiveInteger("RATE_LIMIT_MAX_REQUESTS", 120),
    loginStartRateLimitMax: positiveInteger("LOGIN_START_RATE_LIMIT_MAX", 5),
    messageRateLimitMax: positiveInteger("MESSAGE_RATE_LIMIT_MAX", 20),
    telegramApiId: requiredPositiveInteger("TELEGRAM_API_ID"),
    telegramApiHash
  };
}

export function readBotConfig(): BotConfig {
  const botResponderUrl = optionalEnv("BOT_RESPONDER_URL");
  if (botResponderUrl && !/^https?:\/\//i.test(botResponderUrl)) {
    throw new Error("BOT_RESPONDER_URL must be an http(s) URL.");
  }

  return {
    telegramBotToken: requiredEnv("TELEGRAM_BOT_TOKEN"),
    botPollTimeoutSeconds: positiveInteger("BOT_POLL_TIMEOUT_SECONDS", 25),
    botAnswersPath: optionalEnv("BOT_ANSWERS_PATH", "config/bot-answers.json"),
    botFallbackReply: optionalEnv(
      "BOT_FALLBACK_REPLY",
      "Thanks for your question. I do not have a saved answer for that yet. Please leave your contact details and our team will reply."
    ),
    
    botResponderUrl,
    botResponderTimeoutSeconds: positiveInteger("BOT_RESPONDER_TIMEOUT_SECONDS", 15),
    botClearWebhookOnStart: booleanEnv("BOT_CLEAR_WEBHOOK_ON_START", true)
  };
}
