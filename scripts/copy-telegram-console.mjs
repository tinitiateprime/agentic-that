import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import "./build-telegram-console.mjs";

const sourceDir = path.resolve("services", "messaging", "telegram", "public");
const publicDir = path.resolve("public");
const legacyTargetDir = path.join(publicDir, "console");
const targetDir = path.join(publicDir, "telegram-console-assets");

// A public/console/index.html shadows the authenticated Next.js /console page
// on Netlify and drops the AgenticThat service token. Keep only static assets
// under a non-route path so /console always reaches the protected app page.
rmSync(legacyTargetDir, { recursive: true, force: true });
rmSync(targetDir, { recursive: true, force: true });
mkdirSync(targetDir, { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true });
