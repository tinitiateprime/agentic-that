import { PDFDict, PDFDocument, PDFName, degrees } from "pdf-lib";

export const PDF_LIMITS = Object.freeze({
  files: 30,
  fileBytes: 25 * 1024 * 1024,
  totalBytes: 100 * 1024 * 1024,
  pages: 300,
  exportPages: 100,
  imagePixels: 24_000_000,
  totalImagePixels: 100_000_000,
  archiveBytes: 150 * 1024 * 1024,
});

export function checkCancelled(signal) {
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
}

export async function yieldToBrowser(signal) {
  checkCancelled(signal);
  await new Promise((resolve) => setTimeout(resolve, 0));
  checkCancelled(signal);
}

export function validateFiles(files, existing = [], kind = "pdf") {
  if (!files.length) throw new Error("Choose at least one file.");
  if (files.length + existing.length > PDF_LIMITS.files)
    throw new Error(`Choose up to ${PDF_LIMITS.files} files at a time.`);
  let total = existing.reduce((sum, file) => sum + file.size, 0);
  for (const file of files) {
    if (!file.size) throw new Error(`${file.name} is empty.`);
    if (file.size > PDF_LIMITS.fileBytes)
      throw new Error(`${file.name} exceeds the 25 MB file limit.`);
    if (
      !(kind === "image" ? /\.(jpe?g|png|webp)$/i : /\.pdf$/i).test(file.name)
    ) {
      throw new Error(
        kind === "image"
          ? "Choose JPG, PNG, or WebP images."
          : "Choose PDF files only.",
      );
    }
    total += file.size;
  }
  if (total > PDF_LIMITS.totalBytes)
    throw new Error("The combined file size must be 100 MB or less.");
}

export function safeBasename(name = "document") {
  return (
    name
      .replace(/\.[^.]+$/, "")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/[. ]+$/g, "")
      .trim()
      .slice(0, 90) || "document"
  );
}

// Commas select pages within a group; semicolons separate output documents.
// Preserve the user's order, but reject duplicates and ambiguous syntax.
export function parsePageSelection(value, pageCount) {
  if (!Number.isInteger(pageCount) || pageCount < 1)
    throw new Error("Load a PDF first.");
  const text = value.trim();
  if (!text) throw new Error("Enter page numbers, for example 1-3, 5.");
  if (text.length > 5000) throw new Error("The page selection is too long.");
  const seen = new Set();
  const result = [];
  for (const part of text.split(",")) {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match)
      throw new Error(
        "Use page numbers or ranges separated by commas, such as 1-3, 5.",
      );
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start < 1 || end > pageCount || start > pageCount || start > end)
      throw new Error(`Choose ascending ranges between 1 and ${pageCount}.`);
    for (let page = start; page <= end; page += 1) {
      if (seen.has(page))
        throw new Error(`Page ${page} is selected more than once.`);
      seen.add(page);
      result.push(page - 1);
    }
  }
  return result;
}

export function splitGroups(mode, selection, pageCount) {
  if (mode === "every-page")
    return Array.from({ length: pageCount }, (_, index) => [index]);
  if (mode === "extract") return [parsePageSelection(selection, pageCount)];
  if (mode !== "ranges") throw new Error("Choose a split method.");
  return selection
    .split(";")
    .map((group) => parsePageSelection(group, pageCount));
}

export async function readPdf(bytes, name = "This file") {
  try {
    const document = await PDFDocument.load(bytes, {
      updateMetadata: false,
      throwOnInvalidObject: true,
    });
    if (
      document.catalog
        .lookupMaybe(PDFName.of("AcroForm"), PDFDict)
        ?.has(PDFName.of("XFA"))
    )
      throw new Error("XFA_FORM");
    if (!document.getPageCount()) throw new Error("NO_PAGES");
    if (document.getPageCount() > PDF_LIMITS.pages)
      throw new Error("TOO_MANY_PAGES");
    return document;
  } catch (error) {
    if (error.message === "XFA_FORM")
      throw new Error(
        `${name} uses an XFA form. Save a standard, flattened PDF in your PDF reader before using this tool.`,
      );
    if (error.message === "TOO_MANY_PAGES")
      throw new Error(`${name} exceeds the ${PDF_LIMITS.pages}-page limit.`);
    if (error.message === "NO_PAGES") throw new Error(`${name} has no pages.`);
    if (/encrypt|password/i.test(error.message))
      throw new Error(
        `${name} is password protected. Use an unprotected copy.`,
      );
    throw new Error(
      `${name} could not be read. It may be damaged or use an unsupported PDF format.`,
    );
  }
}

