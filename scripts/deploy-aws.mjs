import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { parse } from "dotenv";
import { AmplifyClient, GetAppCommand, GetBranchCommand, UpdateAppCommand, UpdateBranchCommand, StartJobCommand, GetJobCommand } from "@aws-sdk/client-amplify";
import { CloudFormationClient, CreateStackCommand, UpdateStackCommand, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { SecretsManagerClient, PutSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { amplifyEnvironment, workerEnvironment } from "./amplify-environment.mjs";

const argument = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
const appId = argument("--app-id", "d21kcrps3tyzwx");
const branchName = argument("--branch", "main");
const region = argument("--region", "us-east-1");
if (!/^[a-z0-9]+$/.test(appId) || !/^[a-zA-Z0-9_-]+$/.test(branchName)) throw new Error("The app ID or branch name is invalid.");
const settings = { region };
const amplify = new AmplifyClient(settings);
const formation = new CloudFormationClient(settings);
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function deployStack(name, templatePath, values) {
  const input = { StackName: name, TemplateBody: await readFile(templatePath, "utf8"), Parameters: Object.entries(values).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue })), Capabilities: ["CAPABILITY_IAM"] };
  let present = true;
  try { await formation.send(new DescribeStacksCommand({ StackName: name })); }
  catch (error) { if (error.name === "ValidationError" && /does not exist/i.test(error.message)) present = false; else throw error; }
  try {
    await formation.send(present ? new UpdateStackCommand(input) : new CreateStackCommand(input));
  } catch (error) { if (!/No updates are to be performed/.test(error.message)) throw error; }
  for (;;) {
    const { Stacks } = await formation.send(new DescribeStacksCommand({ StackName: name }));
    const stack = Stacks[0];
    if (["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(stack.StackStatus)) return Object.fromEntries((stack.Outputs || []).map(item => [item.OutputKey, item.OutputValue]));
    if (/FAILED|ROLLBACK/.test(stack.StackStatus)) throw new Error(`${name}: ${stack.StackStatus}. Review its CloudFormation events.`);
    console.log(`${name}: ${stack.StackStatus}`);
    await sleep(15_000);
  }
}

try {
  await new STSClient(settings).send(new GetCallerIdentityCommand({}));
  const [{ app }, { branch }] = await Promise.all([
    amplify.send(new GetAppCommand({ appId })), amplify.send(new GetBranchCommand({ appId, branchName })),
  ]);
  const envFile = argument("--env-file", undefined);
  const source = { ...app.environmentVariables, ...branch.environmentVariables, ...(envFile ? parse(await readFile(envFile)) : {}) };
  const values = amplifyEnvironment(source);
  values.AUTH_RATE_LIMIT_PEPPER ||= randomBytes(32).toString("base64url");
  values.BACKGROUND_JOB_FUNCTION_NAME = `agenticthat-${appId}-${branchName}-jobs`;
  values.BACKGROUND_JOB_REGION = region;
  const checked = spawnSync(process.execPath, ["scripts/check-production-config.mjs", "--amplify"], { env: { ...process.env, ...values }, stdio: "inherit" });
  if (checked.status !== 0) throw new Error("Deployment stopped: complete the missing original server values first. No AWS resources were changed.");
  const databaseCheck = spawnSync(process.execPath, ["scripts/verify-database-security.mjs"], { env: { ...process.env, ...values }, stdio: "inherit" });
  if (databaseCheck.status !== 0) throw new Error("Deployment stopped: verify the existing Supabase migrations and permissions first. No AWS resources were changed.");
  const code = await readFile("artifacts/aws/background-worker.zip");
  if (process.argv.includes("--check")) {
    console.log(`AWS access and configuration verified for ${appId}/${branchName}; worker package is ready. No changes made.`);
    process.exit(0);
  }
  const bootstrap = await deployStack(`agenticthat-${appId}-bootstrap`, "infrastructure/aws-bootstrap.json", { AppId: appId });
  await new SecretsManagerClient(settings).send(new PutSecretValueCommand({ SecretId: bootstrap.ServerConfigSecretArn, SecretString: JSON.stringify(workerEnvironment(values)) }));
  const digest = createHash("sha256").update(code).digest("hex");
  const key = `workers/${digest}.zip`;
  await new S3Client(settings).send(new PutObjectCommand({ Bucket: bootstrap.ArtifactsBucket, Key: key, Body: code, ServerSideEncryption: "AES256" }));
  const worker = await deployStack(`agenticthat-${appId}-${branchName}-worker`, "infrastructure/aws-worker.json", {
    AppId: appId, Branch: branchName, ArtifactsBucket: bootstrap.ArtifactsBucket,
    WorkerCodeKey: key, ServerConfigSecretArn: bootstrap.ServerConfigSecretArn,
  });
  await amplify.send(new UpdateAppCommand({ appId, platform: "WEB_COMPUTE", buildSpec: await readFile("amplify.yml", "utf8") }));
  await amplify.send(new UpdateBranchCommand({ appId, branchName, framework: "Next.js - SSR", computeRoleArn: worker.ComputeRoleArn, environmentVariables: values }));
  await mkdir("artifacts/aws", { recursive: true });
  await writeFile("artifacts/aws/deployment.json", JSON.stringify({ appId, branchName, region, workerFunction: worker.WorkerFunctionName, failureQueue: worker.FailureQueueUrl }, null, 2));
  console.log("Worker and Amplify settings are configured. Server values were preserved; secret values are hidden.");
  if (!process.argv.includes("--release")) {
    console.log("Push the tested commit, then run npm run aws:deploy -- --release to build the main branch.");
    process.exit(0);
  }
  const { jobSummary } = await amplify.send(new StartJobCommand({ appId, branchName, jobType: "RELEASE" }));
  for (;;) {
    const { job } = await amplify.send(new GetJobCommand({ appId, branchName, jobId: jobSummary.jobId }));
    console.log(`Amplify deployment ${jobSummary.jobId}: ${job.summary.status}`);
    if (job.summary.status === "SUCCEED") break;
    if (["FAILED", "CANCELLED"].includes(job.summary.status)) throw new Error("Amplify deployment did not succeed; inspect its build logs.");
    await sleep(15_000);
  }
  const origin = values.PLATFORM_PUBLIC_URL || `https://${branchName}.${app.defaultDomain}`;
  const response = await fetch(`${origin.replace(/\/$/, "")}/health`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  const health = await response.json();
  if (!response.ok || health.provider !== "aws-amplify") throw new Error("The deployed health check did not confirm the AWS runtime.");
  console.log(`Deployment verified: ${origin}`);
} catch (error) {
  if (error.name === "CredentialsProviderError") console.error("AWS access is not configured for this workspace. Use an AWS SDK/CLI profile or temporary credentials; browser sign-in alone is separate.");
  else console.error(error.message);
  process.exitCode = 1;
}
