// Manual timing of the real user flow: node --import tsx scripts/ai-flow-bench.ts <image>
// Page opens (model loads) -> upload (media studied) -> click (each app written).
import fs from "node:fs";
import { localAi } from "../server/services/ai/ai-engine.ts";
import { analyzeMedia, writeForPlatform } from "../server/services/ai/post-seo.ts";
const [image] = process.argv.slice(2);
const t0 = Date.now(); const s = (t: number) => ((Date.now() - t) / 1000).toFixed(0) + "s";
await localAi.warm(); console.log("page open -> model loaded:", s(t0), "| model:", (await localAi.status()).tier?.label);
const t1 = Date.now();
// On a crash, show what the engine said.
process.on("uncaughtException", (error) => { console.log("FAILED:", error.message, "\nENGINE:", ((localAi as any).stderrTail || []).join("").slice(-1500)); process.exit(1); });
process.on("unhandledRejection", (error: any) => { console.log("FAILED:", error?.message, "\nENGINE:", ((localAi as any).stderrTail || []).join("").slice(-1500)); process.exit(1); });
const analysis = await analyzeMedia({ images: [`data:image/jpeg;base64,${fs.readFileSync(image).toString("base64")}`], mediaKind: "image" });
// Where the time goes: reading the prompt (incl. the image) vs writing tokens.
const speed = () => { const t: any = (localAi as any).lastTimings; return t ? `[read ${t.prompt_n} tok in ${(t.prompt_ms / 1000).toFixed(1)}s | wrote ${t.predicted_n} tok in ${(t.predicted_ms / 1000).toFixed(1)}s = ${(t.predicted_n / (t.predicted_ms / 1000)).toFixed(1)} tok/s]` : ""; };
console.log("upload -> media studied (while user types):", s(t1), speed(), "| backend:", localAi.backend); console.log(JSON.stringify(analysis));
const context = { mediaKind: "image" as const, description: process.env.DESC || "", brandName: process.env.BRAND || "", location: process.env.LOCATION || "", businessDetails: process.env.BUSINESS || "" };
const t2 = Date.now();
// APPS=instagram tests one app only.
const apps = (process.env.APPS || "instagram,facebook,linkedin,youtube").split(",") as Array<"instagram" | "facebook" | "linkedin" | "youtube">;
for (const app of apps) {
  const r: any = await writeForPlatform(app, context, analysis);
  const score = r.seoScore ? ` | SEO ${r.seoScore.score}/10${r.seoScore.checks.filter((c: any) => !c.passed).map((c: any) => ` (missing: ${c.id})`).join("")}` : "";
  console.log(`\n== ${app} ready ${s(t2)} after click${score} ${speed()}\n` +(r.fullText || `${r.title}\n${r.description}\nTAGS: ${r.tags.join(", ")}`));
}
await localAi.stop(); process.exit(0);
