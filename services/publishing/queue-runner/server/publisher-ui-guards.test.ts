import assert from "node:assert/strict";
import test from "node:test";
import { visibleIntersectionPoint } from "./services/publishers/linkedin.js";
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

test("X publishing requires both a selected file and a rendered media preview", () => {
  assert.equal(hasReadyXMedia(1, false), false);
  assert.equal(hasReadyXMedia(0, true), false);
  assert.equal(hasReadyXMedia(1, true), true);
});
