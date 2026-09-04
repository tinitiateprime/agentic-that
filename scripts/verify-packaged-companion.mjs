import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = path.join(projectRoot, "apps", "publishing-companion-desktop");
const manifest = JSON.parse(await readFile(path.join(desktopRoot, "package.json"), "utf8"));
const argumentsMap = Object.fromEntries(process.argv.slice(2).map(argument => {
  const [key, ...value] = argument.replace(/^--/, "").split("=");
  return [key, value.join("=")];
}));
const platform = argumentsMap.platform || process.platform;
const architecture = argumentsMap.arch || process.arch;
const outRoot = path.join(desktopRoot, "out");
const packageDirectoryName = (await readdir(outRoot)).find(name => (
  name.endsWith(`-${platform}-${architecture}`) && !name.startsWith("make")
));
if (!packageDirectoryName) throw new Error(`Packaged Companion ${platform}/${architecture} was not found in ${outRoot}.`);
const packageRoot = path.join(outRoot, packageDirectoryName);

let executablePath;
let applicationRoot;
if (platform === "win32") {
  executablePath = path.join(packageRoot, "AgenticThat Publishing Companion.exe");
  applicationRoot = path.join(packageRoot, "resources", "app");
} else if (platform === "darwin") {
  const appBundle = path.join(packageRoot, "AgenticThat Companion.app");
  executablePath = path.join(appBundle, "Contents", "MacOS", "agenticthat-companion");
  applicationRoot = path.join(appBundle, "Contents", "Resources", "app");
} else if (platform === "linux") {
  executablePath = path.join(packageRoot, "agenticthat-companion");
  applicationRoot = path.join(packageRoot, "resources", "app");
} else {
  throw new Error(`Unsupported packaged Companion platform: ${platform}`);
}

await Promise.all([
  access(executablePath),
  access(path.join(applicationRoot, "main.js")),
  access(path.join(applicationRoot, "platform-support.js")),
  access(path.join(applicationRoot, "control.html")),
  access(path.join(applicationRoot, "runtime", "server.mjs")),
  access(path.join(applicationRoot, "node_modules", "sharp", "package.json")),
  access(path.join(applicationRoot, "assets", "app-icon-1024.png")),
]);

if (platform === "darwin" && architecture === "universal") {
  await Promise.all([
    access(path.join(applicationRoot, "node_modules", "@img", "sharp-darwin-x64", "lib", `sharp-darwin-x64-${manifest.dependencies.sharp}.node`)),
    access(path.join(applicationRoot, "node_modules", "@img", "sharp-darwin-arm64", "lib", `sharp-darwin-arm64-${manifest.dependencies.sharp}.node`)),
    access(path.join(applicationRoot, "node_modules", "@img", "sharp-libvips-darwin-x64", "lib")),
    access(path.join(applicationRoot, "node_modules", "@img", "sharp-libvips-darwin-arm64", "lib")),
  ]);
}

const packagedManifest = JSON.parse(await readFile(path.join(applicationRoot, "package.json"), "utf8"));
if (packagedManifest.version !== manifest.version) {
  throw new Error(`Packaged version ${packagedManifest.version} does not match expected version ${manifest.version}.`);
}
const mainSource = await readFile(path.join(applicationRoot, "main.js"), "utf8");
const runtimeSource = await readFile(path.join(applicationRoot, "runtime", "server.mjs"), "utf8");
for (const requiredText of ["secureStorageAvailable", "linuxAutostartDesktopEntry", "subscribeFacebookCompanionActivity", "isolated public browser session"]) {
  if (!mainSource.includes(requiredText)) throw new Error(`Packaged main process is missing ${requiredText}.`);
}
for (const requiredText of ["companion_claim_jobs", "scrape.instagram", "scraping.facebook", "instagram-ready.jpg"]) {
  if (!runtimeSource.includes(requiredText)) throw new Error(`Packaged runtime is missing ${requiredText}.`);
}

console.log(`Packaged Companion ${manifest.version} verified for ${platform}/${architecture}.`);
