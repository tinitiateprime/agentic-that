"use client";

// "Write with AI" inside Publishing's Create composer: the connected AI apps
// write a caption for each app from the chosen picture or video, and the person
// picks one AI's writing to fill the composer. Everything stays editable.
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import { companionAiStatus } from "./companion-ai";
import { probeMediaFile } from "./media-probe";
import { postTextFor } from "./post-text";
import { AI_PLATFORMS, askCompanionAis, savedWritingDetails } from "./ai-writer";
import styles from "./composer-ai.module.css";

const LABELS = { instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", youtube: "YouTube", x: "X", reddit: "Reddit" };
const FINISHED = ["done", "failed", "limit"];
const joinNames = (names) => names.join(", ").replace(/, ([^,]*)$/, " and $1");

/**
 * @param {{
 *   file: File | null,
 *   description?: string,
 *   platforms?: string[],
 *   onApply: (writing: Record<string, { text: string, title?: string }>) => void,
 *   disabled?: boolean,
 * }} props
 */
export default function ComposerAiWriter({ file, description = "", platforms = [], onApply, disabled = false }) {
  const [status, setStatus] = useState(undefined); // undefined: checking, null: Companion not reachable
  const [run, setRun] = useState(null); // { kind, order, providers }
  const [chosen, setChosen] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [applied, setApplied] = useState("");

  const refresh = async () => setStatus(await companionAiStatus());
  useEffect(() => { void refresh(); }, []);
  // A different file is a different post.
  useEffect(() => { setRun(null); setChosen(""); setError(""); setNotice(""); setApplied(""); }, [file]);

  const connected = (status?.providers || []).filter((provider) => provider.connected);
  const working = Boolean(run) && run.order.some((id) => !FINISHED.includes(run.providers[id]?.state));
  const done = run ? run.order.filter((id) => run.providers[id]?.state === "done") : [];
  const targets = (platforms.length ? platforms : AI_PLATFORMS).filter((platform) => AI_PLATFORMS.includes(platform));
  const pick = chosen && done.includes(chosen) ? chosen : done[0] || "";
  const writing = pick ? Object.fromEntries(targets
    .map((platform) => [platform, postTextFor(platform, run.providers[pick].results?.[platform], run.kind)])
    .filter(([, text]) => text?.text)) : {};

  async function write() {
    if (!file || working) return;
    setError(""); setNotice(""); setApplied("");
    const ids = connected.map((provider) => provider.id);
    const labels = Object.fromEntries(connected.map((provider) => [provider.id, provider.label]));
    let media;
    try {
      media = [{ id: `${file.name}-${file.size}-${file.lastModified}`, ...(await probeMediaFile(file)) }];
    } catch (probeError) {
      setError(probeError.message || "This file could not be read.");
      return;
    }
    setRun({
      kind: media[0].kind,
      order: ids,
      providers: Object.fromEntries(ids.map((id) => [id, { id, label: labels[id], state: "working", detail: `Sending your post to ${labels[id]}…` }])),
    });
    const update = (id, change) => setRun((current) => current && ({ ...current, providers: { ...current.providers, [id]: { ...current.providers[id], ...change } } }));
    const saved = savedWritingDetails();
    try {
      await askCompanionAis({
        media,
        ids,
        labels,
        update,
        onNotice: setNotice,
        postDetails: {
          platforms: AI_PLATFORMS,
          description: description.trim() || undefined,
          brandName: saved.brandName || undefined,
          location: saved.city || undefined,
          businessDetails: saved.businessDetails || undefined,
        },
      });
    } catch (runError) {
      setRun((current) => current && ({
        ...current,
        providers: Object.fromEntries(Object.entries(current.providers).map(([id, entry]) => [id, FINISHED.includes(entry.state) ? entry : { ...entry, state: "failed", message: runError.message }])),
      }));
    } finally {
      URL.revokeObjectURL(media[0].previewUrl);
      void refresh();
    }
  }

  function apply() {
    if (!pick || !Object.keys(writing).length) return;
    onApply(writing);
    setApplied(run.providers[pick].label);
  }

  if (!file) {
    return (
      <section className={styles.panel} aria-label="Write with AI">
        <div className={styles.head}><span className={styles.icon}><Sparkles size={17} /></span><div><strong>Write with AI</strong><small>Add your picture or video above, then let your AI write the caption for each app.</small></div></div>
      </section>
    );
  }

  if (status === undefined) {
    return <section className={styles.panel} aria-label="Write with AI"><p className={styles.muted}><Loader2 size={15} className={styles.spin} /> Checking your AI apps…</p></section>;
  }

  if (!connected.length) {
    return (
      <section className={styles.panel} aria-label="Write with AI">
        <div className={styles.head}>
          <span className={styles.icon}><Sparkles size={17} /></span>
          <div>
            <strong>Write with AI</strong>
            <small>{status === null
              ? "Start the AgenticThat Companion on this computer and connect ChatGPT, Claude or Gemini to let AI write your captions."
              : "Connect ChatGPT, Claude or Gemini in the Companion to let AI write your captions."}</small>
          </div>
        </div>
        <div className={styles.actions}>
          <a className={styles.primary} href="/publishing/ai">Connect an AI</a>
          <button type="button" className={styles.secondary} onClick={refresh}><RefreshCw size={14} /> Check again</button>
        </div>
      </section>
    );
  }

  const forWhom = targets.length === AI_PLATFORMS.length ? "each app" : joinNames(targets.map((platform) => LABELS[platform]));
  return (
    <section className={styles.panel} aria-label="Write with AI">
      <div className={styles.head}>
        <span className={styles.icon}><Sparkles size={17} /></span>
        <div>
          <strong>Write with AI</strong>
          <small>
            {joinNames(connected.map((provider) => provider.label))} will write a caption, hashtags and title for {forWhom}.{" "}
            {description.trim() ? "Your description above is used as the brief." : "Add a short description above to guide it (optional)."}
          </small>
        </div>
      </div>

      {!run && <div className={styles.actions}><button type="button" className={styles.primary} onClick={write} disabled={disabled}><Sparkles size={15} /> Write with AI</button></div>}

      {run && (
        <ul className={styles.ais}>
          {run.order.map((id) => {
            const entry = run.providers[id];
            const finished = FINISHED.includes(entry.state);
            return (
              <li key={id} className={entry.state === "done" ? styles.done : finished ? styles.failed : ""}>
                {entry.state === "done" ? <CheckCircle2 size={15} /> : finished ? <TriangleAlert size={15} /> : <Loader2 size={15} className={styles.spin} />}
                <strong>{entry.label}</strong>
                <span>{entry.state === "done" ? "Finished" : finished ? entry.message || "Couldn't write this post." : entry.detail || "Working…"}</span>
              </li>
            );
          })}
        </ul>
      )}
      {working && <p className={styles.muted}>This can take a few minutes, longer for videos. You can keep editing the post meanwhile.</p>}
      {notice && <p className={styles.muted}>{notice}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}

      {done.length > 0 && (
        <div className={styles.results}>
          {done.length > 1 && (
            <div className={styles.choose} role="radiogroup" aria-label="Choose whose writing to use">
              {done.map((id) => (
                <button type="button" role="radio" aria-checked={pick === id} key={id} className={pick === id ? styles.chosen : ""} onClick={() => { setChosen(id); setApplied(""); }}>{run.providers[id].label}</button>
              ))}
            </div>
          )}
          <ul className={styles.previews}>
            {targets.map((platform) => (
              <li key={platform}>
                <strong>{LABELS[platform]}{writing[platform]?.title ? ` · ${writing[platform].title}` : ""}</strong>
                <p>{writing[platform]?.text || <em>{run.providers[pick].label} didn&apos;t write for {LABELS[platform]}.</em>}</p>
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={apply} disabled={!Object.keys(writing).length}>
              {applied ? <><CheckCircle2 size={15} /> Added to your post</> : `Use ${run.providers[pick].label}'s writing`}
            </button>
            {!working && <button type="button" className={styles.secondary} onClick={write}><RefreshCw size={14} /> Write again</button>}
          </div>
          {applied && <p className={styles.success}>{applied}&apos;s writing is now each app&apos;s text. Check or change it with <strong>Edit text</strong> on each app below.</p>}
        </div>
      )}
      {run && !working && !done.length && <div className={styles.actions}><button type="button" className={styles.secondary} onClick={write}><RefreshCw size={14} /> Try again</button></div>}
    </section>
  );
}
