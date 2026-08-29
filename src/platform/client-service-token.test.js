import assert from "node:assert/strict";
import test from "node:test";
import { getClientServiceToken, serviceTokenMatchesAudience } from "./client-service-token.js";

function token(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "EdDSA", typ: "JWT" })}.${encode(payload)}.signature`;
}

test("client service tokens are scoped to the requested audience", () => {
  const exp = Math.floor(Date.now() / 1000) + 300;
  assert.equal(serviceTokenMatchesAudience(token({ aud: "scraping", exp }), "scraping"), true);
  assert.equal(serviceTokenMatchesAudience(token({ aud: "publishing", exp }), "scraping"), false);
});

test("expired and malformed client service tokens are rejected", () => {
  const expired = Math.floor(Date.now() / 1000) - 1;
  assert.equal(serviceTokenMatchesAudience(token({ aud: "scraping", exp: expired }), "scraping"), false);
  assert.equal(serviceTokenMatchesAudience("not-a-token", "scraping"), false);
});

test("a token for another service is refreshed instead of being reused", async () => {
  const exp = Math.floor(Date.now() / 1000) + 300;
  const publishingToken = token({ aud: "publishing", exp });
  const scrapingToken = token({ aud: "scraping", exp });
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (_url, init) => {
    requests += 1;
    assert.deepEqual(JSON.parse(init.body), { audience: "scraping" });
    return {
      ok: true,
      status: 200,
      json: async () => ({ token: scrapingToken }),
    };
  };
  try {
    assert.equal(await getClientServiceToken("scraping", publishingToken), scrapingToken);
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
