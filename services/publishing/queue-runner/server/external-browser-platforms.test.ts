import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { externalBrowserExecutableCandidates } from "./engines/external-browser/index.js";

test("external browser discovery covers standard Windows installations", () => {
  const candidates = externalBrowserExecutableCandidates({
    platform: "win32",
    environment: {
      ProgramFiles: "C:\\Program Files",
      "ProgramFiles(x86)": "C:\\Program Files (x86)",
      LOCALAPPDATA: "C:\\Users\\Test\\AppData\\Local",
    },
    homeDirectory: "C:\\Users\\Test",
  });
  assert.ok(candidates.some(candidate => candidate.endsWith(path.join("Google", "Chrome", "Application", "chrome.exe"))));
  assert.ok(candidates.some(candidate => candidate.endsWith(path.join("Microsoft", "Edge", "Application", "msedge.exe"))));
});

test("external browser discovery covers system and user macOS applications", () => {
  const candidates = externalBrowserExecutableCandidates({
    platform: "darwin",
    environment: {},
    homeDirectory: "/Users/test",
  });
  assert.ok(candidates.includes("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"));
  assert.ok(candidates.includes("/Users/test/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"));
  assert.ok(candidates.includes("/Applications/Chromium.app/Contents/MacOS/Chromium"));
});

test("external browser discovery covers Linux packages, PATH, Snap, and explicit overrides", () => {
  const candidates = externalBrowserExecutableCandidates({
    platform: "linux",
    environment: {
      PATH: "/custom/bin:/usr/bin",
      CHROMIUM_PATH: "/managed/chromium",
    },
    homeDirectory: "/home/test",
  });
  assert.equal(candidates[0], "/managed/chromium");
  assert.ok(candidates.includes("/custom/bin/google-chrome-stable"));
  assert.ok(candidates.includes("/usr/bin/microsoft-edge"));
  assert.ok(candidates.includes("/snap/bin/chromium"));
});
