"use client";

import { Check, Copy, Loader2, MapPin, Sparkles } from "lucide-react";
import styles from "./social-seo.module.css";

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

function Tags({ tags }) {
  if (!tags?.length) return null;
  return <div className={styles.tags}>{tags.map((tag) => <span key={tag} className={styles.tagOn}>{tag}</span>)}</div>;
}

const LABELS = { instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", youtube: "YouTube" };

/** Ready-to-post AI results for one app. */
/** SEO score out of 10 for one app, with a tip for every missing point. */
function SeoScore({ score, app }) {
  const missing = score.checks.filter((check) => !check.passed);
  const level = score.score >= 9 ? styles.scoreGood : score.score >= 7 ? styles.scoreOk : styles.scoreLow;
  return (
    <div className={styles.scoreBox}>
      <div className={styles.scoreHead}>
        <span className={`${styles.scoreValue} ${level}`}>{score.score}/{score.max}</span>
        <span>
          <strong>{app} SEO score</strong>
          <small>{missing.length ? "How to reach 10:" : "Every SEO check passed."}</small>
        </span>
      </div>
      {missing.length > 0 && (
        <ul className={styles.scoreTips}>
          {missing.map((check) => <li key={check.id}><strong>{check.label}:</strong> {check.tip}</li>)}
        </ul>
      )}
      <details className={styles.scoreChecks}>
        <summary>See all {score.max} checks</summary>
        <ul>
          {score.checks.map((check) => <li key={check.id} className={check.passed ? styles.pass : styles.fail}>{check.passed ? "✓" : "✗"} {check.label}</li>)}
        </ul>
      </details>
    </div>
  );
}

export default function AiResults({ data, platform, copied, onCopy, draft = "" }) {
  const result = data?.results?.[platform];
  if (!result && data?.stage && data.stage !== "done" && data.pending?.includes(platform)) {
    const position = data.pending.indexOf(platform);
    const live = data.live?.[platform] || "";
    return (
      <article className={styles.card}>
        <div className={styles.aiWorking}>
          <Loader2 size={22} className={styles.spin} />
          <div>
            <strong>{data.stage === "analyzing" ? "The AI is studying your media…" : `Writing your ${LABELS[platform]} post…`}</strong>
            <span>
              {data.stage === "analyzing"
                ? "It reads your media once, including every list and contact detail, then writes each app. It runs privately on your computer. You can switch tabs while you wait."
                : live ? "You can read along. Your lists, contact details and hashtags are added when it finishes."
                  : position > 0 ? `${position} other app${position > 1 ? "s" : ""} ahead of this one. Finished apps appear in their tabs as soon as they're ready.` : "Starting to write…"}
            </span>
          </div>
        </div>
        {live && (
          <div className={styles.aiField}>
            <span className={styles.tagGroupLabel}>Being written now</span>
            <pre className={styles.aiText}>{live}<span className={styles.caret}>▍</span></pre>
          </div>
        )}
        {!live && draft && (
          <Field
            id="draft"
            title="Quick draft you can use right now"
            value={draft}
            copied={copied}
            onCopy={onCopy}
            multiline
            hint="The AI version replaces this when it's ready."
          />
        )}
      </article>
    );
  }
  if (!result) {
    return <article className={styles.card}><p className={styles.muted}>No AI result for {LABELS[platform]} yet. Generate again to include it.</p></article>;
  }
  const seconds = data.timings ? Math.round(data.timings.totalMs / 1000) : 0;

  return (
    <>
      <article className={styles.card}>
        <div className={styles.cardHead}>
          <h2><Sparkles size={17} /> Ready to post on {LABELS[platform]}</h2>
          <CopyButton id={`${platform}-all`} text={result.fullText || [result.title, result.description].filter(Boolean).join("\n\n")} copied={copied} onCopy={onCopy} label="Copy everything" />
        </div>
        <p className={styles.muted}>Written by the free AI on this computer{data.engine?.label ? ` (${data.engine.label})` : ""}{seconds ? ` in ${seconds}s` : ""}, within {LABELS[platform]}&apos;s limits.</p>

        {result.seoScore && <SeoScore score={result.seoScore} app={LABELS[platform]} />}

        {platform === "instagram" && (
          <>
            <Field id="ig-caption" title="Caption" value={result.caption} copied={copied} onCopy={onCopy} multiline />
            <div className={styles.aiField}>
              <div className={styles.cardHead}>
                <span className={styles.tagGroupLabel}>Hashtags · {result.hashtags.length}/5</span>
                <CopyButton id="ig-tags" text={result.hashtags.join(" ")} copied={copied} onCopy={onCopy} />
              </div>
              <Tags tags={result.hashtags} />
            </div>
          </>
        )}

        {(platform === "facebook" || platform === "linkedin") && (
          <>
            <Field id={`${platform}-post`} title="Post" value={result.post} copied={copied} onCopy={onCopy} multiline />
            <div className={styles.aiField}>
              <div className={styles.cardHead}>
                <span className={styles.tagGroupLabel}>Hashtags</span>
                <CopyButton id={`${platform}-tags`} text={result.hashtags.join(" ")} copied={copied} onCopy={onCopy} />
              </div>
              <Tags tags={result.hashtags} />
            </div>
          </>
        )}

        {platform === "youtube" && (
          <>
            <p className={styles.detected}>Format: <strong>{result.format}</strong></p>
            <Field id="yt-title" title="Title" value={result.title} copied={copied} onCopy={onCopy} />
            <Field id="yt-description" title="Description" value={result.description} copied={copied} onCopy={onCopy} multiline />
            <div className={styles.aiField}>
              <div className={styles.cardHead}>
                <span className={styles.tagGroupLabel}>Tags · paste into the Tags box</span>
                <CopyButton id="yt-tags" text={result.tags.join(", ")} copied={copied} onCopy={onCopy} />
              </div>
              <Tags tags={result.tags} />
            </div>
            <Field id="yt-thumb" title="Thumbnail text" value={result.thumbnailText} copied={copied} onCopy={onCopy} />
          </>
        )}
      </article>

      <article className={styles.card}>
        <h2>Also add when posting</h2>
        {result.altText && <Field id={`${platform}-alt`} title="Alt text" value={result.altText} copied={copied} onCopy={onCopy} hint="Add it under the accessibility or alt text setting so search and screen readers understand the image." />}
        {result.onScreenText && <Field id="ig-onscreen" title="On-screen / cover text" value={result.onScreenText} copied={copied} onCopy={onCopy} />}
        {result.locationTag && (
          <div className={styles.aiField}>
            <div className={styles.cardHead}>
              <span className={styles.tagGroupLabel}><MapPin size={13} /> Location tag</span>
              <CopyButton id={`${platform}-location`} text={result.locationTag} copied={copied} onCopy={onCopy} />
            </div>
            <p className={styles.locationValue}>📍 {result.locationTag}</p>
          </div>
        )}
        {result.searchKeywords?.length > 0 && (
          <div className={styles.aiField}>
            <span className={styles.tagGroupLabel}>Search keywords</span>
            <p className={styles.muted}>Use these in your profile name, bio and on-screen text.</p>
            <div className={styles.keywordGroup}><div>{result.searchKeywords.map((keyword) => <code key={keyword}>{keyword}</code>)}</div></div>
          </div>
        )}
      </article>
    </>
  );
}
