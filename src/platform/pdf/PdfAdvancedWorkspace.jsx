"use client";

import { useState } from "react";
import {
  COMPRESSION_LEVELS,
  compressPdf,
  recompressBrowserImage,
} from "./pdf-compression.js";
import { parsePageSelection } from "./pdf-operations.js";
import { pdfToWord, wordToPdf } from "./word-conversion.js";
import useDocumentTask, { fileSize } from "./use-document-task.js";
import {
  DocumentPicker,
  DocumentPreview,
  DownloadAction,
  LocalProcessingNote,
  TaskFeedback,
} from "./DocumentControls";
import styles from "./pdf-studio.module.css";

export default function PdfAdvancedWorkspace({ tool }) {
  const isCompress = tool.id === "compress-pdf";
  const isWordInput = tool.id === "word-to-pdf";
  const [level, setLevel] = useState("balanced");
  const [selection, setSelection] = useState("");
  const [keepPages, setKeepPages] = useState(true);
  const [pageSize, setPageSize] = useState("A4");
  const [fontSize, setFontSize] = useState(11);
  const [comparison, setComparison] = useState(null);
  const [customFont, setCustomFont] = useState(null);
  const task = useDocumentTask({
    kind: isWordInput ? "docx" : "pdf",
    onReplace: (source) => {
      setSelection(
        source?.pageCount ? `1-${Math.min(source.pageCount, 100)}` : "",
      );
      setComparison(null);
    },
  });
  function change(update) {
    task.changed();
    setComparison(null);
    update();
  }
  function process() {
    void task.run(
      isCompress
        ? "Compressing PDF"
        : isWordInput
          ? "Converting Word to PDF"
          : "Creating editable Word document",
      async (signal, onProgress) => {
        if (isCompress) {
          const value = await compressPdf(task.source.bytes, {
            level,
            recompressImage: recompressBrowserImage,
            signal,
            onProgress,
          });
          setComparison(value);
          task.publish(
            new Blob([value.bytes], { type: "application/pdf" }),
            "-compressed.pdf",
            value.unchanged
              ? "Already optimized — original retained"
              : `${value.savedPercent}% smaller`,
          );
        } else if (isWordInput) {
          const bytes = await wordToPdf(task.source, {
            pageSize,
            fontSize,
            customFont,
            signal,
            onProgress,
          });
          task.publish(new Blob([bytes], { type: "application/pdf" }), ".pdf");
        } else {
          const indices = parsePageSelection(selection, task.source.pageCount);
          const blob = await pdfToWord(task.source.document, indices, {
            keepPages,
            signal,
            onProgress,
          });
          task.publish(
            blob,
            ".docx",
            `${indices.length} page${indices.length === 1 ? "" : "s"} converted`,
          );
        }
      },
    );
  }
  return (
    <div className={styles.workspace}>
      <section className={styles.workspaceMain} aria-label="Source document">
        <DocumentPicker task={task} kind={isWordInput ? "docx" : "pdf"} />
        <DocumentPreview source={task.source} />
        {comparison && (
          <div
            className={styles.compressionSummary}
            aria-label="Compression results"
          >
            <div>
              <span>Original</span>
              <strong>{fileSize(comparison.originalBytes)}</strong>
            </div>
            <div>
              <span>Result</span>
              <strong>{fileSize(comparison.resultBytes)}</strong>
            </div>
            <div>
              <span>Saved</span>
              <strong>{comparison.savedPercent}%</strong>
            </div>
            <p>
              {comparison.unchanged
                ? "This PDF is already compact. Your original is retained so the file does not get larger."
                : `${comparison.optimizedImages} image${comparison.optimizedImages === 1 ? "" : "s"} optimized. Text stays selectable.`}
            </p>
          </div>
        )}
        {isWordInput && task.source?.warnings?.length > 0 && (
          <p className={styles.optionHint}>
            Some document formatting is not supported. Review the converted PDF
            against your original, especially drawings, equations, and custom
            styles.
          </p>
        )}
      </section>
      <aside className={styles.settings} aria-labelledby="advanced-settings">
        <div className={styles.settingsHeading}>
          <span className={styles.step}>02</span>
          <div>
            <h2 id="advanced-settings">Conversion settings</h2>
            <p>Choose your options, then download.</p>
          </div>
        </div>
        <fieldset className={styles.options} disabled={Boolean(task.busy)}>
          {isCompress ? (
            <>
              <label>
                Compression level
                <select
                  aria-label="Compression level"
                  value={level}
                  onChange={(event) =>
                    change(() => setLevel(event.target.value))
                  }
                >
                  {Object.entries(COMPRESSION_LEVELS).map(([key, entry]) => (
                    <option key={key} value={key}>
                      {entry.label}
                      {key === "gentle"
                        ? " · best image quality"
                        : key === "balanced"
                          ? " · recommended"
                          : " · smaller images"}
                    </option>
                  ))}
                </select>
              </label>
              <p className={styles.optionHint}>
                Text, links, and page layout are retained. Suitable images are
                resized or recompressed. Strong compression can soften image
                detail; some PDFs are already optimized.
              </p>
            </>
          ) : isWordInput ? (
            <>
              <label>
                Page size
                <select
                  aria-label="Page size"
                  value={pageSize}
                  onChange={(event) =>
                    change(() => setPageSize(event.target.value))
                  }
                >
                  <option value="A4">A4</option>
                  <option value="LETTER">US Letter</option>
                </select>
              </label>
              <label>
                Body text size
                <select
                  aria-label="Body text size"
                  value={fontSize}
                  onChange={(event) =>
                    change(() => setFontSize(Number(event.target.value)))
                  }
                >
                  {[10, 11, 12, 14].map((size) => (
                    <option key={size} value={size}>
                      {size} pt
                    </option>
                  ))}
                </select>
              </label>
              <p className={styles.optionHint}>
                For .docx documents. Converts headings, paragraphs, lists,
                tables, and embedded PNG/JPG images into selectable PDF text.
                Content is laid out again; original fonts, headers, footers, and
                complex layouts can differ.
              </p>
            </>
          ) : (
            <>
              <label>
                Pages to convert
                <input
                  aria-label="Pages to convert"
                  value={selection}
                  maxLength={5000}
                  onChange={(event) =>
                    change(() => setSelection(event.target.value))
                  }
                  placeholder="1-3, 5"
                />
                <small>Choose up to 100 text-based pages.</small>
              </label>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={keepPages}
                  onChange={(event) =>
                    change(() => setKeepPages(event.target.checked))
                  }
                />{" "}
                Start each PDF page on a new Word page
              </label>
              <p className={styles.optionHint}>
                Creates an editable .docx from selectable text. Columns and
                tables become text lines; graphics are not included. Scanned
                pages need OCR, which is not included in this tool.
              </p>
            </>
          )}
          {isWordInput && (
            <label>
              Custom font (optional)
              <input
                aria-label="Custom document font"
                type="file"
                accept=".ttf,.otf"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file)
                    void task.run("Reading font", async (signal) => {
                      if (file.size > 5 * 1048576)
                        throw new Error("Choose a font file of 5 MB or less.");
                      const bytes = new Uint8Array(await file.arrayBuffer());
                      if (signal.aborted)
                        throw new DOMException("Cancelled", "AbortError");
                      setCustomFont({ bytes, name: file.name });
                    });
                }}
              />
              <small>
                {customFont?.name ||
                  "Use a suitable font for languages outside the default font. Files stay on your device."}
              </small>
            </label>
          )}
          <label>
            Download name
            <input
              aria-label="Download name"
              value={task.filename}
              maxLength={90}
              onChange={(event) => task.setFilename(event.target.value)}
            />
          </label>
        </fieldset>
        <TaskFeedback task={task} />
        <DownloadAction
          task={task}
          label={
            isCompress
              ? "Compress PDF"
              : isWordInput
                ? "Convert to PDF"
                : "Convert to Word"
          }
          onClick={process}
          extension={isCompress || isWordInput ? "PDF" : "Word"}
        />
        <LocalProcessingNote />
        <p className={styles.finePrint}>
          Keep your original file. Saving a changed PDF does not preserve
          existing digital signatures.
        </p>
      </aside>
    </div>
  );
}
