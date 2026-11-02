import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { PDFDocument, PDFName, PDFRawStream, degrees } from "pdf-lib";
import { unzipSync, strFromU8 } from "fflate";
import sharp from "sharp";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableCell,
  TableRow,
  ImageRun,
  HeadingLevel,
} from "docx";

const base = process.env.PDF_STUDIO_TEST_URL || "http://127.0.0.1:5189";
const output = path.resolve("artifacts/pdf-advanced-tests");
await mkdir(output, { recursive: true });
const logo = {
  name: "logo.png",
  mimeType: "image/png",
  buffer: await sharp({
    create: { width: 160, height: 80, channels: 3, background: "#2563eb" },
  })
    .png()
    .toBuffer(),
};
const original = await PDFDocument.create();
original
  .addPage([400, 600])
  .drawText("Editable text page one", { x: 35, y: 520, size: 15 });
const second = original.addPage([400, 600]);
second.drawText("Editable text page two", { x: 40, y: 300, size: 15 });
second.setCropBox(10, 30, 300, 500);
second.setRotation(degrees(90));
const pdf = {
  name: "editable.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from(await original.save()),
};
const scanDocument = await PDFDocument.create();
const scan = scanDocument.addPage([600, 800]);
const noise = Buffer.alloc(1400 * 1000 * 3);
let seed = 19;
for (let index = 0; index < noise.length; index += 1) {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  noise[index] = seed >>> 24;
}
const scanJpg = await sharp(noise, {
  raw: { width: 1400, height: 1000, channels: 3 },
})
  .jpeg({ quality: 100 })
  .toBuffer();
const picture = await scanDocument.embedJpg(scanJpg);
scan.drawImage(picture, { x: 20, y: 150, width: 560, height: 400 });
const scanned = {
  name: "scanned.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from(await scanDocument.save()),
};
const richDocument = new Document({
  sections: [
    {
      children: [
        new Paragraph({
          text: "Quarterly report",
          heading: HeadingLevel.HEADING_1,
        }),
        new Paragraph({
          children: [
            new TextRun("Normal content. "),
            new TextRun({ text: "Bold phrase", bold: true }),
            new TextRun({ text: " and italic phrase", italics: true }),
          ],
        }),
        new Paragraph({ text: "First list item", bullet: { level: 0 } }),
        new Paragraph({ text: "Second list item", bullet: { level: 0 } }),
        new Table({
          rows: [
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph("Product")] }),
                new TableCell({ children: [new Paragraph("Total")] }),
              ],
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph("Example widget")] }),
                new TableCell({ children: [new Paragraph("123.45")] }),
              ],
            }),
          ],
        }),
        new Paragraph({
          children: [
            new ImageRun({
              type: "png",
              data: logo.buffer,
              transformation: { width: 160, height: 80 },
            }),
          ],
        }),
        new Paragraph("Unicode: Résumé café Ελληνικά Привет"),
        ...Array.from(
          { length: 25 },
          (_, index) =>
            new Paragraph(
              `Paragraph ${index + 1}. This body content should remain readable and selectable in the converted PDF. It includes enough text to exercise automatic pagination.`,
            ),
        ),
      ],
    },
  ],
});
const docx = {
  name: "report.docx",
  mimeType:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  buffer: await Packer.toBuffer(richDocument),
};
for (const file of [pdf, scanned, docx])
  await writeFile(path.join(output, `source-${file.name}`), file.buffer);

