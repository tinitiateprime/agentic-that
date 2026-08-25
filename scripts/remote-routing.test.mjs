import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("production scraper routes proxy through private server-only targets", async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    INSTAGRAM_API_URL: process.env.INSTAGRAM_API_URL,
    FACEBOOK_API_URL: process.env.FACEBOOK_API_URL,
  };
  process.env.NODE_ENV = "production";
  process.env.INSTAGRAM_API_URL = "http://127.0.0.1:8791/";
  process.env.FACEBOOK_API_URL = "http://127.0.0.1:8793/";
  try {
    const { default: config } = await import(`../next.config.mjs?remote-routing=${Date.now()}`);
    const rewrites = await config.rewrites();
    assert.deepEqual(
      rewrites.find(route => route.source === "/api/scraping/instagram/:path*"),
      {
        source: "/api/scraping/instagram/:path*",
        destination: "http://127.0.0.1:8791/api/scraping/instagram/:path*",
      },
    );
    assert.deepEqual(
      rewrites.find(route => route.source === "/api/scraping/facebook/:path*"),
      {
        source: "/api/scraping/facebook/:path*",
        destination: "http://127.0.0.1:8793/api/scraping/facebook/:path*",
      },
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("scraper consoles never expose configurable service origins to browsers", async () => {
  for (const file of [
    "services/scraping/instagram/console/src/InstagramScraperConsole.jsx",
    "services/scraping/facebook/console/src/FacebookScraperConsole.jsx",
  ]) {
    const source = await readFile(new URL(file, root), "utf8");
    assert.doesNotMatch(source, /NEXT_PUBLIC_(?:INSTAGRAM|FACEBOOK)_API_URL/);
    assert.match(source, /\/api\/scraping\/(?:instagram|facebook)/);
  }
});

test("development orchestration keeps internal service targets server-side", async () => {
  const source = await readFile(new URL("scripts/dev-all.mjs", root), "utf8");
  assert.match(source, /INSTAGRAM_API_URL: instagramApiUrl/);
  assert.match(source, /FACEBOOK_API_URL: facebookApiUrl/);
  assert.match(source, /TELEGRAM_API_URL: telegramApiUrl/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_INSTAGRAM_API_URL: `http:/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_FACEBOOK_API_URL: `http:/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_PUBLISH_QUEUE_API_URL: publishQueueApiUrl/);
});
