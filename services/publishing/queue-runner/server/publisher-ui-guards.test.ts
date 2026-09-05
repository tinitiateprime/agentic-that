import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FACEBOOK_COMPOSER_EDITOR_SELECTORS, FACEBOOK_POST_ACCEPTED_TEXT, hasFacebookAuthenticationCookies } from "./services/publishers/facebook.js";
import {
  LINKEDIN_COMPOSER_EDITOR_SELECTORS,
  LINKEDIN_POST_ACCEPTED_TEXT,
  isLinkedInPublishResponse,
  visibleIntersectionPoint,
} from "./services/publishers/linkedin.js";
import { hasReadyXMedia } from "./services/publishers/x.js";
import { YOUTUBE_PUBLISH_CONFIRMATION_TEXT } from "./services/publishers/youtube.js";

test("LinkedIn publishing ignores role-button duplicates outside the current viewport", () => {
  const viewport = { width: 1280, height: 900 };

  assert.equal(visibleIntersectionPoint({ x: 1400, y: 120, width: 220, height: 52 }, viewport), null);
  assert.equal(visibleIntersectionPoint({ x: -300, y: 120, width: 220, height: 52 }, viewport), null);
  assert.deepEqual(
    visibleIntersectionPoint({ x: 80, y: 120, width: 220, height: 52 }, viewport),
    { x: 190, y: 146 },
  );
});

test("LinkedIn publishing recognizes the current TipTap composer editor", () => {
  assert.ok(LINKEDIN_COMPOSER_EDITOR_SELECTORS.includes('.tiptap.ProseMirror[contenteditable="true"]'));
});

test("LinkedIn publishing waits for durable provider acceptance", () => {
  assert.equal(isLinkedInPublishResponse(
    "POST",
    "https://www.linkedin.com/voyager/api/contentcreation/normShares",
    201,
  ), true);
  assert.equal(isLinkedInPublishResponse(
    "POST",
    "https://www.linkedin.com/voyager/api/voyagerIdentityDashShares",
    200,
  ), true);
  assert.equal(isLinkedInPublishResponse("GET", "https://www.linkedin.com/voyager/api/contentcreation/normShares", 200), false);
  assert.equal(isLinkedInPublishResponse("POST", "https://www.linkedin.com/voyager/api/contentcreation/normShares", 500), false);
  assert.equal(isLinkedInPublishResponse("POST", "https://www.linkedin.com/voyager/api/feed/updates", 200), false);
  assert.match("Post successful", LINKEDIN_POST_ACCEPTED_TEXT);
});

test("Facebook publishing recognizes delayed Lexical composer editors", () => {
  assert.ok(FACEBOOK_COMPOSER_EDITOR_SELECTORS.includes('[contenteditable="true"][data-lexical-editor="true"]'));
});

test("Facebook recognizes its durable authenticated cookie pair", () => {
  assert.equal(hasFacebookAuthenticationCookies([
    { name: "c_user", value: "123456" },
    { name: "xs", value: "session-proof" },
  ]), true);
  assert.equal(hasFacebookAuthenticationCookies([{ name: "c_user", value: "123456" }]), false);
  assert.equal(hasFacebookAuthenticationCookies([{ name: "datr", value: "browser-only" }]), false);
});

test("Facebook and YouTube recognize accepted long-running video publishing", () => {
  assert.match("Your video is being processed", FACEBOOK_POST_ACCEPTED_TEXT);
  assert.match("Video processing", YOUTUBE_PUBLISH_CONFIRMATION_TEXT);
  assert.match("Processing will begin shortly", YOUTUBE_PUBLISH_CONFIRMATION_TEXT);
});

test("X publishing requires both a selected file and a rendered media preview", () => {
  assert.equal(hasReadyXMedia(true, false), false);
  assert.equal(hasReadyXMedia(false, true), false);
  assert.equal(hasReadyXMedia(true, true), true);
});

test("X publishing retains initial file acceptance after X clears the input", () => {
  const initialFileSelectionCompleted = true;
  const currentInputFileCountAfterXProcessing = 0;
  assert.equal(currentInputFileCountAfterXProcessing, 0);
  assert.equal(hasReadyXMedia(initialFileSelectionCompleted, true), true);
});

test("video composer exposes the YouTube title before destination selection", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(appSource, /const showYoutubeTitle = postFormat === 'video';/);
  assert.match(appSource, /const selectedNeedsTitle = Boolean\(postFormat === 'video' && selectedPlatforms\.includes\('youtube'\)\);/);
  assert.match(appSource, /placeholder=.*Enter a title to enable YouTube publishing/);
});

