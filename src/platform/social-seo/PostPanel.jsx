"use client";

// Posts a Social SEO result straight to the user's connected accounts. It uses
// Social posts' own publishing (accounts, upload, queue, the Companion), so a
// post made here is the same as one made on the Social posts page: each
// account gets its own text, written for its app by the chosen AI.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock, CheckCircle2, ExternalLink, Loader2, PlugZap, Send, X, XCircle } from "lucide-react";
import { api, ContentPreflightApiError, setCentralAuthToken } from "../../../services/publishing/queue-runner/src/lib/api";
import { platformPostRules } from "../../../services/publishing/queue-runner/shared/schema";
import { AiLogo } from "./AiStatusBar";
import { postTextFor } from "./post-text";
import { REDDIT_MY_PROFILE } from "../../../services/publishing/queue-runner/shared/reddit-options.js";
import styles from "./social-seo.module.css";

export const POST_PLATFORMS = [
  { id: "instagram", label: "Instagram", logo: "/instagram-logo.svg" },
  { id: "facebook", label: "Facebook", logo: "/facebook-logo.svg" },
  { id: "linkedin", label: "LinkedIn", logo: "/linkedin-logo.png" },
  { id: "youtube", label: "YouTube", logo: "/youtube-logo.svg" },
  { id: "x", label: "X", logo: "/x-logo.svg" },
  { id: "reddit", label: "Reddit", logo: "/reddit-logo.svg" },
];

const X_LIMIT = 280;

/** Why an account can't take this post right now ("" when it can). */
function accountProblem(account, kind) {
  if (!account.enabled) return "Turned off in Social posts";
  if (!platformPostRules[account.platform]?.formats.includes(kind)) return `${account.platform === "instagram" ? "Instagram" : "This app"} doesn't take ${kind} posts`;
  if (account.readiness === "reconnect_required" || account.sessionStatus === "reconnect_required" || !account.credentialConfigured) return "Reconnect it in Connect";
  return "";
}

function accountNote(account) {
  if (account.executionEngine !== "api" && (account.readiness === "waiting_for_companion" || account.companionStatus === "offline")) return "Posts when the Companion is open";
  return "";
}

const STATUS_TEXT = {
  queued: "Waiting to post",
  processing: "Posting…",
  posted: "Posted",
  failed: "Failed",
};

function statusLine(upload) {
  if (upload.status === "failed") return upload.failureReason || "It didn't post.";
  if (upload.status === "posted") return upload.postedAt ? `Posted ${new Date(upload.postedAt).toLocaleString()}` : "Posted";
  if (upload.safetyDeferredUntil) return `Waiting until ${new Date(upload.safetyDeferredUntil).toLocaleString()}`;
  if (upload.statusDetail === "waiting_for_companion") return "Waiting for the Companion to be open on a computer";
  if (upload.scheduledAt && Date.parse(upload.scheduledAt) > Date.now()) return `Scheduled for ${new Date(upload.scheduledAt).toLocaleString()}`;
  if (upload.statusDetail === "opening_platform") return "Opening the app…";
  if (upload.statusDetail === "uploading") return "Uploading…";
  if (upload.statusDetail === "publishing") return "Publishing…";
  return "";
}

