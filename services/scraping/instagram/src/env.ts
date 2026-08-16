import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(serviceRoot, "../../..");
const environmentFiles = [
  path.join(workspaceRoot, ".env"),
  path.join(workspaceRoot, ".env.local"),
  path.join(serviceRoot, ".env"),
  path.join(serviceRoot, ".env.local"),
];

const fileEnvironment: Record<string, string> = {};
for (const environmentFile of environmentFiles) {
  if (!existsSync(environmentFile)) continue;
  Object.assign(fileEnvironment, parse(readFileSync(environmentFile)));
}

for (const [name, value] of Object.entries(fileEnvironment)) {
  if (process.env[name] === undefined) process.env[name] = value;
}
