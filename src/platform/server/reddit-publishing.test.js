import assert from "node:assert/strict";
import test from "node:test";
import { requireRedditOptions, normalizeSubreddit } from "../../../services/publishing/queue-runner/shared/reddit-options.js";
import { requirePlatformOptions } from "../../../services/publishing/queue-runner/shared/platform-options.js";
import { centralPublishingTestHelpers } from "./publishing-central-store.js";
import { ZernioApiError } from "@zernio/node";
import {
  buildZernioRedditPost,
  redditConnectionConfiguration,
  redditRequestErrorOutcome,
  redditTargetOutcome,
} from "./reddit-publishing.js";

const redditOptions = { reddit: { subreddit: "r/marketing", title: "  Launch   notes " } };

test("Reddit options require a valid subreddit and title and normalize both", () => {
  assert.equal(normalizeSubreddit("/r/Marketing/"), "Marketing");
  assert.deepEqual(requireRedditOptions("reddit", redditOptions), {
    reddit: { subreddit: "marketing", title: "Launch notes", nsfw: false, spoiler: false },
  });
  assert.equal(requireRedditOptions("x", {}), undefined);
  assert.throws(() => requireRedditOptions("reddit", { reddit: { subreddit: "a", title: "Title" } }), /subreddit/);
  assert.throws(() => requireRedditOptions("reddit", { reddit: { subreddit: "marketing", title: " " } }), /title/);
  assert.throws(() => requireRedditOptions("reddit", { reddit: { subreddit: "marketing", title: "x".repeat(301) } }), /300/);
});

test("platform options keep only the destination platform's validated options", () => {
  const options = { ...redditOptions, youtube: { audience: "not_made_for_kids", visibility: "public" } };
  assert.deepEqual(Object.keys(requirePlatformOptions("reddit", "text", options)), ["reddit"]);
  assert.deepEqual(Object.keys(requirePlatformOptions("youtube", "video", options)), ["youtube"]);
  assert.equal(requirePlatformOptions("x", "text", options), undefined);
});

test("Reddit API publishing is enabled only by a Zernio API key", () => {
  const previous = process.env.ZERNIO_API_KEY;
  try {
    delete process.env.ZERNIO_API_KEY;
    assert.equal(redditConnectionConfiguration().configured, false);
    process.env.ZERNIO_API_KEY = "sk_test";
    assert.deepEqual(redditConnectionConfiguration(), { configured: true, provider: "zernio" });
  } finally {
    if (previous === undefined) delete process.env.ZERNIO_API_KEY;
    else process.env.ZERNIO_API_KEY = previous;
  }
});

test("Zernio Reddit posts carry the subreddit, title, tags, and media", () => {
  const text = buildZernioRedditPost({ postFormat: "text", caption: " Body copy ", platformOptions: redditOptions }, { zernioAccountId: "acc_1" });
  assert.equal(text.content, "Body copy");
  assert.equal(text.publishNow, true);
  assert.equal(text.mediaItems, undefined);
  assert.deepEqual(text.platforms, [{
    platform: "reddit",
    accountId: "acc_1",
    platformSpecificData: { subreddit: "marketing", title: "Launch notes", nsfw: false, spoiler: false, forceSelf: true },
  }]);

  const video = buildZernioRedditPost(
    { postFormat: "video", caption: "Clip", originalName: "clip.mp4", mimeType: "video/mp4", platformOptions: { reddit: { ...redditOptions.reddit, nsfw: true } } },
    { zernioAccountId: "acc_1", mediaUrl: "https://media.zernio.example/clip.mp4" },
  );
  assert.deepEqual(video.mediaItems, [{ type: "video", url: "https://media.zernio.example/clip.mp4", mimeType: "video/mp4", filename: "clip.mp4" }]);
  assert.equal(video.platforms[0].platformSpecificData.nsfw, true);
  assert.equal(video.platforms[0].platformSpecificData.forceSelf, undefined);

  assert.throws(() => buildZernioRedditPost({ postFormat: "image", platformOptions: redditOptions }, { zernioAccountId: "acc_1" }), /not uploaded/);
  assert.throws(() => buildZernioRedditPost({ postFormat: "text", caption: "x", platformOptions: {} }, { zernioAccountId: "acc_1" }), /subreddit/);
});

