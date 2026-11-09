"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  ArrowRight,
  ChevronDown,
  FileText,
  Image,
  Search,
  Sparkles,
  Video,
  X,
} from "lucide-react";
import {
  PDF_TOOL_GROUPS,
  PDF_TOOLS,
  PDF_READY_IDS,
  TOOL_STUDIOS,
} from "./tools-catalog";
import styles from "./tools-menu.module.css";

const studioIcons = { pdf: FileText, image: Image, video: Video };

export default function ToolsMenu() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedTool, setSelectedTool] = useState(null);
  const [mounted, setMounted] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  const dialogRef = useRef(null);
  const closeTimerRef = useRef(null);
  const panelId = useId();
  const resultsId = useId();
  const dialogTitleId = useId();
  const normalizedQuery = query.trim().toLowerCase();
  const filteredGroups = PDF_TOOL_GROUPS.map((group) => ({
    ...group,
    tools: group.tools.filter((tool) =>
      `${tool.name} ${tool.description} ${group.name}`
        .toLowerCase()
        .includes(normalizedQuery),
    ),
  })).filter((group) => group.tools.length);
  const resultCount = filteredGroups.reduce(
    (count, group) => count + group.tools.length,
    0,
  );

  useEffect(() => {
    setMounted(true);
    return () => clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const dismissOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const dismissEscape = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!selectedTool || !dialogRef.current) return undefined;
    dialogRef.current.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedTool]);

  function cancelClose() {
    clearTimeout(closeTimerRef.current);
  }

  function showMenu() {
    cancelClose();
    setOpen(true);
  }

  function closePreview() {
    dialogRef.current?.close();
  }

  function returnToMenu() {
    closePreview();
    setOpen(true);
    requestAnimationFrame(() => searchRef.current?.focus());
  }

  return (
    <div
      className={styles.root}
      ref={rootRef}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") showMenu();
      }}
      onPointerLeave={(event) => {
        if (
          event.pointerType === "mouse" &&
          !rootRef.current?.contains(document.activeElement)
        ) {
          closeTimerRef.current = setTimeout(() => setOpen(false), 180);
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        className={`${styles.trigger}${open ? ` ${styles.triggerOpen}` : ""}`}
        type="button"
        ref={triggerRef}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          cancelClose();
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            showMenu();
            requestAnimationFrame(() => searchRef.current?.focus());
          }
        }}
      >
        Tools <ChevronDown size={14} aria-hidden="true" />
      </button>

      {open && (
        <section
          className={styles.panel}
          id={panelId}
          aria-label="Tools studios"
          onPointerEnter={cancelClose}
        >
          <div className={styles.panelContent}>
            <header className={styles.panelHeader}>
              <span>
                <Sparkles size={15} aria-hidden="true" /> A little less
                busywork.
              </span>
              <Link href="/tools/pdf" className={styles.previewLabel}>
                OPEN PDF STUDIO <ArrowRight size={12} />
              </Link>
              <button
                className={styles.closeMenu}
                type="button"
                aria-label="Close tools menu"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                <X size={17} />
              </button>
            </header>
            <div className={styles.columns}>
              {TOOL_STUDIOS.map((studio) => {
                const Icon = studioIcons[studio.id];
                return (
                  <section
                    className={`${styles.studio} ${styles[studio.id]}`}
                    key={studio.id}
                    aria-labelledby={`${panelId}-${studio.id}`}
                  >
                    <header className={styles.studioHeader}>
                      <span className={styles.studioIcon}>
                        <Icon size={21} aria-hidden="true" />
                      </span>
                      <div>
                        <h2 id={`${panelId}-${studio.id}`}>{studio.name}</h2>
                        <p>{studio.description}</p>
                      </div>
                    </header>
                    {studio.id === "pdf" ? (
                      <>
                        <div className={styles.search}>
                          <Search size={16} aria-hidden="true" />
                          <input
                            ref={searchRef}
                            aria-label="Search PDF tools"
                            aria-controls={resultsId}
                            placeholder={`Find a PDF tool (${PDF_TOOLS.length})`}
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            type="search"
                          />
                          {query && (
                            <button
                              type="button"
                              aria-label="Clear PDF tool search"
                              onClick={() => {
                                setQuery("");
                                searchRef.current?.focus();
                              }}
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                        <div className={styles.toolList} id={resultsId}>
                          {filteredGroups.map((group) => (
                            <section
                              className={styles.toolGroup}
                              key={group.id}
                              aria-labelledby={`${panelId}-${group.id}`}
                            >
                              <h3 id={`${panelId}-${group.id}`}>
                                {group.name}
                              </h3>
                              <ul>
                                {group.tools.map((tool) => (
                                  <li key={tool.id}>
                                    {tool.status === "ready" ? (
                                      <Link
                                        href={tool.href}
                                        className={`${styles.tool} ${styles.readyTool}`}
                                        onClick={() => setOpen(false)}
                                      >
                                        <span>{tool.name}</span>
                                        <ArrowRight
                                          size={13}
                                          aria-hidden="true"
                                        />
                                      </Link>
                                    ) : (
                                      <button
                                        type="button"
                                        className={styles.tool}
                                        onClick={() => {
                                          cancelClose();
                                          setOpen(false);
                                          setSelectedTool(tool);
                                        }}
                                      >
                                        <span>{tool.name}</span>
                                        <ArrowRight
                                          size={13}
                                          aria-hidden="true"
                                        />
                                      </button>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </section>
                          ))}
                          {!resultCount && (
                            <div className={styles.noResults}>
                              <Search size={25} aria-hidden="true" />
                              <strong>No tools found</strong>
                              <p>Try “merge”, “convert”, or “sign”.</p>
                            </div>
                          )}
                        </div>
                        <p className={styles.resultCount} role="status">
                          {normalizedQuery
                            ? `${resultCount} matching tool${resultCount === 1 ? "" : "s"}`
                            : `${PDF_TOOLS.length} PDF tools`}
                          <span>{PDF_READY_IDS.length} ready to use</span>
                        </p>
                      </>
                    ) : (
                      <div className={styles.reservedStudio}>
                        <div className={styles.artwork} aria-hidden="true">
                          <span />
                          <span />
                          <span>
                            <Icon strokeWidth={1.3} />
                          </span>
                        </div>
                        <span className={styles.soonBadge}>Coming soon</span>
                        <h3>
                          A little space for
                          <br />
                          what comes next.
                        </h3>
                        <p>
                          {studio.id === "image"
                            ? "Image tools are on the way."
                            : "Video tools are on the way."}
                        </p>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
            <footer className={styles.panelFooter}>
              <span className={styles.statusDot} />
              {PDF_READY_IDS.length} PDF tools, ready when you are.
              <span>PDF · Image · Video</span>
            </footer>
          </div>
        </section>
      )}

      {mounted &&
        createPortal(
          <dialog
            ref={dialogRef}
            className={styles.dialog}
            aria-labelledby={dialogTitleId}
            aria-describedby={`${dialogTitleId}-description`}
            onClick={(event) => {
              if (event.target === event.currentTarget) closePreview();
            }}
            onClose={() => {
              setSelectedTool(null);
              triggerRef.current?.focus();
            }}
          >
            {selectedTool && (
              <div className={styles.dialogContent}>
                <button
                  className={styles.dialogClose}
                  type="button"
                  onClick={closePreview}
                  aria-label="Close tool preview"
                >
                  <X size={20} />
                </button>
                <span className={styles.dialogIcon}>
                  <FileText size={30} aria-hidden="true" />
                </span>
                <p className={styles.dialogEyebrow}>TOOLS / PDF STUDIO</p>
                <h2 id={dialogTitleId}>{selectedTool.name}</h2>
                <p id={`${dialogTitleId}-description`}>
                  {selectedTool.description}
                </p>
                <span className={styles.soonBadge}>
                  {selectedTool.status === "planned"
                    ? "Planned next"
                    : "Future tool"}
                </span>
                <p className={styles.previewNote}>
                  {selectedTool.status === "planned"
                    ? "This is part of the next set of PDF tools. It is not available yet."
                    : "This tool is an idea for a future release. It is not available yet."}
                </p>
                <button
                  type="button"
                  className={styles.backButton}
                  onClick={returnToMenu}
                >
                  Explore PDF tools <ArrowRight size={16} aria-hidden="true" />
                </button>
              </div>
            )}
          </dialog>,
          document.body,
        )}
    </div>
  );
}
