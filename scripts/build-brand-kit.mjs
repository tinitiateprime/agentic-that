// Builds the AgenticThat logo kit from one source: the Keystone @ geometry in
// scripts/brand/keystone.mjs and the Outfit fonts in scripts/brand/fonts.
//
//   npm i --no-save opentype.js@1.3.4   (only needed to run this script)
//   node scripts/build-brand-kit.mjs
//
// Writes public/brand/*, the app favicons and share image, and src/platform/brand-paths.js.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keystone, MICRO } from "./brand/keystone.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const sharp = require("sharp");
const opentype = await import(process.env.OPENTYPE_MODULE || "opentype.js").then((m) => m.default || m)
  .catch(() => { throw new Error("opentype.js is missing. Run: npm i --no-save opentype.js@1.3.4"); });

const C = { ink: "#171717", gold: "#FACC15", ivory: "#F5F2E9", white: "#FFFFFF" };
const out = (...p) => path.join(root, ...p);
const r2 = (n) => Math.round(n * 100) / 100;

const bold = opentype.parse((await readFile(out("scripts/brand/fonts/Outfit-Bold.ttf"))).buffer);
const regular = opentype.parse((await readFile(out("scripts/brand/fonts/Outfit-Regular.ttf"))).buffer);

const MASTER = keystone();
const MICROK = keystone(MICRO);

// Lays text out as outlines. Tracking and the c–T pair follow the refined wordmark spec.
function textPath(font, text, { capHeight, x = 0, baseline = 0, tracking = -0.04, pairs = { cT: -0.035 } }) {
  const capUnits = font.tables.os2.sCapHeight || font.unitsPerEm * 0.7;
  const size = capHeight / (capUnits / font.unitsPerEm);
  const glyphs = font.stringToGlyphs(text);
  let pen = x, d = "", x1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  glyphs.forEach((glyph, i) => {
    const p = glyph.getPath(pen, baseline, size);
    const box = p.getBoundingBox();
    if (box.x1 < x1) x1 = box.x1;
    if (box.x2 > x2) x2 = box.x2;
    if (box.y2 > y2) y2 = box.y2;
    d += p.toPathData(2);
    const next = glyphs[i + 1];
    if (next) {
      const pair = text[i] + text[i + 1];
      pen += (glyph.advanceWidth + font.getKerningValue(glyph, next)) * size / font.unitsPerEm
        + (tracking + (pairs[pair] || 0)) * size;
    }
  });
  return { d, x1, x2, width: x2 - x1, bottom: y2, size };
}

const symbolPaths = (k, fill, t = null) =>
  `<path d="${k.ring}" fill="${fill}"/><path d="${k.a}" fill="${fill}" fill-rule="evenodd"/>${t ? `<path d="${k.tShape}" fill="${t}"/>` : ""}`;
const svgDoc = (viewBox, body, title = "AgenticThat") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;

// Symbol occupies 4..96 on its grid (92 units tall).
const SYM = 92;

// Horizontal lockup: gap 0.25 × symbol height, cap height 0.46 × symbol height, caps centred on the symbol.
const hCap = 0.46 * SYM;
const hProbe = textPath(bold, "AgenticThat", { capHeight: hCap });
const hX = 96 + 0.25 * SYM - hProbe.x1;
const hWord = textPath(bold, "AgenticThat", { capHeight: hCap, x: hX, baseline: 50 + hCap / 2 });
const hBox = `4 4 ${r2(hWord.x2 - 4)} ${SYM}`;
const horizontal = (symbolFill, wordFill) => svgDoc(hBox, symbolPaths(MASTER, symbolFill) + `<path d="${hWord.d}" fill="${wordFill}"/>`);

