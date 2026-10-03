import assert from "node:assert/strict";
import test from "node:test";
import { requestCentralWorkspaceSync, setCentralWorkspaceSyncHandler } from "./central-sync.js";

test("a verified local login can request an immediate central inventory sync", async () => {
  let calls = 0;
  setCentralWorkspaceSyncHandler(async () => {
    calls += 1;
  });
  try {
    await requestCentralWorkspaceSync();
    assert.equal(calls, 1);
  } finally {
    setCentralWorkspaceSyncHandler(null);
  }
});

test("central sync requests are safe before a workspace is paired", async () => {
  setCentralWorkspaceSyncHandler(null);
  await assert.doesNotReject(requestCentralWorkspaceSync());
});
