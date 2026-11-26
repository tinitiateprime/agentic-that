import assert from "node:assert/strict";
import test from "node:test";

import { describeMetaStatusError, withFailureNote } from "./meta-status.js";

test("known Meta failure codes get an actionable explanation", () => {
  assert.match(
    describeMetaStatusError([{ code: 131047, title: "Re-engagement message" }]),
    /^\(131047\) More than 24 hours/
  );
  assert.match(describeMetaStatusError([{ code: 131026 }]), /country code/);
});

test("unknown codes fall back to Meta's own details", () => {
  assert.equal(
    describeMetaStatusError([{ code: 999999, title: "Odd", error_data: { details: "Something specific" } }]),
    "(999999) Something specific"
  );
  assert.match(describeMetaStatusError(undefined), /without a reason/);
});

test("a failure note is added once, even when Meta retries the webhook", () => {
  const once = withFailureNote("Hello", "(131047) closed");
  assert.equal(once, "Hello\n\n[send failed: (131047) closed]");
  assert.equal(withFailureNote(once, "(131047) closed"), once);
});
