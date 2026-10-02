import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { amplifyEnvironment, serializeEnvironment } from "./amplify-environment.mjs";
import { parseAwsEnvironmentInput, usableAwsEnvironmentValues } from "./aws-environment-input.mjs";

const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const sourcePath = argument("--from", undefined);
if (!sourcePath) throw new Error("Use --from <your-private-environment-file>; secret values are never printed.");
const outputPath = path.resolve(argument("--output", ".env.aws-import"));
if (path.dirname(outputPath) !== process.cwd() || !path.basename(outputPath).startsWith(".env.") || path.basename(outputPath) === ".env.example") throw new Error("Output must be an ignored .env.* file in the workspace, excluding .env.example.");
if (path.resolve(sourcePath) === outputPath) throw new Error("The original environment file must not be overwritten.");
async function existing(file) {
  try { return usableAwsEnvironmentValues(parseAwsEnvironmentInput(await readFile(file, "utf8"))); }
  catch (error) { if (error.code === "ENOENT") return {}; throw error; }
}
const source = usableAwsEnvironmentValues(parseAwsEnvironmentInput(await readFile(sourcePath, "utf8")));
const values = amplifyEnvironment({ ...await existing(outputPath), ...await existing(".env.local"), ...source });
values.AUTH_RATE_LIMIT_PEPPER ||= randomBytes(32).toString("base64url");
await writeFile(outputPath, serializeEnvironment(values, { escapeDollar: false }), { mode: 0o600 });
console.log(`Prepared ${Object.keys(values).length} values in ${path.basename(outputPath)}; secrets hidden. Masked values were excluded.`);
for (const name of ["SESSION_ENCRYPTION_KEY", "USER_PROVISIONING_KEY", "SERVICE_TOKEN_PRIVATE_KEY", "SERVICE_TOKEN_PUBLIC_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"]) {
  if (!values[name]) console.log(`Still required: ${name}`);
}
console.log("Retain original encryption/signing keys. Lambda is optional; when used, configure its real function name and invocation role.");
