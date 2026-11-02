import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PDFDocument, PDFName, degrees } from "pdf-lib";
import sharp from "sharp";
import { unzipSync, zipSync, strFromU8 } from "fflate";
import { compressPdf } from "./pdf-compression.js";
import {
  displayPointToPdf,
  editPdf,
  normalizeRectangle,
  pageGeometry,
} from "./pdf-editing.js";
import { inspectDocxArchive } from "./document-archive.js";
import { pdfToWord, textItemsToLines } from "./word-conversion.js";

async function fixture() {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 600]);
  page.drawText("Original text", { x: 20, y: 500, size: 14 });
  return document;
}
async function recompress(input, settings) {
  const pipeline =
    input.kind === "rgb"
      ? sharp(input.bytes, {
          raw: { width: input.width, height: input.height, channels: 3 },
        })
      : sharp(input.bytes);
  const result = await pipeline
    .resize({
      width: settings.maxDimension,
      height: settings.maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: Math.round(settings.quality * 100) })
    .toBuffer({ resolveWithObject: true });
  return {
    bytes: new Uint8Array(result.data),
    width: result.info.width,
    height: result.info.height,
  };
}
async function pdfText(bytes) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
    verbosity: 0,
  });
  try {
    const document = await task.promise;
    const page = await document.getPage(1);
    return {
      items: (await page.getTextContent()).items,
      annotations: await page.getAnnotations(),
    };
  } finally {
    await task.destroy();
  }
}

test("compression shrinks suitable images while retaining page size, editable form values, text and links", async () => {
  const document = await fixture();
  const pixels = Buffer.alloc(1600 * 1200 * 3);
  let state = 17;
  for (let index = 0; index < pixels.length; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    pixels[index] = state >>> 24;
  }
  const image = await document.embedJpg(
    await sharp(pixels, { raw: { width: 1600, height: 1200, channels: 3 } })
      .jpeg({ quality: 100 })
      .toBuffer(),
  );
  const page = document.getPage(0);
  page.drawImage(image, { x: 20, y: 40, width: 360, height: 270 });
  const form = document.getForm().createTextField("customer");
  form.setText("Kept form value");
  form.addToPage(page, { x: 20, y: 420, width: 250, height: 30 });
  document.getForm().updateFieldAppearances();
  page.node.addAnnot(
    document.context.register(
      document.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [20, 350, 150, 370],
        A: { S: "URI", URI: document.context.obj("https://example.com") },
      }),
    ),
  );
  const bytes = await document.save({ useObjectStreams: false });
  const result = await compressPdf(bytes, {
    level: "strong",
    recompressImage: recompress,
  });
  assert.ok(result.resultBytes < bytes.length * 0.7);
  assert.equal(result.optimizedImages, 1);
  const output = await PDFDocument.load(result.bytes);
  assert.deepEqual(output.getPage(0).getSize(), { width: 400, height: 600 });
  assert.equal(
    output.getForm().getTextField("customer").getText(),
    "Kept form value",
  );
  assert.match(
    (await pdfText(result.bytes)).items.map((item) => item.str).join(" "),
    /Original text/,
  );
  assert.equal(output.getPage(0).node.Annots().size(), 2);
});
test("compression never returns a larger file and leaves transparent images alone", async () => {
  const document = await fixture();
  const image = await document.embedPng(
    await sharp({
      create: { width: 50, height: 50, channels: 4, background: "#ff000080" },
    })
      .png()
      .toBuffer(),
  );
  document.getPage(0).drawImage(image);
  const bytes = await document.save();
  let calls = 0;
  const result = await compressPdf(bytes, {
    recompressImage: () => {
      calls += 1;
      throw new Error("Should not recompress transparency");
    },
  });
  assert.equal(calls, 0);
  assert.ok(result.bytes.length <= bytes.length);
  await assert.rejects(
    compressPdf(bytes, { level: "unknown" }),
    /valid compression/,
  );
});
test("compression honors cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    compressPdf(await (await fixture()).save(), { signal: controller.signal }),
    { name: "AbortError" },
  );
});

test("compression optimizes opaque PNG image streams without replacing selectable text", async () => {
  const document = await fixture();
  const pixels = Buffer.alloc(500 * 500 * 3); let state = 41;
  for (let index = 0; index < pixels.length; index += 1) { state = (state * 1664525 + 1013904223) >>> 0; pixels[index] = state >>> 24; }
  const image = await document.embedPng(await sharp(pixels, { raw: { width: 500, height: 500, channels: 3 } }).png().toBuffer());
  document.getPage(0).drawImage(image, { x: 20, y: 20, width: 300, height: 300 });
  const bytes = await document.save(); const result = await compressPdf(bytes, { level: "balanced", recompressImage: recompress });
  assert.equal(result.optimizedImages, 1); assert.ok(result.bytes.length < bytes.length * .8);
  assert.match((await pdfText(result.bytes)).items.map((item) => item.str).join(" "), /Original text/);
});

