"use client";

import { useEffect, useRef, useState } from "react";
import {
  PDF_LIMITS,
  checkCancelled,
  readPdf,
  safeBasename,
  validateFiles,
} from "./pdf-operations.js";
import { openPreview } from "./pdf-browser.js";
import { readDocx } from "./word-conversion.js";

export const fileSize = (bytes) =>
  bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
export function disposeDocument(source) {
  if (source?.document)
    void source.document.loadingTask.destroy().catch(() => {});
}

export default function useDocumentTask({ kind = "pdf", onReplace } = {}) {
  const [source, setSource] = useState(null);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState(null);
  const [filename, setFilename] = useState("document");
  const active = useRef(null);
  const current = useRef(null);
  const download = useRef(null);
  const mounted = useRef(true);
  function clearResult() {
    if (download.current) URL.revokeObjectURL(download.current.url);
    download.current = null;
    setResult(null);
  }
  function changed() {
    clearResult();
    setError("");
    setNotice("");
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.abort();
      disposeDocument(current.current);
      if (download.current) URL.revokeObjectURL(download.current.url);
    };
  }, []);
  async function run(label, work) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    changed();
    setBusy(label);
    setProgress("");
    try {
      return await work(controller.signal, (value) => {
        if (mounted.current) setProgress(value);
      });
    } catch (issue) {
      if (!mounted.current) return;
      if (
        controller.signal.aborted ||
        issue.name === "AbortError" ||
        issue.name === "RenderingCancelledException"
      )
        setNotice("Cancelled. Your source file is unchanged.");
      else
        setError(
          /is not a function|Cannot read|undefined is|Maximum call stack/i.test(
            issue.message || "",
          )
            ? "This document could not be processed. Try a simpler or smaller copy."
            : issue.message ||
                "The document could not be processed. Please try again.",
        );
    } finally {
      if (active.current === controller) active.current = null;
      if (mounted.current) {
        setBusy("");
        setProgress("");
      }
    }
  }
  async function load(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    return run("Reading your document", async (signal) => {
      if (files.length !== 1) throw new Error("Choose one document at a time.");
      const file = files[0];
      if (kind === "docx") {
        if (!/\.docx$/i.test(file.name))
          throw new Error(
            "Choose a .docx file. Save older .doc files as .docx in Word first.",
          );
        if (!file.size || file.size > PDF_LIMITS.fileBytes)
          throw new Error("Choose a non-empty DOCX file of 25 MB or less.");
      } else validateFiles(files);
      const next = {
        name: file.name,
        size: file.size,
        bytes: new Uint8Array(await file.arrayBuffer()),
      };
      try {
        if (kind === "docx")
          Object.assign(next, await readDocx(next.bytes, { signal }));
        else {
          next.pageCount = (
            await readPdf(next.bytes, file.name)
          ).getPageCount();
          next.document = await openPreview(next.bytes, signal);
        }
        checkCancelled(signal);
        if (!mounted.current) throw new DOMException("Cancelled", "AbortError");
        disposeDocument(current.current);
        current.current = next;
        setSource(next);
        setFilename(safeBasename(file.name));
        onReplace?.(next);
      } catch (issue) {
        disposeDocument(next);
        throw issue;
      }
    });
  }
  function publish(blob, suffix, summary = "") {
    if (!mounted.current || active.current?.signal.aborted)
      throw new DOMException("Cancelled", "AbortError");
    const value = {
      url: URL.createObjectURL(blob),
      name: `${safeBasename(filename)}${suffix}`,
      size: blob.size,
      summary,
    };
    download.current = value;
    setResult(value);
  }
  function reset() {
    if (active.current) return;
    changed();
    disposeDocument(current.current);
    current.current = null;
    setSource(null);
    onReplace?.(null);
  }
  return {
    source,
    busy,
    progress,
    error,
    notice,
    result,
    filename,
    setFilename: (name) => {
      changed();
      setFilename(name);
    },
    load,
    run,
    publish,
    changed,
    reset,
    cancel: () => active.current?.abort(),
  };
}
