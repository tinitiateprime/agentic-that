import { PDFHexString, PDFName, PDFNumber, degrees, rgb } from "pdf-lib";
import {
  PDF_LIMITS,
  checkCancelled,
  readPdf,
  yieldToBrowser,
} from "./pdf-operations.js";

export function pageGeometry(page) {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  const x = Math.max(media.x, crop.x);
  const y = Math.max(media.y, crop.y);
  const width = Math.min(media.x + media.width, crop.x + crop.width) - x;
  const height = Math.min(media.y + media.height, crop.y + crop.height) - y;
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  const unit =
    page.node.lookupMaybe(PDFName.of("UserUnit"), PDFNumber)?.asNumber() || 1;
  if (
    width <= 0 ||
    height <= 0 ||
    ![0, 90, 180, 270].includes(rotation) ||
    unit <= 0
  )
    throw new Error("This page has unsupported dimensions or rotation.");
  return {
    x,
    y,
    width,
    height,
    rotation,
    unit,
    displayWidth: (rotation % 180 ? height : width) * unit,
    displayHeight: (rotation % 180 ? width : height) * unit,
  };
}

export function displayPointToPdf(geometry, x, y) {
  const { x: left, y: bottom, width, height, unit, rotation } = geometry;
  const u = x / unit;
  const v = y / unit;
  if (rotation === 90) return { x: left + v, y: bottom + u };
  if (rotation === 180) return { x: left + width - u, y: bottom + v };
  if (rotation === 270) return { x: left + width - v, y: bottom + height - u };
  return { x: left + u, y: bottom + height - v };
}
export function normalizeRectangle(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}
function color(value) {
  if (!/^#[0-9a-f]{6}$/i.test(value))
    throw new Error("Choose a valid annotation color.");
  return rgb(
    parseInt(value.slice(1, 3), 16) / 255,
    parseInt(value.slice(3, 5), 16) / 255,
    parseInt(value.slice(5, 7), 16) / 255,
  );
}

export async function editPdf(
  bytes,
  elements,
  { fontBytes, boldFontBytes, italicFontBytes, signal, onProgress } = {},
) {
  if (!elements.length)
    throw new Error("Add at least one annotation before saving.");
  if (elements.length > 500)
    throw new Error("Use up to 500 annotations in one document.");
  const document = await readPdf(bytes);
  const fonts = new Map();
  const images = new Map();
  if (elements.some((element) => element.type === "text")) {
    if (!fontBytes)
      throw new Error(
        "The annotation font could not be loaded. Please try again.",
      );
    const module = await import("@pdf-lib/fontkit");
    const fontkit = module.default || module;
    document.registerFontkit(fontkit);
    for (const [name, data] of [
      ["regular", fontBytes],
      ["bold", boldFontBytes || fontBytes],
      ["italic", italicFontBytes || fontBytes],
    ]) {
      const subset = elements.filter(
        (element) =>
          element.type === "text" &&
          (element.bold ? "bold" : element.italic ? "italic" : "regular") ===
            name,
      );
      if (!subset.length) continue;
      const parsedFont = fontkit.create(data);
      for (const element of subset)
        for (const character of element.text.replace(/[\r\n\t]/g, ""))
          if (!parsedFont.hasGlyphForCodePoint(character.codePointAt(0)))
            throw new Error(
              "This annotation contains characters the selected font cannot display. Choose a suitable custom font.",
            );
      fonts.set(name, await document.embedFont(data, { subset: true }));
    }
  }
  let textCount = 0;
  for (let index = 0; index < elements.length; index += 1) {
    await yieldToBrowser(signal);
    const element = elements[index];
    if (
      !Number.isInteger(element.pageIndex) ||
      element.pageIndex < 0 ||
      element.pageIndex >= document.getPageCount()
    )
      throw new Error("An annotation refers to a missing page.");
    const page = document.getPage(element.pageIndex);
    const geometry = pageGeometry(page);
    const unit = geometry.unit;
    if (
      !Number.isFinite(element.x) ||
      !Number.isFinite(element.y) ||
      element.x < 0 ||
      element.y < 0 ||
      element.x > geometry.displayWidth ||
      element.y > geometry.displayHeight
    )
      throw new Error("An annotation is outside the page.");
    const fill = color(element.color || "#111827");
    if (element.type === "text") {
      if (
        typeof element.text !== "string" ||
        element.text.length > 5000 ||
        !Number.isFinite(element.fontSize) ||
        element.fontSize < 8 ||
        element.fontSize > 96
      )
        throw new Error(
          "Use annotation text of up to 5,000 characters and a font size between 8 and 96 pt.",
        );
      textCount += element.text.length;
      if (textCount > 100000)
        throw new Error("The document has too much added text.");
      const font = fonts.get(
        element.bold ? "bold" : element.italic ? "italic" : "regular",
      );
      const lines = element.text.replace(/\r/g, "").split("\n");
      if (
        lines.some(
          (line) =>
            element.x + font.widthOfTextAtSize(line, element.fontSize) >
            geometry.displayWidth + 0.5,
        ) ||
        element.y + ((lines.length - 1) * 1.2 + 1.1) * element.fontSize >
          geometry.displayHeight + 0.5
      )
        throw new Error(
          "Some added text extends beyond the page. Move it, reduce its font size, or add line breaks before saving.",
        );
      lines.forEach((line, lineIndex) => {
        const point = displayPointToPdf(
          geometry,
          element.x,
          element.y + (lineIndex * 1.2 + 0.85) * element.fontSize,
        );
        page.drawText(line, {
          ...point,
          size: element.fontSize / unit,
          font,
          color: fill,
          rotate: degrees(geometry.rotation),
        });
      });
    } else if (element.type === "freehand") {
      if (
        !Array.isArray(element.points) ||
        element.points.length > 5000 ||
        element.points.some(
          (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
        )
      )
        throw new Error("This drawing contains too many or invalid points.");
      for (
        let pointIndex = 1;
        pointIndex < element.points.length;
        pointIndex += 1
      )
        page.drawLine({
          start: displayPointToPdf(
            geometry,
            element.points[pointIndex - 1].x,
            element.points[pointIndex - 1].y,
          ),
          end: displayPointToPdf(
            geometry,
            element.points[pointIndex].x,
            element.points[pointIndex].y,
          ),
          thickness:
            Math.max(0.5, Math.min(12, element.strokeWidth || 2)) / unit,
          color: fill,
        });
    } else if (element.type === "note") {
      if (!element.text?.trim() || element.text.length > 5000)
        throw new Error("Write a note of between 1 and 5,000 characters.");
      const first = displayPointToPdf(geometry, element.x, element.y);
      const last = displayPointToPdf(geometry, element.x + 20, element.y + 20);
      const annotation = document.context.obj({
        Type: "Annot",
        Subtype: "Text",
        Rect: [
          Math.min(first.x, last.x),
          Math.min(first.y, last.y),
          Math.max(first.x, last.x),
          Math.max(first.y, last.y),
        ],
        Contents: PDFHexString.fromText(element.text),
        T: PDFHexString.fromText("AgenticThat"),
        Name: "Comment",
        C: [1, 0.85, 0.2],
        F: 4,
        Open: false,
      });
      page.node.addAnnot(document.context.register(annotation));
    } else {
      if (
        !["rectangle", "ellipse", "highlight", "image"].includes(
          element.type,
        ) ||
        !Number.isFinite(element.width) ||
        !Number.isFinite(element.height) ||
        element.width <= 0 ||
        element.height <= 0
      )
        throw new Error("This annotation has an unsupported shape or size.");
      const p1 = displayPointToPdf(geometry, element.x, element.y);
      const p2 = displayPointToPdf(
        geometry,
        element.x + element.width,
        element.y + element.height,
      );
      const bounds = {
        x: Math.min(p1.x, p2.x),
        y: Math.min(p1.y, p2.y),
        width: Math.abs(p1.x - p2.x),
        height: Math.abs(p1.y - p2.y),
      };
      if (element.type === "image") {
        if (
          !element.asset?.bytes ||
          element.asset.bytes.length > PDF_LIMITS.fileBytes
        )
          throw new Error("The inserted image is missing or too large.");
        if (!images.has(element.asset.id))
          images.set(
            element.asset.id,
            element.asset.type === "image/jpeg"
              ? await document.embedJpg(element.asset.bytes)
              : await document.embedPng(element.asset.bytes),
          );
        const origin = displayPointToPdf(
          geometry,
          element.x,
          element.y + element.height,
        );
        page.drawImage(images.get(element.asset.id), {
          ...origin,
          width: element.width / unit,
          height: element.height / unit,
          rotate: degrees(geometry.rotation),
        });
      } else if (element.type === "ellipse")
        page.drawEllipse({
          x: bounds.x + bounds.width / 2,
          y: bounds.y + bounds.height / 2,
          xScale: bounds.width / 2,
          yScale: bounds.height / 2,
          borderColor: fill,
          borderWidth:
            Math.max(0.5, Math.min(12, element.strokeWidth || 2)) / unit,
        });
      else if (element.type === "highlight")
        page.drawRectangle({ ...bounds, color: fill, opacity: 0.28 });
      else
        page.drawRectangle({
          ...bounds,
          borderColor: fill,
          borderWidth:
            Math.max(0.5, Math.min(12, element.strokeWidth || 2)) / unit,
        });
    }
    onProgress?.(`Saving annotation ${index + 1} of ${elements.length}`);
  }
  checkCancelled(signal);
  const output = await document.save({ updateFieldAppearances: false });
  checkCancelled(signal);
  if (output.length > PDF_LIMITS.archiveBytes)
    throw new Error(
      "The edited PDF exceeds 150 MB. Use smaller images or fewer annotations.",
    );
  return output;
}

export async function loadAnnotationFonts() {
  const { version } = await import("pdfjs-dist/build/pdf.mjs");
  const values = await Promise.all(
    [
      "LiberationSans-Regular.ttf",
      "LiberationSans-Bold.ttf",
      "LiberationSans-Italic.ttf",
    ].map(async (name) => {
      const response = await fetch(
        `/tools/pdf/assets/${version}/standard_fonts/${name}`,
      );
      if (!response.ok)
        throw new Error(
          "The annotation fonts could not be loaded. Please try again.",
        );
      return new Uint8Array(await response.arrayBuffer());
    }),
  );
  return {
    fontBytes: values[0],
    boldFontBytes: values[1],
    italicFontBytes: values[2],
  };
}