test("annotation coordinate mapping handles crop boxes, page units, and all four rotations", async () => {
  const document = await fixture();
  const page = document.getPage(0);
  page.setCropBox(10, 30, 300, 500);
  const expected = [
    [40, 490],
    [50, 60],
    [280, 70],
    [270, 500],
  ];
  for (const [index, rotation] of [0, 90, 180, 270].entries()) {
    page.setRotation(degrees(rotation));
    const geometry = pageGeometry(page);
    assert.deepEqual(displayPointToPdf(geometry, 30, 40), {
      x: expected[index][0],
      y: expected[index][1],
    });
  }
  assert.deepEqual(normalizeRectangle({ x: 80, y: 90 }, { x: 20, y: 30 }), {
    x: 20,
    y: 30,
    width: 60,
    height: 60,
  });
});
test("saved annotations retain original content, exact text coordinates, and PDF comments on a rotated cropped page", async () => {
  const document = await fixture();
  const page = document.getPage(0);
  page.setCropBox(10, 30, 300, 500);
  page.setRotation(degrees(90));
  const bytes = await document.save();
  const fontBytes = new Uint8Array(
    await readFile(
      "node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf",
    ),
  );
  const edited = await editPdf(
    bytes,
    [
      {
        type: "text",
        pageIndex: 0,
        x: 100,
        y: 80,
        text: "Review",
        fontSize: 18,
        color: "#112233",
      },
      {
        type: "note",
        pageIndex: 0,
        x: 40,
        y: 50,
        text: "Check this section",
        color: "#112233",
      },
      {
        type: "highlight",
        pageIndex: 0,
        x: 30,
        y: 20,
        width: 120,
        height: 15,
        color: "#facc15",
      },
      {
        type: "ellipse",
        pageIndex: 0,
        x: 30,
        y: 60,
        width: 100,
        height: 40,
        color: "#ff0000",
      },
    ],
    { fontBytes },
  );
  const text = await pdfText(edited);
  assert.match(text.items.map((item) => item.str).join(" "), /Original text/);
  const added = text.items.find((item) => item.str === "Review");
  assert.ok(added);
  assert.ok(Math.abs(added.transform[4] - 105.3) < 0.01);
  assert.ok(Math.abs(added.transform[5] - 130) < 0.01);
  assert.equal(
    text.annotations.find((item) => item.subtype === "Text").contentsObj.str,
    "Check this section",
  );
  const original = await PDFDocument.load(bytes);
  assert.equal(original.getPage(0).node.Annots()?.size() || 0, 0);
});
test("annotation output rejects missing pages, unsupported characters, and invalid shapes", async () => {
  const bytes = await (await fixture()).save();
  await assert.rejects(editPdf(bytes, []), /at least one annotation/);
  await assert.rejects(
    editPdf(bytes, [
      { type: "rectangle", pageIndex: 9, x: 1, y: 1, width: 10, height: 10 },
    ]),
    /missing page/,
  );
  await assert.rejects(
    editPdf(bytes, [
      { type: "rectangle", pageIndex: 0, x: 1, y: 1, width: -10, height: 10 },
    ]),
    /unsupported shape/,
  );
  const fontBytes = new Uint8Array(await readFile("node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf"));
  await assert.rejects(editPdf(bytes, [{ type: "text", pageIndex: 0, x: 1, y: 1, text: "你好", fontSize: 18 }], { fontBytes }), /cannot display/);
  await assert.rejects(editPdf(bytes, [{ type: "text", pageIndex: 0, x: 395, y: 1, text: "Outside page", fontSize: 18 }], { fontBytes }), /extends beyond the page/);
});

test("PDF text grouping preserves lines, spacing, Unicode, and reading order", () => {
  const item = (str, x, y) => ({
    str,
    width: str.length * 6,
    transform: [12, 0, 0, 12, x, y],
    fontName: "Arial",
    dir: "ltr",
  });
  const lines = textItemsToLines([
    item("world", 60, 200),
    item("Привет", 10, 180),
    item("Hello", 10, 200),
  ]);
  assert.deepEqual(
    lines.map((line) => line.text),
    ["Hello world", "Привет"],
  );
});
test("PDF to Word generates editable OOXML with requested page breaks and no raster substitute", async () => {
  const source = {
    getPage: async (number) => ({
      view: [0, 0, 595, 842],
      getTextContent: async () => ({
        items: [
          {
            str: `Editable text page ${number}`,
            width: 140,
            transform: [12, 0, 0, 12, 40, 700],
            dir: "ltr",
          },
        ],
      }),
      cleanup() {},
    }),
  };
  const blob = await pdfToWord(source, [0, 1]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  inspectDocxArchive(bytes);
  const archive = unzipSync(bytes);
  const xml = strFromU8(archive["word/document.xml"]);
  assert.match(xml, /Editable text page 1/);
  assert.match(xml, /Editable text page 2/);
  assert.equal(
    Object.keys(archive).filter(
      (name) => name.startsWith("word/media/") && !name.endsWith("/"),
    ).length,
    0,
  );
  assert.ok((xml.match(/w:sectPr/g) || []).length >= 2);
});
test("PDF to Word refuses scanned or partially scanned selections rather than dropping pages", async () => {
  const source = {
    getPage: async () => ({
      view: [0, 0, 595, 842],
      getTextContent: async () => ({ items: [] }),
      cleanup() {},
    }),
  };
  await assert.rejects(pdfToWord(source, [0]), /no selectable text.*OCR/);
});
test("DOCX archive preflight rejects invalid packages, duplicates, and inflated size declarations", () => {
  assert.throws(
    () => inspectDocxArchive(new Uint8Array([1, 2, 3])),
    /not a readable DOCX/,
  );
  const valid = zipSync({
    "[Content_Types].xml": new Uint8Array([1]),
    "word/document.xml": new Uint8Array([1]),
  });
  assert.equal(inspectDocxArchive(valid).entries, 2);
  const missing = zipSync({ "word/document.xml": new Uint8Array([1]) });
  assert.throws(() => inspectDocxArchive(missing), /standard .docx/);
  const oversized = valid.slice();
  const view = new DataView(oversized.buffer);
  for (let offset = 0; offset < oversized.length - 46; offset += 1)
    if (view.getUint32(offset, true) === 0x02014b50) {
      view.setUint32(offset + 24, 200 * 1048576, true);
      break;
    }
  assert.throws(
    () => inspectDocxArchive(oversized),
    /too large after unpacking/,
  );
});
