"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Copy,
  Download,
  FileText,
  GripVertical,
  ImagePlus,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RotateCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  PDF_LIMITS,
  assemblePdf,
  checkCancelled,
  imagesToPdf,
  parsePageSelection,
  readPdf,
  safeBasename,
  splitGroups,
  validateFiles,
  yieldToBrowser,
} from "./pdf-operations";
import {
  openPreview,
  pdfToImages,
  prepareImage,
  renderPage,
  zipOutputs,
} from "./pdf-browser";
import styles from "./pdf-studio.module.css";

const formatSize = (bytes) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const id = () => crypto.randomUUID();

function PdfThumbnail({ source, index = 0, rotation = 0 }) {
  const host = useRef(null);
  const canvas = useRef(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let observer;
    let started = false;
    async function draw() {
      if (started) return;
      started = true;
      try {
        await renderPage(source.document, index, canvas.current, {
          maxWidth: 240,
          rotation,
          signal: controller.signal,
        });
      } catch (issue) {
        if (
          !controller.signal.aborted &&
          issue.name !== "RenderingCancelledException"
        )
          setError(true);
      }
    }
    // Render only visible thumbnails, keeping long documents responsive.
    if (typeof IntersectionObserver === "undefined") void draw();
    else {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer.disconnect();
            void draw();
          }
        },
        { rootMargin: "200px" },
      );
      observer.observe(host.current);
    }
    return () => {
      controller.abort();
      observer?.disconnect();
    };
  }, [source, index, rotation]);
  return (
    <div className={styles.thumbnail} ref={host}>
      {error ? (
        <span>
          <FileText size={27} />
          Preview unavailable
        </span>
      ) : (
        <canvas
          ref={canvas}
          aria-label={`Preview of page ${index + 1} from ${source.name}`}
          role="img"
        />
      )}
    </div>
  );
}

function IconButton({ label, children, ...props }) {
  return (
    <button
      type="button"
      className={styles.iconButton}
      title={label}
      aria-label={label}
      {...props}
    >
      {children}
    </button>
  );
}

