"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Check, CheckCircle2, Copy, Film, ImagePlus, Info, Lightbulb, Loader2, MapPin, Search, Sparkles, Trash2, Upload, XCircle,
} from "lucide-react";
import { probeMediaFile } from "./media-probe";
import AiResults from "./AiResults";
import AiStatusBar from "./AiStatusBar";
import { analyzeWithCompanionAi, companionAiStatus, installCompanionAi, prepareMediaForAi, warmCompanionAi, writeWithCompanionAi } from "./companion-ai";
import styles from "./social-seo.module.css";

const PLATFORMS = [
  { id: "instagram", label: "Instagram", logo: "/instagram-logo.svg" },
  { id: "facebook", label: "Facebook", logo: "/facebook-logo.svg" },
  { id: "linkedin", label: "LinkedIn", logo: "/linkedin-logo.png" },
  { id: "youtube", label: "YouTube", logo: "/youtube-logo.svg" },
];
const AI_PLATFORMS = PLATFORMS.map((entry) => entry.id);
const MAX_HASHTAGS = 5;
const BRAND_KEY = "agenticthat-social-seo-brand";
const BRAND_SOURCES = {
  you: "the brand name you entered",
  website: "the website in your description",
  workspace: "your workspace name. Add your brand name above to change it",
};

function readStoredBrand() {
  try { return window.localStorage.getItem(BRAND_KEY) || ""; } catch { return ""; }
}

function storeBrand(value) {
  try {
    if (value.trim()) window.localStorage.setItem(BRAND_KEY, value.trim());
    else window.localStorage.removeItem(BRAND_KEY);
  } catch { /* storage unavailable */ }
}

// Saved once and used for every post: the city for local search, and true
// selling points the AI can't see in the image (e.g. "placement support").
const BUSINESS_KEY = "agenticthat-social-seo-business";

function readStoredBusiness() {
  try {
    const value = JSON.parse(window.localStorage.getItem(BUSINESS_KEY) || "{}");
    return { city: String(value.city || ""), details: String(value.details || "") };
  } catch { return { city: "", details: "" }; }
}

function storeBusiness(value) {
  try {
    if (value.city.trim() || value.details.trim()) window.localStorage.setItem(BUSINESS_KEY, JSON.stringify({ city: value.city.trim(), details: value.details.trim() }));
    else window.localStorage.removeItem(BUSINESS_KEY);
  } catch { /* storage unavailable */ }
}

function useCopy() {
  const [copied, setCopied] = useState("");
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy(id, text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(id);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(""), 1800);
  }
  return [copied, copy];
}

function CopyButton({ id, text, copied, onCopy, label = "Copy" }) {
  const done = copied === id;
  return (
    <button type="button" className={styles.copyButton} onClick={() => onCopy(id, text)} disabled={!text}>
      {done ? <Check size={15} /> : <Copy size={15} />}
      {done ? "Copied" : label}
    </button>
  );
}

