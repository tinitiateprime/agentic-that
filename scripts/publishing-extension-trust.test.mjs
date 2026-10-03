import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helperSource = await readFile(
  path.join(projectRoot, "extensions", "publishing-companion", "trusted-origins.js"),
  "utf8",
);
const context = vm.createContext({ URL });
vm.runInContext(helperSource, context);
const helper = context.AgenticThatTrustedOrigins;

test("trusted dashboard origins normalize paths to their exact origin", () => {
  assert.equal(helper.normalizeDashboardOrigin("https://demo.example.com/publishing?platform=instagram"), "https://demo.example.com");
});

test("Cloudflare quick tunnels use the packaged bridge without a second permission request", () => {
  assert.equal(helper.hasStaticBridgeForOrigin("https://sample.trycloudflare.com"), true);
  assert.equal(helper.hasStaticBridgeForOrigin("https://trycloudflare.com.example.org"), false);
  assert.equal(helper.hasStaticBridgeForOrigin("https://app.example.com"), false);
});

test("trusted script IDs are stable across routes on the same dashboard", () => {
  assert.equal(helper.trustedScriptId("https://app.example.com/publishing"), helper.trustedScriptId("https://app.example.com/config-manager"));
});
