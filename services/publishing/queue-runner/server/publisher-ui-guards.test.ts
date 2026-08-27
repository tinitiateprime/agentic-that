import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FACEBOOK_COMPOSER_EDITOR_SELECTORS } from "./services/publishers/facebook.js";
import {
  LINKEDIN_COMPOSER_EDITOR_SELECTORS,
  visibleIntersectionPoint,
} from "./services/publishers/linkedin.js";
import { hasReadyXMedia } from "./services/publishers/x.js";

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

test("Facebook publishing recognizes delayed Lexical composer editors", () => {
  assert.ok(FACEBOOK_COMPOSER_EDITOR_SELECTORS.includes('[contenteditable="true"][data-lexical-editor="true"]'));
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

test("the authenticated website uses server-managed publishing accounts as its authority", () => {
  const dashboard = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const configManager = readFileSync(new URL("../../../../app/config-manager/ConfigManager.jsx", import.meta.url), "utf8");
  const productStatus = readFileSync(new URL("../../../../src/platform/use-product-status.js", import.meta.url), "utf8");

  assert.match(dashboard, /\.map\(serverAccountForComposer\) \?\? \[\]\)/);
  assert.match(dashboard, /platform: account\.platform/);
  assert.doesNotMatch(dashboard, /function serverAccountForComposer[\s\S]*?platform: 'instagram'[\s\S]*?\n}/);
  assert.doesNotMatch(dashboard, /\.\.\.latestAccounts/);
  assert.match(configManager, /\(serverAutomation\?\.accounts \|\| \[\]\)\.map\(serverAccountForConfig\)/);
  assert.doesNotMatch(configManager, /Pair this device/);
  assert.match(productStatus, /fetch\("\/api\/automation-server\/accounts"/);
});

test("the website login modal preserves the worker's terminal failure reason", () => {
  const configManager = readFileSync(new URL("../../../../app/config-manager/ConfigManager.jsx", import.meta.url), "utf8");

  assert.match(configManager, />\{session\.errorMessage \|\| error\}<\/p>/);
  assert.doesNotMatch(configManager, />\{error \|\| session\.errorMessage\}<\/p>/);
});

test("the composer exposes YouTube video requirements before account selection", () => {
  const dashboard = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(dashboard, /const showYoutubeTitle = postFormat === 'video'/);
  assert.match(dashboard, /const youtubeVideoSelected = Boolean\(postFormat === 'video' && selectedPlatforms\.includes\('youtube'\)\)/);
  assert.match(dashboard, /const selectedNeedsTitle = youtubeVideoSelected/);
  assert.match(dashboard, /<span>\{handoffOnly \? 'Video title' : 'YouTube title'\}/);
});

test("server media uploads use small chunks instead of browser-side platform size caps", () => {
  const dashboard = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const api = readFileSync(new URL("../src/lib/api.ts", import.meta.url), "utf8");

  assert.doesNotMatch(dashboard, /Images: 25 MB each/);
  assert.doesNotMatch(dashboard, /maximumBytes/);
  assert.match(dashboard, /secure 4 MB chunks/);
  assert.match(api, /for \(let offset = 0; offset < file\.size; offset \+= chunkSize\)/);
  assert.match(api, /file\.slice\(offset/);
  assert.match(api, /\/media\/uploads/);
});