function formatBytes(bytes) {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "length unknown";
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function StatusIcon({ status }) {
  if (status === "pass") return <CheckCircle2 size={17} className={styles.pass} />;
  if (status === "fail") return <XCircle size={17} className={styles.fail} />;
  if (status === "warn") return <AlertTriangle size={17} className={styles.warn} />;
  return <Info size={17} className={styles.info} />;
}

export default function SocialSeoWorkspace({ canGenerate, workspaceName = "" }) {
  const [platform, setPlatform] = useState("instagram");
  const [aiStatus, setAiStatus] = useState(undefined);
  const [aiResult, setAiResult] = useState(null);
  const [tierChoice, setTierChoice] = useState("");
  const [installing, setInstalling] = useState(false);
  const [media, setMedia] = useState([]);
  const [probing, setProbing] = useState(false);
  const [description, setDescription] = useState("");
  const [useLocation, setUseLocation] = useState(true);
  const [brandName, setBrandName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [variantId, setVariantId] = useState("polished");
  const [captionEdits, setCaptionEdits] = useState({});
  const [selectedTags, setSelectedTags] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [copied, copy] = useCopy();
  const inputRef = useRef(null);
  const mediaRef = useRef(media);
  mediaRef.current = media;

  useEffect(() => () => mediaRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl)), []);
  useEffect(() => { setBrandName(readStoredBrand()); }, []);
  const [business, setBusiness] = useState({ city: "", details: "" });
  useEffect(() => { setBusiness(readStoredBusiness()); }, []);

  // Keep the free-AI status fresh: every 3 s while downloading, otherwise every 20 s.
  const downloading = aiStatus?.phase === "downloading";
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const next = await companionAiStatus();
      if (!cancelled) setAiStatus(next);
    };
    refresh();
    const timer = setInterval(refresh, downloading ? 3000 : 20000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [downloading]);

  const aiReady = Boolean(aiStatus && ["installed", "ready", "starting"].includes(aiStatus.phase));

  // Speed: load the model as soon as the page opens...
  const warmed = useRef(false);
  useEffect(() => {
    if (!aiReady || warmed.current || !canGenerate) return;
    warmed.current = true;
    warmCompanionAi();
  }, [aiReady, canGenerate]);

  // ...and study the media the moment it is added, while the user is still
  // typing. The description is used later, when each app is written.
  const earlyAnalysis = useRef({ key: "", promise: null });
  const mediaKey = media.map((item) => item.id).join("|");
  useEffect(() => {
    if (!aiReady || !canGenerate || !mediaKey) return undefined;
    const timer = setTimeout(() => {
      if (earlyAnalysis.current.key === mediaKey) return;
      const promise = prepareMediaForAi(mediaRef.current).then((prepared) => analyzeWithCompanionAi(prepared));
      promise.catch(() => undefined);
      earlyAnalysis.current = { key: mediaKey, promise };
    }, 1200);
    return () => clearTimeout(timer);
  }, [aiReady, canGenerate, mediaKey]);

  async function installAi(tier) {
    setInstalling(true);
    setError("");
    try {
      setAiStatus(await installCompanionAi(tier));
    } catch (installError) {
      setError(installError.message);
    } finally {
      setInstalling(false);
    }
  }

  const gps = useMemo(() => media.find((item) => item.gps)?.gps || null, [media]);

  async function addFiles(fileList) {
    const files = [...(fileList || [])];
    if (!files.length) return;
    setError("");
    setProbing(true);
    const added = [];
    for (const file of files) {
      try {
        added.push({ id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`, ...(await probeMediaFile(file)) });
      } catch (probeError) {
        setError(probeError.message || `${file.name} could not be read.`);
      }
    }
    setMedia((current) => [...current, ...added].slice(0, 30));
    setResult(null);
    setAiResult(null);
    setProbing(false);
  }

  function removeMedia(id) {
    setMedia((current) => {
      const item = current.find((entry) => entry.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return current.filter((entry) => entry.id !== id);
    });
    setResult(null);
    setAiResult(null);
  }

  async function generate(event) {
    event.preventDefault();
    if (!media.length) { setError("Add a photo or video first."); return; }
    if (!aiReady && description.trim().length < 10) { setError("Describe the post in at least a short sentence."); return; }
    setLoading(true);
    setError("");
    setAiResult(null);
    storeBrand(brandName);
    storeBusiness(business);
    try {
      // Media checks and location always come from the quick check; with the
      // free AI, a description is optional.
      const checkDescription = description.trim().length >= 10 ? description : `${media[0].kind === "video" ? "Video" : "Photo"} post for social media`;
      const response = await fetch("/api/social-seo/instagram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: checkDescription,
          brandName,
          gps: useLocation ? gps : null,
          media: media.map(({ kind, name, mimeType, width, height, durationSeconds, sizeBytes, coverFrame }) => ({ kind, name, mimeType, width, height, durationSeconds, sizeBytes, coverFrame })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to prepare suggestions.");
      setResult(payload.result);
      setVariantId(payload.result.captions[0]?.id || "polished");
      setCaptionEdits({});
      setSelectedTags(payload.result.hashtags.selected.map((entry) => entry.tag));

      if (aiReady) {
        // Look once, then fill in each app as soon as it is written, starting
        // with the tab the user is looking at.
        const order = [platform, ...AI_PLATFORMS.filter((entry) => entry !== platform)];
        const started = Date.now();
        setAiResult({ stage: "analyzing", results: {}, pending: order, started });
        const details = {
          description: description.trim() || undefined,
          // The brand typed or named in the description. The workspace name is
          // never used here: the AI reads the real brand from the media instead.
          brandName: brandName.trim() || (payload.result.brand?.source !== "workspace" ? payload.result.brand?.name : "") || undefined,
          // A city the business saved wins; otherwise the photo's location.
          location: business.city.trim() || payload.result.locationTag || undefined,
          businessDetails: business.details.trim() || undefined,
        };
        // Usually already finished (or nearly) because it started on upload.
        let analyzed = null;
        if (earlyAnalysis.current.key === mediaKey && earlyAnalysis.current.promise) {
          analyzed = await earlyAnalysis.current.promise.catch(() => null);
        }
        if (!analyzed) {
          analyzed = await analyzeWithCompanionAi({ ...(await prepareMediaForAi(media)), ...details });
          earlyAnalysis.current = { key: mediaKey, promise: Promise.resolve(analyzed) };
        }
        setAiResult({ stage: "writing", engine: analyzed.engine, analysis: analyzed.analysis, results: {}, pending: order, started });
        for (const app of order) {
          // The caption appears word by word while the AI writes it.
          const written = await writeWithCompanionAi(analyzed.analysisId, app, details, (text) => {
            setAiResult((current) => ({ ...current, live: { ...(current.live || {}), [app]: text } }));
          });
          setAiResult((current) => ({
            ...current,
            live: { ...(current.live || {}), [app]: "" },
            results: { ...current.results, [app]: written.result },
            pending: current.pending.filter((entry) => entry !== app),
            stage: current.pending.length <= 1 ? "done" : "writing",
            timings: { totalMs: Date.now() - started },
          }));
        }
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  const variant = result?.captions.find((entry) => entry.id === variantId) || result?.captions[0];
  const captionText = variant ? captionEdits[variant.id] ?? variant.captionOnly : "";
  const hashtagLine = selectedTags.join(" ");
  const fullCaption = [captionText.trim(), hashtagLine].filter(Boolean).join("\n\n");
  const allTags = result ? [...result.hashtags.selected, ...result.hashtags.alternatives] : [];
  const coverItem = media.find((item) => item.kind === "video" && item.coverPreview);

  function toggleTag(tag) {
    setSelectedTags((current) => (current.includes(tag)
      ? current.filter((entry) => entry !== tag)
      : current.length >= MAX_HASHTAGS ? current : [...current, tag]));
  }

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <span className={styles.eyebrow}><Search size={14} /> Get found online</span>
        <h1>Social SEO</h1>
        <p>Upload your photo or video. We prepare the caption, hashtags, alt text and everything else each app needs so the right people find your post.</p>
        <div className={styles.platformTabs} role="tablist" aria-label="Platform">
          {PLATFORMS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={entry.id === platform}
              className={entry.id === platform ? styles.platformActive : ""}
              onClick={() => setPlatform(entry.id)}
            >
              <img src={entry.logo} alt="" width={18} height={18} />
              {entry.label}
            </button>
          ))}
        </div>
      </header>

      <AiStatusBar
        status={aiStatus}
        tierChoice={tierChoice || aiStatus?.recommendedTier}
        onTierChange={setTierChoice}
        onInstall={installAi}
        installing={installing}
      />
      {aiReady && aiStatus?.lowMemory && (
        <p className={styles.memoryNote} role="status">
          Your computer has only {aiStatus.freeMemoryGb} GB of memory free, so the AI will be slower (the result is just as good).
          Close other apps or browser tabs before you create a post to make it faster.
        </p>
      )}

      <div className={styles.layout}>
        <form className={styles.inputCard} onSubmit={generate}>
          <h2>Your post</h2>
          <div
            className={`${styles.dropzone} ${dragging ? styles.dropzoneActive : ""}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}
          >
            <Upload size={26} />
            <strong>Drop photos or a video here</strong>
            <span>Several photos make a carousel. Files stay on your device; only their size, length and shape are checked.</span>
            <button type="button" className={styles.secondaryButton} onClick={() => inputRef.current?.click()} disabled={probing}>
              {probing ? <Loader2 size={16} className={styles.spin} /> : <ImagePlus size={16} />}
              {probing ? "Reading media…" : "Choose files"}
            </button>
            <input ref={inputRef} type="file" accept="image/*,video/*" multiple hidden onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} />
          </div>

          {media.length > 0 && (
            <ul className={styles.mediaList}>
              {media.map((item, index) => (
                <li key={item.id}>
                  {item.kind === "image"
                    ? <img src={item.previewUrl} alt="" />
                    : item.coverPreview ? <img src={item.coverPreview} alt="" /> : <span className={styles.videoThumb}><Film size={20} /></span>}
                  <div>
                    <strong>{media.length > 1 ? `${index + 1}. ` : ""}{item.name}</strong>
                    <span>
                      {item.kind === "video" ? `Video · ${formatDuration(item.durationSeconds)}` : "Photo"}
                      {item.width ? ` · ${item.width} × ${item.height}` : ""} · {formatBytes(item.sizeBytes)}
                    </span>
                  </div>
                  <button type="button" aria-label={`Remove ${item.name}`} onClick={() => removeMedia(item.id)}><Trash2 size={16} /></button>
                </li>
              ))}
            </ul>
          )}

          <label className={styles.field}>
            <span>What is this post about?{aiReady && <em> (optional)</em>}</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={6}
              maxLength={2200}
              placeholder="e.g. Our new Hyderabadi chicken biryani is slow cooked on dum for 4 hours. Available every weekend at our Banjara Hills kitchen."
            />
            <small>{description.length} / 2200 · {aiReady ? "The AI looks at your media. Add offers, prices or links it can't see." : "Write it the way you'd tell a customer. Specific words help people find it."}</small>
          </label>

          <label className={styles.field}>
            <span>Brand name <em>(optional)</em></span>
            <input
              type="text"
              value={brandName}
              maxLength={60}
              onChange={(event) => setBrandName(event.target.value)}
              placeholder={workspaceName && !/^workspace$/i.test(workspaceName) ? `e.g. ${workspaceName}` : "e.g. Tinitiate AI"}
            />
            <small>Used for your brand hashtag and alt text. Leave empty and we&apos;ll use the brand written on your image or named in your description.</small>
          </label>

          {aiReady && (
            <details className={styles.businessBox} open={!business.city && !business.details ? undefined : true}>
              <summary>Business details <em>(optional, saved for every post)</em></summary>
              <label className={styles.field}>
                <span>City or area</span>
                <input
                  type="text"
                  value={business.city}
                  maxLength={60}
                  onChange={(event) => setBusiness((current) => ({ ...current, city: event.target.value }))}
                  onBlur={() => storeBusiness(business)}
                  placeholder="e.g. Hyderabad"
                />
                <small>Adds local search words and a local hashtag, like #HyderabadITTraining.</small>
              </label>
              <label className={styles.field}>
                <span>What makes you different</span>
                <input
                  type="text"
                  value={business.details}
                  maxLength={300}
                  onChange={(event) => setBusiness((current) => ({ ...current, details: event.target.value }))}
                  onBlur={() => storeBusiness(business)}
                  placeholder="e.g. Live projects, placement support, free trial sessions"
                />
                <small>Only true facts: the AI uses them in your posts but never invents its own.</small>
              </label>
            </details>
          )}

          {gps && (
            <label className={styles.checkbox}>
              <input type="checkbox" checked={useLocation} onChange={(event) => setUseLocation(event.target.checked)} />
              <span><MapPin size={14} /> Use the photo&apos;s location for local hashtags (only the nearest city is used)</span>
            </label>
          )}

          {error && <p className={styles.error} role="alert">{error}</p>}

          <button className={styles.primaryButton} type="submit" disabled={!canGenerate || loading || probing}>
            {loading ? <Loader2 size={18} className={styles.spin} /> : <Sparkles size={18} />}
            {loading ? (aiReady ? "Writing with free AI…" : "Preparing suggestions…") : aiReady ? "Create SEO posts for all apps" : "Get Instagram SEO"}
          </button>
          {!canGenerate && <p className={styles.muted}>Your role can view Social SEO but not generate suggestions.</p>}
        </form>

        <section className={styles.results} aria-live="polite">
          {aiResult && <AiResults data={aiResult} platform={platform} copied={copied} onCopy={copy} draft={platform === "instagram" ? fullCaption : ""} />}

          {!aiResult && result && platform !== "instagram" && (
            <div className={styles.emptyState}>
              <Sparkles size={30} />
              <h2>Turn on the free AI for {PLATFORMS.find((entry) => entry.id === platform)?.label}</h2>
              <p>Facebook, LinkedIn and YouTube posts are written by the free AI in the Companion. Basic SEO is available for Instagram.</p>
            </div>
          )}

          {!result && (
            <div className={styles.emptyState}>
              <Sparkles size={30} />
              <h2>Your suggestions appear here</h2>
              <p>You&apos;ll get three caption options, a focused hashtag set, alt text, the keywords to say and show on screen, and a check of whether your media fits Instagram.</p>
            </div>
          )}

          {result && !aiResult && platform === "instagram" && (
            <>
              <article className={styles.card}>
                <div className={styles.cardHead}>
                  <h2>Caption</h2>
                  <CopyButton id="caption" text={fullCaption} copied={copied} onCopy={copy} label="Copy caption + hashtags" />
                </div>
                <div className={styles.variantTabs} role="tablist" aria-label="Caption style">
                  {result.captions.map((entry) => (
                    <button key={entry.id} type="button" role="tab" aria-selected={entry.id === variant.id} className={entry.id === variant.id ? styles.variantActive : ""} onClick={() => setVariantId(entry.id)}>
                      {entry.label}
                    </button>
                  ))}
                </div>
                <p className={styles.muted}>{variant.description}</p>
                <textarea
                  className={styles.captionBox}
                  value={captionText}
                  onChange={(event) => setCaptionEdits((current) => ({ ...current, [variant.id]: event.target.value }))}
                  rows={10}
                />
                <div className={styles.captionMeta}>
                  <span className={variant.keywordVisible ? styles.goodBadge : styles.warnBadge}>
                    {variant.keywordVisible ? <Check size={13} /> : <AlertTriangle size={13} />}
                    {variant.keywordVisible ? "Keyword visible before “… more”" : "Keyword not in the first line"}
                  </span>
                  <span>{fullCaption.length} / 2200 characters</span>
                </div>
                <p className={styles.detected}>
                  Written as: <strong>{result.intent.label}</strong>
                  {result.topics?.length > 0 && <> · Topics: {result.topics.map((topic) => `${topic.emoji} ${topic.label}`).join(", ")}</>}
                </p>
              </article>

              <article className={styles.card}>
                <div className={styles.cardHead}>
                  <h2>Hashtags <small>{selectedTags.length}/{MAX_HASHTAGS}</small></h2>
                  <CopyButton id="tags" text={hashtagLine} copied={copied} onCopy={copy} />
                </div>
                <p className={styles.muted}>Instagram allows up to {MAX_HASHTAGS} hashtags. Specific tags work better than broad, popular ones. Tap a tag to add or remove it.</p>
                {result.brand && <p className={styles.muted}>Brand tag <strong>{result.brand.tag}</strong> comes from {BRAND_SOURCES[result.brand.source]}.</p>}
                {(result.hashtags.groups?.length ? result.hashtags.groups : [{ id: "all", label: "", tags: allTags.map((entry) => entry.tag) }]).map((group) => (
                  <div key={group.id} className={styles.tagGroup}>
                    {group.label && <span className={styles.tagGroupLabel}>{group.label}</span>}
                    <div className={styles.tags}>
                      {group.tags.map((tag) => {
                        const entry = allTags.find((candidate) => candidate.tag === tag) || { tag, reason: "" };
                        const on = selectedTags.includes(tag);
                        return (
                          <button key={tag} type="button" title={entry.reason} className={on ? styles.tagOn : styles.tagOff} onClick={() => toggleTag(tag)} disabled={!on && selectedTags.length >= MAX_HASHTAGS}>
                            {tag}<small>{entry.reason}</small>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </article>

              {result.locationTag && (
                <article className={styles.card}>
                  <div className={styles.cardHead}>
                    <h2><MapPin size={17} /> Location tag</h2>
                    <CopyButton id="location" text={result.locationTag} copied={copied} onCopy={copy} />
                  </div>
                  <p className={styles.muted}>Add this location when posting (tap <strong>Add location</strong>). People nearby searching Instagram can then find your post.</p>
                  <p className={styles.locationValue}>📍 {result.locationTag}</p>
                </article>
              )}

              <article className={styles.card}>
                <div className={styles.scoreRow}>
                  <div className={styles.score} style={{ "--score": result.score }}>
                    <strong>{result.score}</strong><span>/100</span>
                  </div>
                  <div>
                    <h2>SEO checklist</h2>
                    <p className={styles.muted}>How many Instagram search best practices this post covers. It doesn&apos;t predict views. Detected post type: <strong>{result.intent.label}</strong> · {result.format.label}</p>
                  </div>
                </div>
                <ul className={styles.checklist}>
                  {result.checklist.filter((item) => !item.skipped).map((item) => (
                    <li key={item.id} className={item.met ? styles.met : styles.unmet}>
                      {item.met ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
                      <div><strong>{item.label}</strong>{!item.met && item.tip && <span>{item.tip}</span>}</div>
                    </li>
                  ))}
                </ul>
              </article>

              <article className={styles.card}>
                <h2>Keywords</h2>
                {result.keywords.primary ? (
                  <div className={styles.keywordPrimary}>
                    <span>Main keyword</span>
                    <strong>{result.keywords.primary.phrase}</strong>
                    {result.keywords.primary.searchValidated && <em><Check size={13} /> Found in real search suggestions</em>}
                  </div>
                ) : <p className={styles.muted}>Add more detail to your description so we can find a clear keyword.</p>}
                {result.keywords.secondary.length > 0 && (
                  <div className={styles.keywordGroup}>
                    <span>Supporting keywords</span>
                    <div>{result.keywords.secondary.map((entry) => <code key={entry.phrase}>{entry.phrase}</code>)}</div>
                  </div>
                )}
                {result.keywords.searchPhrases.length > 0 && (
                  <div className={styles.keywordGroup}>
                    <span>What people search for</span>
                    <div>{result.keywords.searchPhrases.map((phrase) => <code key={phrase}>{phrase}</code>)}</div>
                  </div>
                )}
                {result.keywords.onScreenText && (
                  <div className={styles.keywordGroup}>
                    <span>On-screen text</span>
                    <div className={styles.inlineCopy}>
                      <code>{result.keywords.onScreenText}</code>
                      <CopyButton id="onscreen" text={result.keywords.onScreenText} copied={copied} onCopy={copy} />
                    </div>
                  </div>
                )}
              </article>

              {result.altText.length > 0 && (
                <article className={styles.card}>
                  <h2>Alt text</h2>
                  <p className={styles.muted}>Add this under Advanced settings → Accessibility. We can&apos;t see the image, so check it describes what is actually shown and edit it if needed.</p>
                  <ul className={styles.altList}>
                    {result.altText.map((entry) => (
                      <li key={entry.slide}>
                        <p>{entry.text}</p>
                        <CopyButton id={`alt-${entry.slide}`} text={entry.text} copied={copied} onCopy={copy} />
                      </li>
                    ))}
                  </ul>
                </article>
              )}

              <article className={styles.card}>
                <h2>Media check · {result.format.label}</h2>
                {result.format.cover && (
                  <div className={styles.cover}>
                    {coverItem && <img src={coverItem.coverPreview} alt="Suggested cover frame" />}
                    <div>
                      <strong>Suggested cover: frame at {result.format.cover.label}</strong>
                      <span>The sharpest, best-lit frame we sampled. Choose it under Edit cover when posting, and add your on-screen keyword to it.</span>
                    </div>
                  </div>
                )}
                <ul className={styles.checks}>
                  {result.format.checks.map((entry, index) => (
                    <li key={`${entry.id}-${index}`}>
                      <StatusIcon status={entry.status} />
                      <div><strong>{entry.title}</strong><span>{entry.detail}</span></div>
                    </li>
                  ))}
                </ul>
              </article>

              <article className={styles.card}>
                <h2>Before you post</h2>
                <ul className={styles.tips}>
                  {result.tips.map((tip) => <li key={tip}><Lightbulb size={16} /><span>{tip}</span></li>)}
                </ul>
                <p className={styles.footnote}>
                  Built from clear rules, your description{result.signals.searchSuggestions ? " and public search suggestions" : ""}. No AI is used. Instagram rules last reviewed {result.rulesReviewedAt}.
                </p>
              </article>
            </>
          )}

          {result && aiResult && (
            <article className={styles.card}>
              <h2>Media check · {result.format.label}</h2>
              <ul className={styles.checks}>
                {result.format.checks.map((entry, index) => (
                  <li key={`${entry.id}-${index}`}>
                    <StatusIcon status={entry.status} />
                    <div><strong>{entry.title}</strong><span>{entry.detail}</span></div>
                  </li>
                ))}
              </ul>
            </article>
          )}
        </section>
      </div>
    </div>
  );
}
