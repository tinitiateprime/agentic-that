import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = path.join(projectRoot, "extensions", "publishing-companion");
const manifestPath = path.join(extensionRoot, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const productionOrigin = "https://agentic-that.netlify.app";
const productionMatch = `${productionOrigin}/*`;
const quickTunnelMatch = "https://*.trycloudflare.com/*";

if (manifest.manifest_version !== 3) throw new Error("Publishing extension must use Manifest V3.");
if (!manifest.background?.service_worker) throw new Error("Publishing extension service worker is missing.");
if (!Array.isArray(manifest.content_scripts) || manifest.content_scripts.length === 0) {
  throw new Error("Publishing extension dashboard bridge is missing.");
}
if ((manifest.host_permissions ?? []).some(permission => permission === "<all_urls>")) {
  throw new Error("Publishing extension must not request <all_urls>.");
}
if (!(manifest.permissions ?? []).includes("scripting") || !(manifest.permissions ?? []).includes("storage")) {
  throw new Error("Companion extension must support explicitly trusted dashboard origins.");
}
if (!(manifest.optional_host_permissions ?? []).includes("https://*/*")) {
  throw new Error("Companion extension must allow users to approve their exact HTTPS dashboard origin.");
}
const extensionPermissions = [
  ...(manifest.host_permissions ?? []),
  ...(manifest.content_scripts ?? []).flatMap(script => script.matches ?? []),
];
if (extensionPermissions.some(permission => /instagram\.com/i.test(permission))) {
  throw new Error("Publishing extension must not request or inject on Instagram hosts.");
}
if (!manifest.content_scripts.some(script => (script.matches ?? []).includes(productionMatch))) {
  throw new Error(`Publishing extension must inject the dashboard bridge on ${productionMatch}.`);
}
if (!manifest.content_scripts.some(script => (script.matches ?? []).includes(quickTunnelMatch))) {
  throw new Error(`Publishing extension must inject the dashboard bridge on ${quickTunnelMatch}.`);
}
if (!(manifest.web_accessible_resources ?? []).some(resource => (resource.matches ?? []).includes("https://*/*"))) {
  throw new Error("Companion extension media resources must support explicitly trusted HTTPS dashboards.");
}

const files = new Set([
  manifest.background.service_worker,
  "trusted-origins.js",
  "popup.js",
  manifest.action?.default_popup,
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
  ...manifest.content_scripts.flatMap(script => script.js ?? []),
  ...(manifest.web_accessible_resources ?? []).flatMap(resource => resource.resources ?? []),
].filter(Boolean));

for (const file of files) await access(path.join(extensionRoot, file));

const scriptFiles = [...files].filter(file => file.endsWith(".js"));
for (const file of scriptFiles) {
  const source = await readFile(path.join(extensionRoot, file), "utf8");
  if (/\beval\s*\(|new\s+Function\s*\(/.test(source)) {
    throw new Error(`${file} contains forbidden dynamic code execution.`);
  }
  if (file === manifest.background.service_worker && !source.includes(JSON.stringify(productionOrigin))) {
    throw new Error(`Publishing extension service worker must trust ${productionOrigin}.`);
  }
}

console.log(`Publishing extension valid: Manifest V${manifest.manifest_version}, version ${manifest.version}, ${files.size} referenced files.`);
