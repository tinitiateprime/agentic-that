"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Circle,
  Highlighter,
  ImagePlus,
  MessageSquare,
  MousePointer2,
  Pencil,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import useDocumentTask from "./use-document-task.js";
import {
  DocumentPicker,
  DownloadAction,
  LocalProcessingNote,
  TaskFeedback,
} from "./DocumentControls";
import { prepareImage, renderPage } from "./pdf-browser.js";
import { checkCancelled, validateFiles } from "./pdf-operations.js";
import {
  editPdf,
  loadAnnotationFonts,
  normalizeRectangle,
} from "./pdf-editing.js";
import styles from "./pdf-studio.module.css";

const MODES = [
  ["select", "Select & move", MousePointer2],
  ["text", "Add text", Type],
  ["highlight", "Highlight", Highlighter],
  ["rectangle", "Rectangle", Square],
  ["ellipse", "Ellipse", Circle],
  ["freehand", "Draw", Pencil],
  ["note", "Add note", MessageSquare],
];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const uid = () => crypto.randomUUID();

function textBounds(text, size) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  context.font = `${size}px Arial`;
  const lines = text.split("\n");
  return {
    width:
      Math.max(30, ...lines.map((line) => context.measureText(line).width)) + 4,
    height: Math.max(size * 1.2, lines.length * size * 1.2),
  };
}
function Annotation({ element }) {
  if (element.type === "text")
    return (
      <text
        x={element.x}
        y={element.y + element.fontSize * 0.85}
        fill={element.color}
        fontFamily="Arial, sans-serif"
        fontSize={element.fontSize}
        fontWeight={element.bold ? 700 : 400}
        fontStyle={element.italic ? "italic" : "normal"}
      >
        {element.text.split("\n").map((line, index) => (
          <tspan
            key={index}
            x={element.x}
            dy={index ? element.fontSize * 1.2 : 0}
          >
            {line || " "}
          </tspan>
        ))}
      </text>
    );
  if (element.type === "image")
    return (
      <image
        href={element.asset.preview}
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        preserveAspectRatio="none"
      />
    );
  if (element.type === "freehand")
    return (
      <polyline
        points={element.points
          .map((point) => `${point.x},${point.y}`)
          .join(" ")}
        fill="none"
        stroke={element.color}
        strokeWidth={element.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  if (element.type === "note")
    return (
      <g>
        <rect
          x={element.x}
          y={element.y}
          width={22}
          height={22}
          fill="#facc15"
          stroke="#854d0e"
          rx={3}
        />
        <text
          x={element.x + 11}
          y={element.y + 16}
          fontSize={15}
          textAnchor="middle"
          fill="#422006"
        >
          N
        </text>
        <title>{element.text}</title>
      </g>
    );
  if (element.type === "ellipse")
    return (
      <ellipse
        cx={element.x + element.width / 2}
        cy={element.y + element.height / 2}
        rx={element.width / 2}
        ry={element.height / 2}
        fill="none"
        stroke={element.color}
        strokeWidth={element.strokeWidth}
      />
    );
  return (
    <rect
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      fill={element.type === "highlight" ? element.color : "none"}
      fillOpacity={element.type === "highlight" ? 0.28 : 1}
      stroke={element.type === "highlight" ? "none" : element.color}
      strokeWidth={element.strokeWidth}
    />
  );
}

export default function PdfEditor() {
  const [elements, setElements] = useState([]);
  const current = useRef([]);
  const [undo, setUndo] = useState([]);
  const [redo, setRedo] = useState([]);
  const [mode, setMode] = useState("select");
  const [selected, setSelected] = useState(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [geometry, setGeometry] = useState(null);
  const [draft, setDraftState] = useState(null);
  const draftRef = useRef(null);
  function setDraft(value) {
    const next = typeof value === "function" ? value(draftRef.current) : value;
    draftRef.current = next;
    setDraftState(next);
  }
  const gesture = useRef(null);
  const [text, setText] = useState("Your text");
  const [color, setColor] = useState("#111827");
  const [fontSize, setFontSize] = useState(18);
  const [fontStyle, setFontStyle] = useState("regular");
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [customFont, setCustomFont] = useState(null);
  const stage = useRef(null);
  const canvas = useRef(null);
  const imageInput = useRef(null);
  const assets = useRef(new Map());
  const editingText = useRef(false);
  function releaseAssets() {
    assets.current.forEach((asset) => URL.revokeObjectURL(asset.preview));
    assets.current.clear();
  }
  function resetEditor() {
    releaseAssets();
    current.current = [];
    setElements([]);
    setUndo([]);
    setRedo([]);
    setSelected(null);
    setPageIndex(0);
    setGeometry(null);
    setDraft(null);
    gesture.current = null;
  }
  const task = useDocumentTask({ onReplace: resetEditor });
  useEffect(() => () => releaseAssets(), []);
  useEffect(() => {
    if (!task.source?.document) return;
    const controller = new AbortController();
    setGeometry(null);
    void (async () => {
      const page = await task.source.document.getPage(pageIndex + 1);
      checkCancelled(controller.signal);
      const viewport = page.getViewport({ scale: 1 });
      setGeometry({ width: viewport.width, height: viewport.height });
      await renderPage(task.source.document, pageIndex, canvas.current, {
        scale: Math.min(2, 1100 / viewport.width),
        signal: controller.signal,
      });
    })().catch((issue) => {
      if (!controller.signal.aborted)
        void task.run("Preparing page", () => {
          throw new Error(
            "This page could not be previewed. Try a standard PDF copy.",
          );
        });
    });
    return () => controller.abort();
  }, [task.source, pageIndex]);

  function commit(next, record = true) {
    const previous = current.current;
    if (record) {
      setUndo((past) => [...past.slice(-49), previous]);
      setRedo([]);
    }
    current.current = next;
    setElements(next);
    task.changed();
  }
  function restore(direction) {
    const stack = direction === "undo" ? undo : redo;
    if (!stack.length) return;
    const target = stack[stack.length - 1];
    const previous = current.current;
    if (direction === "undo") {
      setUndo(stack.slice(0, -1));
      setRedo((future) => [...future, previous]);
    } else {
      setRedo(stack.slice(0, -1));
      setUndo((past) => [...past, previous]);
    }
    current.current = target;
    setElements(target);
    setSelected(null);
    task.changed();
  }
  function point(event) {
    const rect = stage.current.getBoundingClientRect();
    return {
      x: clamp(
        ((event.clientX - rect.left) / rect.width) * geometry.width,
        0,
        geometry.width,
      ),
      y: clamp(
        ((event.clientY - rect.top) / rect.height) * geometry.height,
        0,
        geometry.height,
      ),
    };
  }
  function newElement(type, position) {
    const size =
      type === "text" ? textBounds(text, fontSize) : { width: 22, height: 22 };
    return {
      id: uid(),
      pageIndex,
      type,
      ...position,
      ...size,
      text,
      fontSize,
      color: type === "highlight" ? "#facc15" : color,
      bold: fontStyle === "bold",
      italic: fontStyle === "italic",
      strokeWidth,
    };
  }
  function start(event) {
    if (!geometry || task.busy || event.button !== 0) return;
    if (mode === "select") {
      setSelected(null);
      return;
    }
    if (current.current.length >= 500) {
      void task.run("Adding annotation", () => {
        throw new Error("Use up to 500 annotations in one document.");
      });
      return;
    }
    event.preventDefault();
    const position = point(event);
    if (mode === "text" || mode === "note") {
      if (!text.trim()) return;
      const entry = newElement(mode, position);
      entry.x = clamp(entry.x, 0, Math.max(0, geometry.width - entry.width));
      entry.y = clamp(entry.y, 0, Math.max(0, geometry.height - entry.height));
      commit([...current.current, entry]);
      setSelected(entry.id);
      setMode("select");
      return;
    }
    stage.current.setPointerCapture(event.pointerId);
    gesture.current = {
      kind: "draw",
      from: position,
      entry: newElement(mode, position),
    };
    const entry = {
      ...gesture.current.entry,
      width: 0,
      height: 0,
      ...(mode === "freehand" ? { points: [position] } : {}),
    };
    setDraft(entry);
  }
  function startMove(event, entry) {
    if (mode !== "select" || task.busy) return;
    event.stopPropagation();
    event.preventDefault();
    setSelected(entry.id);
    stage.current.setPointerCapture(event.pointerId);
    gesture.current = { kind: "move", from: point(event), entry };
    setDraft(entry);
  }
  function move(event) {
    const active = gesture.current;
    if (!active || !geometry) return;
    const position = point(event);
    if (active.kind === "move") {
      const x = clamp(
        active.entry.x + position.x - active.from.x,
        0,
        Math.max(0, geometry.width - active.entry.width),
      );
      const y = clamp(
        active.entry.y + position.y - active.from.y,
        0,
        Math.max(0, geometry.height - active.entry.height),
      );
      setDraft({
        ...active.entry,
        x,
        y,
        ...(active.entry.type === "freehand"
          ? {
              points: active.entry.points.map((item) => ({
                x: item.x + x - active.entry.x,
                y: item.y + y - active.entry.y,
              })),
            }
          : {}),
      });
    } else if (active.entry.type === "freehand")
      setDraft((previous) => {
        if (!previous || previous.points.length >= 5000) return previous;
        const points = [...previous.points, position];
        const xs = points.map((entry) => entry.x);
        const ys = points.map((entry) => entry.y);
        return {
          ...previous,
          points,
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        };
      });
    else
      setDraft({
        ...active.entry,
        ...normalizeRectangle(active.from, position),
      });
  }
  function end() {
    const active = gesture.current;
    const draft = draftRef.current;
    if (!active || !draft) {
      gesture.current = null;
      setDraft(null);
      return;
    }
    if (active.kind === "move") {
      if (draft.x !== active.entry.x || draft.y !== active.entry.y)
        commit(
          current.current.map((entry) =>
            entry.id === draft.id ? draft : entry,
          ),
        );
    } else if (
      (draft.type === "freehand" && draft.points.length > 1) ||
      (draft.width > 2 && draft.height > 2)
    ) {
      commit([...current.current, draft]);
      setSelected(draft.id);
    }
    gesture.current = null;
    setDraft(null);
  }
  function changeSelected(patch, record = true) {
    const entry = current.current.find((item) => item.id === selected);
    if (!entry) return;
    const next = { ...entry, ...patch };
    if (next.type === "text")
      Object.assign(next, textBounds(next.text, next.fontSize));
    commit(
      current.current.map((item) => (item.id === selected ? next : item)),
      record,
    );
  }
  function removeSelected() {
    if (!selected) return;
    commit(current.current.filter((entry) => entry.id !== selected));
    setSelected(null);
  }
  async function insertImage(files) {
    if (!files?.length || !geometry) return;
    await task.run("Preparing image", async (signal) => {
      validateFiles(Array.from(files), [], "image");
      const prepared = await prepareImage(files[0], signal);
      checkCancelled(signal);
      const total =
        [...assets.current.values()].reduce(
          (sum, asset) => sum + asset.bytes.length,
          0,
        ) + prepared.bytes.length;
      if (total > 50 * 1048576) {
        URL.revokeObjectURL(prepared.preview);
        throw new Error("Inserted images exceed 50 MB. Use smaller images.");
      }
      const asset = {
        id: uid(),
        bytes: prepared.bytes,
        type: prepared.imageType,
        preview: prepared.preview,
      };
      assets.current.set(asset.id, asset);
      const width = Math.min(220, geometry.width * 0.6);
      const height = (width * prepared.height) / prepared.width;
      const scale = Math.min(1, (geometry.height * 0.6) / height);
      const entry = {
        id: uid(),
        type: "image",
        pageIndex,
        asset,
        x: (geometry.width - width * scale) / 2,
        y: (geometry.height - height * scale) / 2,
        width: width * scale,
        height: height * scale,
      };
      commit([...current.current, entry]);
      setSelected(entry.id);
      setMode("select");
    });
    if (imageInput.current) imageInput.current.value = "";
  }
  function save() {
    void task.run("Saving edited PDF", async (signal, onProgress) => {
      const fonts = elements.some((entry) => entry.type === "text")
        ? customFont
          ? { fontBytes: customFont.bytes }
          : await loadAnnotationFonts()
        : {};
      const bytes = await editPdf(task.source.bytes, current.current, {
        ...fonts,
        signal,
        onProgress,
      });
      task.publish(
        new Blob([bytes], { type: "application/pdf" }),
        "-edited.pdf",
        `${elements.length} annotations saved`,
      );
    });
  }
  const item = elements.find((entry) => entry.id === selected);
  const visible = elements
    .filter((entry) => entry.pageIndex === pageIndex)
    .map((entry) => (draft?.id === entry.id ? draft : entry));
  if (draft && !elements.some((entry) => entry.id === draft.id))
    visible.push(draft);
  return (
    <div className={`${styles.workspace} ${styles.editorWorkspace}`}>
      <section className={styles.workspaceMain} aria-label="PDF editing canvas">
        <DocumentPicker task={task} />
        {task.source && (
          <>
            <div
              className={styles.editorToolbar}
              role="toolbar"
              aria-label="Annotation tools"
            >
              {MODES.map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  aria-label={label}
                  aria-pressed={mode === value}
                  title={label}
                  disabled={Boolean(task.busy)}
                  onClick={() => {
                    setMode(value);
                    setSelected(null);
                    if (value === "note") setText("Your note");
                  }}
                >
                  <Icon size={17} />
                  <span>{label}</span>
                </button>
              ))}
              <button
                type="button"
                aria-label="Insert image"
                title="Insert image"
                disabled={Boolean(task.busy) || !geometry}
                onClick={() => imageInput.current?.click()}
              >
                <ImagePlus size={17} />
                <span>Image</span>
              </button>
            </div>
            <input
              ref={imageInput}
              type="file"
              hidden
              accept=".jpg,.jpeg,.png,.webp"
              aria-label="Choose annotation image"
              onChange={(event) => void insertImage(event.target.files)}
            />
            <div className={styles.editorNavigation}>
              <div>
                <button
                  type="button"
                  aria-label="Previous page"
                  disabled={!pageIndex || Boolean(task.busy)}
                  onClick={() => {
                    setPageIndex(pageIndex - 1);
                    setSelected(null);
                  }}
                >
                  <ChevronLeft size={18} />
                </button>
                <span>
                  Page {pageIndex + 1} of {task.source.pageCount}
                </span>
                <button
                  type="button"
                  aria-label="Next page"
                  disabled={
                    pageIndex >= task.source.pageCount - 1 || Boolean(task.busy)
                  }
                  onClick={() => {
                    setPageIndex(pageIndex + 1);
                    setSelected(null);
                  }}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
              <div>
                <button
                  type="button"
                  aria-label="Undo"
                  disabled={!undo.length || Boolean(task.busy)}
                  onClick={() => restore("undo")}
                >
                  <Undo2 size={16} />
                </button>
                <button
                  type="button"
                  aria-label="Redo"
                  disabled={!redo.length || Boolean(task.busy)}
                  onClick={() => restore("redo")}
                >
                  <Redo2 size={16} />
                </button>
                <button
                  type="button"
                  aria-label="Delete selected annotation"
                  disabled={!selected || Boolean(task.busy)}
                  onClick={removeSelected}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            <p className={styles.editorHint}>
              {mode === "select"
                ? "Select a mark to move it or change its settings."
                : ["text", "note"].includes(mode)
                  ? "Write your text in the panel, then click the page to place it."
                  : "Drag on the page to draw. Select a mark to move it afterward."}
            </p>
            <div className={styles.editorPaper}>
              <canvas
                ref={canvas}
                role="img"
                aria-label={`PDF page ${pageIndex + 1}`}
              />
              {geometry && (
                <svg
                  ref={stage}
                  className={styles.annotationLayer}
                  viewBox={`0 0 ${geometry.width} ${geometry.height}`}
                  aria-label="Interactive annotation layer"
                  onPointerDown={start}
                  onPointerMove={move}
                  onPointerUp={end}
                  onPointerCancel={() => {
                    gesture.current = null;
                    setDraft(null);
                  }}
                >
                  <rect
                    width={geometry.width}
                    height={geometry.height}
                    fill="transparent"
                  />
                  {visible.map((entry) => (
                    <g
                      key={entry.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${entry.type} annotation`}
                      style={{
                        cursor: mode === "select" ? "move" : "crosshair",
                      }}
                      onPointerDown={(event) => startMove(event, entry)}
                      onKeyDown={(event) => {
                        if (task.busy) return;
                        if (
                          event.key === "Delete" ||
                          event.key === "Backspace"
                        ) {
                          event.preventDefault();
                          commit(
                            current.current.filter(
                              (element) => element.id !== entry.id,
                            ),
                          );
                          setSelected(null);
                        }
                        if (event.key === "Enter") {
                          setSelected(entry.id);
                          setMode("select");
                        }
                      }}
                    >
                      <rect
                        x={entry.x - 3}
                        y={entry.y - 3}
                        width={Math.max(6, entry.width) + 6}
                        height={Math.max(6, entry.height) + 6}
                        fill="transparent"
                        stroke={entry.id === selected ? "#2563eb" : "none"}
                        strokeWidth={1}
                        strokeDasharray="4 3"
                      />
                      <Annotation element={entry} />
                    </g>
                  ))}
                </svg>
              )}
            </div>
          </>
        )}
      </section>
      <aside className={styles.settings} aria-labelledby="edit-settings">
        <div className={styles.settingsHeading}>
          <span className={styles.step}>02</span>
          <div>
            <h2 id="edit-settings">Annotation settings</h2>
            <p>
              {item
                ? "Editing selected annotation"
                : "Settings for your next mark"}
            </p>
          </div>
        </div>
        <fieldset className={styles.options} disabled={Boolean(task.busy)}>
          <label>
            {item?.type === "note" || mode === "note"
              ? "Note text"
              : "Text to add"}
            <textarea
              aria-label="Annotation text"
              rows={4}
              maxLength={5000}
              value={
                item && ["text", "note"].includes(item.type) ? item.text : text
              }
              onFocus={() => {
                editingText.current = false;
              }}
              onBlur={() => {
                editingText.current = false;
              }}
              onChange={(event) => {
                setText(event.target.value);
                if (item && ["text", "note"].includes(item.type)) {
                  changeSelected(
                    { text: event.target.value },
                    !editingText.current,
                  );
                  editingText.current = true;
                }
              }}
            />
          </label>
          <label>
            Text size
            <input
              aria-label="Text size"
              type="number"
              min={8}
              max={96}
              value={item?.type === "text" ? item.fontSize : fontSize}
              onChange={(event) => {
                const value = clamp(Number(event.target.value), 8, 96);
                setFontSize(value);
                if (item?.type === "text") changeSelected({ fontSize: value });
              }}
            />
          </label>
          <label>
            Text style
            <select
              aria-label="Text style"
              value={
                item?.type === "text"
                  ? item.bold
                    ? "bold"
                    : item.italic
                      ? "italic"
                      : "regular"
                  : fontStyle
              }
              onChange={(event) => {
                setFontStyle(event.target.value);
                if (item?.type === "text")
                  changeSelected({
                    bold: event.target.value === "bold",
                    italic: event.target.value === "italic",
                  });
              }}
            >
              <option value="regular">Regular</option>
              <option value="bold">Bold</option>
              <option value="italic">Italic</option>
            </select>
          </label>
          <label>
            Color
            <input
              aria-label="Annotation color"
              type="color"
              value={item?.color || color}
              onChange={(event) => {
                setColor(event.target.value);
                if (item && item.type !== "image")
                  changeSelected({ color: event.target.value });
              }}
            />
          </label>
          <label>
            Line width
            <select
              aria-label="Line width"
              value={item?.strokeWidth || strokeWidth}
              onChange={(event) => {
                setStrokeWidth(Number(event.target.value));
                if (item)
                  changeSelected({ strokeWidth: Number(event.target.value) });
              }}
            >
              {[1, 2, 3, 5, 8].map((value) => (
                <option key={value} value={value}>
                  {value} pt
                </option>
              ))}
            </select>
          </label>
          {item?.type === "image" && (
            <label>
              Image width
              <input
                aria-label="Image width"
                type="number"
                min={10}
                max={Math.floor(geometry?.width || 1000)}
                value={Math.round(item.width)}
                onChange={(event) => {
                  const width = clamp(
                    Number(event.target.value),
                    10,
                    Math.min(
                      (geometry?.width || 1000) - item.x,
                      (((geometry?.height || 1000) - item.y) * item.width) /
                        item.height,
                    ),
                  );
                  changeSelected({
                    width,
                    height: (width * item.height) / item.width,
                  });
                }}
              />
              <small>Height adjusts to keep the image proportions.</small>
            </label>
          )}
          <label>
            Custom text font (optional)
            <input
              aria-label="Custom annotation font"
              type="file"
              accept=".ttf,.otf"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file)
                  void task.run("Reading font", async (signal) => {
                    if (file.size > 5 * 1048576)
                      throw new Error("Choose a font file of 5 MB or less.");
                    const bytes = new Uint8Array(await file.arrayBuffer());
                    checkCancelled(signal);
                    setCustomFont({ name: file.name, bytes });
                  });
              }}
            />
            <small>
              {customFont?.name ||
                "Use a suitable TTF/OTF font for languages outside the default font."}
            </small>
          </label>
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
          label="Save edited PDF"
          onClick={save}
          disabled={!elements.length || Boolean(draft)}
        />
        <LocalProcessingNote />
        <p className={styles.optionHint}>
          Adds content over existing pages. Existing PDF text is preserved; this
          tool does not rewrite or remove it. Notes are saved as PDF comments.
        </p>
        <p className={styles.finePrint}>
          Existing digital signatures are invalidated by saving changes. Keep
          the original.
        </p>
      </aside>
    </div>
  );
}
