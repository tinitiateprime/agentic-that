import path from "node:path";
import type { SocialPlatform } from "./contracts.ts";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const DEPLOYMENT_MODES = new Set(["development", "staging", "production"]);

export type AutomationDeploymentMode = "development" | "staging" | "production";

export type AutomationConfig = {
  deploymentMode: AutomationDeploymentMode;
  host: string;
  port: number;
  dataDirectory: string;
  databaseFile: string;
  internalToken: string;
  browserExecutablePath: string;
  loginTimeoutMs: number;
  executionEnabled: boolean;
  instagramPublishingEnabled: boolean;
  facebookPublishingEnabled: boolean;
  xPublishingEnabled: boolean;
  linkedinPublishingEnabled: boolean;
  youtubePublishingEnabled: boolean;
  loginEnabled: boolean;
  scrapingEnabled: boolean;
  publishingDryRunEnabled: boolean;
  publishingPreviewEnabled: boolean;
  workerPollMs: number;
  liveWorkerCount: number;
  mediaUploadMaxBytes: number;
  autoMigrate: boolean;
  allowPublicBind: boolean;
  profileStorageEncrypted: boolean;
  backupsConfigured: boolean;
  singleHostAcknowledged: boolean;
};

function enabled(value: string | undefined) {
  return TRUE_VALUES.has(String(value || "").trim().toLowerCase());
}

function deploymentMode(value: string | undefined): AutomationDeploymentMode {
  const normalized = String(value || "development").trim().toLowerCase();
  if (!DEPLOYMENT_MODES.has(normalized)) {
    throw new Error("SERVER_ARCHITECTURE_DEPLOYMENT must be development, staging, or production.");
  }
  return normalized as AutomationDeploymentMode;
}

function port(value: string | undefined) {
  const parsed = Number(value || 8800);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error("SERVER_ARCHITECTURE_PORT must be an integer between 1 and 65535.");
  }
  return parsed;
}

function loginTimeout(value: string | undefined) {
  const parsed = Number(value || 600_000);
  if (!Number.isInteger(parsed) || parsed < 60_000 || parsed > 1_800_000) {
    throw new Error("SERVER_LOGIN_TIMEOUT_MS must be between 60000 and 1800000 milliseconds.");
  }
  return parsed;
}

function workerPoll(value: string | undefined) {
  const parsed = Number(value || 2_000);
  if (!Number.isInteger(parsed) || parsed < 250 || parsed > 60_000) {
    throw new Error("SERVER_WORKER_POLL_MS must be between 250 and 60000 milliseconds.");
  }
  return parsed;
}

function liveWorkerCount(value: string | undefined) {
  const parsed = Number(value || 1);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) {
    throw new Error("SERVER_LIVE_WORKER_COUNT must be an integer between 1 and 8.");
  }
  return parsed;
}

function mediaUploadMaxBytes(value: string | undefined) {
  const parsed = Number(value || 10 * 1024 * 1024 * 1024);
  if (!Number.isSafeInteger(parsed) || parsed < 8 * 1024 * 1024 || parsed > 256 * 1024 * 1024 * 1024) {
    throw new Error("SERVER_MEDIA_UPLOAD_MAX_BYTES must be between 8 MB and 256 GB.");
  }
  return parsed;
}

