import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareTelegramMedia, telegramPhoneMatchesUser } from "./account-client.ts";

test("a connected Telegram account recognizes its own international phone number", () => {
  assert.equal(telegramPhoneMatchesUser("+91 62812 46483", "916281246483"), true);
  assert.equal(telegramPhoneMatchesUser("+916281246483", "+916281246483"), true);
  assert.equal(telegramPhoneMatchesUser("+916281246483", "918799445479"), false);
  assert.equal(telegramPhoneMatchesUser("invalid", "916281246483"), false);
});

test("phone delivery checks the connected account's contacts and dialogs before import", async () => {
  const source = await readFile(new URL("./account-client.ts", import.meta.url), "utf8");
  assert.match(source, /contacts\.GetContacts/);
  assert.match(source, /client\.iterDialogs\(\{ limit: 500 \}\)/);
  assert.ok(source.indexOf("resolveExistingPhoneContact(client, recipient)") < source.indexOf("importPhoneContact(client, input)"));
});

test("public Telegram media is downloaded and uploaded as a server-local file", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agenticthat-telegram-media-test-"));
  try {
    const prepared = await prepareTelegramMedia("https://media.example/video", "video", {
      tempRoot,
      maxBytes: 1024,
      resolver: async () => [{ address: "93.184.216.34" }],
      fetcher: (async () => new Response(Buffer.from("video-bytes"), {
        status: 200,
        headers: { "content-type": "video/mp4", "content-length": "11" },
      })) as typeof fetch,
    });
    assert.ok(prepared);
    assert.equal(prepared.file.name, "video.mp4");
    assert.equal(prepared.file.size, 11);
    assert.equal(await readFile(prepared.file.path, "utf8"), "video-bytes");
    await prepared.cleanup();
    await assert.rejects(readFile(prepared.file.path), /ENOENT/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("Telegram media downloading rejects private-network URLs before fetching", async () => {
  let fetched = false;
  await assert.rejects(
    prepareTelegramMedia("http://private.example/video.mp4", "video", {
      resolver: async () => [{ address: "127.0.0.1" }],
      fetcher: (async () => {
        fetched = true;
        return new Response("not allowed");
      }) as typeof fetch,
    }),
    /private network/,
  );
  assert.equal(fetched, false);
});