export default function PostPanel({ token, media, aiResult, fallbackText, onClose }) {
  const [accounts, setAccounts] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [mediaId, setMediaId] = useState(media[0]?.id || "");
  const item = media.find((entry) => entry.id === mediaId) || media[0];
  const kind = item?.kind || "image";
  const doneAis = useMemo(() => (aiResult ? aiResult.order.map((id) => aiResult.providers[id]).filter((entry) => entry?.state === "done" && entry.results) : []), [aiResult]);

  const [selected, setSelected] = useState([]);
  const [linkedinPages, setLinkedinPages] = useState({});
  const [aiFor, setAiFor] = useState({});
  const [drafts, setDrafts] = useState({});
  const [youtubeVisibility, setYoutubeVisibility] = useState("public");
  const [when, setWhen] = useState("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [rights, setRights] = useState(false);
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [created, setCreated] = useState(null);

  // The accounts connected in Social posts.
  useEffect(() => {
    let cancelled = false;
    setCentralAuthToken(token);
    api.workspaceSnapshot()
      .then((snapshot) => { if (!cancelled) setAccounts(snapshot.accounts || []); })
      .catch((failure) => { if (!cancelled) setLoadError(failure.message || "Your social accounts couldn't be loaded."); });
    return () => { cancelled = true; };
  }, [token]);

  // Each app starts with the first AI's version; the user can pick another or edit it.
  const draftFrom = useCallback((platform, providerId) => {
    const entry = doneAis.find((ai) => ai.id === providerId) || doneAis.find((ai) => ai.results?.[platform]);
    return postTextFor(platform, entry?.results?.[platform], kind) || { text: fallbackText || "", title: "", subreddit: platform === "reddit" ? REDDIT_MY_PROFILE : "" };
  }, [doneAis, fallbackText, kind]);

  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      for (const { id } of POST_PLATFORMS) if (!next[id]) next[id] = draftFrom(id, aiFor[id]);
      return next;
    });
  }, [draftFrom, aiFor]);

  const byPlatform = useMemo(() => {
    const groups = Object.fromEntries(POST_PLATFORMS.map(({ id }) => [id, []]));
    for (const account of accounts || []) if (groups[account.platform]) groups[account.platform].push(account);
    return groups;
  }, [accounts]);

  const chosenAccounts = (accounts || []).filter((account) => selected.includes(account.id));
  const chosenPlatforms = [...new Set(chosenAccounts.map((account) => account.platform))];

  const toggle = (account) => setSelected((current) => (current.includes(account.id) ? current.filter((id) => id !== account.id) : [...current, account.id]));
  const setDraft = (platform, change) => setDrafts((current) => ({ ...current, [platform]: { ...current[platform], ...change } }));
  const pickAi = (platform, providerId) => {
    setAiFor((current) => ({ ...current, [platform]: providerId }));
    setDrafts((current) => ({ ...current, [platform]: draftFrom(platform, providerId) }));
  };

  // Problems found before anything is sent.
  const problems = [];
  if (!item) problems.push("Add a photo or video first.");
  if (!chosenAccounts.length) problems.push("Choose at least one account.");
  for (const platform of chosenPlatforms) {
    const draft = drafts[platform] || {};
    const label = POST_PLATFORMS.find((entry) => entry.id === platform)?.label;
    if (!String(draft.text || "").trim()) problems.push(`Write the ${label} text.`);
    if (platform === "x" && String(draft.text || "").length > X_LIMIT) problems.push(`The X post is ${draft.text.length} characters; X allows ${X_LIMIT}.`);
    const limit = platformPostRules[platform]?.descriptionLimit;
    if (limit && platform !== "x" && String(draft.text || "").length > limit) problems.push(`The ${label} text is longer than ${label} allows (${limit.toLocaleString()} characters).`);
    if (platform === "reddit") {
      if (!String(draft.title || "").trim()) problems.push("Reddit needs a title.");
      }
    if (platform === "youtube" && kind === "video" && !String(draft.title || "").trim()) problems.push("YouTube needs a video title.");
  }
  if (when === "schedule" && !(scheduledAt && Date.parse(scheduledAt) > Date.now())) problems.push("Choose a time in the future to schedule.");
  if (!rights) problems.push("Confirm you own this photo or video, or may post it.");

  async function post(confirmWarnings = false) {
    setError("");
    if (problems.length) return;
    setBusy("Preparing…");
    try {
      const blob = await (await fetch(item.previewUrl)).blob();
      const file = new File([blob], item.name, { type: item.mimeType || blob.type });
      const textOf = (platform) => String(drafts[platform]?.text || "").trim();
      const reddit = chosenPlatforms.includes("reddit") ? drafts.reddit : null;
      const youtubeVideo = kind === "video" && chosenPlatforms.includes("youtube");
      const at = when === "schedule" ? new Date(scheduledAt).toISOString() : undefined;
      const uploads = await api.createUnifiedPost({
        postFormat: kind,
        file,
        title: youtubeVideo ? String(drafts.youtube?.title || "").trim() : "",
        platformOptions: {
          ...(youtubeVideo ? { youtube: { audience: "not_made_for_kids", visibility: youtubeVisibility } } : {}),
          ...(reddit ? { reddit: { subreddit: REDDIT_MY_PROFILE, title: String(reddit.title).trim() } } : {}),
        },
        description: textOf(chosenAccounts[0].platform),
        destinations: chosenAccounts.map((account) => ({
          accountId: account.id,
          ...(account.platform === "linkedin" && linkedinPages[account.id] ? { linkedinPageId: linkedinPages[account.id] } : {}),
          description: textOf(account.platform),
          ...(at ? { scheduledAt: at } : {}),
        })),
        rightsConfirmed: rights,
        confirmWarnings,
        onProgress: (progress) => setBusy(progress.phase === "uploading" ? `Uploading ${kind}… ${progress.percent}%` : "Creating the posts…"),
      });
      setWarnings([]);
      setCreated(uploads);
    } catch (failure) {
      if (failure instanceof ContentPreflightApiError && failure.code === "CONTENT_PREFLIGHT_WARNINGS") {
        setWarnings([...new Set(failure.issues.map((issue) => issue.message))]);
      } else {
        setError(failure?.message || "The post couldn't be sent.");
      }
    } finally {
      setBusy("");
    }
  }

  // After posting: each account's live status.
  useEffect(() => {
    if (!created?.length) return undefined;
    const ids = new Set(created.map((upload) => upload.id));
    const settled = () => created.every((upload) => upload.status === "posted" || upload.status === "failed");
    if (settled()) return undefined;
    const timer = setInterval(async () => {
      try {
        const all = await api.uploads();
        setCreated((current) => current.map((upload) => all.find((entry) => entry.id === upload.id && ids.has(entry.id)) || upload));
      } catch { /* try again on the next tick */ }
    }, 4000);
    return () => clearInterval(timer);
  }, [created]);

  const accountName = (id) => accounts?.find((account) => account.id === id);

  return (
    <div className={styles.postOverlay} role="dialog" aria-modal="true" aria-labelledby="post-title" onClick={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <section className={styles.postDialog}>
        <header className={styles.postHead}>
          <div>
            <h2 id="post-title">{created ? "Posting to your accounts" : "Post to your accounts"}</h2>
            <p>{created ? "Each account posts on its own; you can close this, the posts carry on." : "Each app gets its own text, written for it. Edit anything before posting."}</p>
          </div>
          <button type="button" className={styles.iconButton} onClick={onClose} disabled={Boolean(busy)} aria-label="Close"><X size={18} /></button>
        </header>

        {created ? (
          <div className={styles.postBody}>
            <ul className={styles.postStatusList}>
              {created.map((upload) => {
                const account = accountName(upload.accountId);
                const platform = POST_PLATFORMS.find((entry) => entry.id === upload.platform);
                return (
                  <li key={upload.id} data-status={upload.status}>
                    <img src={platform?.logo} alt="" width={20} height={20} />
                    <div>
                      <strong>{account?.displayName || platform?.label}</strong>
                      <small>{statusLine(upload)}</small>
                    </div>
                    <span className={styles.postStatusTag}>
                      {upload.status === "posted" ? <CheckCircle2 size={15} /> : upload.status === "failed" ? <XCircle size={15} /> : <Loader2 size={15} className={styles.spin} />}
                      {STATUS_TEXT[upload.status] || upload.status}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className={styles.muted}>Failed posts can be fixed and retried in <Link href="/publishing">Social posts</Link>, where every post is kept.</p>
            <div className={styles.postActions}>
              <Link className={styles.secondaryButton} href="/publishing"><ExternalLink size={15} /> Open Social posts</Link>
              <button type="button" className={styles.primaryButtonSmall} onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <div className={styles.postBody}>
            {media.length > 1 && (
              <div className={styles.postMediaPick}>
                <strong>Which {media.some((entry) => entry.kind === "video") ? "photo or video" : "photo"} to post</strong>
                <div>
                  {media.map((entry) => (
                    <button key={entry.id} type="button" className={entry.id === item?.id ? styles.postMediaOn : ""} onClick={() => setMediaId(entry.id)} aria-pressed={entry.id === item?.id}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={entry.kind === "video" ? entry.coverPreview || "" : entry.previewUrl} alt={entry.name} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {loadError && <p className={styles.error} role="alert">{loadError}</p>}
            {!accounts && !loadError && <p className={styles.muted}><Loader2 size={15} className={styles.spin} /> Loading your accounts…</p>}

            {accounts && (
              <>
                <h3 className={styles.postSection}>1. Choose accounts</h3>
                <div className={styles.postPlatforms}>
                  {POST_PLATFORMS.map((platform) => {
                    const list = byPlatform[platform.id];
                    return (
                      <div key={platform.id} className={styles.postPlatform}>
                        <div className={styles.postPlatformHead}><img src={platform.logo} alt="" width={20} height={20} /> <strong>{platform.label}</strong></div>
                        {!list.length && <Link className={styles.postConnect} href="/config-manager"><PlugZap size={14} /> Connect {platform.label}</Link>}
                        {list.map((account) => {
                          const problem = accountProblem(account, kind);
                          const note = accountNote(account);
                          return (
                            <label key={account.id} className={`${styles.postAccount} ${problem ? styles.postAccountOff : ""}`}>
                              <input type="checkbox" checked={selected.includes(account.id)} disabled={Boolean(problem)} onChange={() => toggle(account)} />
                              <span>
                                <strong>{account.displayName}</strong>
                                <small>{problem || note || account.handle}</small>
                              </span>
                              {account.platform === "linkedin" && account.linkedinManagedPages?.length > 0 && selected.includes(account.id) && (
                                <select value={linkedinPages[account.id] || ""} onChange={(event) => setLinkedinPages((current) => ({ ...current, [account.id]: event.target.value }))} aria-label="Post as">
                                  <option value="">As yourself</option>
                                  {account.linkedinManagedPages.map((page) => <option key={page.id} value={page.id}>As {page.name}</option>)}
                                </select>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>

                {chosenPlatforms.length > 0 && (
                  <>
                    <h3 className={styles.postSection}>2. Check the text for each app</h3>
                    {POST_PLATFORMS.filter((platform) => chosenPlatforms.includes(platform.id)).map((platform) => {
                      const draft = drafts[platform.id] || {};
                      const offered = doneAis.filter((ai) => ai.results?.[platform.id]);
                      const chosenAi = aiFor[platform.id] || offered[0]?.id;
                      return (
                        <div key={platform.id} className={styles.postDraft}>
                          <div className={styles.postDraftHead}>
                            <span><img src={platform.logo} alt="" width={18} height={18} /> <strong>{platform.label}</strong></span>
                            {offered.length > 1 && (
                              <span className={styles.postAiPick} role="radiogroup" aria-label={`Whose ${platform.label} version`}>
                                {offered.map((ai) => (
                                  <button key={ai.id} type="button" role="radio" aria-checked={ai.id === chosenAi} className={ai.id === chosenAi ? styles.postAiOn : ""} onClick={() => pickAi(platform.id, ai.id)}>
                                    <AiLogo id={ai.id} size={15} /> {ai.label}
                                  </button>
                                ))}
                              </span>
                            )}
                          </div>
                          {(platform.id === "reddit" || (platform.id === "youtube" && kind === "video")) && (
                            <label className={styles.postField}>Title<input value={draft.title || ""} onChange={(event) => setDraft(platform.id, { title: event.target.value })} maxLength={platform.id === "youtube" ? 100 : 300} /></label>
                          )}
                          {platform.id === "reddit" && (
                            <>
                              <small className={styles.muted}>Posts go to each selected Reddit account's own profile (u/yourname).</small>
                            </>
                          )}
                          <label className={styles.postField}>
                            {platform.id === "youtube" ? (kind === "video" ? "Description" : "Community post text") : platform.id === "reddit" ? "Post" : "Text"}
                            <textarea rows={platform.id === "x" ? 3 : 5} value={draft.text || ""} onChange={(event) => setDraft(platform.id, { text: event.target.value })} />
                          </label>
                          {platform.id === "x" && <small className={String(draft.text || "").length > X_LIMIT ? styles.fail : styles.muted}>{String(draft.text || "").length} of {X_LIMIT} characters</small>}
                          {platform.id === "youtube" && kind === "image" && <small className={styles.muted}>A photo goes to YouTube as a Community post.</small>}
                          {platform.id === "youtube" && kind === "video" && (
                            <label className={styles.postField}>Who can watch<select value={youtubeVisibility} onChange={(event) => setYoutubeVisibility(event.target.value)}><option value="public">Everyone (public)</option><option value="unlisted">Anyone with the link</option><option value="private">Only you</option></select></label>
                          )}
                        </div>
                      );
                    })}

                    <h3 className={styles.postSection}>3. When</h3>
                    <div className={styles.postWhen}>
                      <label><input type="radio" name="when" checked={when === "now"} onChange={() => setWhen("now")} /> Post now</label>
                      <label><input type="radio" name="when" checked={when === "schedule"} onChange={() => setWhen("schedule")} /> <CalendarClock size={15} /> Schedule</label>
                      {when === "schedule" && <input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} aria-label="Post at" />}
                    </div>
                  </>
                )}

                <label className={styles.postRights}><input type="checkbox" checked={rights} onChange={(event) => setRights(event.target.checked)} /> I own this {kind} or have permission to post it.</label>

                {warnings.length > 0 && (
                  <div className={styles.postWarning} role="alert">
                    <AlertTriangle size={17} />
                    <div>
                      <strong>Check before posting</strong>
                      <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                      <button type="button" className={styles.secondaryButton} disabled={Boolean(busy)} onClick={() => post(true)}>Post anyway</button>
                    </div>
                  </div>
                )}
                {error && <p className={styles.error} role="alert">{error}</p>}
                {chosenAccounts.length > 0 && problems.length > 0 && <ul className={styles.postProblems}>{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>}

                <div className={styles.postActions}>
                  <button type="button" className={styles.secondaryButton} onClick={onClose} disabled={Boolean(busy)}>Cancel</button>
                  <button type="button" className={styles.primaryButtonSmall} disabled={Boolean(busy) || problems.length > 0} onClick={() => post(false)}>
                    {busy ? <Loader2 size={15} className={styles.spin} /> : <Send size={15} />}
                    {busy || (when === "schedule" ? `Schedule for ${chosenAccounts.length || ""} account${chosenAccounts.length === 1 ? "" : "s"}` : `Post to ${chosenAccounts.length || ""} account${chosenAccounts.length === 1 ? "" : "s"}`)}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
