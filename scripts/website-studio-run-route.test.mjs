import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

// Exercise the actual route with asynchronous authorization, as production
// uses, while keeping test requests away from real sessions and databases.
async function routeFixture({ denied = false, missing = false } = {}) {
  const result = await build({
    entryPoints: ["app/api/website-studio/[id]/run/route.js"],
    bundle: true, write: false, platform: "node", format: "esm",
    plugins: [{ name: "isolated-route-dependencies", setup(builder) {
      builder.onResolve({ filter: /^@platform\/server\// }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("access-control") ? `
        export async function authorizeApiAccess() { return { userId: "fixture-owner", workspaceId: "fixture-workspace" }; }
        export async function assertPrincipalCapability(actor) {
          await Promise.resolve();
          if (${denied}) throw Object.assign(new Error("Access denied"), { status: 403 });
          return actor;
        }
        export function accessErrorResponse(error) { if (error.status === 403) return Response.json({ error: "Access denied" }, { status: 403 }); throw error; }
      ` : `
        export async function advanceWebsiteRequestJob(actor, id) {
          if (actor.userId !== "fixture-owner") throw new Error("The route passed an unresolved authorization result.");
          if (${missing}) throw Object.assign(new Error("Missing"), { status: 404 });
          return { project: { id, ownerId: actor.userId } };
        }
      ` }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

test("website run resolves asynchronous capability authorization before advancing the owner's project", async () => {
  const route = await routeFixture();
  const response = await route.POST(new Request("https://example.test"), { params: Promise.resolve({ id: "website_fixture" }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, project: { id: "website_fixture", ownerId: "fixture-owner" } });
});

test("website run returns denied capability access without advancing a job", async () => {
  const route = await routeFixture({ denied: true });
  const response = await route.POST(new Request("https://example.test"), { params: Promise.resolve({ id: "website_fixture" }) });
  assert.equal(response.status, 403);
});

test("website run preserves a missing project response", async () => {
  const route = await routeFixture({ missing: true });
  const response = await route.POST(new Request("https://example.test"), { params: Promise.resolve({ id: "website_fixture" }) });
  assert.equal(response.status, 404);
});
