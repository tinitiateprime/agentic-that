import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  beginTelegramLogin,
  completeTelegramLoginWithCode,
  completeTelegramLoginWithPassword,
  normalizePhone,
  type TelegramApiCredentials
} from "./account-client.ts";
import { readConfig } from "./config.ts";
import { MultiUserStore } from "./store.ts";

function readFlag(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? "" : process.argv[index + 1] ?? "";
}

function readTelegramApiCredentialsFromEnv(): TelegramApiCredentials {
  const apiId = Number(process.env.TELEGRAM_API_ID?.trim() || "");
  const apiHash = process.env.TELEGRAM_API_HASH?.trim() || "";
  if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash) {
    throw new Error("Set TELEGRAM_API_ID and TELEGRAM_API_HASH before using the CLI login command.");
  }
  return { apiId, apiHash };
}

async function main() {
  const token = readFlag("token");
  if (!token) throw new Error("Usage: npm run login -- --token YOUR_ACCESS_TOKEN");

  const config = readConfig();
  const credentials = readTelegramApiCredentialsFromEnv();
  const store = new MultiUserStore(config.dataDir, config.sessionEncryptionKey);
  await store.initialize();
  const user = await store.findUserByAccessToken(token);
  if (!user) throw new Error("Invalid access token.");

  const rl = createInterface({ input, output });
  try {
    const phone = normalizePhone((await rl.question("Telegram phone (+country code): ")).trim());
    const start = await beginTelegramLogin(credentials, phone);
    const challenge = await store.createLoginChallenge(
      user.id, credentials.apiId, credentials.apiHash, phone, start.phoneCodeHash, start.sessionString, config.loginChallengeTtlMinutes
    );
    const code = (await rl.question(`Telegram login code (${start.codeDelivery}): `)).trim();
    const codeResult = await completeTelegramLoginWithCode(credentials, {
      sessionString: start.sessionString, phone, phoneCodeHash: start.phoneCodeHash, code
    });
    const result = codeResult.kind === "password_required"
      ? await completeTelegramLoginWithPassword(
          credentials,
          codeResult.sessionString,
          (await rl.question("Telegram 2FA password: ")).trim()
        )
      : codeResult;
    const account = await store.saveTelegramAccount(user.id, {
      telegramApiId: credentials.apiId,
      telegramApiHash: credentials.apiHash,
      ...result.profile,
      sessionString: result.sessionString
    });
    await store.deleteLoginChallenge(user.id, challenge.id);
    console.log(JSON.stringify({ ok: true, status: "connected", account }, null, 2));
  } finally {
    rl.close();
    await store.close();
  }
}

main().catch((error) => {
  console.error("Command failed without logging sensitive input.");
  process.exitCode = 1;
});

