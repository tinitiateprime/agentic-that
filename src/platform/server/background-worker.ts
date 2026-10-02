import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { validateBackgroundJob } from "../../../lib/background-jobs.js";

let configuration: Promise<void> | undefined;

async function configure() {
  const secretArn = process.env.SERVER_CONFIG_SECRET_ARN;
  if (!secretArn) throw new Error("SERVER_CONFIG_SECRET_ARN is required by the background worker.");
  const secrets = new SecretsManagerClient({});
  const secret = await secrets.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!secret.SecretString) throw new Error("The server configuration secret is empty.");
  const values = JSON.parse(secret.SecretString) as Record<string, unknown>;
  for (const [key, value] of Object.entries(values)) {
    if (/^[A-Z][A-Z0-9_]+$/.test(key) && !key.startsWith("AWS_") && typeof value === "string") process.env[key] = value;
  }
  process.env.SERVERLESS = "true";
  (process.env as Record<string, string | undefined>).NODE_ENV = "production";
  process.env.DATA_STORE = "postgres";
  process.env.RUN_DATABASE_MIGRATIONS = "false";
  process.env.PG_POOL_MAX = "1";
  process.env.PG_IDLE_TIMEOUT_SECONDS = "5";
}

export async function handler(event: unknown, context: { callbackWaitsForEmptyEventLoop: boolean }) {
  context.callbackWaitsForEmptyEventLoop = false;
  const job = validateBackgroundJob(event);
  configuration ||= configure().catch((error) => { configuration = undefined; throw error; });
  await configuration;
  switch (job.kind) {
    case "website-studio": {
      const { executeAutomatedWebsiteProject } = await import("./website-studio-store.js");
      await executeAutomatedWebsiteProject(job.jobId, job.jobToken);
      break;
    }
    case "growth-advisor": {
      const { executeGrowthAdvisorJob } = await import("../../../services/scraping/instagram/src/growth-advisor-jobs.ts");
      await executeGrowthAdvisorJob(job.jobId, { workspaceId: job.workspaceId, userId: job.userId });
      break;
    }
    case "instagram": {
      const { executeInstagramJob } = await import("../../../services/scraping/instagram/src/api.ts");
      await executeInstagramJob(job.jobId, job.workspaceId!);
      break;
    }
    case "facebook": {
      const { executeFacebookJob } = await import("../../../services/scraping/facebook/src/api.ts");
      await executeFacebookJob(job.jobId, job.workspaceId!);
    }
  }
  return { ok: true, jobId: job.jobId };
}
