import assert from "node:assert/strict";
import test from "node:test";
import { publishingNormalizedStoreTestHelpers } from "./publishing-normalized-store.js";

const { readNormalizedDocument, replaceNormalizedDocument } = publishingNormalizedStoreTestHelpers;

test("normalized publishing reads every collection in one database round trip", async () => {
  const calls = [];
  const transaction = {
    unsafe: async (query, parameters) => {
      calls.push({ query, parameters });
      return [
        { collection: "accounts", record: { id: "account_1", workspaceId: "workspace_1" } },
        { collection: "uploads", record: JSON.stringify({ id: "upload_1", workspaceId: "workspace_1" }) },
      ];
    },
  };

  const document = await readNormalizedDocument(transaction, {}, "workspace_1");

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].parameters, ["workspace_1"]);
  assert.match(calls[0].query, /UNION ALL/);
  assert.equal(document.accounts[0].id, "account_1");
  assert.equal(document.uploads[0].id, "upload_1");
  assert.deepEqual(document.submissions, []);
});

test("normalized publishing replaces a workspace in one bulk database round trip", async () => {
  const calls = [];
  const transaction = {
    unsafe: async (query, parameters) => {
      calls.push({ query, parameters });
      return [{ affected: 1 }];
    },
  };
  const document = {
    accounts: [
      { id: "account_1", workspaceId: "workspace_1", updatedAt: "2026-09-07T00:00:00.000Z" },
      { id: "account_other", workspaceId: "workspace_2", updatedAt: "2026-09-07T00:00:00.000Z" },
    ],
  };

  await replaceNormalizedDocument(transaction, document, "workspace_1");

  assert.equal(calls.length, 1);
  assert.match(calls[0].query, /upsert_accounts/);
  assert.match(calls[0].query, /delete_pairings/);
  const payload = calls[0].parameters[0];
  assert.deepEqual(payload.accounts.map((account) => account.id), ["account_1"]);
  assert.deepEqual(payload.uploads, []);
  assert.equal(calls[0].parameters[1], "workspace_1");
});
