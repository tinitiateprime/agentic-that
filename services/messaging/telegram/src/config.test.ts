import assert from "node:assert/strict";
import test from "node:test";
import { readConfig } from "./config.ts";

const TELEGRAM_ENV_NAMES = [
  "SESSION_ENCRYPTION_KEY",
  "USER_PROVISIONING_KEY",
  "TELEGRAM_API_ID",
  "TELEGRAM_API_HASH"
] as const;

function withTelegramEnvironment(values: Record<string, string>, assertion: () => void) {
  const original = Object.fromEntries(TELEGRAM_ENV_NAMES.map((name) => [name, process.env[name]]));
  try {
    process.env.SESSION_ENCRYPTION_KEY = "test-session-encryption-key";
    process.env.USER_PROVISIONING_KEY = "test-provisioning-key";
    process.env.TELEGRAM_API_ID = values.TELEGRAM_API_ID ?? "";
    process.env.TELEGRAM_API_HASH = values.TELEGRAM_API_HASH ?? "";
    assertion();
  } finally {
    for (const name of TELEGRAM_ENV_NAMES) {
      const value = original[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("Telegram starts without shared API credentials", () => {
  withTelegramEnvironment({}, () => {
    const config = readConfig();
    assert.equal(config.telegramApiId, null);
    assert.equal(config.telegramApiHash, null);
    assert.equal(config.telegramApiCredentialsStatus, "user_required");
  });
});

test("Telegram uses a complete valid shared application identity", () => {
  withTelegramEnvironment({
    TELEGRAM_API_ID: "123456",
    TELEGRAM_API_HASH: "0123456789abcdef0123456789abcdef"
  }, () => {
    const config = readConfig();
    assert.equal(config.telegramApiId, 123456);
    assert.equal(config.telegramApiHash, "0123456789abcdef0123456789abcdef");
    assert.equal(config.telegramApiCredentialsStatus, "configured");
  });
});

test("invalid shared credentials fall back to per-connection setup", () => {
  withTelegramEnvironment({ TELEGRAM_API_ID: "not-a-number" }, () => {
    const config = readConfig();
    assert.equal(config.telegramApiId, null);
    assert.equal(config.telegramApiHash, null);
    assert.equal(config.telegramApiCredentialsStatus, "invalid");
  });
});
