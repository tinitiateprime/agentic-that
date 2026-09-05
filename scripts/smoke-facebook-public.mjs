import { runFacebookScrape } from "../services/scraping/facebook/src/scraper.ts";

const query = process.argv[2];
if (!query) throw new Error("Usage: node --import tsx scripts/smoke-facebook-public.mjs <URL or keyword> [profile_url|post_url|keyword]");
const inputMode = process.argv[3] || "profile_url";
const started = Date.now();
const result = await runFacebookScrape({ query, inputMode, collectionMode: "latest", maxResults: 2, skipComments: true }, { signal: AbortSignal.timeout(180_000) });
console.log(JSON.stringify({ seconds: Math.round((Date.now() - started) / 1000), status: result.discoveryStatus,
  results: result.results.map(post => ({ url: post.post_url, author: post.author_name, authorUrl: post.author_url,
    content: post.content?.slice(0, 160), timestamp: post.timestamp, followers: post.follower_count,
    followerDisplay: post.follower_count_display, views: post.views_count, viewDisplay: post.views_display,
    reactions: post.reactions_count, comments: post.comments_count })), diagnostics: result.diagnostics }, null, 2));
if (!result.results.length) process.exitCode = 1;
