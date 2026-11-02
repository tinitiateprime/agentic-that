"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Combine,
  FileImage,
  FileText,
  ImagePlus,
  Layers,
  LockKeyhole,
  Scissors,
  FileDown,
  FileUp,
  Minimize2,
  Pencil,
} from "lucide-react";
import { PDF_TOOLS, PDF_READY_IDS, PDF_PLANNED_IDS } from "../tools-catalog";
import styles from "./pdf-studio.module.css";

const PdfWorkspace = dynamic(() => import("./PdfWorkspace"), {
  ssr: false,
  loading: () => (
    <div className={styles.loading} role="status">
      Preparing your workspace…
    </div>
  ),
});
const PdfAdvancedWorkspace = dynamic(() => import("./PdfAdvancedWorkspace"), {
  ssr: false,
  loading: () => (
    <div className={styles.loading} role="status">
      Preparing your workspace…
    </div>
  ),
});
const PdfEditor = dynamic(() => import("./PdfEditor"), {
  ssr: false,
  loading: () => (
    <div className={styles.loading} role="status">
      Preparing your editor…
    </div>
  ),
});
export const toolIcons = {
  "merge-pdf": Combine,
  "split-pdf": Scissors,
  "organize-pdf": Layers,
  "images-to-pdf": ImagePlus,
  "pdf-to-images": FileImage,
  "compress-pdf": Minimize2,
  "pdf-to-word": FileDown,
  "word-to-pdf": FileUp,
  "edit-pdf": Pencil,
};

export default function PdfStudio({ tool }) {
  const ready = PDF_READY_IDS.map((id) =>
    PDF_TOOLS.find((entry) => entry.id === id),
  );
  const planned = PDF_PLANNED_IDS.map((id) =>
    PDF_TOOLS.find((entry) => entry.id === id),
  );
  const Icon = toolIcons[tool?.id] || FileText;
  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#pdf-main">
        Skip to workspace
      </a>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
          <span aria-hidden="true">a.</span> AgenticThat
        </Link>
        <Link href="/tools/pdf" className={styles.studioLink}>
          <FileText size={17} /> PDF Studio
        </Link>
        <Link href="/" className={styles.homeLink}>
          <ArrowLeft size={15} /> Back to home
        </Link>
      </header>
      <main id="pdf-main" className={styles.main}>
        <div className={styles.breadcrumb}>
          <Link href="/tools/pdf">Tools / PDF Studio</Link>
          {tool && (
            <>
              <span>/</span>
              <span>{tool.name}</span>
            </>
          )}
        </div>
        {tool ? (
          <>
            <div className={styles.toolHeading}>
              <span className={styles.heroIcon}>
                <Icon size={27} />
              </span>
              <div>
                <p className={styles.eyebrow}>YOUR EVERYDAY DOCUMENT TOOLKIT</p>
                <h1>{tool.name}</h1>
                <p>{tool.description}</p>
              </div>
            </div>
            <nav className={styles.toolTabs} aria-label="PDF tools">
              {ready.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  aria-current={item.id === tool.id ? "page" : undefined}
                >
                  {item.name}
                </Link>
              ))}
            </nav>
            {tool.status === "ready" ? (
              tool.id === "edit-pdf" ? (
                <PdfEditor key={tool.id} />
              ) : ["compress-pdf", "pdf-to-word", "word-to-pdf"].includes(
                  tool.id,
                ) ? (
                <PdfAdvancedWorkspace key={tool.id} tool={tool} />
              ) : (
                <PdfWorkspace key={tool.id} tool={tool} />
              )
            ) : (
              <section className={styles.placeholder}>
                <span className={styles.badge}>
                  {tool.status === "planned" ? "Planned next" : "Future tool"}
                </span>
                <h2>{tool.name} is on the roadmap</h2>
                <p>
                  {tool.status === "planned"
                    ? "This is part of the next set of PDF tools. It is not available yet."
                    : "This tool is an idea for a future release. It is not available yet."}
                </p>
                <Link className={styles.primary} href="/tools/pdf">
                  Explore working PDF tools <ArrowRight size={17} />
                </Link>
              </section>
            )}
          </>
        ) : (
          <>
            <section className={styles.hero}>
              <p className={styles.eyebrow}>LESS BUSYWORK. MORE DONE.</p>
              <h1>
                Your documents.
                <br />
                <span>A little more organized.</span>
              </h1>
              <p>
                {ready.length} useful PDF tools, one simple workspace.
                <br />
                Make the changes you need and take your files with you.
              </p>
              <div className={styles.privacy}>
                <LockKeyhole size={15} /> Files stay on your device. Processing
                happens in your browser.
              </div>
            </section>
            <section aria-labelledby="ready-tools">
              <div className={styles.sectionHeading}>
                <h2 id="ready-tools">Ready when you are</h2>
                <span>
                  <Check size={14} /> {ready.length} working tools
                </span>
              </div>
              <div className={styles.cards}>
                {ready.map((item, index) => {
                  const CardIcon = toolIcons[item.id];
                  return (
                    <Link
                      className={styles.card}
                      href={item.href}
                      key={item.id}
                    >
                      <div className={styles.cardTop}>
                        <span className={styles.cardIcon}>
                          <CardIcon size={24} />
                        </span>
                        <span className={styles.cardNumber}>0{index + 1}</span>
                      </div>
                      <h3>{item.name}</h3>
                      <p>{item.description}</p>
                      <span className={styles.cardAction}>
                        Open tool <ArrowRight size={16} />
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
            <section className={styles.roadmap} aria-labelledby="planned-tools">
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>WHAT COMES NEXT</p>
                  <h2 id="planned-tools">More useful tools, on the way</h2>
                </div>
                <span className={styles.badge}>Planned</span>
              </div>
              <div className={styles.plannedGrid}>
                {planned.map((item) => (
                  <Link href={item.href} key={item.id}>
                    <FileText size={18} />
                    <div>
                      <h3>{item.name}</h3>
                      <p>{item.description}</p>
                    </div>
                    <ArrowRight size={15} />
                  </Link>
                ))}
              </div>
            </section>
          </>
        )}
        <footer className={styles.footer}>
          <span>AgenticThat / PDF Studio</span>
          <span>Simple tools. A lighter workday.</span>
        </footer>
      </main>
    </div>
  );
}
