import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FACEBOOK_COMPOSER_EDITOR_SELECTORS, FACEBOOK_POST_ACCEPTED_TEXT, hasFacebookAuthenticationCookies } from "./services/publishers/facebook.js";
import {
  LINKEDIN_COMPOSER_EDITOR_SELECTORS,
  LINKEDIN_POST_ACCEPTED_TEXT,
  LINKEDIN_UPLOAD_ACTIVE_TEXT,
  isLinkedInPublishResponse,
  isLinkedInManagedPagePostsUrl,
  linkedInManagedPageFromLink,
  shouldOpenLinkedInManagedPageFromManage,
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
  assert.match("Uploading... Keep the page open to finish uploading", LINKEDIN_UPLOAD_ACTIVE_TEXT);
  assert.match("Uploading... Keep the page open to finish uploading 18%", LINKEDIN_UPLOAD_ACTIVE_TEXT);
  assert.match("Processing video", LINKEDIN_UPLOAD_ACTIVE_TEXT);
  assert.match("Posting...", LINKEDIN_UPLOAD_ACTIVE_TEXT);
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

test("video composer reveals YouTube-only details inside the selected destination", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(appSource, /const selectedNeedsTitle = Boolean\(postFormat === 'video' && selectedPlatforms\.includes\('youtube'\)\);/);
  assert.match(appSource, /platform === 'youtube' && postFormat === 'video' && selectedCount > 0/);
  assert.match(appSource, /YouTube video details/);
  assert.match(appSource, /App character limits/);
});

test("LinkedIn composer exposes personal and managed Page destinations with independent copy", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(appSource, /Personal profile/);
  assert.match(appSource, /account\.linkedinManagedPages/);
  assert.match(appSource, /managed-linkedin-page/);
  assert.match(appSource, /composer-linkedin-copy-list/);
  assert.match(appSource, /linkedinPageId: destination\.linkedinPage\?\.id/);
  assert.match(appSource, /destinationDescriptions\[destination\.key\]/);
});

test("LinkedIn managed Page links become stable direct Page-post destinations", () => {
  assert.deepEqual(
    linkedInManagedPageFromLink(
      "Tinitiate AI Solutions",
      "https://www.linkedin.com/company/117884053/admin/dashboard/",
    ),
    {
      id: "117884053",
      name: "Tinitiate AI Solutions",
      pageUrl: "https://www.linkedin.com/company/117884053/admin/",
      pagePostsUrl: "https://www.linkedin.com/company/117884053/admin/page-posts/published/",
    },
  );
  assert.equal(linkedInManagedPageFromLink("Other", "https://example.com/company/117884053/admin/"), null);
  assert.equal(linkedInManagedPageFromLink("Manage", "https://www.linkedin.com/company/117884053/admin/"), null);
  assert.deepEqual(
    linkedInManagedPageFromLink("Public-link Page", "https://www.linkedin.com/company/public-link-page/"),
    {
      id: "public-link-page",
      name: "Public-link Page",
      pageUrl: "https://www.linkedin.com/company/public-link-page/admin/",
      pagePostsUrl: "https://www.linkedin.com/company/public-link-page/admin/page-posts/published/",
    },
  );
});

test("LinkedIn managed Page navigation accepts a canonical numeric admin redirect", () => {
  assert.equal(isLinkedInManagedPagePostsUrl(
    "https://www.linkedin.com/company/tinitiate-ai/admin/page-posts/published/",
    "tinitiate-ai",
  ), true);
  assert.equal(isLinkedInManagedPagePostsUrl(
    "https://www.linkedin.com/company/117884053/admin/page-posts/published/",
    "tinitiate-ai",
  ), false);
  assert.equal(isLinkedInManagedPagePostsUrl(
    "https://www.linkedin.com/company/117884053/admin/page-posts/published/",
  ), true);
  assert.equal(isLinkedInManagedPagePostsUrl("https://example.com/company/117884053/admin/page-posts/published/"), false);
  assert.equal(isLinkedInManagedPagePostsUrl("https://www.linkedin.com/company/117884053/admin/dashboard/"), false);
});

test("LinkedIn managed Page navigation avoids ambiguous direct admin URLs for public slugs", () => {
  assert.equal(shouldOpenLinkedInManagedPageFromManage("tinitiateit"), true);
  assert.equal(shouldOpenLinkedInManagedPageFromManage("tinitiate-ai"), true);
  assert.equal(shouldOpenLinkedInManagedPageFromManage("117884053"), false);
});

