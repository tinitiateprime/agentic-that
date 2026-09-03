import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(projectRoot, "apps", "publishing-companion-desktop", "assets", "app-icon-1024.png");
const extensionIconDirectory = path.join(projectRoot, "extensions", "publishing-companion", "icons");
const desktopAssetDirectory = path.join(projectRoot, "apps", "publishing-companion-desktop", "assets");
const msixAssetDirectory = path.join(desktopAssetDirectory, "msix");
const rasterSizes = [16, 32, 48, 64, 128, 256, 512, 1024];
const icoSizes = [16, 32, 48, 64, 128, 256];

await Promise.all([
  mkdir(extensionIconDirectory, { recursive: true }),
  mkdir(desktopAssetDirectory, { recursive: true }),
  mkdir(msixAssetDirectory, { recursive: true }),
]);
const source = await readFile(sourcePath);
const pngBySize = new Map();

for (const size of rasterSizes) {
  const png = await sharp(source).resize(size, size, { fit: "cover" }).png().toBuffer();
  pngBySize.set(size, png);
  if ([16, 32, 48, 128].includes(size)) {
    await writeFile(path.join(extensionIconDirectory, `icon-${size}.png`), png);
  }
}

await writeFile(path.join(desktopAssetDirectory, "tray-icon.png"), pngBySize.get(32));

const iconHeader = Buffer.alloc(6);
iconHeader.writeUInt16LE(0, 0);
iconHeader.writeUInt16LE(1, 2);
iconHeader.writeUInt16LE(icoSizes.length, 4);
const entries = [];
let imageOffset = 6 + icoSizes.length * 16;
for (const size of icoSizes) {
  const png = pngBySize.get(size);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size === 256 ? 0 : size, 0);
  entry.writeUInt8(size === 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(imageOffset, 12);
  entries.push(entry);
  imageOffset += png.length;
}

await writeFile(
  path.join(desktopAssetDirectory, "app-icon.ico"),
  Buffer.concat([iconHeader, ...entries, ...icoSizes.map(size => pngBySize.get(size))]),
);

if (process.platform === "darwin") {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "agenticthat-icon-"));
  const iconsetDirectory = path.join(temporaryRoot, "app-icon.iconset");
  try {
    await mkdir(iconsetDirectory, { recursive: true });
    const iconsetFiles = [
      ["icon_16x16.png", 16],
      ["icon_16x16@2x.png", 32],
      ["icon_32x32.png", 32],
      ["icon_32x32@2x.png", 64],
      ["icon_128x128.png", 128],
      ["icon_128x128@2x.png", 256],
      ["icon_256x256.png", 256],
      ["icon_256x256@2x.png", 512],
      ["icon_512x512.png", 512],
      ["icon_512x512@2x.png", 1024],
    ];
    await Promise.all(iconsetFiles.map(([fileName, size]) => (
      writeFile(path.join(iconsetDirectory, fileName), pngBySize.get(size))
    )));
    await execFileAsync("iconutil", [
      "--convert", "icns",
      "--output", path.join(desktopAssetDirectory, "app-icon.icns"),
      iconsetDirectory,
    ]);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

const msixAssets = [
  ["icon.png", 50, 50],
  ["LockScreenLogo.scale-200.png", 48, 48],
  ["SplashScreen.scale-200.png", 1240, 600],
  ["Square150x150Logo.png", 300, 300],
  ["Square150x150Logo.scale-200.png", 300, 300],
  ["Square44x44Logo.png", 88, 88],
  ["Square44x44Logo.scale-200.png", 88, 88],
  ["Square44x44Logo.targetsize-24_altform-unplated.png", 24, 24],
  ["Wide310x150Logo.scale-200.png", 620, 300],
];
await Promise.all(msixAssets.map(async ([fileName, width, height]) => {
  const image = await sharp(source)
    .resize(width, height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await writeFile(path.join(msixAssetDirectory, fileName), image);
}));

console.log("Publishing companion brand assets generated.");
