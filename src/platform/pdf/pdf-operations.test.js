import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFDict, PDFHexString, PDFName, degrees } from "pdf-lib";
import {
  PDF_LIMITS,
  assemblePdf,
  imagePlacement,
  imagesToPdf,
  parsePageSelection,
  readPdf,
  safeBasename,
  splitGroups,
  validateFiles,
} from "./pdf-operations.js";

async function fixture(id, widths) {
  const document = await PDFDocument.create();
  widths.forEach((width, index) => {
    const page = document.addPage([width, 400]);
    if (index === 1) page.setRotation(degrees(90));
  });
  return { id, name: `${id}.pdf`, bytes: await document.save() };
}

test("merge retains source order, page dimensions, and original rotations", async () => {
  const a = await fixture("a", [210, 220]);
  const b = await fixture("b", [310, 320]);
  const bytes = await assemblePdf(
    [a, b],
    [
      { sourceId: "b", index: 0 },
      { sourceId: "b", index: 1 },
      { sourceId: "a", index: 0 },
      { sourceId: "a", index: 1 },
    ],
  );
  const result = await PDFDocument.load(bytes);
  assert.deepEqual(
    result.getPages().map((page) => page.getWidth()),
    [310, 320, 210, 220],
  );
  assert.deepEqual(
    result.getPages().map((page) => page.getRotation().angle),
    [0, 90, 0, 90],
  );
  assert.equal((await PDFDocument.load(a.bytes)).getPageCount(), 2);
});

test("organize supports arbitrary order, duplicates, removals and relative rotation", async () => {
  const source = await fixture("a", [210, 220, 230]);
  const bytes = await assemblePdf(
    [source],
    [
      { sourceId: "a", index: 2 },
      { sourceId: "a", index: 1, rotation: 270 },
      { sourceId: "a", index: 2, rotation: 90 },
    ],
  );
  const result = await PDFDocument.load(bytes);
  assert.deepEqual(
    result.getPages().map((page) => page.getWidth()),
    [230, 220, 230],
  );
  assert.deepEqual(
    result.getPages().map((page) => page.getRotation().angle),
    [0, 0, 90],
  );
});

test("split preserves selection order and creates explicit independent groups", () => {
  assert.deepEqual(parsePageSelection("5, 1-3", 5), [4, 0, 1, 2]);
  assert.deepEqual(splitGroups("ranges", "1-2; 4, 3", 5), [
    [0, 1],
    [3, 2],
  ]);
  assert.deepEqual(splitGroups("every-page", "", 3), [[0], [1], [2]]);
  assert.deepEqual(splitGroups("extract", "2-3", 3), [[1, 2]]);
});

test("split rejects invalid, duplicate, reversed and out-of-bounds selections", () => {
  for (const value of [
    "",
    "0",
    "4",
    "3-1",
    "1,1",
    "1-2,2",
    "1,",
    "1.5",
    "1e2",
    "-1",
    "1;;2",
    "999999999999999999999",
  ])
    assert.throws(() => parsePageSelection(value, 3), Error, value);
  assert.throws(() => splitGroups("ranges", "1-2;", 3), Error);
});

test("invalid and encrypted PDF bytes fail with safe, actionable messages", async () => {
  await assert.rejects(
    readPdf(new TextEncoder().encode("not a PDF"), "bad.pdf"),
    /could not be read/,
  );
  const source = await fixture("a", [210]);
  const text = new TextDecoder().decode(source.bytes);
  assert.ok(text.startsWith("%PDF"));
  await assert.rejects(
    assemblePdf([source], [{ sourceId: "missing", index: 0 }]),
    /source document is missing/,
  );
  await assert.rejects(
    assemblePdf([source], [{ sourceId: "a", index: 9 }]),
    /outside the document/,
  );
  await assert.rejects(assemblePdf([source], []), /at least one page/);
  const encrypted = await PDFDocument.create();
  encrypted.addPage();
  encrypted.context.trailerInfo.Encrypt = encrypted.context.register(
    encrypted.context.obj({
      Filter: "Standard",
      V: 1,
      R: 2,
      Length: 40,
      O: PDFHexString.of("00".repeat(32)),
      U: PDFHexString.of("00".repeat(32)),
      P: -4,
    }),
  );
  await assert.rejects(
    readPdf(await encrypted.save(), "locked.pdf"),
    /password protected/,
  );
});

