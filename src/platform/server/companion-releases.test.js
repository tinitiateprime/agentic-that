import assert from "node:assert/strict";
import test from "node:test";

const completeAssetNames = [
  "AgenticThat-Publishing-Companion-Setup.exe",
  "AgenticThat-Publishing-Companion-Windows-x64-Portable.zip",
  "AgenticThat-Publishing-Companion-macOS-universal.dmg",
  "AgenticThat-Publishing-Companion-darwin-universal.zip",
  "AgenticThat-Publishing-Companion-Linux-x64.deb",
  "AgenticThat-Publishing-Companion-Linux-x64.rpm",
  "AgenticThat-Publishing-Companion-Linux-x64.zip",
  "AgenticThat-Publishing-Companion-Linux-arm64.deb",
  "AgenticThat-Publishing-Companion-Linux-arm64.rpm",
  "AgenticThat-Publishing-Companion-Linux-arm64.zip",
  "SHA256SUMS.txt",
];

function release(tagName, publishedAt, assetNames = completeAssetNames) {
  return {
    tag_name: tagName,
    published_at: publishedAt,
    prerelease: true,
    draft: false,
    html_url: `https://github.test/releases/tag/${tagName}`,
    assets: assetNames.map((name, index) => ({
      name,
      size: 1_000 + index,
      browser_download_url: `https://github.test/releases/download/${tagName}/${name}`,
    })),
  };
}

test("selects the newest complete release and recommends the Windows portable build", async t => {
  const originalFetch = globalThis.fetch;
  const originalPinnedTag = process.env.COMPANION_RELEASE_TAG;
  const originalPublicPinnedTag = process.env.NEXT_PUBLIC_PUBLISHING_COMPANION_RELEASE_TAG;
  delete process.env.COMPANION_RELEASE_TAG;
  delete process.env.NEXT_PUBLIC_PUBLISHING_COMPANION_RELEASE_TAG;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalPinnedTag === undefined) delete process.env.COMPANION_RELEASE_TAG;
    else process.env.COMPANION_RELEASE_TAG = originalPinnedTag;
    if (originalPublicPinnedTag === undefined) delete process.env.NEXT_PUBLIC_PUBLISHING_COMPANION_RELEASE_TAG;
    else process.env.NEXT_PUBLIC_PUBLISHING_COMPANION_RELEASE_TAG = originalPublicPinnedTag;
  });

  const latestComplete = release("v2.1.16-qa.2", "2026-09-11T06:29:05Z");
  const newerButIncomplete = release("v2.1.17-qa.1", "2026-09-12T06:29:05Z", [
    "AgenticThat-Publishing-Companion-Setup.exe",
  ]);
  globalThis.fetch = async url => {
    assert.match(String(url), /\/releases\?per_page=30$/);
    return new Response(JSON.stringify([newerButIncomplete, latestComplete]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const { getCompanionRelease } = await import(`./companion-releases.js?test=${Date.now()}`);
  const resolved = await getCompanionRelease();
  const windows = resolved.platforms.find(platform => platform.id === "windows");

  assert.equal(resolved.tagName, "v2.1.16-qa.2");
  assert.equal(resolved.version, "2.1.16-qa.2");
  assert.deepEqual(windows.downloads.map(download => download.label), ["Portable build", "Installer"]);
  assert.equal(windows.downloads[0].primary, true);
  assert.equal(windows.downloads[0].available, true);
  assert.match(windows.downloads[0].href, /v2\.1\.16-qa\.2\/AgenticThat-Publishing-Companion-Windows-x64-Portable\.zip$/);
});
