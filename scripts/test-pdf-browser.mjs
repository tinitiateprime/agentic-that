import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { unzipSync } from "fflate";
import sharp from "sharp";

const base = process.env.PDF_STUDIO_TEST_URL || "http://127.0.0.1:5188";
const artifacts = path.resolve("artifacts/pdf-studio-tests");
await mkdir(artifacts, { recursive: true });
async function makePdf(name, widths) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  widths.forEach((width, index) => {
    const page = document.addPage([width, 400]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width,
      height: 400,
      color: index % 2 ? rgb(0.95, 0.8, 0.5) : rgb(0.8, 0.9, 1),
    });
    page.drawText(`${name} PAGE ${index + 1}`, {
      x: 20,
      y: 200,
      size: 14,
      font,
    });
  });
  const buffer = Buffer.from(await document.save());
  await writeFile(path.join(artifacts, name), buffer);
  return { name, mimeType: "application/pdf", buffer };
}
const a = await makePdf("alpha.pdf", [210, 220, 230]);
const b = await makePdf("beta.pdf", [310, 320]);
const cancellationFile = await makePdf(
  "cancel-check.pdf",
  Array.from({ length: 120 }, () => 210),
);
const formDocument = await PDFDocument.create();
const formPage = formDocument.addPage([300, 400]);
const formField = formDocument.getForm().createTextField("customer");
formField.setText("Filled value survives");
formField.addToPage(formPage, { x: 20, y: 150, width: 240, height: 35 });
formDocument.getForm().updateFieldAppearances();
const form = {
  name: "filled-form.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from(await formDocument.save()),
};
const png = {
  name: "wide.png",
  mimeType: "image/png",
  buffer: await sharp({
    create: { width: 80, height: 40, channels: 4, background: "#ff000080" },
  })
    .png()
    .toBuffer(),
};
const jpg = {
  name: "photo.jpg",
  mimeType: "image/jpeg",
  buffer: await sharp({
    create: { width: 60, height: 100, channels: 3, background: "#0000ff" },
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer(),
};
const webp = {
  name: "graphic.webp",
  mimeType: "image/webp",
  buffer: await sharp({
    create: { width: 90, height: 60, channels: 3, background: "#00ff00" },
  })
    .webp()
    .toBuffer(),
};

const browser = await chromium.launch({
  channel: process.env.PDF_TEST_BROWSER || "chrome",
  headless: true,
});
const context = await browser.newContext({ acceptDownloads: true });
context.setDefaultNavigationTimeout(90000);
const page = await context.newPage();
const errors = [];
const fileUploads = [];
const failedResources = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  if (
    request.method() !== "GET" &&
    request.method() !== "HEAD" &&
    !request.url().includes("__nextjs")
  )
    fileUploads.push(`${request.method()} ${request.url()}`);
});
page.on("response", (response) => {
  if (response.status() >= 400 && response.url().includes("/tools/pdf/assets/"))
    failedResources.push(`${response.status()} ${response.url()}`);
});
async function waitIdle() {
  await page.waitForFunction(
    () =>
      !document
        .querySelector('[role="status"]')
        ?.textContent?.includes("Reading files"),
  );
  await page.getByRole("button", { name: "Clear all", exact: true }).waitFor();
}
async function upload(files) {
  await page.locator('input[type="file"]').setInputFiles(files);
  await waitIdle();
}
async function go(tool) {
  await page.goto(`${base}/tools/pdf/${tool}`);
  await page.locator('input[type="file"]').waitFor({ state: "attached" });
}
async function download(action) {
  await page.getByRole("button", { name: action, exact: true }).click();
  const link = page.getByRole("link", { name: /^Download (PDF|ZIP|image)$/ });
  await page.waitForFunction(
    () =>
      document.querySelector("main a[download]") ||
      document.querySelector("main [role=alert]"),
    { timeout: 60000 },
  );
  if (await page.locator("main [role=alert]").count())
    throw new Error(await page.locator("main [role=alert]").innerText());
  await link.waitFor({ timeout: 60000 });
  const pending = page.waitForEvent("download");
  await link.click();
  const file = await pending;
  const buffer = await readFile(await file.path());
  await writeFile(path.join(artifacts, file.suggestedFilename()), buffer);
  return { buffer, name: file.suggestedFilename() };
}
async function widths(buffer) {
  return (await PDFDocument.load(buffer))
    .getPages()
    .map((entry) => entry.getWidth());
}
async function extractedText(buffer) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
  });
  try {
    const document = await task.promise;
    return (await (await document.getPage(1)).getTextContent()).items
      .map((item) => item.str)
      .join(" ");
  } finally {
    await task.destroy();
  }
}
async function noOverflow() {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Page must not scroll horizontally",
  );
}