test("unsupported XFA forms are rejected instead of producing incomplete documents", async () => {
  const document = await PDFDocument.create();
  document.addPage();
  document.catalog.set(
    PDFName.of("AcroForm"),
    document.context.obj({ XFA: PDFHexString.of("00"), Fields: [] }),
  );
  await assert.rejects(
    readPdf(await document.save(), "form.pdf"),
    /XFA form.*flattened PDF/,
  );
});

test("a cancelled operation produces no partial download", async () => {
  const source = await fixture("a", [210]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    assemblePdf([source], [{ sourceId: "a", index: 0 }], {
      signal: controller.signal,
    }),
    { name: "AbortError" },
  );
});

test("filled form appearances are flattened before copying", async () => {
  const document = await PDFDocument.create();
  const page = document.addPage();
  const field = document.getForm().createTextField("name");
  field.setText("Visible name");
  field.addToPage(page);
  document.getForm().updateFieldAppearances();
  const source = { id: "form", name: "form.pdf", bytes: await document.save() };
  const result = await PDFDocument.load(
    await assemblePdf([source], [{ sourceId: "form", index: 0 }]),
  );
  assert.equal(result.getForm().getFields().length, 0);
  assert.ok(result.getPage(0).node.Contents());
  assert.equal(
    (await PDFDocument.load(source.bytes))
      .getForm()
      .getTextField("name")
      .getText(),
    "Visible name",
  );
});

test("image placement fits A4/Letter without stretching, cropping, or lost margins", () => {
  const a4 = imagePlacement(1200, 600, {
    pageSize: "a4",
    orientation: "auto",
    margin: 24,
  });
  assert.ok(a4.pageWidth > a4.pageHeight);
  assert.equal(a4.width / a4.height, 2);
  assert.ok(a4.x >= 24);
  assert.ok(a4.y >= 24);
  const letter = imagePlacement(600, 1200, {
    pageSize: "letter",
    orientation: "portrait",
    margin: 48,
  });
  assert.equal(letter.pageWidth, 612);
  assert.equal(letter.pageHeight, 792);
  assert.equal(letter.width / letter.height, 0.5);
  assert.deepEqual(imagePlacement(800, 600, { pageSize: "fit" }), {
    pageWidth: 600,
    pageHeight: 450,
    x: 0,
    y: 0,
    width: 600,
    height: 450,
  });
  assert.throws(() => imagePlacement(10000, 10000), /24 megapixels/);
});

test("image conversion creates valid pages with requested dimensions", async () => {
  const bytes = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  const result = await PDFDocument.load(
    await imagesToPdf(
      [
        { bytes, imageType: "image/png" },
        { bytes, imageType: "image/png" },
      ],
      { pageSize: "letter", orientation: "landscape", margin: 0 },
    ),
  );
  assert.equal(result.getPageCount(), 2);
  assert.equal(result.getPage(0).getWidth(), 792);
  assert.equal(result.getPage(0).getHeight(), 612);
  const source = { id: "images", bytes: await result.save() };
  const copies = await PDFDocument.load(
    await assemblePdf(
      [source],
      [
        { sourceId: "images", index: 0 },
        { sourceId: "images", index: 0, rotation: 90 },
      ],
    ),
  );
  const refs = copies
    .getPages()
    .map((page) =>
      page.node
        .Resources()
        .lookup(PDFName.of("XObject"), PDFDict)
        .values()[0]
        .toString(),
    );
  assert.equal(refs[0], refs[1], "duplicated pages share image data");
  assert.deepEqual(
    copies.getPages().map((page) => page.getRotation().angle),
    [0, 90],
    "duplicate rotations are independent",
  );
});

test("file limits reject unsupported extensions, empties and oversized selections", () => {
  const file = { name: "a.PDF", size: 128 };
  validateFiles([file]);
  validateFiles([{ name: "a.webp", size: 128 }], [], "image");
  assert.throws(() => validateFiles([{ ...file, size: 0 }]), /empty/);
  assert.throws(
    () => validateFiles([{ ...file, size: PDF_LIMITS.fileBytes + 1 }]),
    /25 MB/,
  );
  assert.throws(() => validateFiles(Array(31).fill(file)), /30 files/);
  assert.throws(
    () => validateFiles([{ name: "evil.svg", size: 128 }], [], "image"),
    /JPG, PNG, or WebP/,
  );
  assert.throws(
    () => validateFiles(Array(5).fill({ ...file, size: PDF_LIMITS.fileBytes })),
    /100 MB/,
  );
  assert.equal(safeBasename("../../bad:name.pdf"), "..-..-bad-name");
});
