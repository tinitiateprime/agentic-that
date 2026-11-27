import assert from "node:assert/strict";
import test from "node:test";
import { cleanCollectedItems, versionAtLeast } from "./collected.js";

test("only well-formed YouTube comments are accepted from a Companion", () => {
  const items = cleanCollectedItems({ items: [
    { externalId: "yt:UgzfAO-gD0fihMl8iEN4AaABAg", authorName: "@kitty43_42", authorUrl: "https://www.youtube.com/@kitty43_42", body: "  neatly   explained ", contextText: "SQL Server", permalink: "https://www.youtube.com/watch?v=znV7qIA5c4s&lc=UgzfAO", receivedAt: "2026-11-27T05:57:04.364Z" },
    { externalId: "ig:nope", body: "wrong platform" },
    { externalId: "yt:UgzfAO-gD0fihMl8iEN4AaABAx", body: "" },
    { externalId: "yt:UgzfAO-gD0fihMl8iEN4AaABAy", body: "bad links", permalink: "javascript:alert(1)", authorUrl: "https://evil.example/" },
  ] });
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    platform: "youtube", kind: "comment", externalId: "yt:UgzfAO-gD0fihMl8iEN4AaABAg", authorName: "@kitty43_42", authorUrl: "https://www.youtube.com/@kitty43_42",
    body: "neatly explained", contextText: "SQL Server", permalink: "https://www.youtube.com/watch?v=znV7qIA5c4s&lc=UgzfAO", receivedAt: "2026-11-27T05:57:04.364Z",
  });
  assert.equal(items[1].permalink, "");
  assert.equal(items[1].authorUrl, "");
  assert.equal(items[1].authorName, "YouTube viewer");
  assert.deepEqual(cleanCollectedItems(null), []);
});

test("Companion versions", () => {
  assert.equal(versionAtLeast("2.9.0", "2.9.0"), true);
  assert.equal(versionAtLeast("2.10.1", "2.9.0"), true);
  assert.equal(versionAtLeast("2.8.11", "2.9.0"), false);
  assert.equal(versionAtLeast("2.9.0-qa.1", "2.9.0"), true);
  assert.equal(versionAtLeast(null, "2.9.0"), false);
});

test("LinkedIn items are accepted only for LinkedIn jobs, with LinkedIn links", () => {
  const item = { kind: "mention", externalId: "li:urn:li:activity:7529022106349629440:0123456789abcdef", authorName: "Kranthi Kumar A", body: "New role at Tinitiate", permalink: "https://www.linkedin.com/feed/update/urn:li:activity:7529022106349629440", authorUrl: "https://www.youtube.com/@x" };
  const [clean] = cleanCollectedItems({ items: [item] }, "linkedin");
  assert.equal(clean.platform, "linkedin");
  assert.equal(clean.kind, "mention");
  assert.equal(clean.permalink, item.permalink);
  assert.equal(clean.authorUrl, "", "a YouTube link can't be a LinkedIn author");
  assert.deepEqual(cleanCollectedItems({ items: [item] }, "youtube"), [], "wrong platform");
  assert.deepEqual(cleanCollectedItems({ items: [item] }, "facebook"), [], "platform not supported yet");
  const [reply] = cleanCollectedItems({ items: [{ kind: "reply", externalId: "x:2126226624219865091", authorName: "Kaushik (@seernu293)", body: "thats very useful", permalink: "https://x.com/seernu293/status/2126226624219865091" }] }, "x");
  assert.equal(reply.platform, "x");
  assert.equal(reply.permalink, "https://x.com/seernu293/status/2126226624219865091");
});