// Stacked lockup: name centred under the symbol.
const sCap = 0.3 * SYM;
const sProbe = textPath(bold, "AgenticThat", { capHeight: sCap });
const sBaseline = 96 + 0.22 * SYM + sCap;
const sX = 50 - sProbe.width / 2 - sProbe.x1;
const sWord = textPath(bold, "AgenticThat", { capHeight: sCap, x: sX, baseline: sBaseline });
const sLeft = Math.min(4, sWord.x1), sRight = Math.max(96, sWord.x2);
const sBox = `${r2(sLeft)} 4 ${r2(sRight - sLeft)} ${r2(sWord.bottom - 4)}`;
const stacked = (symbolFill, wordFill) => svgDoc(sBox, symbolPaths(MASTER, symbolFill) + `<path d="${sWord.d}" fill="${wordFill}"/>`);

// App tile: ink symbol on a gold tile with breathing room.
const tile = (k, { radius = 22, scale = 0.6, bg = C.gold, fg = C.ink } = {}) => {
  const t = (1 - scale) * 50;
  return svgDoc("0 0 100 100", `<rect width="100" height="100" rx="${radius}" fill="${bg}"/><g transform="translate(${t} ${t}) scale(${scale})">${symbolPaths(k, fg)}</g>`);
};

const files = {
  "agenticthat-symbol.svg": svgDoc("4 4 92 92", symbolPaths(MASTER, C.ink)),
  "agenticthat-symbol-gold.svg": svgDoc("4 4 92 92", symbolPaths(MASTER, C.gold)),
  "agenticthat-symbol-white.svg": svgDoc("4 4 92 92", symbolPaths(MASTER, C.white)),
  "agenticthat-symbol-signature.svg": svgDoc("4 4 92 92", symbolPaths(MASTER, C.ink, C.gold)),
  "agenticthat-symbol-micro.svg": svgDoc("4 4 92 92", symbolPaths(MICROK, C.ink)),
  "agenticthat-logo-horizontal.svg": horizontal(C.ink, C.ink),
  "agenticthat-logo-horizontal-dark.svg": horizontal(C.gold, C.white),
  "agenticthat-logo-horizontal-white.svg": horizontal(C.white, C.white),
  "agenticthat-logo-stacked.svg": stacked(C.ink, C.ink),
  "agenticthat-logo-stacked-dark.svg": stacked(C.gold, C.white),
  "agenticthat-app-icon.svg": tile(MASTER),
};

await mkdir(out("public/brand"), { recursive: true });
for (const [name, svg] of Object.entries(files)) await writeFile(out("public/brand", name), svg);

const png = (svg, width, height = width, background = null) => {
  let img = sharp(Buffer.from(svg), { density: 1200 }).resize(width, height, { fit: "contain", background: background || { r: 0, g: 0, b: 0, alpha: 0 } });
  if (background) img = img.flatten({ background });
  return img.png({ compressionLevel: 9 }).toBuffer();
};

const rasters = [
  ["agenticthat-symbol-1024.png", files["agenticthat-symbol.svg"], 1024],
  ["agenticthat-symbol-2048.png", files["agenticthat-symbol.svg"], 2048],
  ["agenticthat-symbol-gold-1024.png", files["agenticthat-symbol-gold.svg"], 1024],
  ["agenticthat-symbol-white-1024.png", files["agenticthat-symbol-white.svg"], 1024],
  ["agenticthat-app-icon-1024.png", files["agenticthat-app-icon.svg"], 1024],
  ["agenticthat-logo-512.png", tile(MASTER, { radius: 0 }), 512],
  ["icon-192.png", tile(MASTER, { radius: 0 }), 192],
  ["icon-512.png", tile(MASTER, { radius: 0 }), 512],
];
for (const [name, svg, w] of rasters) await writeFile(out("public/brand", name), await png(svg, w));

const [hw, hh] = hBox.split(" ").slice(2).map(Number);
for (const [name, key] of [["agenticthat-logo-horizontal-2048.png", "agenticthat-logo-horizontal.svg"], ["agenticthat-logo-horizontal-dark-2048.png", "agenticthat-logo-horizontal-dark.svg"]]) {
  await writeFile(out("public/brand", name), await png(files[key], 2048, Math.round(2048 * hh / hw)));
}

