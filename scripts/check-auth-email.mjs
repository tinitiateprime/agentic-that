import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parse } from "dotenv";
import { platformEmailConfiguration, sendPlatformAuthEmail } from "../src/platform/server/auth-email.js";

const fileIndex = process.argv.indexOf("--env-file");
if (fileIndex >= 0) {
  const file = process.argv[fileIndex + 1];
  if (!file || file.startsWith("--")) throw new Error("Provide a private environment file after --env-file.");
  Object.assign(process.env, parse(readFileSync(file)));
} else {
  const require = createRequire(import.meta.url);
  require("@next/env").loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
}

try {
  const configuration = platformEmailConfiguration();
  if (!configuration.configured || configuration.provider !== "Resend") {
    throw new Error("Set AUTH_EMAIL_FROM and RESEND_API_KEY to check Resend delivery.");
  }
  await sendPlatformAuthEmail({
    to: "delivered@resend.dev",
    subject: "AgenticThat email configuration check",
    text: "This Resend simulation verifies the sender and credentials used for authentication email.",
  });
  console.log(`PASS: Resend accepted a simulated email from ${configuration.from}.`);
  console.log("This checks provider acceptance. Confirm real inbox delivery separately in Resend Emails.");
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
}