try {
  await go("merge-pdf");
  await upload([a, b]);
  await page
    .getByRole("button", { name: "Move beta.pdf earlier", exact: true })
    .click();
  const merged = await download("Merge PDFs");
  assert.deepEqual(await widths(merged.buffer), [310, 320, 210, 220, 230]);
  await page.screenshot({
    path: path.join(artifacts, "merge-desktop.png"),
    fullPage: true,
  });
  console.log("PASS Merge: reordered documents, real output, five pages");

  await go("split-pdf");
  await upload(a);
  await page.getByLabel("Pages to extract", { exact: true }).fill("3, 1-2");
  assert.deepEqual(
    await widths((await download("Split PDF")).buffer),
    [230, 210, 220],
  );
  await page.getByLabel("Split method").selectOption("ranges");
  await page.getByLabel("Page groups").fill("1-2; 3");
  const split = await download("Split PDF");
  const groups = unzipSync(split.buffer);
  assert.deepEqual(Object.keys(groups), [
    "alpha-part-001.pdf",
    "alpha-part-002.pdf",
  ]);
  assert.deepEqual(await widths(groups["alpha-part-001.pdf"]), [210, 220]);
  assert.deepEqual(await widths(groups["alpha-part-002.pdf"]), [230]);
  await page.getByLabel("Split method").selectOption("every-page");
  assert.equal(
    Object.keys(unzipSync((await download("Split PDF")).buffer)).length,
    3,
  );
  await page.getByLabel("Split method").selectOption("extract");
  await page.getByLabel("Pages to extract", { exact: true }).fill("0, 999");
  await page.getByRole("button", { name: "Split PDF", exact: true }).click();
  await page.locator("main [role=alert]").waitFor();
  assert.match(
    await page.locator("main [role=alert]").innerText(),
    /between 1 and 3/,
  );
  console.log(
    "PASS Split: extraction order, ranges ZIP, individual pages, invalid selection",
  );

  await go("organize-pdf");
  await upload(a);
  await page
    .getByRole("button", { name: "Move Page 3 earlier", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Rotate Page 2 clockwise", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Duplicate Page 2", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove Page 1", exact: true })
    .click();
  await upload(b);
  const organized = await download("Save organized PDF");
  const organizedPdf = await PDFDocument.load(organized.buffer);
  assert.deepEqual(await widths(organized.buffer), [230, 230, 220, 310, 320]);
  assert.deepEqual(
    organizedPdf.getPages().map((entry) => entry.getRotation().angle),
    [90, 90, 0, 0, 0],
  );
  await page.screenshot({
    path: path.join(artifacts, "organize-desktop.png"),
    fullPage: true,
  });
  // Remove every page; the action must be disabled until a page is added.
  for (let index = 5; index >= 1; index -= 1)
    await page
      .getByRole("button", { name: `Remove Page ${index}`, exact: true })
      .click();
  assert.equal(
    await page
      .getByRole("button", { name: "Save organized PDF", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  await upload(form);
  const flattened = await download("Save organized PDF");
  assert.equal(
    (await PDFDocument.load(flattened.buffer)).getForm().getFields().length,
    0,
  );
  assert.match(await extractedText(flattened.buffer), /Filled value survives/);
  console.log(
    "PASS Organize: reorder, rotate, duplicate, remove, insert, all-pages-deleted guard, filled forms",
  );

  await go("images-to-pdf");
  await upload([png, jpg, webp]);
  await page.getByLabel("Page size", { exact: true }).selectOption("fit");
  const imagePdf = await PDFDocument.load(
    (await download("Create PDF")).buffer,
  );
  assert.deepEqual(
    imagePdf.getPages().map((entry) => [entry.getWidth(), entry.getHeight()]),
    [
      [60, 30],
      [75, 45],
      [67.5, 45],
    ],
  );
  await page.getByLabel("Page size", { exact: true }).selectOption("letter");
  await page
    .getByLabel("Orientation", { exact: true })
    .selectOption("portrait");
  await page.getByLabel("Margins", { exact: true }).selectOption("48");
  const letterPdf = await PDFDocument.load(
    (await download("Create PDF")).buffer,
  );
  assert.equal(letterPdf.getPageCount(), 3);
  assert.deepEqual(
    letterPdf.getPages().map((entry) => [entry.getWidth(), entry.getHeight()]),
    [
      [612, 792],
      [612, 792],
      [612, 792],
    ],
  );
  console.log(
    "PASS Images to PDF: PNG, EXIF-rotated JPEG, WebP, fit dimensions and Letter layout",
  );

  await go("pdf-to-images");
  await upload(a);
  await page.getByLabel("Pages to export").fill("1, 3");
  const exported = unzipSync((await download("Export images")).buffer);
  assert.deepEqual(Object.keys(exported), [
    "alpha-page-001.png",
    "alpha-page-003.png",
  ]);
  assert.equal(
    (await sharp(exported["alpha-page-001.png"]).metadata()).width,
    420,
  );
  assert.equal(
    (await sharp(exported["alpha-page-003.png"]).metadata()).height,
    800,
  );
  assert.ok(
    (await sharp(exported["alpha-page-001.png"]).stats()).channels[0].mean <
      240,
    "Rendered pages retain their content, rather than exporting blank images",
  );
  await page.getByLabel("Pages to export").fill("2");
  await page.getByLabel("Image format").selectOption("jpg");
  await page.getByLabel("Resolution").selectOption("1");
  const single = await download("Export images");
  assert.match(single.name, /page-002\.jpg$/);
  assert.equal((await sharp(single.buffer).metadata()).width, 220);
  console.log(
    "PASS PDF to Images: PNG ZIP, selected pages, DPI dimensions, direct JPG download",
  );

  await go("merge-pdf");
  await upload([cancellationFile, b]);
  await page.getByRole("button", { name: "Merge PDFs", exact: true }).click();
  const cancel = page.getByRole("button", {
    name: "Cancel processing",
    exact: true,
  });
  await cancel.click();
  await page
    .getByText("Cancelled. Your source files are unchanged.", { exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("link", { name: "Download PDF", exact: true }).count(),
    0,
  );
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "broken.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("not a PDF"),
  });
  await page.locator("main [role=alert]").waitFor();
  assert.match(
    await page.locator("main [role=alert]").innerText(),
    /could not be read/,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Merge PDFs", exact: true })
      .isDisabled(),
    true,
  );
  await upload(a);
  assert.equal(
    await page
      .getByRole("button", { name: "Merge PDFs", exact: true })
      .isDisabled(),
    true,
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: "empty.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.alloc(0),
  });
  await page.locator("main [role=alert]").waitFor();
  assert.match(await page.locator("main [role=alert]").innerText(), /empty/);
  assert.equal(await page.locator("article").count(), 1);
  console.log(
    "PASS Error handling: corrupt and empty files, atomic append, minimum merge count",
  );

  await page.goto(`${base}/tools/pdf/sign-pdf`);
  await page.getByText("Sign PDF is on the roadmap").waitFor();
  assert.equal(await page.locator('input[type="file"]').count(), 0);
  await page.goto(`${base}/tools/pdf/jpg-to-pdf`);
  await page.waitForURL("**/tools/pdf/images-to-pdf");
  await page.setViewportSize({ width: 390, height: 844 });
  await upload([png, jpg]);
  await noOverflow();
  await page.screenshot({
    path: path.join(artifacts, "images-mobile.png"),
    fullPage: true,
  });
  await page.goto(`${base}/tools/pdf`);
  await page.getByText("Ready when you are").waitFor();
  await noOverflow();
  await page.screenshot({
    path: path.join(artifacts, "studio-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: path.join(artifacts, "studio-desktop.png"),
    fullPage: true,
  });
  const asset = await context.request.get(
    `${base}/tools/pdf/assets/6.5.438/standard_fonts/LiberationSans-Regular.ttf`,
  );
  assert.equal(asset.status(), 200);
  const traversal = await context.request.get(
    `${base}/tools/pdf/assets/6.5.438/__proto__/anything`,
  );
  assert.equal(traversal.status(), 404);
  assert.deepEqual(failedResources, [], "PDF renderer resources must load");
  assert.deepEqual(errors, [], "No browser exceptions");
  assert.deepEqual(fileUploads, [], "Documents must never be uploaded");
  console.log(
    "PASS Planned placeholders, alias routes, mobile layout, renderer assets, zero uploads and browser errors",
  );
  console.log(`All PDF Studio browser checks passed. Artifacts: ${artifacts}`);
} catch (error) {
  await page
    .screenshot({ path: path.join(artifacts, "failure.png"), fullPage: true })
    .catch(() => {});
  console.error("Browser errors:", errors);
  console.error("Renderer errors:", failedResources);
  throw error;
} finally {
  await browser.close();
}