test("Zernio publish results map to queue outcomes", () => {
  assert.deepEqual(redditTargetOutcome({ status: "published", platformPostUrl: "https://reddit.com/r/x/comments/1", platformPostId: "t3_1" }),
    { state: "success", url: "https://reddit.com/r/x/comments/1", id: "t3_1" });
  assert.equal(redditTargetOutcome({ status: "processing" }).state, "in_flight");
  assert.equal(redditTargetOutcome({ status: "failed", errorCategory: "auth_expired", errorMessage: "token revoked" }).state, "reconnect_required");
  assert.equal(redditTargetOutcome({ status: "failed", errorCategory: "platform_rate_limit", errorMessage: "slow down" }).state, "retry");
  assert.equal(redditTargetOutcome({ status: "failed", errorCategory: "user_abuse", errorMessage: "you are doing that too much" }).state, "retry");
  const rejected = redditTargetOutcome({ status: "failed", errorCategory: "user_content", errorMessage: "SUBREDDIT_NOEXIST" });
  assert.equal(rejected.state, "failed");
  assert.match(rejected.message, /SUBREDDIT_NOEXIST/);
  assert.equal(redditTargetOutcome(undefined).state, "failed");
});

test("Zernio request errors retry only when the post cannot have been duplicated", () => {
  const apiError = (status, code) => new ZernioApiError("error", status, code, undefined, { error: "message from Zernio", code });
  assert.equal(redditRequestErrorOutcome(apiError(503)).state, "retry");
  assert.equal(redditRequestErrorOutcome(apiError(429)).state, "retry");
  assert.equal(redditRequestErrorOutcome(apiError(400, "ACCOUNT_DISCONNECTED")).state, "reconnect_required");
  assert.match(redditRequestErrorOutcome(apiError(401)).message, /ZERNIO_API_KEY/);
  assert.equal(redditRequestErrorOutcome(apiError(400)).state, "failed");
  assert.equal(redditRequestErrorOutcome(new TypeError("fetch failed")).state, "retry");
  assert.equal(redditRequestErrorOutcome(Object.assign(new Error("Connect first"), { status: 409, reconnect: true })).state, "reconnect_required");
});

test("Reddit always publishes through Zernio and never waits for the Companion", () => {
  const { accountReadiness, companionPublishingEngine } = centralPublishingTestHelpers;
  assert.equal(companionPublishingEngine("reddit", "api"), "api");
  assert.equal(companionPublishingEngine("reddit", "companion"), "api");
  assert.equal(companionPublishingEngine("reddit", "external_browser"), "api");
  assert.equal(companionPublishingEngine("instagram", "api"), "companion");
  assert.equal(companionPublishingEngine("x", "api"), "external_browser");
  assert.equal(accountReadiness({ platform: "reddit", enabled: true, credentialConfigured: true, executionEngine: "api" }, null), "ready");
  assert.equal(accountReadiness({ platform: "reddit", enabled: true, credentialConfigured: false, executionEngine: "api" }, null), "reconnect_required");
  assert.equal(accountReadiness({ platform: "instagram", enabled: true, credentialConfigured: true, executionEngine: "companion" }, null), "waiting_for_companion");
});

test("central intake validates Reddit posts and queues API jobs without a Companion", () => {
  const document = {
    accounts: [
      { id: "reddit_api", workspaceId: "workspace_1", platform: "reddit", enabled: true, credentialConfigured: true, executionEngine: "api" },
      { id: "reddit_unconnected", workspaceId: "workspace_1", platform: "reddit", enabled: true, credentialConfigured: false, executionEngine: "companion" },
    ],
    uploads: [], jobs: [], schedules: [], activityLogs: [], companions: [],
  };
  const principal = { workspaceId: "workspace_1", userId: "user_1", name: "Manager" };
  const create = (input) => centralPublishingTestHelpers.createUploadInDocument(document, principal, input);

  assert.throws(() => create({ accountId: "reddit_api", postFormat: "text", caption: "Body" }), /subreddit/);
  const upload = create({ accountId: "reddit_api", postFormat: "text", caption: "Body", platformOptions: redditOptions });
  assert.deepEqual(document.uploads.find((item) => item.id === upload.id).platformOptions, {
    reddit: { subreddit: "marketing", title: "Launch notes", nsfw: false, spoiler: false },
  });
  assert.equal(document.jobs.find((job) => job.uploadId === upload.id).state, "queued");
  assert.equal(upload.statusDetail, "queued");

  const videoInput = { postFormat: "video", caption: "Clip", originalName: "clip.mp4", mimeType: "video/mp4", rightsConfirmed: true, platformOptions: redditOptions };
  const apiVideo = create({ ...videoInput, accountId: "reddit_api" });
  assert.equal(document.jobs.find((job) => job.uploadId === apiVideo.id).state, "queued");
  // A Reddit account is never routed to the Companion, even before it connects.
  const unconnected = create({ ...videoInput, accountId: "reddit_unconnected" });
  assert.equal(document.jobs.find((job) => job.uploadId === unconnected.id).state, "queued");
  assert.equal(unconnected.companionStatus, "offline");
  assert.notEqual(unconnected.statusDetail, "waiting_for_companion");
});
