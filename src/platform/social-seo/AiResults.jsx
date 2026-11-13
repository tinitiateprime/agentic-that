"use client";

import { AlertTriangle, AppWindow, Check, Copy, RefreshCw, Sparkles } from "lucide-react";
import { AiLogo } from "./AiStatusBar";
import styles from "./social-seo.module.css";

const LABELS = { instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", youtube: "YouTube" };
const STEPS = [
  { id: "opening", label: "Opening" },
  { id: "uploading", label: "Uploading" },
  { id: "sending", label: "Sending" },
  { id: "writing", label: "Writing" },
];

function CopyButton({ id, text, copied, onCopy, label = "Copy" }) {
  return (
    <button type="button" className={styles.copyButton} onClick={() => onCopy(id, text)} disabled={!text}>
      {copied === id ? <Check size={15} /> : <Copy size={15} />}
      {copied === id ? "Copied" : label}
    </button>
  );
}

function Field({ id, title, value, copied, onCopy, multiline = false, hint }) {
  if (!value) return null;
  return (
    <div className={styles.aiField}>
      <div className={styles.cardHead}>
        <span className={styles.tagGroupLabel}>{title}</span>
        <CopyButton id={id} text={value} copied={copied} onCopy={onCopy} />
      </div>
      {hint && <p className={styles.muted}>{hint}</p>}
      {multiline ? <pre className={styles.aiText}>{value}</pre> : <p className={styles.aiValue}>{value}</p>}
    </div>
  );
}

function Tags({ id, title, tags, joiner, copied, onCopy }) {
  if (!tags?.length) return null;
  return (
    <div className={styles.aiField}>
      <div className={styles.cardHead}>
        <span className={styles.tagGroupLabel}>{title}</span>
        <CopyButton id={id} text={tags.join(joiner)} copied={copied} onCopy={onCopy} />
      </div>
      <div className={styles.tags}>{tags.map((tag) => <span key={tag} className={styles.tagOn}>{tag}</span>)}</div>
    </div>
  );
}

/** One app's finished parts from one AI. */
function PlatformFields({ provider, platform, result, copied, onCopy }) {
  const key = `${provider}-${platform}`;
  if (platform === "instagram") {
    return (
      <>
        <Field id={`${key}-caption`} title="Caption" value={result.caption} copied={copied} onCopy={onCopy} multiline />
        <Tags id={`${key}-tags`} title={`Hashtags · ${result.hashtags?.length || 0}`} tags={result.hashtags} joiner=" " copied={copied} onCopy={onCopy} />
        <Field id={`${key}-alt`} title="Alt text" value={result.altText} copied={copied} onCopy={onCopy} hint="Add it under Advanced settings → Accessibility when posting." />
      </>
    );
  }
  if (platform === "youtube") {
    return (
      <>
        <Field id={`${key}-title`} title="Title" value={result.title} copied={copied} onCopy={onCopy} />
        <Field id={`${key}-description`} title="Description" value={result.description} copied={copied} onCopy={onCopy} multiline />
        <Tags id={`${key}-tags`} title="Tags · paste into the Tags box" tags={result.tags} joiner=", " copied={copied} onCopy={onCopy} />
      </>
    );
  }
  return (
    <>
      <Field id={`${key}-post`} title="Post" value={result.post} copied={copied} onCopy={onCopy} multiline />
      <Tags id={`${key}-tags`} title="Hashtags" tags={result.hashtags} joiner=" " copied={copied} onCopy={onCopy} />
    </>
  );
}

/** Opening → Uploading → Sending → Writing, with the current step highlighted. */
function StepTrack({ step }) {
  const current = Math.max(0, STEPS.findIndex((entry) => entry.id === step));
  return (
    <ol className={styles.stepTrack} aria-label="Progress">
      {STEPS.map((entry, index) => (
        <li key={entry.id} data-status={index < current ? "done" : index === current ? "active" : "waiting"}>
          <i />
          <span>{entry.label}</span>
        </li>
      ))}
    </ol>
  );
}

const STATUS = { working: "Working", writing: "Writing", "needs-you": "Needs you", done: "Done", failed: "Couldn't finish" };

function ProviderCard({ entry, platform, copied, onCopy, onShow, onRerun, busy }) {
  const result = entry.results?.[platform];
  const hasParts = result && Object.entries(result).some(([field, value]) => field !== "fullText" && (Array.isArray(value) ? value.length : value));
  const seconds = entry.ms ? Math.round(entry.ms / 1000) : 0;
  const working = entry.state === "working" || entry.state === "writing";

  return (
    <article className={styles.aiCard} data-state={entry.state}>
      <header className={styles.aiCardHead}>
        <AiLogo id={entry.id} size={30} />
        <div>
          <h3>{entry.label}</h3>
          <span className={styles.aiCardStatus}>{STATUS[entry.state] || entry.state}{entry.state === "done" && seconds ? ` · ${seconds}s` : ""}</span>
        </div>
        <div className={styles.cardActions}>
          {(entry.state === "done" || entry.state === "failed") && (
            <button type="button" className={styles.copyButton} onClick={() => onRerun(entry.id)} disabled={busy} title={`Ask ${entry.label} for a new version of this post`}>
              <RefreshCw size={15} /> {entry.state === "failed" ? "Try again" : "Write again"}
            </button>
          )}
          {hasParts && result.fullText && (
            <CopyButton id={`${entry.id}-${platform}-all`} text={result.fullText} copied={copied} onCopy={onCopy} label="Copy everything" />
          )}
        </div>
      </header>

      {entry.state === "needs-you" && (
        <div className={styles.needsYouBox}>
          <AlertTriangle size={18} />
          <div>
            <strong>{entry.label} needs you</strong>
            <span>{entry.detail}</span>
          </div>
          <button type="button" className={styles.copyButton} onClick={() => onShow(entry.id)}><AppWindow size={14} /> Show window</button>
        </div>
      )}

      {working && (
        <>
          <StepTrack step={entry.state === "writing" ? "writing" : entry.step} />
          <p className={styles.muted}>{entry.state === "writing" ? `${entry.label} is writing your posts. Read along below.` : entry.detail || `Sending your post to ${entry.label}…`}</p>
        </>
      )}

      {entry.state === "writing" && entry.live && (
        <pre className={`${styles.aiText} ${styles.liveText}`}>{entry.live}<span className={styles.caret}>▍</span></pre>
      )}

      {entry.state === "done" && (hasParts
        ? <PlatformFields provider={entry.id} platform={platform} result={result} copied={copied} onCopy={onCopy} />
        : <Field id={`${entry.id}-raw`} title={`${entry.label}'s answer`} value={entry.raw} copied={copied} onCopy={onCopy} multiline hint="It didn't use the usual sections, so here is its full answer." />)}

      {entry.state === "failed" && <p className={styles.error} role="alert">{entry.message}</p>}
    </article>
  );
}

/** Ready-to-post results for one app, one card per connected AI. */
export default function AiResults({ data, platform, copied, onCopy, onShow, onRerun, busy = false, draft = "" }) {
  const entries = data.order.map((id) => data.providers[id]).filter(Boolean);
  const working = entries.some((entry) => entry.state !== "done" && entry.state !== "failed");
  return (
    <>
      {entries.map((entry) => (
        <ProviderCard key={entry.id} entry={entry} platform={platform} copied={copied} onCopy={onCopy} onShow={onShow} onRerun={onRerun} busy={busy} />
      ))}
      {working && draft && (
        <article className={styles.card}>
          <Field id="draft" title="Quick draft you can use right now" value={draft} copied={copied} onCopy={onCopy} multiline hint={`Your AI versions for ${LABELS[platform]} replace this when they're ready.`} />
        </article>
      )}
      {!entries.length && (
        <div className={styles.emptyState}>
          <Sparkles size={30} />
          <h2>Connect an AI to write your posts</h2>
          <p>Log in to ChatGPT, Claude or Gemini above.</p>
        </div>
      )}
    </>
  );
}
