// Builds every AgenticThat Companion icon from the website's Keystone @ brand
// files (see docs/brand.md), so the desktop app looks exactly like the site:
//   apps/publishing-companion-desktop/assets/app-icon-1024.png, app-icon.ico,
//   tray-icon.png, msix/* (Microsoft Store tiles) and public/publishing-companion-icon.ico
//   (the installer icon the website serves).
// Run: node scripts/build-companion-icons.mjs

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.join(root, "apps/publishing-companion-desktop/assets");
const GOLD = "#FACC15";

const appIcon = await readFile(path.join(root, "public/brand/agenticthat-app-icon.svg"));
// The gold favicon tile with the micro symbol: the brand's choice below 32 px.
const smallTile = await readFile(path.join(root, "app/icon.svg"));
const symbol = await readFile(path.join(root, "public/brand/agenticthat-symbol.svg"));

const png = (svg, width, height = width) => sharp(svg, { density: 384 }).resize(width, height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();

/** A solid gold tile with the ink symbol centred at the given share of its height. */
async function tile(width, height, share = 0.5) {
  const size = Math.round(height * share);
  return sharp({ create: { width, height, channels: 4, background: GOLD } })
    .composite([{ input: await png(symbol, size), gravity: "center" }])
    .png()
    .toBuffer();
}

/** An .ico holding PNG images (Windows Vista and later). */
function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.data)]);
}

const icoImages = await Promise.all([16, 24, 32, 48, 64, 128, 256].map(async (size) => ({ size, data: await png(size < 32 ? smallTile : appIcon, size) })));
const icon = ico(icoImages);

const outputs = {
  "app-icon-1024.png": await png(appIcon, 1024),
  "app-icon.ico": icon,
  "tray-icon.png": await png(smallTile, 32),
  "msix/icon.png": await png(appIcon, 50),
  "msix/LockScreenLogo.scale-200.png": await png(smallTile, 48),
  "msix/Square44x44Logo.png": await png(appIcon, 88),
  "msix/Square44x44Logo.scale-200.png": await png(appIcon, 88),
  "msix/Square44x44Logo.targetsize-24_altform-unplated.png": await png(smallTile, 24),
  "msix/Square150x150Logo.png": await tile(300, 300, 0.5),
  "msix/Square150x150Logo.scale-200.png": await tile(300, 300, 0.5),
  "msix/Wide310x150Logo.scale-200.png": await tile(620, 300, 0.5),
  "msix/SplashScreen.scale-200.png": await tile(1240, 600, 0.36),
};
for (const [file, data] of Object.entries(outputs)) {
  await writeFile(path.join(assets, file), data);
  console.log(`assets/${file}`);
}
await writeFile(path.join(root, "public/publishing-companion-icon.ico"), icon);
console.log("public/publishing-companion-icon.ico");
