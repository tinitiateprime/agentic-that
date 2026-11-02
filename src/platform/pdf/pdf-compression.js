import { PDFName, PDFNumber, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { checkCancelled, readPdf, yieldToBrowser } from "./pdf-operations.js";

export const COMPRESSION_LEVELS = Object.freeze({
  gentle: { label: "Gentle", quality: 0.92, maxDimension: 3200 },
  balanced: { label: "Balanced", quality: 0.8, maxDimension: 2200 },
  strong: { label: "Strong", quality: 0.62, maxDimension: 1400 },
});

function number(dict, name) {
  return dict.lookupMaybe(PDFName.of(name), PDFNumber)?.asNumber();
}

// An embedded JPEG's EXIF orientation is not the PDF page orientation. Browser
// image decoding can apply EXIF, so preserve these uncommon streams unchanged.
function hasExif(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return true;
  let offset = 2;
  while (offset + 4 < bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0xe1) return true;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) break;
    offset += length + 2;
  }
  return false;
}

export async function compressPdf(
  bytes,
  { level = "balanced", recompressImage, signal, onProgress } = {},
) {
  const settings = COMPRESSION_LEVELS[level];
  if (!settings) throw new Error("Choose a valid compression level.");
  const document = await readPdf(bytes);
  const objects = document.context.enumerateIndirectObjects();
  let optimizedImages = 0;
  for (let index = 0; index < objects.length; index += 1) {
    await yieldToBrowser(signal);
    const [reference, object] = objects[index];
    if (!(object instanceof PDFRawStream) || !recompressImage) continue;
    const dict = object.dict;
    if (dict.lookup(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
    const colorSpace = dict.lookup(PDFName.of("ColorSpace"));
    const width = number(dict, "Width");
    const height = number(dict, "Height");
    const filter = dict.lookup(PDFName.of("Filter"));
    // Retain masks, transparency, CMYK/ICC/indexed colors and predictors exactly.
    if (
      ![PDFName.of("DeviceRGB"), PDFName.of("DeviceGray")].includes(
        colorSpace,
      ) ||
      number(dict, "BitsPerComponent") !== 8 ||
      dict.has(PDFName.of("SMask")) ||
      dict.has(PDFName.of("Mask")) ||
      dict.has(PDFName.of("Decode")) ||
      dict.has(PDFName.of("DecodeParms")) ||
      !width ||
      !height ||
      width * height > 24_000_000 ||
      width > 16000 ||
      height > 16000
    )
      continue;
    let input;
    if (filter === PDFName.of("DCTDecode")) {
      const data = object.getContents();
      if (hasExif(data)) continue;
      input = { bytes: data, width, height, kind: "jpeg" };
    } else if (
      filter === PDFName.of("FlateDecode") &&
      colorSpace === PDFName.of("DeviceRGB")
    ) {
      try {
        const data = decodePDFRawStream(object).getBytes(
          width * height * 3 + 1,
        );
        if (data.length !== width * height * 3) continue;
        input = { bytes: data, width, height, kind: "rgb" };
      } catch {
        continue;
      }
    } else continue;
    const compressed = await recompressImage(input, settings, signal);
    checkCancelled(signal);
    if (
      !compressed ||
      compressed.bytes.length >= object.getContentsSize() * 0.97
    )
      continue;
    const next = dict.clone(document.context);
    next.set(PDFName.of("Width"), PDFNumber.of(compressed.width));
    next.set(PDFName.of("Height"), PDFNumber.of(compressed.height));
    next.set(PDFName.of("ColorSpace"), PDFName.of("DeviceRGB"));
    next.set(PDFName.of("Filter"), PDFName.of("DCTDecode"));
    document.context.assign(reference, PDFRawStream.of(next, compressed.bytes));
    optimizedImages += 1;
    onProgress?.(
      `Optimized ${optimizedImages} image${optimizedImages === 1 ? "" : "s"}`,
    );
  }
  checkCancelled(signal);
  const candidate = await document.save({
    useObjectStreams: true,
    updateFieldAppearances: false,
  });
  checkCancelled(signal);
  const result = candidate.length < bytes.length ? candidate : bytes;
  return {
    bytes: result,
    originalBytes: bytes.length,
    resultBytes: result.length,
    savedBytes: bytes.length - result.length,
    savedPercent: Math.round((1 - result.length / bytes.length) * 100),
    optimizedImages: result === bytes ? 0 : optimizedImages,
    unchanged: result === bytes,
  };
}

export async function recompressBrowserImage(input, settings, signal) {
  const factor = Math.min(
    1,
    settings.maxDimension / Math.max(input.width, input.height),
  );
  const width = Math.max(1, Math.round(input.width * factor));
  const height = Math.max(1, Math.round(input.height * factor));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  let bitmap;
  let rawCanvas;
  try {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Your browser could not prepare this image.");
    if (input.kind === "jpeg")
      bitmap = await createImageBitmap(
        new Blob([input.bytes], { type: "image/jpeg" }),
      );
    else {
      rawCanvas = document.createElement("canvas");
      rawCanvas.width = input.width;
      rawCanvas.height = input.height;
      const rawContext = rawCanvas.getContext("2d");
      const rgba = new Uint8ClampedArray(input.width * input.height * 4);
      for (
        let source = 0, target = 0;
        source < input.bytes.length;
        source += 3, target += 4
      ) {
        rgba[target] = input.bytes[source];
        rgba[target + 1] = input.bytes[source + 1];
        rgba[target + 2] = input.bytes[source + 2];
        rgba[target + 3] = 255;
      }
      rawContext.putImageData(
        new ImageData(rgba, input.width, input.height),
        0,
        0,
      );
      bitmap = rawCanvas;
    }
    checkCancelled(signal);
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error("This image could not be compressed.")),
        "image/jpeg",
        settings.quality,
      ),
    );
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
  } finally {
    bitmap?.close?.();
    canvas.width = 0;
    canvas.height = 0;
    if (rawCanvas) {
      rawCanvas.width = 0;
      rawCanvas.height = 0;
    }
  }
}