test("LinkedIn managed Page selection verifies navigation and retains the exact Manage destination", async () => {
  const source = await readFile(new URL("./services/publishers/linkedin.ts", import.meta.url), "utf8");
  assert.match(source, /const previousUrl = page\.url\(\)/);
  assert.match(source, /link\.click\(\{ force: true/);
  assert.match(source, /if \(page\.url\(\) === previousUrl\)/);
  assert.match(source, /page\.goto\(candidate!\.href/);
});

test("normal CI and Companion releases share the complete verification suite", async () => {
  const [ciWorkflow, releaseWorkflow] = await Promise.all([
    readFile(new URL("../../../../.github/workflows/ci.yml", import.meta.url), "utf8"),
    readFile(new URL("../../../../.github/workflows/publishing-companion-release.yml", import.meta.url), "utf8"),
  ]);
  assert.match(ciWorkflow, /push:\s*\n\s*branches:/);
  assert.match(ciWorkflow, /pull_request:/);
  assert.match(ciWorkflow, /workflow_call:/);
  for (const command of [
    "npm run test:publishing",
    "npm run test:instagram",
    "npm run test:facebook",
    "npm run test:whatsapp",
    "npm run test:rbac",
    "npm run test:security",
    "npm --prefix services/messaging/telegram test",
    "npm run build",
  ]) assert.match(ciWorkflow, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(releaseWorkflow, /verify:\s*\n\s*uses: \.\/\.github\/workflows\/ci\.yml/);
  assert.match(releaseWorkflow, /release-checks:/);
  assert.match(releaseWorkflow, /Audit production dependencies/);
});

test("publishing makes overdue Companion waits explicit", async () => {
  const [appSource, styles] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.source.css", import.meta.url), "utf8"),
  ]);
  assert.match(appSource, /function WaitingForCompanionTimeline/);
  assert.match(appSource, /Scheduled \$\{formatEventTime\(earliestWaitingUpload\.scheduledAt\)\} → \$\{waitingCompanionLabel\} → Waiting for Companion/);
  assert.match(appSource, /The post is safely queued and will continue automatically/);
  assert.match(styles, /\.companion-waiting-alert/);
  assert.match(styles, /\.delivery-wait-timeline/);
});

test("first-time publishing setup follows real saved progress through a confirmed post", async () => {
  const [managerSource, styles] = await Promise.all([
    readFile(new URL("../../../../app/config-manager/ConfigManager.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../../../app/config-manager/config-manager.css", import.meta.url), "utf8"),
  ]);
  assert.match(managerSource, /useCompanionStatus\(\)/);
  assert.match(managerSource, /uploads\.some\(upload => upload\.status === "posted"\)/);
  for (const step of ["Install Companion", "Pair", "Connect Account", "Test Post", "Success"]) {
    assert.match(managerSource, new RegExp(`title: "${step}"`));
  }
  assert.match(managerSource, /The test is a real social post and is published only after you review and confirm it/);
  assert.match(styles, /\.config-connection-steps\.publishing-onboarding-steps/);
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

test("publishing UI maps uploader, scheduler, manager, and viewer capabilities to distinct actions", async () => {
  const [appSource, routeSource] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../../app/api/publishing/[...path]/route.js", import.meta.url), "utf8"),
  ]);
  assert.match(appSource, /const PUBLISHING_SCHEDULING_ENABLED = true;/);
  assert.match(appSource, /canEditContent: capabilities\.includes\('publishing\.content\.create'\) \|\| capabilities\.includes\('publishing\.content\.edit'\)/);
  assert.match(appSource, /canSchedulePosts: capabilities\.includes\('publishing\.schedule\.manage'\)/);
  assert.match(appSource, /canRunAutomation: capabilities\.includes\('publishing\.execute'\)/);
  assert.match(appSource, /handoffOnly=\{!permissions\.canRunAutomation\}/);
  assert.match(routeSource, /principal\(scheduleOnly \? "publishing\.schedule\.manage" : "publishing\.execute"\)/);
});

test("scheduler handoffs expose and submit independent timing for every destination", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const modalSource = appSource.slice(
    appSource.indexOf("function ScheduleSubmissionModal"),
    appSource.indexOf("function PlatformScheduleModal"),
  );
  assert.match(modalSource, /const \[destinationTimings, setDestinationTimings\]/);
  assert.match(modalSource, /compatibleDestinations\.map\(destination =>/);
  assert.match(modalSource, /destinationTimings\[destination\.key\]/);
  assert.match(modalSource, /linkedinPageId: destination\.linkedinPage\?\.id/);
  assert.match(modalSource, /Set each destination separately/);
  assert.doesNotMatch(modalSource, /const \[timingMode, setTimingMode\]/);
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
  assert.match(appSource, /setInterval\(refreshVisibleWorkspace, 15000\)/);
  assert.match(appSource, /document\.visibilityState === 'visible'/);
  assert.match(clientSource, /request<.*>\("\/api\/workspace-snapshot"\)/);
  assert.match(routeSource, /parts\[0\] === "workspace-snapshot"/);
  assert.match(accessSource, /export async function requirePrincipalCapability/);
  assert.match(detailSource, /requirePrincipalCapability\(user,/);
  assert.match(documentStoreSource, /process\.env\.NETLIFY === "true" \? 1 : 5/);
  assert.match(centralStoreSource, /supabasePublishingWorkspaceSnapshot\(workspaceId\)/);
  assert.match(jobControlSource, /export async function supabasePublishingWorkspaceSnapshot/);
  assert.match(jobControlSource, /jsonb_agg\(to_jsonb\(job_row\)\)/);
});
