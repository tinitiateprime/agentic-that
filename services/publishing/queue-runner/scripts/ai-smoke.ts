// Manual smoke test for the local AI: node --import tsx scripts/ai-smoke.ts <tier> <image...>
import fs from "node:fs";
import path from "node:path";
import { localAi } from "../server/services/ai/ai-engine.ts";
import { generatePostSeo } from "../server/services/ai/post-seo.ts";

const [tier = "lite", ...images] = process.argv.slice(2);
const status = await localAi.status();
console.log("status:", status.phase, "memory", status.memoryGb, "GB, recommended", status.recommendedTier);
if (status.phase !== "installed" || status.tier?.id !== tier) {
  const timer = setInterval(async () => {
    const s = await localAi.status();
    if (s.progress) console.log(`  ${s.progress.file}: ${(s.progress.overallReceived / 1e6).toFixed(0)} / ${(s.progress.overallTotal / 1e6).toFixed(0)} MB`);
  }, 5000);
  await localAi.install(tier);
  clearInterval(timer);
  console.log("installed:", (await localAi.status()).tier);
}
if (!images.length) process.exit(0);
const dataUrls = images.map((file) => `data:image/jpeg;base64,${fs.readFileSync(file).toString("base64")}`);
const description = process.env.DESC || "";
const started = Date.now();
const result = await generatePostSeo({
  platforms: ["instagram", "facebook", "linkedin", "youtube"],
  images: dataUrls,
  mediaKind: images.length > 1 ? "carousel" : "image",
  description,
  brandName: process.env.BRAND || "",
  location: process.env.LOCATION || "",
});
console.log(JSON.stringify(result, null, 2));
console.log("seconds:", ((Date.now() - started) / 1000).toFixed(1), path.basename(images[0]));
await localAi.stop();
process.exit(0);
