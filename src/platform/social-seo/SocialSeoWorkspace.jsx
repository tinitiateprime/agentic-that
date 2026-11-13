"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Check, CheckCircle2, Copy, Film, ImagePlus, Info, Lightbulb, Loader2, MapPin, Search, Sparkles, Trash2, Upload, XCircle,
} from "lucide-react";
import { probeMediaFile } from "./media-probe";
import AiResults from "./AiResults";
import AiStatusBar, { AiLogo } from "./AiStatusBar";
import { companionAiStatus, connectCompanionAi, disconnectCompanionAi, generateWithCompanionAis, prepareMediaForAi, showCompanionAiWindow } from "./companion-ai";
import styles from "./social-seo.module.css";

const PLATFORMS = [
  { id: "instagram", label: "Instagram", logo: "/instagram-logo.svg" },
  { id: "facebook", label: "Facebook", logo: "/facebook-logo.svg" },
  { id: "linkedin", label: "LinkedIn", logo: "/linkedin-logo.png" },
  { id: "youtube", label: "YouTube", logo: "/youtube-logo.svg" },
  { id: "x", label: "X", logo: "/x-logo.svg" },
  { id: "reddit", label: "Reddit", logo: "/reddit-logo.svg" },
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
  const [aiBusy, setAiBusy] = useState("");
  const [media, setMedia] = useState([]);
  const [probing, setProbing] = useState(false);
  const [description, setDescription] = useState("");
  const [useLocation, setUseLocation] = useState(true);
  const [brandName, setBrandName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
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

  // Keep the AI accounts fresh: every 3 s while someone is logging in or an AI
  // needs the user, otherwise every 15 s (the Companion may start later).
  const waitingForUser = Boolean(aiStatus?.providers?.some((provider) => provider.state === "connecting" || provider.state === "needs-you"));
  const refreshAiStatus = async () => setAiStatus(await companionAiStatus());
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const next = await companionAiStatus();
      if (!cancelled) setAiStatus(next);
    };
    refresh();
    const timer = setInterval(refresh, waitingForUser || loading ? 3000 : 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [waitingForUser, loading]);

  const connectedAis = aiStatus?.providers?.filter((provider) => provider.connected) || [];
  const aiReady = connectedAis.length > 0;

  async function aiAction(provider, action) {
    setAiBusy(provider);
    setError("");
    try {
      setAiStatus(await action(provider));
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setAiBusy("");
      refreshAiStatus();
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

  // The same post (media, description, brand and business details) is never sent
  // again to an AI that already answered it: Create only runs the AIs that are
  // missing or failed. "Write again" on a card asks one AI for a fresh version.
  const postKey = JSON.stringify([media.map((item) => item.id), description.trim(), brandName.trim(), business.city.trim(), business.details.trim(), useLocation]);

  /** Sends the post to these AI apps; cards of other AIs keep their results. */
  async function runAis(ids, quick, key) {
    const labels = Object.fromEntries((aiStatus?.providers || []).map((provider) => [provider.id, provider.label]));
    setAiResult((current) => {
      const keep = current?.key === key ? current : { key, order: [], providers: {} };
      return {
        key,
        order: [...keep.order, ...ids.filter((id) => !keep.order.includes(id))],
        providers: {
          ...keep.providers,
          ...Object.fromEntries(ids.map((id) => [id, { id, label: labels[id] || id, state: "working", detail: `Sending your post to ${labels[id] || id}…` }])),
        },
      };
    });
    const update = (id, change) => setAiResult((current) => current && ({
      ...current,
      providers: { ...current.providers, [id]: { ...current.providers[id], ...change } },
    }));
    try {
      const prepared = await prepareMediaForAi(media);
      await generateWithCompanionAis({
        providers: ids,
        images: prepared.images,
        mediaKind: prepared.mediaKind,
        durationSeconds: prepared.durationSeconds,
        platforms: AI_PLATFORMS,
        description: description.trim() || undefined,
        // The brand typed or named in the description. The workspace name is never
        // used here: the AI reads the real brand from the media instead.
        brandName: brandName.trim() || (quick?.brand?.source !== "workspace" ? quick?.brand?.name : "") || undefined,
        // A city the business saved wins; otherwise the photo's location.
        location: business.city.trim() || quick?.locationTag || undefined,
        businessDetails: business.details.trim() || undefined,
      }, (event) => {
        if (!event.provider) return;
        if (event.ok === true) update(event.provider, { state: "done", results: event.results, complete: event.complete, raw: event.raw, ms: event.ms, live: "" });
        else if (event.ok === false) update(event.provider, { state: event.limit ? "limit" : "failed", message: event.message });
        else update(event.provider, { state: event.state, step: event.step, detail: event.detail || "", live: event.live || "" });
      });
    } catch (runError) {
      // The Companion closed or the connection dropped: mark what was still running.
      setAiResult((current) => current && ({
        ...current,
        providers: Object.fromEntries(Object.entries(current.providers).map(([id, entry]) => [id, ids.includes(id) && !["done", "failed", "limit"].includes(entry.state) ? { ...entry, state: "failed", message: runError.message } : entry])),
      }));
    } finally {
      refreshAiStatus();
    }
  }

  async function generate(event) {
    event.preventDefault();
    if (!media.length) { setError("Add a photo or video first."); return; }
    if (!aiReady && description.trim().length < 10) { setError("Describe the post in at least a short sentence."); return; }
    const samePost = aiResult?.key === postKey;
    const pending = connectedAis.map((provider) => provider.id).filter((id) => !(samePost && aiResult.providers[id]?.state === "done"));
    if (aiReady && samePost && !pending.length) {
      setError("");
      setNotice("Every connected AI has already written this post. Use “Write again” on a card for a fresh version.");
      return;
    }
    setLoading(true);
    setError("");
    setNotice("");
    storeBrand(brandName);
    storeBusiness(business);
    try {
      // Media checks and location come from the quick check, once per post.
      let quick = samePost ? result : null;
      if (!quick) {
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
        quick = payload.result;
        setResult(quick);
        setVariantId(quick.captions[0]?.id || "polished");
        setCaptionEdits({});
        setSelectedTags(quick.hashtags.selected.map((entry) => entry.tag));
      }
      if (aiReady) await runAis(pending, quick, postKey);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  /** "Write again" / "Try again" on one AI's card. */
  async function rerunAi(id) {
    if (!aiResult || !result) return;
    if (aiResult.key !== postKey) {
      setError("Your post details changed. Create posts again to use the updated details.");
      return;
    }
    setLoading(true);
    setNotice("");
    try {
      await runAis([id], result, aiResult.key);
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
      <header className={styles.top}>
        <div>
          <span className={styles.eyebrow}><Search size={14} /> Get found online</span>
          <h1>Social SEO</h1>
          <p>Upload a post. {aiReady ? `${connectedAis.map((provider) => provider.label).join(", ").replace(/, ([^,]*)$/, " and $1")} write` : "Your ChatGPT, Claude or Gemini write"} ready-to-post captions, hashtags and alt text for Instagram, Facebook, LinkedIn and YouTube.</p>
        </div>
      </header>

      <AiStatusBar
        status={aiStatus}
        busy={aiBusy}
        onConnect={(provider) => aiAction(provider, connectCompanionAi)}
        onDisconnect={(provider) => aiAction(provider, disconnectCompanionAi)}
        onShow={showCompanionAiWindow}
      />

      <div className={styles.layout}>
        <form className={styles.inputCard} onSubmit={generate}>
          <h2><span className={styles.stepNumber}>1</span> Your post</h2>

          {media.length > 0 && (
            <ul className={styles.mediaGrid} aria-label="Your post">
              {media.map((item, index) => (
                <li key={item.id}>
                  {item.kind === "image"
                    ? <img src={item.previewUrl} alt={item.name} />
                    : item.coverPreview ? <img src={item.coverPreview} alt={item.name} /> : <span className={styles.videoThumb}><Film size={26} /></span>}
                  <span className={styles.mediaMeta}>
                    {media.length > 1 ? `${index + 1} · ` : ""}{item.kind === "video" ? `Video ${formatDuration(item.durationSeconds)}` : item.width ? `${item.width} × ${item.height}` : "Photo"} · {formatBytes(item.sizeBytes)}
                  </span>
                  <button type="button" aria-label={`Remove ${item.name}`} title="Remove" onClick={() => removeMedia(item.id)}><Trash2 size={15} /></button>
                </li>
              ))}
            </ul>
          )}

          <div
            className={`${styles.dropzone} ${media.length ? styles.dropzoneCompact : ""} ${dragging ? styles.dropzoneActive : ""}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}
          >
            {!media.length && <Upload size={28} />}
            {!media.length && <strong>Drop a photo, carousel or video here</strong>}
            {!media.length && <span>It stays on your computer: the Companion passes it only to the AI apps you connected.</span>}
            <button type="button" className={styles.secondaryButton} onClick={() => inputRef.current?.click()} disabled={probing}>
              {probing ? <Loader2 size={16} className={styles.spin} /> : <ImagePlus size={16} />}
              {probing ? "Reading media…" : media.length ? "Add more" : "Choose files"}
            </button>
            <input ref={inputRef} type="file" accept="image/*,video/*" multiple hidden onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} />
          </div>

          <section className={styles.details} aria-labelledby="seo-details-title">
            <div className={styles.detailsHead}>
              <strong id="seo-details-title">Help the AI</strong>
              <span className={styles.detailsPill}>{aiReady ? "Recommended" : "Needed for basic SEO"}</span>
            </div>
            <p className={styles.detailsWhy}>
              {aiReady
                ? "Your AI reads the image. Tell it what it can't see: these details are what turn a good post into one that ranks and sells."
                : "Describe the post the way you'd tell a customer: specific words help people find it."}
            </p>

            <label className={styles.field}>
              <span>About this post</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
                maxLength={2200}
                placeholder={aiReady ? "What's new, offers, prices, dates or links" : "What it is, who it's for and what's special about it"}
              />
              <small>{description.length ? `${description.length} / 2200 · ` : ""}Used as you write it, so add facts exactly.</small>
            </label>

            <div className={styles.detailsRow}>
              <label className={styles.field}>
                <span>Brand</span>
                <input
                  type="text"
                  value={brandName}
                  maxLength={60}
                  onChange={(event) => setBrandName(event.target.value)}
                  onBlur={() => storeBrand(brandName)}
                  placeholder={workspaceName && !/^workspace$/i.test(workspaceName) ? workspaceName : "Business or page name"}
                />
              </label>
              <label className={styles.field}>
                <span>City or area</span>
                <input
                  type="text"
                  value={business.city}
                  maxLength={60}
                  onChange={(event) => setBusiness((current) => ({ ...current, city: event.target.value }))}
                  onBlur={() => storeBusiness(business)}
                  placeholder="For local search"
                />
              </label>
            </div>

            <label className={styles.field}>
              <span>What makes you different</span>
              <input
                type="text"
                value={business.details}
                maxLength={300}
                onChange={(event) => setBusiness((current) => ({ ...current, details: event.target.value }))}
                onBlur={() => storeBusiness(business)}
                placeholder="What customers love about you"
              />
            </label>
            <p className={styles.detailsSaved}>Brand, city and what makes you different are saved for your next posts.</p>
          </section>

          {gps && (
            <label className={styles.checkbox}>
              <input type="checkbox" checked={useLocation} onChange={(event) => setUseLocation(event.target.checked)} />
              <span><MapPin size={14} /> Use the photo&apos;s location for local hashtags (only the nearest city is used)</span>
            </label>
          )}

          {error && <p className={styles.error} role="alert">{error}</p>}
          {notice && <p className={styles.notice} role="status">{notice}</p>}

          <button className={styles.primaryButton} type="submit" disabled={!canGenerate || loading || probing}>
            {loading ? <Loader2 size={18} className={styles.spin} /> : <Sparkles size={18} />}
            {loading ? (aiReady ? `Writing with ${connectedAis.map((provider) => provider.label).join(", ")}…` : "Preparing suggestions…") : aiReady ? "Create SEO posts" : "Get Instagram SEO"}
          </button>
          {aiReady && !loading && (
            <p className={styles.sendsTo}>
              <span>Written by</span>
              {connectedAis.map((provider) => <AiLogo key={provider.id} id={provider.id} size={18} />)}
              <span>for Instagram, Facebook, LinkedIn and YouTube</span>
            </p>
          )}
          {!canGenerate && <p className={styles.muted}>Your role can view Social SEO but not generate suggestions.</p>}
        </form>

        <section className={styles.results} aria-live="polite">
          <div className={styles.resultsHead}>
            <h2><span className={styles.stepNumber}>2</span> Your SEO posts</h2>
            <div className={styles.platformTabs} role="tablist" aria-label="App">
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
          </div>
          {aiResult && <AiResults data={aiResult} platform={platform} copied={copied} onCopy={copy} onShow={showCompanionAiWindow} onRerun={rerunAi} busy={loading} draft={platform === "instagram" ? fullCaption : ""} />}

          {!aiResult && result && platform !== "instagram" && (
            <div className={styles.emptyState}>
              <Sparkles size={30} />
              <h2>Connect an AI for {PLATFORMS.find((entry) => entry.id === platform)?.label}</h2>
              <p>Facebook, LinkedIn, YouTube, X and Reddit posts are written by your ChatGPT, Claude or Gemini through the Companion. Basic SEO is available for Instagram.</p>
            </div>
          )}

          {!result && (
            <div className={styles.emptyState}>
              {aiReady ? (
                <>
                  <div className={styles.emptyLogos} aria-hidden="true">{connectedAis.map((provider) => <AiLogo key={provider.id} id={provider.id} size={34} />)}</div>
                  <h2>Your posts appear here</h2>
                  <p>Add your post on the left and click <strong>Create SEO posts</strong>. You can read each AI&apos;s answer as it is written, then copy the caption, hashtags and alt text for every app.</p>
                </>
              ) : (
                <>
                  <Sparkles size={30} />
                  <h2>Your suggestions appear here</h2>
                  <p>Connect ChatGPT, Claude or Gemini above for posts on every app. Without one, you get Instagram captions, hashtags, alt text and a media check.</p>
                </>
              )}
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