export function loadAutomationConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): AutomationConfig {
  const runtimeDeployment = deploymentMode(env.SERVER_ARCHITECTURE_DEPLOYMENT);
  const allowPublicBind = enabled(env.SERVER_ARCHITECTURE_ALLOW_PUBLIC_BIND);
  const host = String(env.SERVER_ARCHITECTURE_HOST || "127.0.0.1").trim();
  if (!LOOPBACK_HOSTS.has(host) && !allowPublicBind) {
    throw new Error(
      "Refusing a public automation-server bind. Set SERVER_ARCHITECTURE_ALLOW_PUBLIC_BIND=true only in an intentionally secured environment.",
    );
  }
  const dataDirectory = path.resolve(cwd, env.SERVER_ARCHITECTURE_DATA_DIR?.trim() || ".server-data");
  const databaseFile = path.resolve(
    cwd,
    env.SERVER_ARCHITECTURE_DATABASE_FILE?.trim() || path.join(dataDirectory, "automation.db"),
  );
  const internalToken = env.SERVER_ARCHITECTURE_INTERNAL_TOKEN?.trim() || "";
  const browserExecutablePath = env.SERVER_BROWSER_EXECUTABLE_PATH?.trim() || "";
  const autoMigrate = enabled(env.SERVER_ARCHITECTURE_AUTO_MIGRATE);

  if (runtimeDeployment === "staging" || runtimeDeployment === "production") {
    if (!LOOPBACK_HOSTS.has(host) || allowPublicBind) {
      throw new Error(`${runtimeDeployment === "production" ? "Production" : "Staging"} must bind to loopback behind the website server.`);
    }
    if (internalToken.length < 32) {
      throw new Error(`${runtimeDeployment === "production" ? "Production" : "Staging"} requires SERVER_ARCHITECTURE_INTERNAL_TOKEN with at least 32 characters.`);
    }
    if (!env.SERVER_ARCHITECTURE_DATA_DIR?.trim() || !path.isAbsolute(env.SERVER_ARCHITECTURE_DATA_DIR.trim())) {
      throw new Error(`${runtimeDeployment === "production" ? "Production" : "Staging"} requires an absolute SERVER_ARCHITECTURE_DATA_DIR.`);
    }
    if (!env.SERVER_ARCHITECTURE_DATABASE_FILE?.trim() || !path.isAbsolute(env.SERVER_ARCHITECTURE_DATABASE_FILE.trim())) {
      throw new Error(`${runtimeDeployment === "production" ? "Production" : "Staging"} requires an absolute SERVER_ARCHITECTURE_DATABASE_FILE.`);
    }
    if (!autoMigrate) {
      throw new Error(`${runtimeDeployment === "production" ? "Production" : "Staging"} requires SERVER_ARCHITECTURE_AUTO_MIGRATE=true.`);
    }
    const browserFeaturesEnabled = enabled(env.SERVER_LOGIN_ENABLED)
      || enabled(env.SERVER_PUBLISHING_PREVIEW_ENABLED)
      || (enabled(env.SERVER_EXECUTION_ENABLED) && (enabled(env.SERVER_INSTAGRAM_PUBLISHING_ENABLED) || enabled(env.SERVER_FACEBOOK_PUBLISHING_ENABLED) || enabled(env.SERVER_X_PUBLISHING_ENABLED) || enabled(env.SERVER_LINKEDIN_PUBLISHING_ENABLED) || enabled(env.SERVER_YOUTUBE_PUBLISHING_ENABLED)));
    if (browserFeaturesEnabled && (!browserExecutablePath || !path.isAbsolute(browserExecutablePath))) {
      throw new Error(`${runtimeDeployment === "production" ? "Production" : "Staging"} browser features require an absolute SERVER_BROWSER_EXECUTABLE_PATH.`);
    }
  }
  const profileStorageEncrypted = enabled(env.SERVER_PROFILE_STORAGE_ENCRYPTED);
  const backupsConfigured = enabled(env.SERVER_BACKUPS_CONFIGURED);
  const singleHostAcknowledged = enabled(env.SERVER_SINGLE_HOST_ACKNOWLEDGED);
  if (runtimeDeployment === "production") {
    if (!singleHostAcknowledged) {
      throw new Error("Production single-host mode requires SERVER_SINGLE_HOST_ACKNOWLEDGED=true.");
    }
    if (!profileStorageEncrypted) {
      throw new Error("Production requires encrypted-at-rest profile storage and SERVER_PROFILE_STORAGE_ENCRYPTED=true.");
    }
    if (!backupsConfigured) {
      throw new Error("Production requires tested encrypted backups and SERVER_BACKUPS_CONFIGURED=true.");
    }
  }

  return {
    deploymentMode: runtimeDeployment,
    host,
    port: port(env.SERVER_ARCHITECTURE_PORT),
    dataDirectory,
    databaseFile,
    internalToken,
    browserExecutablePath,
    loginTimeoutMs: loginTimeout(env.SERVER_LOGIN_TIMEOUT_MS),
    executionEnabled: enabled(env.SERVER_EXECUTION_ENABLED),
    instagramPublishingEnabled: enabled(env.SERVER_INSTAGRAM_PUBLISHING_ENABLED),
    facebookPublishingEnabled: enabled(env.SERVER_FACEBOOK_PUBLISHING_ENABLED),
    xPublishingEnabled: enabled(env.SERVER_X_PUBLISHING_ENABLED),
    linkedinPublishingEnabled: enabled(env.SERVER_LINKEDIN_PUBLISHING_ENABLED),
    youtubePublishingEnabled: enabled(env.SERVER_YOUTUBE_PUBLISHING_ENABLED),
    loginEnabled: enabled(env.SERVER_LOGIN_ENABLED),
    scrapingEnabled: enabled(env.SERVER_SCRAPING_ENABLED),
    publishingDryRunEnabled: enabled(env.SERVER_PUBLISHING_DRY_RUN_ENABLED),
    publishingPreviewEnabled: enabled(env.SERVER_PUBLISHING_PREVIEW_ENABLED),
    workerPollMs: workerPoll(env.SERVER_WORKER_POLL_MS),
    liveWorkerCount: liveWorkerCount(env.SERVER_LIVE_WORKER_COUNT),
    mediaUploadMaxBytes: mediaUploadMaxBytes(env.SERVER_MEDIA_UPLOAD_MAX_BYTES),
    autoMigrate,
    allowPublicBind,
    profileStorageEncrypted,
    backupsConfigured,
    singleHostAcknowledged,
  };
}

export function isLoopbackHost(host: string) {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

export function publishingPlatformEnabled(config: AutomationConfig, platform: SocialPlatform) {
  if (!config.executionEnabled) return false;
  if (platform === "instagram") return config.instagramPublishingEnabled;
  if (platform === "facebook") return config.facebookPublishingEnabled;
  if (platform === "x") return config.xPublishingEnabled;
  if (platform === "linkedin") return config.linkedinPublishingEnabled;
  return config.youtubePublishingEnabled;
}

export function livePublishingEnabled(config: AutomationConfig) {
  return config.executionEnabled && (
    config.instagramPublishingEnabled
    || config.facebookPublishingEnabled
    || config.xPublishingEnabled
    || config.linkedinPublishingEnabled
    || config.youtubePublishingEnabled
  );
}
