import {
  PDF_LIMITS,
  checkCancelled,
  safeBasename,
  yieldToBrowser,
} from "./pdf-operations.js";

let rendererPromise;
export async function loadRenderer() {
  rendererPromise ||= import("pdfjs-dist/build/pdf.mjs")
    .then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = `/tools/pdf/assets/${pdfjs.version}/build/pdf.worker.min.mjs`;
      return pdfjs;
    })
    .catch((error) => {
      rendererPromise = null;
      throw error;
    });
  return rendererPromise;
}

export async function openPreview(bytes, signal) {
  const pdfjs = await loadRenderer();
  checkCancelled(signal);
  const base = `/tools/pdf/assets/${pdfjs.version}`;
  // PDF.js transfers this buffer to its worker. Keep the original for exports.
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
    cMapUrl: `${base}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}/standard_fonts/`,
    wasmUrl: `${base}/wasm/`,
    iccUrl: `${base}/iccs/`,
  });
  let rejectAbort;
  const cancelled = new Promise((_, reject) => {
    rejectAbort = reject;
  });
  const abort = () => {
    void task.destroy().catch(() => {});
    rejectAbort(new DOMException("Cancelled", "AbortError"));
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try {
    return await Promise.race([task.promise, cancelled]);
  } catch (error) {
    await task.destroy();
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

export async function renderPage(
  document,
  index,
  canvas,
  { scale = 1, rotation = 0, maxWidth, signal } = {},
) {
  checkCancelled(signal);
  const page = await document.getPage(index + 1);
  checkCancelled(signal);
  const base = page.getViewport({ scale: 1, rotation: page.rotate + rotation });
  const viewport = page.getViewport({
    scale: maxWidth ? Math.min(maxWidth / base.width, 1) : scale,
    rotation: page.rotate + rotation,
  });
  if (
    viewport.width * viewport.height > PDF_LIMITS.imagePixels ||
    viewport.width > 16000 ||
    viewport.height > 16000
  )
    throw new Error(
      "This page is too large to render at this quality. Select a lower resolution.",
    );
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context)
    throw new Error("Your browser could not create an image canvas.");
  const task = page.render({
    canvasContext: context,
    viewport,
    background: "rgb(255,255,255)",
  });
  const abort = () => task.cancel();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await task.promise;
    checkCancelled(signal);
  } finally {
    signal?.removeEventListener("abort", abort);
    page.cleanup();
  }
}

export function canvasBlob(canvas, type = "image/png", quality = 0.92) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("The browser could not export this image.")),
      type,
      quality,
    ),
  );
}

export async function prepareImage(file, signal) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    checkCancelled(signal);
    if (
      !image.naturalWidth ||
      image.naturalWidth * image.naturalHeight > PDF_LIMITS.imagePixels ||
      image.naturalWidth > 16000 ||
      image.naturalHeight > 16000
    )
      throw new Error(
        `${file.name} exceeds the image limit of 24 megapixels or 16,000 pixels per side.`,
      );
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    try {
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Your browser could not read this image.");
      context.drawImage(image, 0, 0);
      // Browser decoding applies photo orientation; normalizing also supports WebP.
      const imageType = /\.jpe?g$/i.test(file.name)
        ? "image/jpeg"
        : "image/png";
      const blob = await canvasBlob(canvas, imageType, 0.96);
      if (blob.size > PDF_LIMITS.fileBytes)
        throw new Error(
          `${file.name} exceeds the 25 MB limit after decoding. Resize the image and try again.`,
        );
      const bytes = new Uint8Array(await blob.arrayBuffer());
      checkCancelled(signal);
      return {
        bytes,
        imageType,
        width: canvas.width,
        height: canvas.height,
        preview: URL.createObjectURL(blob),
      };
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  } catch (error) {
    if (error.name === "AbortError" || /limit|browser/.test(error.message))
      throw error;
    throw new Error(
      `${file.name} could not be decoded. Choose a valid JPG, PNG, or WebP image.`,
    );
  } finally {
    URL.revokeObjectURL(url);
    image.src = "";
  }
}

export async function zipOutputs(outputs, signal) {
  checkCancelled(signal);
  const { zip } = await import("fflate");
  const entries = Object.create(null);
  let total = 0;
  for (const output of outputs) {
    total += output.blob.size;
    if (total > PDF_LIMITS.archiveBytes)
      throw new Error(
        "The download exceeds 150 MB. Export fewer pages or choose a lower resolution.",
      );
    entries[output.name] = new Uint8Array(await output.blob.arrayBuffer());
    checkCancelled(signal);
  }
  return new Promise((resolve, reject) => {
    const abort = () => {
      terminate();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const terminate = zip(entries, { level: 0 }, (error, data) => {
      signal?.removeEventListener("abort", abort);
      if (error)
        reject(
          new Error(
            "The download archive could not be created. Try fewer pages.",
          ),
        );
      else resolve(new Blob([data], { type: "application/zip" }));
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export async function pdfToImages(
  pdfDocument,
  indices,
  { format = "png", scale = 2, name = "document", signal, onProgress } = {},
) {
  if (!indices.length || indices.length > PDF_LIMITS.exportPages)
    throw new Error(
      `Export between 1 and ${PDF_LIMITS.exportPages} pages at a time.`,
    );
  if (!["png", "jpg"].includes(format) || ![1, 2, 3].includes(scale))
    throw new Error("Choose a valid image format and resolution.");
  const outputs = [];
  let total = 0;
  const canvas = document.createElement("canvas");
  try {
    for (let index = 0; index < indices.length; index += 1) {
      await yieldToBrowser(signal);
      await renderPage(pdfDocument, indices[index], canvas, { scale, signal });
      const blob = await canvasBlob(
        canvas,
        format === "jpg" ? "image/jpeg" : "image/png",
      );
      total += blob.size;
      if (total > PDF_LIMITS.archiveBytes)
        throw new Error(
          "The images exceed 150 MB. Export fewer pages or choose a lower resolution.",
        );
      outputs.push({
        name: `${safeBasename(name)}-page-${String(indices[index] + 1).padStart(3, "0")}.${format}`,
        blob,
      });
      onProgress?.(index + 1, indices.length);
    }
    return outputs;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