const browser = await chromium.launch({
  channel: process.env.PDF_TEST_BROWSER || "chrome",
  headless: true,
});
const context = await browser.newContext({
  acceptDownloads: true,
  viewport: { width: 1440, height: 1100 },
});
context.setDefaultNavigationTimeout(120000);
context.setDefaultTimeout(60000);
const page = await context.newPage();
const errors = [];
const uploads = [];
const badAssets = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  if (
    !["GET", "HEAD"].includes(request.method()) &&
    !request.url().includes("__nextjs")
  )
    uploads.push(`${request.method()} ${request.url()}`);
});
page.on("response", (response) => {
  if (response.url().includes("/tools/pdf/assets/") && response.status() >= 400)
    badAssets.push(`${response.status()} ${response.url()}`);
});
async function go(tool) {
  await page.goto(`${base}/tools/pdf/${tool}`);
  await page
    .locator('input[type="file"]')
    .first()
    .waitFor({ state: "attached" });
}
async function upload(file) {
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await page.waitForFunction(
    (name) =>
      document.querySelector("main [role=alert]") ||
      Array.from(document.querySelectorAll("main h2")).some(
        (entry) => entry.textContent === name,
      ),
    file.name,
  );
  if (await page.locator("main [role=alert]").count())
    throw new Error(await page.locator("main [role=alert]").innerText());
}
async function download(action, extension = "PDF") {
  await page.getByRole("button", { name: action, exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector("main a[download]") ||
      document.querySelector("main [role=alert]"),
    null,
    { timeout: 120000 },
  );
  if (await page.locator("main [role=alert]").count())
    throw new Error(await page.locator("main [role=alert]").innerText());
  const pending = page.waitForEvent("download");
  await page
    .getByRole("link", { name: `Download ${extension}`, exact: true })
    .click();
  const file = await pending;
  const bytes = await readFile(await file.path());
  await writeFile(path.join(output, file.suggestedFilename()), bytes);
  return bytes;
}
async function textOf(bytes) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    verbosity: 0,
  });
  try {
    const document = await task.promise;
    const values = [];
    for (let index = 1; index <= document.numPages; index += 1) {
      const entry = await document.getPage(index);
      values.push({
        text: (await entry.getTextContent()).items
          .map((item) => item.str)
          .join(" "),
        annotations: await entry.getAnnotations(),
      });
    }
    return values;
  } finally {
    await task.destroy();
  }
}
const layer = () =>
  page.getByLabel("Interactive annotation layer", { exact: true });