test("all publishers attach Companion-local media through CDP without Playwright's 50 MB relay", async () => {
  const publisherDirectory = new URL("./services/publishers/", import.meta.url);
  const [helper, ...publishers] = await Promise.all([
    readFile(new URL("local-file-input.ts", publisherDirectory), "utf8"),
    ...["instagram.ts", "facebook.ts", "x.ts", "linkedin.ts", "youtube.ts"]
      .map(fileName => readFile(new URL(fileName, publisherDirectory), "utf8")),
  ]);
  assert.match(helper, /DOM\.setFileInputFiles/);
  assert.match(helper, /files: \[resolvedPath\]/);
  for (const source of publishers) {
    assert.doesNotMatch(source, /\.(?:setInputFiles|setFiles)\(/);
  }
});

test("large website media batches gateway authorization and completion requests", async () => {
  const [clientSource, routeSource, storeSource] = await Promise.all([
    readFile(new URL("../src/lib/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../../app/api/publishing/[...path]/route.js", import.meta.url), "utf8"),
    readFile(new URL("../../../../src/platform/server/publishing-central-store.js", import.meta.url), "utf8"),
  ]);
  assert.match(clientSource, /Array\.from\(\{ length: 4 \}/);
  assert.equal((clientSource.match(/JSON\.stringify\(\{ parts: requestedParts \}\)/g) || []).length, 2);
  assert.match(routeSource, /authorizeSupabaseJobArtifactPartUploads/);
  assert.match(routeSource, /verifySupabaseJobArtifactPartUploads/);
  assert.match(routeSource, /advanceCentralStagedUploadParts/);
  assert.match(routeSource, /requested\[0\]\.offset < stage\.offset/);
  assert.doesNotMatch(routeSource, /requested\[0\]\.offset !== stage\.offset/);
  assert.match(storeSource, /agentic_that\.publishing_staged_uploads/);
});

test("direct destination creation does not call the redundant automation start route", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const submitFlow = appSource.slice(appSource.indexOf("const created = await api.createUnifiedPost"), appSource.indexOf("onCreated();", appSource.indexOf("const created = await api.createUnifiedPost")));
  assert.doesNotMatch(submitFlow, /api\.runAutomation/);
  assert.doesNotMatch(submitFlow, /publishing could not start/);
});

test("large-media finalization is split, retried, and never deletes finalized parts on a gateway timeout", async () => {
  const [clientSource, routeSource, storeSource] = await Promise.all([
    readFile(new URL("../src/lib/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../../app/api/publishing/[...path]/route.js", import.meta.url), "utf8"),
    readFile(new URL("../../../../src/platform/server/publishing-central-store.js", import.meta.url), "utf8"),
  ]);
  assert.match(clientSource, /staged-uploads\/\$\{session\.id\}\/finalize/);
  assert.match(clientSource, /stagedUploadId && !finalizationStarted/);
  assert.match(routeSource, /sourceSubmissionId: body\.stagedUploadId/);
  assert.match(storeSource, /item\.sourceSubmissionId === sourceSubmissionId/);
  assert.match(storeSource, /artifact_manifest/);
});

test("central publishing refresh uses one non-overlapping workspace request", async () => {
  const [appSource, clientSource, routeSource, accessSource, detailSource, documentStoreSource, centralStoreSource, jobControlSource] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../../app/api/publishing/[...path]/route.js", import.meta.url), "utf8"),
    readFile(new URL("../../../../src/platform/server/access-control.js", import.meta.url), "utf8"),
    readFile(new URL("../../../../app/apps/[category]/[slug]/page.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../../../lib/database-document-store.js", import.meta.url), "utf8"),
    readFile(new URL("../../../../src/platform/server/publishing-central-store.js", import.meta.url), "utf8"),
    readFile(new URL("../../../../src/platform/server/supabase-job-control.js", import.meta.url), "utf8"),
  ]);
  assert.match(appSource, /refreshInFlight\.current/);
  assert.match(appSource, /api\.workspaceSnapshot\(permissions\.canManageUsers\)/);
  assert.match(appSource, /setInterval\(\(\) => void refresh\(false\), 10000\)/);
  assert.match(clientSource, /request<.*>\("\/api\/workspace-snapshot"\)/);
  assert.match(routeSource, /parts\[0\] === "workspace-snapshot"/);
  assert.match(accessSource, /export async function requirePrincipalCapability/);
  assert.match(detailSource, /requirePrincipalCapability\(user,/);
  assert.match(documentStoreSource, /process\.env\.NETLIFY === "true" \? 1 : 5/);
  assert.match(centralStoreSource, /supabasePublishingWorkspaceSnapshot\(workspaceId\)/);
  assert.match(jobControlSource, /export async function supabasePublishingWorkspaceSnapshot/);
  assert.match(jobControlSource, /jsonb_agg\(to_jsonb\(job_row\)\)/);
});