// Favicons. Below 32 px the micro symbol is used; the gold tile keeps it visible on light and dark tabs.
const faviconSvg = tile(MICROK, { radius: 22, scale: 0.72 });
await writeFile(out("app/icon.svg"), faviconSvg);
const icoSizes = [16, 32, 48];
const icoImages = await Promise.all(icoSizes.map((s) => png(s < 32 ? faviconSvg : tile(MASTER, { scale: 0.68 }), s)));
const header = Buffer.alloc(6 + 16 * icoImages.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(icoImages.length, 4);
let offset = header.length;
icoImages.forEach((img, i) => {
  const e = 6 + i * 16, s = icoSizes[i];
  header.writeUInt8(s, e); header.writeUInt8(s, e + 1); header.writeUInt8(0, e + 2); header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(img.length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += img.length;
});
await writeFile(out("app/favicon.ico"), Buffer.concat([header, ...icoImages]));
await writeFile(out("app/apple-icon.png"), await png(tile(MASTER, { radius: 0, scale: 0.58 }), 180));

// Share image, 1200 × 630: gold symbol and white name on ink, with the one-line description.
const ogSym = 230, ogX = 96, ogY = (630 - ogSym) / 2, ogScale = ogSym / SYM;
const ogCap = 0.46 * ogSym * 0.78;
const ogWordProbe = textPath(bold, "AgenticThat", { capHeight: ogCap });
const ogTextX = ogX + ogSym + 0.25 * ogSym * 0.9;
const ogWord = textPath(bold, "AgenticThat", { capHeight: ogCap, x: ogTextX - ogWordProbe.x1, baseline: 300 });
const tagline = textPath(regular, "AI agents for messaging, scraping, publishing and engagement.", { capHeight: 17, x: ogTextX, baseline: 362, tracking: 0, pairs: {} });
const domain = textPath(bold, "agenticthat.com", { capHeight: 15, x: ogTextX, baseline: 430, tracking: 0.02, pairs: {} });
const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="${C.ink}"/>`
  + `<g transform="translate(${ogX - 4 * ogScale} ${ogY - 4 * ogScale}) scale(${ogScale})">${symbolPaths(MASTER, C.gold)}</g>`
  + `<path d="${ogWord.d}" fill="${C.white}"/><path d="${tagline.d}" fill="#B9B4A8"/><path d="${domain.d}" fill="${C.gold}"/>`
  + `<rect x="0" y="618" width="1200" height="12" fill="${C.gold}"/></svg>`;
const ogPng = await sharp(Buffer.from(ogSvg)).png({ compressionLevel: 9 }).toBuffer();
await writeFile(out("app/opengraph-image.png"), ogPng);
await writeFile(out("app/twitter-image.png"), ogPng);
await writeFile(out("app/opengraph-image.alt.txt"), "AgenticThat logo: the Keystone @ symbol in gold beside the AgenticThat name.");
await writeFile(out("app/twitter-image.alt.txt"), "AgenticThat logo: the Keystone @ symbol in gold beside the AgenticThat name.");

// Paths for the React components, so the site draws the exact same mark.
await writeFile(out("src/platform/brand-paths.js"), `// Generated by scripts/build-brand-kit.mjs. Do not edit by hand.
export const SYMBOL = ${JSON.stringify({ ring: MASTER.ring, a: MASTER.a, t: MASTER.tShape })};
export const SYMBOL_MICRO = ${JSON.stringify({ ring: MICROK.ring, a: MICROK.a, t: MICROK.tShape })};
export const WORDMARK_HORIZONTAL = ${JSON.stringify({ viewBox: hBox, d: hWord.d })};
`);

console.log("Brand kit written:", Object.keys(files).length, "SVGs,", rasters.length + 2, "PNGs, favicons, share image.");
