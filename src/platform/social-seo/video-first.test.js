import assert from "node:assert/strict";
import test from "node:test";
import { runVideoFirst } from "./video-first.js";

test("an AI that refuses the video starts on speech while the others are still working", async () => {
  const order = [];
  let finishClaude;
  const claudeStillWriting = new Promise((resolve) => { finishClaude = resolve; });
  const run = runVideoFirst({
    ids: ["chatgpt", "claude", "gemini"],
    askWithVideo: async (send) => {
      send({ provider: "gemini", ok: false, videoRefused: true });
      send({ provider: "chatgpt", ok: false, limit: true });
      await claudeStillWriting;
      order.push("claude finished");
      send({ provider: "claude", ok: true });
    },
    askWithSpeech: async (providers) => { order.push(`speech: ${providers.join(",")}`); },
    onRefused: (id) => order.push(`refused: ${id}`),
    onEvent: () => undefined,
  });
  await Promise.resolve();
  assert.deepEqual(order, ["refused: gemini", "speech: gemini"], "Gemini doesn't wait for Claude");
  finishClaude();
  await run;
  assert.deepEqual(order, ["refused: gemini", "speech: gemini", "claude finished"], "an AI with no uploads left is skipped, not retried");
});

test("if the video run breaks, AIs that never answered use speech once", async () => {
  const speech = [];
  await runVideoFirst({
    ids: ["chatgpt", "claude", "gemini"],
    askWithVideo: async (send) => {
      send({ provider: "gemini", ok: false, videoRefused: true });
      send({ provider: "claude", ok: true });
      throw new Error("connection dropped");
    },
    askWithSpeech: async (providers) => { speech.push(providers); },
    onRefused: () => undefined,
    onEvent: () => undefined,
  });
  assert.deepEqual(speech, [["gemini"], ["chatgpt"]]);
});
