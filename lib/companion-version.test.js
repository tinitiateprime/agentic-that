import assert from "node:assert/strict";
import test from "node:test";
import { versionAtLeast } from "./companion-version.js";

test("Companion version checks compare semantic numeric parts", () => {
  assert.equal(versionAtLeast("1.7.0", "1.7.0"), true);
  assert.equal(versionAtLeast("1.10.0", "1.7.0"), true);
  assert.equal(versionAtLeast("1.6.21", "1.7.0"), false);
  assert.equal(versionAtLeast("development", "1.7.0"), false);
  assert.equal(versionAtLeast(undefined, "1.7.0"), false);
});
