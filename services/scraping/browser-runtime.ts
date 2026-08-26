import { existsSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser } from "playwright-core";

export type ScrapingBrowserRuntime = "local" | "serverless";

const localBrowserArgs = [
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--no-sandbox",
];

export function scrapingBrowserLaunchArgs(
  runtime: ScrapingBrowserRuntime,
  serverlessArgs: readonly string[] = [],
) {
  const selected = runtime === "serverless" ? [...serverlessArgs, ...localBrowserArgs] : localBrowserArgs;
  return [...new Set(selected)];
}

export function localChromeCandidates(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
) {
  if (platform === "win32") {
    const roots = [
      environment.PROGRAMFILES,
      environment["PROGRAMFILES(X86)"],
      environment.LOCALAPPDATA,
    ].filter((value): value is string => Boolean(value));
    return roots.flatMap(root => [
      path.join(root, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
    ]);
  }
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
  }
  return [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
}

export function resolveLocalChromeExecutable(options: {
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  exists?: (candidate: string) => boolean;
} = {}) {
  const environment = options.environment || process.env;
  const exists = options.exists || existsSync;
  const configured = environment.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || environment.CHROME_EXECUTABLE_PATH;
  if (configured && exists(configured)) return configured;
  return localChromeCandidates(options.platform || process.platform, environment).find(exists) || null;
}

async function resolveLaunchPlan() {
  const localExecutable = resolveLocalChromeExecutable();
  if (localExecutable) {
    return {
      executablePath: localExecutable,
      args: scrapingBrowserLaunchArgs("local"),
    };
  }

  const serverlessChromium = (await import("@sparticuz/chromium")).default;
  return {
    executablePath: await serverlessChromium.executablePath(),
    args: scrapingBrowserLaunchArgs("serverless", serverlessChromium.args),
  };
}

export async function launchScrapingBrowser(): Promise<Browser> {
  const plan = await resolveLaunchPlan();
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await chromium.launch({ ...plan, headless: true });
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 600));
    }
  }
  throw lastError;
}

export function recoverableBrowserRuntimeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /browser.*(?:closed|disconnected)|Target page, context or browser has been closed|newContext|ECONNRESET|ERR_CONNECTION|navigation.*timeout/i.test(message);
}

export function operationalBrowserError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Unexpected browser error.");
  const lines = message.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const firstLine = lines[0] || "Unexpected browser error.";
  const browserStderr = lines.filter(line => /\]\[err\]/i.test(line)).slice(-3);
  let summary = `${error instanceof Error ? error.name : "Error"}: ${firstLine}`;
  if (browserStderr.length) summary += ` | ${browserStderr.join(" | ")}`;

  const secretNames = [
    "AUTOMATION_INTERNAL_TOKEN",
    "CREDENTIAL_ENCRYPTION_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "SERVICE_TOKEN_PRIVATE_KEY",
    "SESSION_ENCRYPTION_KEY",
    "TELEGRAM_API_HASH",
    "USER_PROVISIONING_KEY",
  ];
  for (const name of secretNames) {
    const value = process.env[name]?.trim();
    if (value && value.length > 3) summary = summary.split(value).join(`[${name} redacted]`);
  }
  summary = summary
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[credentials-redacted]@")
    .replace(/(--(?:password|proxy-server|secret|token|key)=)[^\s]+/gi, "$1[redacted]");
  return summary.slice(0, 600);
}
