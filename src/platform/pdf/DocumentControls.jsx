"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Download,
  FileText,
  LoaderCircle,
  LockKeyhole,
  Plus,
  Upload,
  X,
} from "lucide-react";
import { renderPage } from "./pdf-browser.js";
import { fileSize } from "./use-document-task.js";
import styles from "./pdf-studio.module.css";

export function DocumentPicker({ task, kind = "pdf" }) {
  const input = useRef(null);
  const [dragging, setDragging] = useState(false);
  return (
    <>
      <input
        ref={input}
        type="file"
        hidden
        accept={
          kind === "docx"
            ? ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : ".pdf,application/pdf"
        }
        aria-label={
          kind === "docx" ? "Choose Word document" : "Choose PDF document"
        }
        onChange={async (event) => {
          await task.load(event.target.files);
          if (input.current) input.current.value = "";
        }}
      />
      <button
        type="button"
        disabled={Boolean(task.busy)}
        className={`${styles.dropzone} ${task.source ? styles.compactDrop : ""} ${dragging ? styles.dragActive : ""}`}
        onClick={() => input.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void task.load(event.dataTransfer.files);
        }}
      >
        <span className={styles.uploadIcon}>
          {task.source ? <Plus size={22} /> : <Upload size={29} />}
        </span>
        <strong>
          {task.source
            ? "Choose a different document"
            : kind === "docx"
              ? "Choose a Word document"
              : "Choose a PDF file"}
        </strong>
        <span>or drag and drop here</span>
        {!task.source && (
          <small>
            {kind === "docx"
              ? "DOCX · up to 25 MB"
              : "PDF · up to 25 MB · 300 pages"}
          </small>
        )}
      </button>
      {task.source && (
        <div className={styles.filesHeading}>
          <div>
            <h2>{task.source.name}</h2>
            <p>
              {task.source.pageCount ? `${task.source.pageCount} pages · ` : ""}
              {fileSize(task.source.size)}
            </p>
          </div>
          <button
            type="button"
            className={styles.textButton}
            disabled={Boolean(task.busy)}
            onClick={task.reset}
          >
            Clear file
          </button>
        </div>
      )}
    </>
  );
}

export function DocumentPreview({ source }) {
  const canvas = useRef(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!source?.document) return;
    const controller = new AbortController();
    setError(false);
    void renderPage(source.document, 0, canvas.current, {
      maxWidth: 620,
      signal: controller.signal,
    }).catch(() => {
      if (!controller.signal.aborted) setError(true);
    });
    return () => controller.abort();
  }, [source]);
  if (!source) return null;
  return (
    <div className={styles.documentPreview}>
      {source.document ? (
        error ? (
          <p>
            <FileText size={24} /> Preview unavailable
          </p>
        ) : (
          <canvas
            ref={canvas}
            role="img"
            aria-label="Preview of the first page"
          />
        )
      ) : (
        <div className={styles.wordPreview}>
          <span className={styles.eyebrow}>DOCUMENT TEXT PREVIEW</span>
          <p>{source.text.slice(0, 3500)}</p>
          {source.text.length > 3500 && (
            <small>
              Preview shortened. The full document will be converted.
            </small>
          )}
        </div>
      )}
    </div>
  );
}

export function TaskFeedback({ task }) {
  return (
    <div className={styles.statusArea}>
      {task.busy && (
        <div className={styles.progress} role="status">
          <LoaderCircle className={styles.spin} size={20} />
          <div>
            <strong>{task.busy}</strong>
            <span>{task.progress || "Please wait…"}</span>
          </div>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Cancel processing"
            onClick={task.cancel}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {task.error && (
        <div className={styles.error} role="alert">
          {task.error}
        </div>
      )}
      {task.notice && (
        <p className={styles.notice} role="status">
          {task.notice}
        </p>
      )}
      {task.result && (
        <div className={styles.success} role="status">
          <CheckCircle2 size={20} />
          <div>
            <strong>Your download is ready</strong>
            <span>
              {fileSize(task.result.size)}
              {task.result.summary && ` · ${task.result.summary}`}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function DownloadAction({
  task,
  label,
  onClick,
  disabled = false,
  extension = "PDF",
}) {
  return task.result ? (
    <a
      className={styles.primary}
      href={task.result.url}
      download={task.result.name}
    >
      <Download size={18} /> Download {extension}
    </a>
  ) : (
    <button
      type="button"
      className={styles.primary}
      disabled={Boolean(task.busy) || !task.source || disabled}
      onClick={onClick}
    >
      <Download size={18} /> {label}
    </button>
  );
}
export function LocalProcessingNote() {
  return (
    <div className={styles.localNote}>
      <LockKeyhole size={15} />
      <p>
        Files stay on your device.
        <br />
        Nothing is uploaded or stored on our servers.
      </p>
    </div>
  );
}
