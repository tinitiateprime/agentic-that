import assert from "node:assert/strict";
import test from "node:test";
import { platformOptionsSchema, platformUploadSchema } from "../shared/schema.js";
import { requireYouTubeOptions } from "../shared/youtube-options.js";
import { youtubeFinalAction } from "./services/publishers/youtube-options.js";
import { centralPublishingTestHelpers } from "../../../../src/platform/server/publishing-central-store.js";

test("YouTube audience and visibility survive central queue creation and Companion schema parsing", () => {
  for (const audience of ["made_for_kids", "not_made_for_kids"] as const) {
    for (const visibility of ["public", "private", "unlisted"] as const) {
      const options = { youtube: { audience, visibility } };
      const document = { accounts: [{ id: "yt", workspaceId: "workspace", platform: "youtube", enabled: true }], uploads: [], jobs: [], schedules: [], companions: [], activityLogs: [] };
      const upload = centralPublishingTestHelpers.createUploadInDocument(document,
        { workspaceId: "workspace", userId: "user" },
        { accountId: "yt", title: "Video title", caption: "Description", postFormat: "video", mimeType: "video/mp4", originalName: "test.mp4", fileName: "test.mp4", rightsConfirmed: true, platformOptions: options });
      assert.deepEqual(upload.platformOptions, options);
      assert.deepEqual(platformUploadSchema.shape.platformOptions.parse(JSON.parse(JSON.stringify(upload)).platformOptions), options);
      assert.equal(youtubeFinalAction(visibility), visibility === "public" ? "Publish" : "Save");
    }
  }
});

test("YouTube rejects missing or unsupported choices and does not impose video options on other posts", () => {
  assert.throws(() => requireYouTubeOptions("youtube", "video", undefined), /made for kids/);
  assert.throws(() => requireYouTubeOptions("youtube", "video", { youtube: { audience: "made_for_kids" } }), /visibility/);
  assert.throws(() => platformOptionsSchema.parse({ youtube: { audience: "maybe", visibility: "public" } }));
  assert.throws(() => platformOptionsSchema.parse({ youtube: { audience: "not_made_for_kids", visibility: "everyone" } }));
  assert.equal(requireYouTubeOptions("facebook", "video", undefined), undefined);
  assert.equal(requireYouTubeOptions("youtube", "image", undefined), undefined);
  assert.equal(requireYouTubeOptions("youtube", "text", undefined), undefined);
});
