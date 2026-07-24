import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = path.join(projectRoot, "apps", "publishing-companion-desktop");
const runtimeDirectory = path.join(desktopRoot, "runtime");
const runtimeDesktopAssets = path.join(runtimeDirectory, "desktop");

await rm(runtimeDirectory, { recursive: true, force: true });
await mkdir(runtimeDirectory, { recursive: true });
await build({
  entryPoints: [path.join(projectRoot, "services", "publishing", "queue-runner", "server", "index.ts")],
  outfile: path.join(runtimeDirectory, "server.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: false,
  minify: false,
  external: ["playwright-core", "@netlify/blobs"],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});

await mkdir(runtimeDesktopAssets, { recursive: true });
await Promise.all(["media-proxy.html", "media-proxy.js", "media-proxy.css"].map(fileName =>
  copyFile(
    path.join(projectRoot, "extensions", "publishing-companion", fileName),
    path.join(runtimeDesktopAssets, fileName),
  )
));

console.log(`Publishing companion runtime built at ${runtimeDirectory}.`);
