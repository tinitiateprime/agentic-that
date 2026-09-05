import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  throw new Error("macOS Companion artifacts must be built on macOS.");
}

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const makeRoot = path.join(desktopRoot, "out", "make");
const forgeBinary = path.join(desktopRoot, "node_modules", ".bin", "electron-forge");
const volumeName = "AgenticThat Companion";

function run(command, args, allowFailure = false) {
  const result = spawnSync(command, args, {
    cwd: desktopRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${path.basename(command)} ${args.join(" ")} failed with exit code ${result.status}.`);
  }
  return result.status ?? 1;
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(target) : [target];
  }));
  return nested.flat();
}

async function dmgFiles() {
  return (await filesBelow(makeRoot)).filter(file => file.toLowerCase().endsWith(".dmg"));
}

function detachStaleVolumes() {
  for (let suffix = 0; suffix <= 4; suffix += 1) {
    const mount = `/Volumes/${volumeName}${suffix === 0 ? "" : ` ${suffix}`}`;
    spawnSync("hdiutil", ["detach", mount, "-force"], { stdio: "ignore" });
  }
}

function validDmg(file) {
  return spawnSync("hdiutil", ["verify", file], { stdio: "inherit" }).status === 0;
}

run(forgeBinary, ["package", "--platform=darwin", "--arch=universal"]);
run(forgeBinary, [
  "make", "--platform=darwin", "--arch=universal", "--skip-package",
  "--targets", "@electron-forge/maker-zip",
]);

let lastStatus = 1;
for (let attempt = 1; attempt <= 3; attempt += 1) {
  detachStaleVolumes();
  for (const file of await dmgFiles()) await rm(file, { force: true });

  console.log(`Creating macOS DMG (attempt ${attempt}/3)...`);
  lastStatus = run(forgeBinary, [
    "make", "--platform=darwin", "--arch=universal", "--skip-package",
    "--targets", "@electron-forge/maker-dmg",
  ], true);
  const images = await dmgFiles();
  if (lastStatus === 0) break;
  if (images.length > 0 && images.every(validDmg)) {
    console.warn("The DMG maker reported only a detach failure; every generated image passed hdiutil verification.");
    lastStatus = 0;
    break;
  }
  if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 2000));
}

detachStaleVolumes();
if (lastStatus !== 0) throw new Error("Could not create a verified macOS DMG after three attempts.");
