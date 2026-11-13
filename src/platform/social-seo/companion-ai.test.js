import assert from "node:assert/strict";
import test from "node:test";
import { generateWithCompanionAis } from "./companion-ai.js";

function mockStream(t, lines) {
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url === "/api/social-seo/companion-token") {
      return Response.json({ token: "test-token", expiresInSeconds: 300 });
    }
    return new Response(new ReadableStream({
      start(controller) {
        // Split inside the UTF-8 text and JSON lines, as a real network can.
        const bytes = new TextEncoder().encode(lines);
        for (let index = 0; index < bytes.length; index += 7) {
          controller.enqueue(bytes.slice(index, index + 7));
        }
        controller.close();
      },
    }));
  });
}

test("AI streaming preserves split UTF-8 answers and confirms completion", async (t) => {
  const answer = { provider: "claude", ok: true, raw: "A café ☕" };
  mockStream(t, `${JSON.stringify(answer)}\n{"done":true}\n`);
  const events = [];
  await generateWithCompanionAis({}, (event) => events.push(event));
  assert.deepEqual(events, [answer, { done: true }]);
});

test("AI streaming reports a dropped connection instead of leaving cards working", async (t) => {
  mockStream(t, '{"provider":"claude","state":"working"}\n');
  await assert.rejects(generateWithCompanionAis({}, () => {}), /connection ended before every AI finished/);
});