async function clickPaper(x, y) {
  await layer().click({ position: { x, y } });
}
async function draw(name, from, to) {
  await page.getByRole("button", { name, exact: true }).click();
  await layer().scrollIntoViewIfNeeded();
  const bounds = await layer().boundingBox();
  await page.mouse.move(
    bounds.x + bounds.width * from[0],
    bounds.y + bounds.height * from[1],
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * to[0],
    bounds.y + bounds.height * to[1],
    { steps: 10 },
  );
  await page.mouse.up();
}
try {
  await go("compress-pdf");
  await upload(scanned);
  await page
    .getByLabel("Compression level", { exact: true })
    .selectOption("strong");
  const compressed = await download("Compress PDF");
  assert.ok(compressed.length < scanned.buffer.length * 0.7);
  assert.equal((await PDFDocument.load(compressed)).getPageCount(), 1);
  await page.getByLabel("Compression results").waitFor();
  await page.screenshot({
    path: path.join(output, "compress-desktop.png"),
    fullPage: true,
  });
  console.log(
    "PASS Compress: real size reduction, page retained, size comparison and download",
  );

  await go("pdf-to-word");
  await upload(pdf);
  await page.getByLabel("Pages to convert", { exact: true }).fill("1-2");
  const word = await download("Convert to Word", "Word");
  const archive = unzipSync(word);
  const xml = strFromU8(archive["word/document.xml"]);
  assert.match(xml, /Editable text page one/);
  assert.match(xml, /Editable text page two/);
  assert.match(xml, /w:orient="landscape"/, "Rotated PDF pages retain their visible orientation in Word");
  assert.ok((xml.match(/w:sectPr/g) || []).length >= 2);
  await page.getByLabel("Pages to convert", { exact: true }).fill("2");
  const selectedXml = strFromU8(
    unzipSync(await download("Convert to Word", "Word"))["word/document.xml"],
  );
  assert.doesNotMatch(selectedXml, /Editable text page one/);
  assert.match(selectedXml, /Editable text page two/);
  await go("pdf-to-word");
  await upload(scanned);
  await page
    .getByRole("button", { name: "Convert to Word", exact: true })
    .click();
  await page.locator("main [role=alert]").waitFor();
  assert.match(await page.locator("main [role=alert]").innerText(), /OCR/);
  console.log(
    "PASS PDF to Word: editable DOCX, selection, page sections, scanned-page error",
  );

  await go("word-to-pdf");
  await upload(docx);
  const converted = await download("Convert to PDF");
  const convertedText = await textOf(converted);
  const allText = convertedText.map((entry) => entry.text).join(" ");
  for (const expected of [
    "Quarterly report",
    "Bold phrase",
    "First list item",
    "Example widget",
    "123.45",
    "Paragraph 25",
    "Привет",
  ])
    assert.ok(allText.includes(expected), expected);
  assert.ok(convertedText.length >= 2);
  const convertedPdf = await PDFDocument.load(converted);
  assert.ok(
    convertedPdf.context
      .enumerateIndirectObjects()
      .some(
        ([, entry]) =>
          entry instanceof PDFRawStream &&
          entry.dict.lookup(PDFName.of("Subtype")) === PDFName.of("Image"),
      ),
    "Embedded Word images are retained",
  );
  await page.screenshot({
    path: path.join(output, "word-to-pdf-desktop.png"),
    fullPage: true,
  });
  console.log(
    "PASS Word to PDF: real DOCX, headings, styles, lists, tables, Unicode, pictures and pagination",
  );

  await go("edit-pdf");
  await upload(pdf);
  await layer().waitFor();
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  await page
    .getByLabel("Annotation text", { exact: true })
    .fill("Review saved");
  await clickPaper(100, 100);
  await draw("Rectangle", [0.2, 0.3], [0.55, 0.37]);
  const beforeUndo = await layer().locator('g[role="button"]').count();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(
    await layer().locator('g[role="button"]').count(),
    beforeUndo - 1,
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  assert.equal(await layer().locator('g[role="button"]').count(), beforeUndo);
  await draw("Highlight", [0.15, 0.42], [0.5, 0.45]);
  await draw("Ellipse", [0.2, 0.5], [0.45, 0.58]);
  await draw("Draw", [0.3, 0.6], [0.6, 0.65]);
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await page
    .getByLabel("Annotation text", { exact: true })
    .fill("Please verify the totals");
  await clickPaper(100, 180);
  await page
    .getByLabel("Choose annotation image", { exact: true })
    .setInputFiles(logo);
  await layer().locator("image").waitFor();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await page.getByText("Page 2 of 2", { exact: true }).waitFor();
  await layer().waitFor();
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  await page
    .getByLabel("Annotation text", { exact: true })
    .fill("Rotated page note");
  await clickPaper(100, 100);
  const edited = await download("Save edited PDF");
  const editedText = await textOf(edited);
  assert.match(editedText[0].text, /Editable text page one/);
  assert.match(editedText[0].text, /Review saved/);
  assert.match(editedText[1].text, /Rotated page note/);
  assert.equal(
    editedText[0].annotations.find((entry) => entry.subtype === "Text")
      .contentsObj.str,
    "Please verify the totals",
  );
  await page.screenshot({
    path: path.join(output, "editor-desktop.png"),
    fullPage: true,
  });
  console.log(
    "PASS Editor: text, shape tools, highlight, drawing, comment, image, undo/redo and rotated-page save",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Previous page", exact: true })
    .click();
  await layer().waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.screenshot({
    path: path.join(output, "editor-mobile.png"),
    fullPage: true,
  });
  await page.goto(`${base}/tools/pdf`);
  await page.getByText("9 working tools", { exact: true }).waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(uploads, []);
  assert.deepEqual(badAssets, []);
  console.log(
    "PASS Mobile layouts, nine ready tools, no document uploads and no browser errors",
  );
  console.log(`All advanced PDF browser checks passed. Artifacts: ${output}`);
} catch (error) {
  await page
    .screenshot({ path: path.join(output, "failure.png"), fullPage: true })
    .catch(() => {});
  console.error("Browser errors:", errors);
  console.error("Bad renderer assets:", badAssets);
  throw error;
} finally {
  await browser.close();
}
