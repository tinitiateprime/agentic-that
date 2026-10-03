import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = path.join(projectRoot, "apps", "publishing-companion-desktop");
const makeRoot = path.join(desktopRoot, "out", "make");
const artifactRoot = path.join(projectRoot, "artifacts");
const manifest = JSON.parse(await readFile(path.join(desktopRoot, "package.json"), "utf8"));

const argumentsMap = Object.fromEntries(process.argv.slice(2).map(argument => {
  const [key, ...value] = argument.replace(/^--/, "").split("=");
  return [key, value.join("=")];
}));
const platform = argumentsMap.platform || process.platform;
const architecture = argumentsMap.arch || process.arch;
if (!new Set(["win32", "darwin", "linux"]).has(platform)) {
  throw new Error(`Unsupported Companion release platform: ${platform}`);
}
if (!new Set(["x64", "arm64", "universal"]).has(architecture)) {
  throw new Error(`Unsupported Companion release architecture: ${architecture}`);
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(target) : [target];
  }));
  return nested.flat();
}

const outputFiles = await filesBelow(makeRoot);
await mkdir(artifactRoot, { recursive: true });

function requireFile(predicate, description) {
  const match = outputFiles.find(predicate);
  if (!match) throw new Error(`${description} was not produced below ${makeRoot}.`);
  return match;
}

async function copyAs(source, ...names) {
  for (const name of names) await copyFile(source, path.join(artifactRoot, name));
}

const artifactForVersion = file => path.basename(file).includes(manifest.version);
const zip = requireFile(
  file => file.toLowerCase().endsWith(".zip") && artifactForVersion(file),
  `${platform} Companion ${manifest.version} ZIP`,
);
if (platform === "win32") {
  const setup = requireFile(file => path.basename(file) === "AgenticThat-Publishing-Companion-Setup.exe", "Windows Companion Setup executable");
  const releases = requireFile(file => path.basename(file) === "RELEASES", "Squirrel.Windows update manifest");
  const updatePackage = requireFile(
    file => file.toLowerCase().endsWith("-full.nupkg") && artifactForVersion(file),
    `Squirrel.Windows ${manifest.version} update package`,
  );
  await copyAs(setup, "AgenticThat-Publishing-Companion-Setup.exe");
  await copyAs(releases, "RELEASES");
  await copyAs(updatePackage, path.basename(updatePackage));
  await copyAs(zip,
    "AgenticThat-Publishing-Companion-Windows-x64-Portable.zip",
    // Retain the stable alias used by existing deployments.
    "AgenticThat-Publishing-Companion-Portable.zip",
  );
} else if (platform === "darwin") {
  const dmg = requireFile(
    file => file.toLowerCase().endsWith(".dmg") && (
      artifactForVersion(file) || path.basename(file) === "AgenticThat Companion.dmg"
    ),
    `macOS Companion ${manifest.version} DMG`,
  );
  await copyAs(dmg,
    `AgenticThat-Publishing-Companion-macOS-${architecture}.dmg`,
  );
  await copyAs(zip,
    `AgenticThat-Publishing-Companion-darwin-${architecture}.zip`,
  );
} else {
  const deb = requireFile(
    file => file.toLowerCase().endsWith(".deb") && artifactForVersion(file),
    `Linux Companion ${manifest.version} DEB`,
  );
  const rpm = requireFile(
    file => file.toLowerCase().endsWith(".rpm") && artifactForVersion(file),
    `Linux Companion ${manifest.version} RPM`,
  );
  await copyAs(deb,
    `AgenticThat-Publishing-Companion-Linux-${architecture}.deb`,
  );
  await copyAs(rpm,
    `AgenticThat-Publishing-Companion-Linux-${architecture}.rpm`,
  );
  await copyAs(zip,
    `AgenticThat-Publishing-Companion-Linux-${architecture}.zip`,
  );
}

console.log(`${platform}/${architecture} Companion release artifacts copied to ${artifactRoot}.`);