function flattenForm(document) {
  const form = document.getForm();
  if (!form.getFields().length) return;
  try {
    form.flatten({ updateFieldAppearances: false });
  } catch {
    throw new Error(
      "A form in this PDF has missing field appearances. Save a flattened copy in your PDF reader first.",
    );
  }
}

export async function assemblePdf(
  sources,
  pages,
  { signal, onProgress, documents = new Map() } = {},
) {
  if (!pages.length)
    throw new Error("Keep at least one page in your document.");
  if (pages.length > PDF_LIMITS.pages)
    throw new Error(`The result can contain up to ${PDF_LIMITS.pages} pages.`);
  const result = await PDFDocument.create();
  result.setProducer("AgenticThat PDF Studio");
  const bySource = new Map();
  const copies = new Array(pages.length);
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    if (!Number.isFinite(page.rotation || 0) || (page.rotation || 0) % 90 !== 0)
      throw new Error("Page rotation must be a multiple of 90 degrees.");
    if (!bySource.has(page.sourceId)) bySource.set(page.sourceId, []);
    bySource.get(page.sourceId).push({ ...page, position: index });
  }
  // Copy each source's pages together so shared fonts and images are copied once.
  // This also prevents duplicating a large embedded scan for every page copy.
  for (const [sourceId, selected] of bySource) {
    await yieldToBrowser(signal);
    const source = sources.find((entry) => entry.id === sourceId);
    if (!source)
      throw new Error("A source document is missing. Please add it again.");
    if (!documents.has(source.id)) {
      const document = await readPdf(source.bytes, source.name);
      flattenForm(document);
      documents.set(source.id, document);
    }
    const document = documents.get(source.id);
    if (
      selected.some(
        (page) =>
          !Number.isInteger(page.index) ||
          page.index < 0 ||
          page.index >= document.getPageCount(),
      )
    )
      throw new Error("A selected page is outside the document.");
    const copied = await result.copyPages(
      document,
      selected.map((page) => page.index),
    );
    selected.forEach((page, index) => {
      copies[page.position] = copied[index];
    });
  }
  for (let index = 0; index < pages.length; index += 1) {
    await yieldToBrowser(signal);
    const page = pages[index];
    const copy = copies[index];
    copy.setRotation(
      degrees(
        (((copy.getRotation().angle + (page.rotation || 0)) % 360) + 360) % 360,
      ),
    );
    result.addPage(copy);
    onProgress?.(index + 1, pages.length);
  }
  checkCancelled(signal);
  const bytes = await result.save();
  checkCancelled(signal);
  if (bytes.length > PDF_LIMITS.archiveBytes)
    throw new Error(
      "The result exceeds 150 MB. Work with fewer pages at a time.",
    );
  return bytes;
}

export function imagePlacement(
  width,
  height,
  { pageSize = "a4", orientation = "auto", margin = 24 } = {},
) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > PDF_LIMITS.imagePixels
  )
    throw new Error(
      "This image is too large. Resize it to 24 megapixels or less.",
    );
  if (
    !["a4", "letter", "fit"].includes(pageSize) ||
    !["auto", "portrait", "landscape"].includes(orientation) ||
    ![0, 24, 48].includes(margin)
  )
    throw new Error("Choose valid page settings.");
  if (pageSize === "fit")
    return {
      pageWidth: width * 0.75,
      pageHeight: height * 0.75,
      x: 0,
      y: 0,
      width: width * 0.75,
      height: height * 0.75,
    };
  let [pageWidth, pageHeight] =
    pageSize === "letter" ? [612, 792] : [595.28, 841.89];
  if (orientation === "landscape" || (orientation === "auto" && width > height))
    [pageWidth, pageHeight] = [pageHeight, pageWidth];
  const scale = Math.min(
    (pageWidth - 2 * margin) / width,
    (pageHeight - 2 * margin) / height,
  );
  return {
    pageWidth,
    pageHeight,
    x: (pageWidth - width * scale) / 2,
    y: (pageHeight - height * scale) / 2,
    width: width * scale,
    height: height * scale,
  };
}

export async function imagesToPdf(sources, options = {}) {
  if (!sources.length) throw new Error("Add at least one image.");
  const result = await PDFDocument.create();
  result.setProducer("AgenticThat PDF Studio");
  for (let index = 0; index < sources.length; index += 1) {
    await yieldToBrowser(options.signal);
    const source = sources[index];
    const image =
      source.imageType === "image/jpeg"
        ? await result.embedJpg(source.bytes)
        : await result.embedPng(source.bytes);
    const position = imagePlacement(image.width, image.height, options);
    const page = result.addPage([position.pageWidth, position.pageHeight]);
    page.drawImage(image, position);
    options.onProgress?.(index + 1, sources.length);
  }
  checkCancelled(options.signal);
  return result.save();
}
