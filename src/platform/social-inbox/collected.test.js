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