export default function PdfWorkspace({ tool }) {
  const isImages = tool.id === "images-to-pdf";
  const isMerge = tool.id === "merge-pdf";
  const isOrganize = tool.id === "organize-pdf";
  const isSplit = tool.id === "split-pdf";
  const isExport = tool.id === "pdf-to-images";
  const multiple = isImages || isMerge || isOrganize;
  const [sources, setSources] = useState([]);
  const [pages, setPages] = useState([]);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState(null);
  const [filename, setFilename] = useState(
    isMerge ? "merged" : isImages ? "images" : "document",
  );
  const [splitMode, setSplitMode] = useState("extract");
  const [selection, setSelection] = useState("");
  const [imageFormat, setImageFormat] = useState("png");
  const [resolution, setResolution] = useState(2);
  const [imageOptions, setImageOptions] = useState({
    pageSize: "a4",
    orientation: "auto",
    margin: 24,
  });
  const input = useRef(null);
  const operation = useRef(null);
  const sourcesRef = useRef([]);
  const resultRef = useRef(null);
  const mounted = useRef(true);
  const dragged = useRef(null);
  const dragDepth = useRef(0);

  function disposeSource(source) {
    source.document?.loadingTask.destroy().catch(() => {});
    if (source.preview) URL.revokeObjectURL(source.preview);
  }
  function clearResult() {
    if (resultRef.current) URL.revokeObjectURL(resultRef.current.url);
    resultRef.current = null;
    setResult(null);
  }
  function setSourceList(list) {
    sourcesRef.current = list;
    setSources(list);
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.abort();
      sourcesRef.current.forEach(disposeSource);
      if (resultRef.current) URL.revokeObjectURL(resultRef.current.url);
    };
  }, []);

  function changed() {
    clearResult();
    setNotice("");
    setError("");
  }
  function begin(label) {
    if (operation.current) return null;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(label);
    setProgress("");
    setError("");
    setNotice("");
    clearResult();
    return controller;
  }
  function failed(issue, controller) {
    if (!mounted.current) return;
    if (
      controller.signal.aborted ||
      issue.name === "AbortError" ||
      issue.name === "RenderingCancelledException"
    )
      setNotice("Cancelled. Your source files are unchanged.");
    else
      setError(
        issue.message ||
          "Something went wrong. Please try again with a smaller file.",
      );
  }
  function finish(controller) {
    if (operation.current === controller) operation.current = null;
    if (mounted.current) {
      setBusy("");
      setProgress("");
    }
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const controller = begin("Reading files");
    if (!controller) return;
    const pending = [];
    try {
      if (!multiple && files.length !== 1)
        throw new Error("Choose one PDF at a time for this tool.");
      validateFiles(
        files,
        multiple ? sourcesRef.current : [],
        isImages ? "image" : "pdf",
      );
      let pageTotal = multiple
        ? isOrganize
          ? pages.length
          : sourcesRef.current.reduce(
              (sum, source) => sum + source.pageCount,
              0,
            )
        : 0;
      let imagePixels = isImages
        ? sourcesRef.current.reduce(
            (sum, source) => sum + source.width * source.height,
            0,
          )
        : 0;
      let normalizedBytes = isImages
        ? sourcesRef.current.reduce(
            (sum, source) => sum + source.bytes.length,
            0,
          )
        : 0;
      for (let index = 0; index < files.length; index += 1) {
        await yieldToBrowser(controller.signal);
        const file = files[index];
        setProgress(`Reading ${index + 1} of ${files.length}: ${file.name}`);
        const source = { id: id(), name: file.name, size: file.size };
        if (isImages) {
          Object.assign(source, await prepareImage(file, controller.signal), {
            pageCount: 1,
          });
          pending.push(source);
          imagePixels += source.width * source.height;
          normalizedBytes += source.bytes.length;
          if (
            imagePixels > PDF_LIMITS.totalImagePixels ||
            normalizedBytes > PDF_LIMITS.totalBytes
          )
            throw new Error(
              "These images use too much memory together. Use fewer images or resize them before trying again.",
            );
        } else {
          source.bytes = new Uint8Array(await file.arrayBuffer());
          const parsed = await readPdf(source.bytes, file.name);
          source.pageCount = parsed.getPageCount();
          pageTotal += source.pageCount;
          if (pageTotal > PDF_LIMITS.pages)
            throw new Error(
              `Work with up to ${PDF_LIMITS.pages} pages at a time.`,
            );
          // Register before starting the worker so cancellation always releases it.
          pending.push(source);
          source.document = await openPreview(source.bytes);
        }
      }
      checkCancelled(controller.signal);
      if (!mounted.current) throw new DOMException("Cancelled", "AbortError");
      const previous = sourcesRef.current;
      setSourceList(multiple ? [...previous, ...pending] : pending);
      if (isOrganize)
        setPages((current) => [
          ...current,
          ...pending.flatMap((source) =>
            Array.from({ length: source.pageCount }, (_, index) => ({
              id: id(),
              sourceId: source.id,
              index,
              rotation: 0,
            })),
          ),
        ]);
      if (!multiple) {
        previous.forEach(disposeSource);
        setSelection(`1-${pending[0].pageCount}`);
        setFilename(safeBasename(pending[0].name));
      }
      if (multiple && previous.length === 0 && !isMerge && !isImages)
        setFilename(safeBasename(pending[0].name));
      setNotice(
        `${pending.length} ${isImages ? "image" : "PDF"}${pending.length === 1 ? "" : "s"} added.`,
      );
    } catch (issue) {
      pending.forEach(disposeSource);
      failed(issue, controller);
    } finally {
      if (input.current) input.current.value = "";
      finish(controller);
    }
  }

  function reset() {
    if (operation.current) return;
    sourcesRef.current.forEach(disposeSource);
    setSourceList([]);
    setPages([]);
    changed();
    setSelection("");
  }
  function removeSource(sourceId) {
    changed();
    const source = sourcesRef.current.find((entry) => entry.id === sourceId);
    if (source) disposeSource(source);
    setSourceList(sourcesRef.current.filter((entry) => entry.id !== sourceId));
  }
  function moveItem(from, to) {
    const entries = isOrganize ? pages : sourcesRef.current;
    if (
      from < 0 ||
      to < 0 ||
      from >= entries.length ||
      to >= entries.length ||
      from === to
    )
      return;
    changed();
    const next = [...entries];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    if (isOrganize) setPages(next);
    else setSourceList(next);
    setNotice(`Moved item ${from + 1} to position ${to + 1}.`);
  }
  function changePage(pageId, action) {
    changed();
    if (action === "duplicate" && pages.length >= PDF_LIMITS.pages) {
      setError(`The result can contain up to ${PDF_LIMITS.pages} pages.`);
      return;
    }
    setPages((current) =>
      current.flatMap((page) =>
        page.id !== pageId
          ? [page]
          : action === "remove"
            ? []
            : action === "duplicate"
              ? [page, { ...page, id: id() }]
              : [{ ...page, rotation: (page.rotation + 90) % 360 }],
      ),
    );
  }

  async function process() {
    const controller = begin("Creating your download");
    if (!controller) return;
    const signal = controller.signal;
    const onProgress = (done, total) => {
      if (mounted.current) setProgress(`Processing ${done} of ${total}`);
    };
    try {
      let outputs;
      const base = safeBasename(filename);
      if (isMerge || isOrganize) {
        if (isMerge && sources.length < 2)
          throw new Error("Add at least two PDF files to merge.");
        const selectedPages = isOrganize
          ? pages
          : sources.flatMap((source) =>
              Array.from({ length: source.pageCount }, (_, index) => ({
                sourceId: source.id,
                index,
                rotation: 0,
              })),
            );
        const bytes = await assemblePdf(sources, selectedPages, {
          signal,
          onProgress,
        });
        outputs = [
          {
            name: `${base}.pdf`,
            blob: new Blob([bytes], { type: "application/pdf" }),
          },
        ];
      } else if (isImages) {
        const bytes = await imagesToPdf(sources, {
          ...imageOptions,
          signal,
          onProgress,
        });
        outputs = [
          {
            name: `${base}.pdf`,
            blob: new Blob([bytes], { type: "application/pdf" }),
          },
        ];
      } else {
        const source = sources[0];
        if (!source) throw new Error("Add a PDF first.");
        if (isExport)
          outputs = await pdfToImages(
            source.document,
            parsePageSelection(selection, source.pageCount),
            {
              format: imageFormat,
              scale: resolution,
              name: base,
              signal,
              onProgress,
            },
          );
        else {
          const groups = splitGroups(splitMode, selection, source.pageCount);
          if (groups.length > PDF_LIMITS.exportPages)
            throw new Error(
              `Create up to ${PDF_LIMITS.exportPages} separate files at a time. Use selected ranges for a larger document.`,
            );
          let totalBytes = 0;
          const documents = new Map();
          outputs = [];
          for (let index = 0; index < groups.length; index += 1) {
            const bytes = await assemblePdf(
              sources,
              groups[index].map((pageIndex) => ({
                sourceId: source.id,
                index: pageIndex,
              })),
              { signal, documents },
            );
            totalBytes += bytes.length;
            if (totalBytes > PDF_LIMITS.archiveBytes)
              throw new Error(
                "The results exceed 150 MB. Split fewer pages at a time.",
              );
            outputs.push({
              name:
                groups.length === 1
                  ? `${base}-selected.pdf`
                  : `${base}-part-${String(index + 1).padStart(3, "0")}.pdf`,
              blob: new Blob([bytes], { type: "application/pdf" }),
            });
            onProgress(index + 1, groups.length);
          }
        }
      }
      checkCancelled(signal);
      setProgress("Preparing download…");
      const blob =
        outputs.length === 1
          ? outputs[0].blob
          : await zipOutputs(outputs, signal);
      checkCancelled(signal);
      const download = {
        name:
          outputs.length === 1
            ? outputs[0].name
            : `${base}-${isExport ? "images" : "split"}.zip`,
        url: URL.createObjectURL(blob),
        size: blob.size,
        count: outputs.length,
      };
      resultRef.current = download;
      setResult(download);
    } catch (issue) {
      failed(issue, controller);
    } finally {
      finish(controller);
    }
  }

  const totalPages = isOrganize
    ? pages.length
    : sources.reduce((sum, source) => sum + source.pageCount, 0);
  const actionLabel = isMerge
    ? "Merge PDFs"
    : isSplit
      ? "Split PDF"
      : isOrganize
        ? "Save organized PDF"
        : isImages
          ? "Create PDF"
          : "Export images";
  const disabled =
    !sources.length ||
    (isMerge && sources.length < 2) ||
    (isOrganize && !pages.length);
  const entries = isOrganize ? pages : sources;
  return (
    <div className={styles.workspace}>
      <div className={styles.workspaceMain}>
        <input
          ref={input}
          type="file"
          accept={
            isImages
              ? ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
              : ".pdf,application/pdf"
          }
          multiple={multiple}
          hidden
          aria-label={isImages ? "Choose images" : "Choose PDFs"}
          onChange={(event) => void addFiles(event.target.files)}
        />
        <button
          type="button"
          className={`${styles.dropzone} ${dragging ? styles.dragActive : ""} ${sources.length ? styles.compactDrop : ""}`}
          disabled={Boolean(busy)}
          onClick={() => input.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault();
            if (event.dataTransfer.types.includes("Files")) {
              dragDepth.current += 1;
              setDragging(true);
            }
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = busy ? "none" : "copy";
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (!dragDepth.current) setDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            dragDepth.current = 0;
            setDragging(false);
            void addFiles(event.dataTransfer.files);
          }}
        >
          <span className={styles.uploadIcon}>
            {sources.length ? (
              <Plus size={22} />
            ) : isImages ? (
              <ImagePlus size={29} />
            ) : (
              <Upload size={29} />
            )}
          </span>
          <strong>
            {sources.length
              ? multiple
                ? `Add more ${isImages ? "images" : "PDFs"}`
                : "Choose a different PDF"
              : `Choose ${isImages ? "images" : multiple ? "PDF files" : "a PDF file"}`}
          </strong>
          <span>
            {sources.length ? "or drop files here" : "or drag and drop here"}
          </span>
          {!sources.length && (
            <small>
              {isImages
                ? "JPG, PNG, WebP · 24 MP per image"
                : "PDF · up to 300 pages total"}
              <br />
              25 MB per file · 100 MB total{multiple ? " · up to 30 files" : ""}
            </small>
          )}
        </button>

        {sources.length > 0 && (
          <>
            <div className={styles.filesHeading}>
              <div>
                <h2>
                  {isOrganize
                    ? "Arrange your pages"
                    : isImages
                      ? "Your images"
                      : isMerge
                        ? "Your documents"
                        : "Your document"}
                </h2>
                <p>
                  {totalPages} {isImages ? "image" : "page"}
                  {totalPages === 1 ? "" : "s"}
                  {(isMerge || isImages || isOrganize) &&
                    " · Drag to reorder or use the arrow buttons"}
                </p>
              </div>
              <button
                type="button"
                className={styles.textButton}
                onClick={reset}
                disabled={Boolean(busy)}
              >
                Clear all
              </button>
            </div>
            <fieldset
              disabled={Boolean(busy)}
              className={styles.fileFieldset}
              aria-label={isOrganize ? "Document pages" : "Source files"}
            >
              <div className={isOrganize ? styles.pageGrid : styles.fileList}>
                {entries.map((entry, index) => {
                  const source = isOrganize
                    ? sources.find((item) => item.id === entry.sourceId)
                    : entry;
                  const movable = isOrganize || isMerge || isImages;
                  const label = isOrganize ? `Page ${index + 1}` : source.name;
                  return (
                    <article
                      key={entry.id}
                      className={isOrganize ? styles.pageCard : styles.fileCard}
                      draggable={movable && !busy}
                      onDragStart={(event) => {
                        if (!movable) return;
                        dragged.current = index;
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", String(index));
                      }}
                      onDragOver={(event) => {
                        if (movable && dragged.current !== null) {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                        }
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (!busy && dragged.current !== null)
                          moveItem(dragged.current, index);
                        dragged.current = null;
                      }}
                      onDragEnd={() => {
                        dragged.current = null;
                      }}
                    >
                      {isImages ? (
                        <div className={styles.imageThumb}>
                          <img
                            src={source.preview}
                            alt={`Preview of ${source.name}`}
                            draggable={false}
                          />
                        </div>
                      ) : (
                        <PdfThumbnail
                          source={source}
                          index={isOrganize ? entry.index : 0}
                          rotation={isOrganize ? entry.rotation : 0}
                        />
                      )}
                      <div className={styles.fileDetails}>
                        <strong title={label}>{label}</strong>
                        <span>
                          {isOrganize
                            ? `${source.name} · original page ${entry.index + 1}${entry.rotation ? ` · +${entry.rotation}°` : ""}`
                            : `${source.pageCount} ${isImages ? "image" : "page"}${source.pageCount === 1 ? "" : "s"} · ${formatSize(source.size)}`}
                        </span>
                      </div>
                      <div className={styles.fileActions}>
                        {movable && (
                          <>
                            <GripVertical
                              size={15}
                              className={styles.grip}
                              aria-hidden="true"
                            />
                            <IconButton
                              label={`Move ${label} earlier`}
                              disabled={index === 0}
                              onClick={() => moveItem(index, index - 1)}
                            >
                              <ArrowUp size={15} />
                            </IconButton>
                            <IconButton
                              label={`Move ${label} later`}
                              disabled={index === entries.length - 1}
                              onClick={() => moveItem(index, index + 1)}
                            >
                              <ArrowDown size={15} />
                            </IconButton>
                          </>
                        )}
                        {isOrganize && (
                          <>
                            <IconButton
                              label={`Rotate ${label} clockwise`}
                              onClick={() => changePage(entry.id, "rotate")}
                            >
                              <RotateCw size={15} />
                            </IconButton>
                            <IconButton
                              label={`Duplicate ${label}`}
                              onClick={() => changePage(entry.id, "duplicate")}
                            >
                              <Copy size={15} />
                            </IconButton>
                          </>
                        )}
                        <IconButton
                          label={`Remove ${label}`}
                          onClick={() =>
                            isOrganize
                              ? changePage(entry.id, "remove")
                              : removeSource(source.id)
                          }
                        >
                          <Trash2 size={15} />
                        </IconButton>
                      </div>
                    </article>
                  );
                })}
              </div>
              {isOrganize && !pages.length && (
                <div className={styles.emptyPages}>
                  All pages removed. Add a PDF or clear all to start again.
                </div>
              )}
            </fieldset>
          </>
        )}
      </div>

      <aside className={styles.settings} aria-labelledby="settings-title">
        <div className={styles.settingsHeading}>
          <span className={styles.step}>02</span>
          <div>
            <h2 id="settings-title">Make it yours</h2>
            <p>Set your options, then download.</p>
          </div>
        </div>
        <fieldset disabled={Boolean(busy)} className={styles.options}>
          {isSplit && (
            <>
              <label>
                Split method
                <select
                  aria-label="Split method"
                  value={splitMode}
                  onChange={(event) => {
                    changed();
                    setSplitMode(event.target.value);
                  }}
                >
                  <option value="extract">
                    Extract selected pages into one PDF
                  </option>
                  <option value="ranges">Separate PDFs by ranges</option>
                  <option value="every-page">One PDF per page</option>
                </select>
              </label>
              {splitMode !== "every-page" && (
                <label>
                  {splitMode === "ranges" ? "Page groups" : "Pages to extract"}
                  <input
                    aria-label={
                      splitMode === "ranges"
                        ? "Page groups"
                        : "Pages to extract"
                    }
                    value={selection}
                    placeholder={
                      splitMode === "ranges" ? "1-3; 4-6; 7, 9" : "1-3, 5"
                    }
                    onChange={(event) => {
                      changed();
                      setSelection(event.target.value);
                    }}
                    aria-describedby="page-help"
                  />
                  <small id="page-help">
                    {splitMode === "ranges"
                      ? "Use semicolons between files: 1-3; 4-6. Commas select pages within a file."
                      : "Use commas and ranges: 1-3, 5. Pages stay in the order you enter."}
                  </small>
                </label>
              )}
              <p className={styles.optionHint}>
                Multiple PDFs download together as a ZIP. Up to 100 output files
                per operation.
              </p>
            </>
          )}
          {isExport && (
            <>
              <label>
                Pages to export
                <input
                  aria-label="Pages to export"
                  aria-describedby="export-page-help"
                  value={selection}
                  placeholder="1-3, 5"
                  onChange={(event) => {
                    changed();
                    setSelection(event.target.value);
                  }}
                />
                <small id="export-page-help">
                  Choose up to 100 pages. Use commas and ranges: 1-3, 5.
                </small>
              </label>
              <label>
                Image format
                <select
                  aria-label="Image format"
                  value={imageFormat}
                  onChange={(event) => {
                    changed();
                    setImageFormat(event.target.value);
                  }}
                >
                  <option value="png">PNG — sharp text and graphics</option>
                  <option value="jpg">JPG — smaller files for sharing</option>
                </select>
              </label>
              <label>
                Resolution
                <select
                  aria-label="Resolution"
                  value={resolution}
                  onChange={(event) => {
                    changed();
                    setResolution(Number(event.target.value));
                  }}
                >
                  <option value={1}>Standard · 72 DPI</option>
                  <option value={2}>High · 144 DPI</option>
                  <option value={3}>Extra high · 216 DPI</option>
                </select>
              </label>
              <p className={styles.optionHint}>
                One image per page. Multiple images download together as a ZIP.
              </p>
            </>
          )}
          {isImages && (
            <>
              <label>
                Page size
                <select
                  aria-label="Page size"
                  value={imageOptions.pageSize}
                  onChange={(event) => {
                    changed();
                    setImageOptions({
                      ...imageOptions,
                      pageSize: event.target.value,
                    });
                  }}
                >
                  <option value="a4">A4</option>
                  <option value="letter">US Letter</option>
                  <option value="fit">Fit to image</option>
                </select>
              </label>
              {imageOptions.pageSize !== "fit" && (
                <>
                  <label>
                    Orientation
                    <select
                      aria-label="Orientation"
                      value={imageOptions.orientation}
                      onChange={(event) => {
                        changed();
                        setImageOptions({
                          ...imageOptions,
                          orientation: event.target.value,
                        });
                      }}
                    >
                      <option value="auto">
                        Automatic · follow each image
                      </option>
                      <option value="portrait">Portrait</option>
                      <option value="landscape">Landscape</option>
                    </select>
                  </label>
                  <label>
                    Margins
                    <select
                      aria-label="Margins"
                      value={imageOptions.margin}
                      onChange={(event) => {
                        changed();
                        setImageOptions({
                          ...imageOptions,
                          margin: Number(event.target.value),
                        });
                      }}
                    >
                      <option value={0}>None</option>
                      <option value={24}>Small</option>
                      <option value={48}>Large</option>
                    </select>
                  </label>
                </>
              )}
              <p className={styles.optionHint}>
                One image per page. Images keep their proportions and are never
                cropped.
              </p>
            </>
          )}
          {isMerge && (
            <p className={styles.optionHint}>
              Documents merge in the order shown. Move a document up or down to
              change its position.
            </p>
          )}
          {isOrganize && (
            <p className={styles.optionHint}>
              Drag pages to reorder them. Rotate, duplicate, or remove a page
              using its buttons. Add another PDF to insert its pages.
            </p>
          )}
          <label>
            Download name
            <input
              aria-label="Download name"
              aria-describedby="filename-help"
              value={filename}
              maxLength={90}
              onChange={(event) => {
                changed();
                setFilename(event.target.value);
              }}
              placeholder="document"
            />
            <small id="filename-help">
              {isImages || isMerge || isOrganize
                ? ".pdf is added automatically."
                : "The appropriate file extension is added automatically."}
            </small>
          </label>
        </fieldset>
        <div className={styles.statusArea}>
          {busy && (
            <div className={styles.progress} role="status">
              <LoaderCircle className={styles.spin} size={20} />
              <div>
                <strong>{busy}</strong>
                <span>{progress || "Please wait…"}</span>
              </div>
              <IconButton
                label="Cancel processing"
                onClick={() => operation.current?.abort()}
              >
                <X size={17} />
              </IconButton>
            </div>
          )}
          {error && (
            <div className={styles.error} role="alert">
              {error}
            </div>
          )}
          {!busy && notice && (
            <p className={styles.notice} role="status">
              {notice}
            </p>
          )}
          {result && (
            <div className={styles.success} role="status">
              <CheckCircle2 size={20} />
              <div>
                <strong>Your download is ready</strong>
                <span>
                  {result.count > 1 ? `${result.count} files · ` : ""}
                  {formatSize(result.size)}
                </span>
              </div>
            </div>
          )}
        </div>
        {result ? (
          <a
            className={styles.primary}
            href={result.url}
            download={result.name}
          >
            <Download size={18} /> Download{" "}
            {result.name.endsWith(".zip") ? "ZIP" : isExport ? "image" : "PDF"}
          </a>
        ) : (
          <button
            type="button"
            className={styles.primary}
            disabled={disabled || Boolean(busy)}
            onClick={() => void process()}
          >
            {busy ? (
              <LoaderCircle className={styles.spin} size={18} />
            ) : (
              <Download size={18} />
            )}
            {actionLabel}
          </button>
        )}
        {result && (
          <button type="button" className={styles.textButton} onClick={reset}>
            Start a new task
          </button>
        )}
        {!sources.length && (
          <p className={styles.startHint}>
            Add your {isImages ? "images" : "PDF files"} to get started.
          </p>
        )}
        {isMerge && sources.length === 1 && (
          <p className={styles.startHint}>Add one more PDF to merge.</p>
        )}
        <div className={styles.localNote}>
          <LockKeyhole size={15} />
          <p>
            Files stay on your device.
            <br />
            Nothing is uploaded or stored on our servers.
          </p>
        </div>
        {(isMerge || isSplit || isOrganize) && (
          <p className={styles.finePrint}>
            Form fields become static content. Existing digital signatures and
            document bookmarks are not preserved. Your original files stay
            unchanged.
          </p>
        )}
      </aside>
    </div>
  );
}
