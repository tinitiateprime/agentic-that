import { build } from "esbuild";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { ZipArchive } from "archiver";

const require = createRequire(import.meta.url);
const output = path.resolve("artifacts/aws/worker");
await mkdir(output, { recursive: true });
await build({
  entryPoints: ["src/platform/server/background-worker.ts"],
  outfile: path.join(output, "index.mjs"),
  platform: "node", target: "node22", format: "esm", bundle: true,
  banner: { js: 'import { createRequire as awsCreateRequire } from "node:module"; const require = awsCreateRequire(import.meta.url);' },
  external: ["@sparticuz/chromium", "playwright-core", "sharp"],
  sourcemap: false,
});
await writeFile(path.join(output, "package.json"), JSON.stringify({ private: true, type: "module" }));

const archive = new ZipArchive({ zlib: { level: 9 } });
const archivePath = path.resolve("artifacts/aws/background-worker.zip");
const destination = createWriteStream(archivePath);
const finished = new Promise((resolve, reject) => { destination.on("close", resolve); destination.on("error", reject); archive.on("error", reject); });
archive.pipe(destination);
archive.file(path.join(output, "index.mjs"), { name: "index.mjs" });
archive.file(path.join(output, "package.json"), { name: "package.json" });
const seen = new Set();
let uncompressedBytes = (await stat(path.join(output, "index.mjs"))).size;
async function packageRoot(name, from) {
  const resolver = createRequire(path.join(from, "package.json"));
  for (const directory of resolver.resolve.paths(name) || []) {
    const root = path.join(directory, name);
    if (existsSync(path.join(root, "package.json"))) return root;
  }
  const error = new Error(`Worker dependency ${name} is not installed.`);
  error.code = "MODULE_NOT_FOUND";
  throw error;
}

async function linuxPackage(name, version) {
  const root = path.resolve("artifacts/aws/native", name.replaceAll("/", "-"));
  await mkdir(root, { recursive: true });
  const npm = process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  const packed = JSON.parse(execFileSync(process.execPath, [npm, "pack", `${name}@${version}`, "--json", "--pack-destination", root], { encoding: "utf8" }));
  execFileSync("tar", ["-xzf", path.join(root, packed[0].filename), "-C", root]);
  return path.join(root, "package");
}
async function size(directory) {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) bytes += await size(file);
    else if (entry.isFile()) bytes += (await stat(file)).size;
  }
  return bytes;
}
async function include(name, from, version) {
  if (seen.has(name)) return;
  seen.add(name);
  let root;
  try { root = await packageRoot(name, from); }
  catch (error) {
    if (!name.startsWith("@img/") || !name.includes("linux-x64") || !version) throw error;
    root = await linuxPackage(name, version);
  }
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  archive.directory(root, `node_modules/${name}`, data => data.name.includes("/node_modules/") ? false : data);
  uncompressedBytes += await size(root);
  for (const dependency of Object.keys(manifest.dependencies || {})) await include(dependency, root);
  for (const dependency of Object.keys(manifest.optionalDependencies || {})) {
    // Cross-platform package builds retain only Linux x64 binaries for Lambda.
    if (dependency.startsWith("@img/") && !dependency.includes("linux-x64")) continue;
    await include(dependency, root, manifest.optionalDependencies[dependency]);
  }
}
for (const name of ["@sparticuz/chromium", "playwright-core", "sharp"]) await include(name, process.cwd());
if (uncompressedBytes > 250 * 1024 * 1024) throw new Error("AWS worker exceeds Lambda's uncompressed package limit.");
await archive.finalize();
await finished;
console.log(`AWS worker: ${(uncompressedBytes / 1024 / 1024).toFixed(1)} MB uncompressed; ${(archive.pointer() / 1024 / 1024).toFixed(1)} MB zipped.`);
