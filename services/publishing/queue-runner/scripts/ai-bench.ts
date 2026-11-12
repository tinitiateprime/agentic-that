// Speed check for the local AI: node --import tsx scripts/ai-bench.ts <image>
import fs from "node:fs";
import os from "node:os";
import { localAi } from "../server/services/ai/ai-engine.ts";
import { analyzeMedia, writeForPlatform } from "../server/services/ai/post-seo.ts";

const image = process.argv[2];
const report = (label: string, started: number) => {
  const t = localAi.lastTimings;
  console.log(`${label}: ${((Date.now() - started) / 1000).toFixed(1)}s total` + (t
    ? ` | prompt ${t.prompt_n} tokens in ${(t.prompt_ms / 1000).toFixed(1)}s (${(t.prompt_n / (t.prompt_ms / 1000)).toFixed(1)}/s) | wrote ${t.predicted_n} tokens in ${(t.predicted_ms / 1000).toFixed(1)}s (${(t.predicted_n / (t.predicted_ms / 1000)).toFixed(1)}/s)`
    : ""));
};
console.log("free memory GB", (os.freemem() / 1024 ** 3).toFixed(1), "| tier", (await localAi.status()).tier?.label);

let started = Date.now();
await localAi.chat({ messages: [{ role: "user", content: "Write one short sentence about coffee." }], schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false }, maxTokens: 120 });
report("1. warm-up + short text (includes loading the model)", started);

const dataUrl = `data:image/jpeg;base64,${fs.readFileSync(image).toString("base64")}`;
started = Date.now();
const analysis = await analyzeMedia({ images: [dataUrl], mediaKind: "image", description: process.env.DESC || "" });
report("2. image analysis", started);
console.log(JSON.stringify(analysis, null, 2));

started = Date.now();
const instagram = await writeForPlatform("instagram", { mediaKind: "image", description: process.env.DESC || "", brandName: process.env.BRAND || "", location: process.env.LOCATION || "" }, analysis);
report("3. Instagram post", started);
console.log(JSON.stringify(instagram, null, 2));
await localAi.stop();
process.exit(0);
