"use client";

import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  Download,
  Eye,
  Heart,
  MessageCircle,
  Pin,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2
} from "lucide-react";
import {
  buildComparisonReport,
  canonicalPostKey,
  normalizeProfileInput,
  pinSelectedPosts,
  postsFromComparisonJob
} from "./profileComparison";

const MAX_PROFILES = 4;
const MAX_SELECTED_POSTS = 3;
const GOAL_OPTIONS = [
  "Get more customers",
  "Increase sales",
  "Improve repeat business",
  "Compete better locally",
  "Grow online reach",
  "Other business goal"
];

const emptyProfile = (id, value = "") => ({
  id,
  value,
  username: "",
  role: "competitor",
  posts: [],
  selectedKeys: [],
  analysis: null,
  status: "idle",
  statusText: "",
  error: ""
});

const initialBusinessContext = {
  business_name: "",
  business_type: "",
  location: "",
  target_customer: "",
  offers: "",
  current_challenge: "",
  goal: "",
  custom_goal: ""
};

const metricLabel = (post, metric) => {
  const hidden = metric === "likes" ? post.likes_hidden : metric === "comments_count" ? post.comments_hidden : false;
  if (hidden) return "Hidden";
  const display = metric === "comments_count"
    ? post.comments_display
    : post[`${metric}_display`];
  if (display) return String(display).replace(/\s+/g, "");
  const value = Number(post[metric]);
  return Number.isFinite(value) ? value.toLocaleString() : "N/A";
};

const formatAverage = (value) => Number.isFinite(Number(value)) ? Number(value).toLocaleString() : "N/A";

const relativeDate = (value) => {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  const today = new Date();
  date.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((today.getTime() - date.getTime()) / 86_400_000));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
};

function ComparisonThumbnail({ post }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [post.thumbnail_url]);
  return (
    <div className="compare-post-thumb">
      {post.thumbnail_url && !failed ? (
        <img
          src={post.thumbnail_url}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : <span>{/\/reel\//i.test(post.post_url || "") ? "REEL" : "POST"}</span>}
    </div>
  );
}

function EvidenceThumbnail({ post }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [post.thumbnail_url]);
  return post.thumbnail_url && !failed ? (
    <img src={post.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
  ) : <span className="evidence-placeholder" />;
}

function Metric({ icon: Icon, label, value }) {
  return (
    <span className="compare-metric" title={label}>
      <Icon size={14} aria-hidden="true" />
      <span>{value}</span>
    </span>
  );
}

function ProfilePost({ post, selected, onToggle }) {
  return (
    <article className={`compare-post ${selected ? "is-selected" : ""}`}>
      <ComparisonThumbnail post={post} />
      <div className="compare-post-body">
        <div className="compare-post-heading">
          <div>
            <strong>{/\/reel\//i.test(post.post_url || "") ? "Reel" : "Post"}</strong>
            <span>{relativeDate(post.timestamp)}</span>
          </div>
          <button
            type="button"
            className="select-post-button"
            aria-label={selected ? "Remove selected post" : "Select post"}
            title={selected ? "Remove selection" : "Select post"}
            onClick={onToggle}
          >
            {selected ? <Pin size={17} aria-hidden="true" /> : <Check size={17} aria-hidden="true" />}
          </button>
        </div>
        <div className="compare-post-metrics">
          <Metric icon={Eye} label="Views" value={metricLabel(post, "views")} />
          <Metric icon={Heart} label="Likes" value={metricLabel(post, "likes")} />
          <Metric icon={MessageCircle} label="Comments" value={metricLabel(post, "comments_count")} />
        </div>
        <a href={post.post_url} target="_blank" rel="external noopener noreferrer" referrerPolicy="no-referrer">
          Open post
        </a>
      </div>
    </article>
  );
}

export default function ProfileComparisonWorkspace({ seedProfile = "", runJob }) {
  const [profiles, setProfiles] = useState(() => [
    emptyProfile("profile-1", seedProfile),
    emptyProfile("profile-2")
  ]);
  const [selectionMode, setSelectionMode] = useState("recent");
  const [postCount, setPostCount] = useState(10);
  const [stage, setStage] = useState("setup");
  const [error, setError] = useState("");
  const [businessContext, setBusinessContext] = useState(initialBusinessContext);
  const [report, setReport] = useState(null);
  const [advisorConfigured, setAdvisorConfigured] = useState(null);
  const [advisorStatus, setAdvisorStatus] = useState("idle");
  const [advisorError, setAdvisorError] = useState("");
  const [advisorPlan, setAdvisorPlan] = useState(null);
  const [advisorQuestion, setAdvisorQuestion] = useState("");
  const [advisorAnswers, setAdvisorAnswers] = useState([]);
  const [questionStatus, setQuestionStatus] = useState("idle");

  useEffect(() => {
    if (!seedProfile) return;
    setProfiles((current) => current.map((profile, index) => (
      index === 0 && !profile.value ? { ...profile, value: seedProfile } : profile
    )));
  }, [seedProfile]);

  useEffect(() => {
    if (stage !== "report") return;
    let active = true;
    fetch("/api/instagram/growth-advisor", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("AI status unavailable");
        return response.json();
      })
      .then((data) => {
        if (active) setAdvisorConfigured(Boolean(data.configured));
      })
      .catch(() => {
        if (active) setAdvisorConfigured(null);
      });
    return () => { active = false; };
  }, [stage]);

  const loadedProfiles = profiles.filter((profile) => profile.posts.length > 0);
  const allProfilesSelected = loadedProfiles.length >= 2
    && loadedProfiles.every((profile) => profile.selectedKeys.length > 0);

  const updateProfile = (id, changes) => {
    setProfiles((current) => current.map((profile) => profile.id === id ? { ...profile, ...changes } : profile));
  };

  const addProfile = () => {
    if (profiles.length >= MAX_PROFILES) return;
    const nextNumber = Math.max(...profiles.map((profile) => Number(profile.id.split("-")[1]) || 0)) + 1;
    setProfiles((current) => [...current, emptyProfile(`profile-${nextNumber}`)]);
  };

  const removeProfile = (id) => {
    if (profiles.length <= 2) return;
    setProfiles((current) => current.filter((profile) => profile.id !== id));
  };

  const setOwnProfile = (id, own) => {
    setProfiles((current) => current.map((profile) => ({
      ...profile,
      role: profile.id === id && own ? "own" : "competitor"
    })));
  };

  const collectOneProfile = async (profile, index, total) => {
    const username = normalizeProfileInput(profile.value);
    updateProfile(profile.id, {
      username,
      status: "working",
      statusText: `Profile ${index + 1} of ${total}`,
      error: ""
    });
    try {
      const data = await runJob({
        mode: "profile",
        keyword: `@${username}`,
        max_results: postCount,
        collection_mode: selectionMode === "views" ? "engagement" : "latest",
        timezone_offset_minutes: new Date().getTimezoneOffset(),
        auto_expand_days: false,
        max_auto_expand_days: 1
      }, (status) => updateProfile(profile.id, { statusText: status }));
      const posts = postsFromComparisonJob(data, selectionMode, postCount);
      if (!posts.length) {
        throw new Error(selectionMode === "views"
          ? "Instagram did not expose public Reel view counts for this profile."
          : "Instagram did not expose public posts for this profile.");
      }
      updateProfile(profile.id, {
        username,
        posts,
        selectedKeys: [],
        analysis: data?.analysis || data?.run?.analysis || null,
        status: "complete",
        statusText: "Ready",
        error: ""
      });
      return true;
    } catch (cause) {
      updateProfile(profile.id, {
        posts: [],
        selectedKeys: [],
        analysis: null,
        status: "failed",
        statusText: "",
        error: cause instanceof Error ? cause.message : "Profile scrape failed"
      });
      return false;
    }
  };

  const collectProfiles = async () => {
    const normalized = profiles.map((profile) => normalizeProfileInput(profile.value));
    if (normalized.some((username) => !username)) {
      setError("Enter a valid Instagram username or profile URL for every profile.");
      return;
    }
    if (new Set(normalized).size !== normalized.length) {
      setError("Each comparison profile must be different.");
      return;
    }
    setError("");
    setStage("collecting");
    setProfiles((current) => current.map((profile, index) => ({
      ...profile,
      username: normalized[index],
      posts: [],
      selectedKeys: [],
      analysis: null,
      status: "queued",
      statusText: "Queued",
      error: ""
    })));
    let completed = 0;
    const failedProfiles = [];
    for (let index = 0; index < profiles.length; index += 1) {
      const profile = { ...profiles[index], username: normalized[index] };
      if (await collectOneProfile(profile, index, profiles.length)) completed += 1;
      else failedProfiles.push({ profile, index });
    }
    if (failedProfiles.length > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, 3500));
      for (const { profile, index } of failedProfiles) {
        updateProfile(profile.id, { status: "queued", statusText: "Automatic retry", error: "" });
        if (await collectOneProfile(profile, index, profiles.length)) completed += 1;
      }
    }
    setStage("select");
    if (completed < 2) setError("At least two profiles must load before a benchmark can be built.");
    else if (completed < profiles.length) setError("Some profiles could not load. Retry those profiles below.");
  };

  const retryProfile = async (profile) => {
    setError("");
    await collectOneProfile(profile, profiles.findIndex((item) => item.id === profile.id), profiles.length);
  };

  const togglePost = (profileId, post) => {
    const key = canonicalPostKey(post.post_url);
    const target = profiles.find((profile) => profile.id === profileId);
    setError("");
    if (target && !target.selectedKeys.includes(key) && target.selectedKeys.length >= MAX_SELECTED_POSTS) {
      setError(`Select up to ${MAX_SELECTED_POSTS} posts per profile.`);
      return;
    }
    setProfiles((current) => current.map((profile) => {
      if (profile.id !== profileId) return profile;
      if (profile.selectedKeys.includes(key)) {
        return { ...profile, selectedKeys: profile.selectedKeys.filter((item) => item !== key) };
      }
      return { ...profile, selectedKeys: [...profile.selectedKeys, key] };
    }));
  };

  const buildReport = () => {
    const businessType = businessContext.business_type.trim();
    const goal = businessContext.goal === "Other business goal"
      ? businessContext.custom_goal.trim()
      : businessContext.goal.trim();
    if (!businessType || !goal) {
      setError("Business type and main goal are required.");
      return;
    }
    const nextReport = buildComparisonReport({
      profiles: loadedProfiles,
      excludedProfiles: profiles.filter((profile) => profile.posts.length === 0),
      businessContext: { ...businessContext, business_type: businessType, goal },
      selectionMode
    });
    setReport(nextReport);
    setAdvisorPlan(null);
    setAdvisorAnswers([]);
    setAdvisorQuestion("");
    setAdvisorError("");
    setAdvisorStatus("idle");
    setQuestionStatus("idle");
    setStage("report");
    setError("");
  };

  const resetComparison = () => {
    setProfiles((current) => current.map((profile) => ({
      ...profile,
      posts: [],
      selectedKeys: [],
      analysis: null,
      status: "idle",
      statusText: "",
      error: ""
    })));
    setReport(null);
    setAdvisorPlan(null);
    setAdvisorAnswers([]);
    setAdvisorQuestion("");
    setAdvisorError("");
    setAdvisorStatus("idle");
    setQuestionStatus("idle");
    setStage("setup");
    setError("");
  };

  const downloadReport = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `competitor-benchmark-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const requestAdvisor = async (payload) => {
    const response = await fetch("/api/instagram/growth-advisor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const failure = new Error(data.error || "AI advice could not be generated.");
      failure.code = data.code;
      throw failure;
    }
    return data.result;
  };

  const generateGrowthPlan = async () => {
    setAdvisorStatus("loading");
    setAdvisorError("");
    try {
      const result = await requestAdvisor({ operation: "plan", report });
      setAdvisorPlan(result);
      setAdvisorConfigured(true);
      setAdvisorStatus("ready");
    } catch (cause) {
      if (cause.code === "AI_NOT_CONFIGURED") setAdvisorConfigured(false);
      setAdvisorError(cause.message);
      setAdvisorStatus("error");
    }
  };

  const askAdvisor = async (event) => {
    event.preventDefault();
    const question = advisorQuestion.trim();
    if (!question || questionStatus === "loading") return;
    setQuestionStatus("loading");
    setAdvisorError("");
    try {
      const result = await requestAdvisor({
        operation: "question",
        report,
        question,
        history: advisorAnswers.map((item) => ({ question: item.question, answer: item.result.answer }))
      });
      setAdvisorAnswers((current) => [...current, { question, result }]);
      setAdvisorQuestion("");
      setQuestionStatus("idle");
    } catch (cause) {
      setAdvisorError(cause.message);
      setQuestionStatus("error");
    }
  };

  if (stage === "report" && report) {
    const leaderRows = [
      ["Average views", report.benchmark.leaders.views],
      ["Average likes", report.benchmark.leaders.likes],
      ["Average comments", report.benchmark.leaders.comments_count]
    ];
    return (
      <section className="comparison-workspace comparison-report">
        <header className="comparison-header">
          <div>
            <p className="eyebrow">Competitor benchmark</p>
            <h2>{report.business_context.business_name || "Profile comparison"}</h2>
            <span>{new Date(report.captured_at).toLocaleString()}</span>
          </div>
          <div className="comparison-actions">
            <button type="button" onClick={() => setStage("select")}>
              <ArrowLeft size={17} aria-hidden="true" /> Edit selection
            </button>
            <button type="button" onClick={downloadReport}>
              <Download size={17} aria-hidden="true" /> JSON
            </button>
            <button type="button" className="primary-button" onClick={resetComparison}>New comparison</button>
          </div>
        </header>

        {report.excluded_profiles.length > 0 && (
          <div className="benchmark-warning">
            {report.excluded_profiles.length} profile{report.excluded_profiles.length === 1 ? " was" : "s were"} excluded because public data could not be collected.
          </div>
        )}

        <div className="benchmark-stats">
          <div><span>Profiles</span><strong>{report.benchmark.profiles_compared}</strong></div>
          <div><span>Selected posts</span><strong>{report.benchmark.posts_selected}</strong></div>
          <div><span>Source</span><strong>{report.selection_mode === "most_viewed" ? "Most viewed" : "Recent"}</strong></div>
          <div><span>Business context</span><strong>{report.advisor_context_ready ? "Complete" : "Partial"}</strong></div>
        </div>

        <section className="benchmark-section">
          <h3>Performance leaders</h3>
          <div className="benchmark-leaders">
            {leaderRows.map(([label, leader]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{leader ? `@${leader.username}` : "N/A"}</strong>
                <small>{leader ? formatAverage(leader.average) : "Public value unavailable"}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="benchmark-section">
          <h3>Selected evidence</h3>
          <div className="benchmark-profile-grid">
            {report.profiles.map((profile) => (
              <section className="benchmark-profile" key={profile.id}>
                <header>
                  <div>
                    <strong>@{profile.username}</strong>
                    <span>{profile.role === "own" ? "My business" : "Competitor"}</span>
                  </div>
                  <span>{profile.followers.display || formatAverage(profile.followers.value)} followers</span>
                </header>
                <div className="benchmark-averages">
                  <span>Views <strong>{formatAverage(profile.averages.views)}</strong></span>
                  <span>Likes <strong>{formatAverage(profile.averages.likes)}</strong></span>
                  <span>Comments <strong>{formatAverage(profile.averages.comments_count)}</strong></span>
                </div>
                {profile.selected_posts.map((post) => (
                  <article className="evidence-post" key={post.key}>
                    <EvidenceThumbnail post={post} />
                    <div>
                      <strong>{post.format}</strong>
                      <div className="evidence-metrics">
                        <span>{post.views.display || formatAverage(post.views.value)} views</span>
                        <span>{post.likes.display || formatAverage(post.likes.value)} likes</span>
                        <span>{post.comments.display || formatAverage(post.comments.value)} comments</span>
                      </div>
                      {post.hashtags.length > 0 && <p>{post.hashtags.join(" ")}</p>}
                      {post.top_comments.length > 0 && (
                        <div className="evidence-comments">
                          {post.top_comments.map((comment, index) => (
                            <span key={`${comment.username}-${index}`}>
                              <strong>{comment.username ? `@${comment.username}` : "Comment"}</strong> {comment.text}
                            </span>
                          ))}
                        </div>
                      )}
                      <a href={post.post_url} target="_blank" rel="external noopener noreferrer">Open post</a>
                    </div>
                  </article>
                ))}
              </section>
            ))}
          </div>
        </section>

        <section className="benchmark-section benchmark-context">
          <div>
            <h3>Business context</h3>
            <p>{report.business_context.business_type || "Business type not provided"}</p>
            <span>{report.business_context.location || "Location not provided"}</span>
          </div>
          <dl>
            <div><dt>Target customer</dt><dd>{report.business_context.target_customer || "Not provided"}</dd></div>
            <div><dt>Offers</dt><dd>{report.business_context.offers || "Not provided"}</dd></div>
            <div><dt>Current challenge</dt><dd>{report.business_context.current_challenge || "Not provided"}</dd></div>
            <div><dt>Goal</dt><dd>{report.business_context.goal || "Not provided"}</dd></div>
          </dl>
        </section>

        {(report.benchmark.shared_hashtags.length > 0 || Object.keys(report.benchmark.format_counts).length > 0) && (
          <section className="benchmark-section benchmark-patterns">
            <h3>Observed patterns</h3>
            <div>
              {Object.entries(report.benchmark.format_counts).map(([format, count]) => (
                <span key={format}>{format}: {count}</span>
              ))}
              {report.benchmark.shared_hashtags.map((hashtag) => (
                <span key={hashtag.label}>{hashtag.label}: {hashtag.profile_count} profiles</span>
              ))}
            </div>
          </section>
        )}

        <section className="benchmark-section growth-advisor">
          <header className="growth-advisor-header">
            <div>
              <p className="eyebrow">AI growth advisor</p>
              <h3>Turn this benchmark into business actions</h3>
              <span>Evidence-backed ideas for sales, customers, offers, operations, and content.</span>
            </div>
            <button
              type="button"
              className="primary-button"
              onClick={generateGrowthPlan}
              disabled={advisorStatus === "loading" || advisorConfigured === false}
            >
              <Sparkles size={17} aria-hidden="true" />
              {advisorStatus === "loading" ? "Creating plan..." : advisorPlan ? "Refresh plan" : "Generate growth plan"}
            </button>
          </header>

          {advisorConfigured === false && (
            <div className="advisor-setup-note">
              AI setup is required. Add <strong>GEMINI_API_KEY</strong> to the server environment, then reload this page.
            </div>
          )}
          {advisorError && <div className="error-box advisor-error">{advisorError}</div>}
          {advisorStatus === "loading" && (
            <div className="advisor-loading"><div className="loader-ring" /><span>Reviewing the selected evidence...</span></div>
          )}

          {advisorPlan && (
            <div className="advisor-result">
              <section className="advisor-summary">
                <span>Growth summary</span>
                <p>{advisorPlan.executive_summary}</p>
              </section>

              {advisorPlan.verified_findings.length > 0 && (
                <section className="advisor-block">
                  <h4>Verified findings</h4>
                  <div className="advisor-row-list">
                    {advisorPlan.verified_findings.map((item, index) => (
                      <article key={`${item.finding}-${index}`}>
                        <strong>{item.finding}</strong>
                        <div className="advisor-evidence-links">
                          {item.evidence_urls.map((url, urlIndex) => (
                            <a key={url} href={url} target="_blank" rel="external noopener noreferrer">Evidence {urlIndex + 1}</a>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )}

              <section className="advisor-block">
                <h4>Business opportunities</h4>
                <div className="advisor-opportunity-grid">
                  {advisorPlan.business_opportunities.map((item, index) => (
                    <article key={`${item.title}-${index}`}>
                      <header><strong>{item.title}</strong><span>{item.confidence} confidence</span></header>
                      <p>{item.why}</p>
                      <div><span>First step</span><strong>{item.first_step}</strong></div>
                    </article>
                  ))}
                </div>
              </section>

              <section className="advisor-plan-grid">
                <div className="advisor-block">
                  <h4>Next 7 days</h4>
                  <ol>
                    {advisorPlan.seven_day_plan.map((item, index) => (
                      <li key={`${item.day}-${index}`}><strong>{item.day}: {item.action}</strong><span>{item.reason}</span></li>
                    ))}
                  </ol>
                </div>
                <div className="advisor-block">
                  <h4>Next 30 days</h4>
                  <ol>
                    {advisorPlan.thirty_day_plan.map((item, index) => (
                      <li key={`${item.week}-${index}`}><strong>{item.week}: {item.action}</strong><span>Success signal: {item.success_signal}</span></li>
                    ))}
                  </ol>
                </div>
              </section>

              {(advisorPlan.assumptions.length > 0 || advisorPlan.questions_to_validate.length > 0) && (
                <section className="advisor-caveats">
                  {advisorPlan.assumptions.length > 0 && <p><strong>Assumptions:</strong> {advisorPlan.assumptions.join(" ")}</p>}
                  {advisorPlan.questions_to_validate.length > 0 && <p><strong>Useful details to confirm:</strong> {advisorPlan.questions_to_validate.join(" ")}</p>}
                </section>
              )}

              <section className="advisor-questions">
                <h4>Ask about your business</h4>
                {advisorAnswers.map((item, index) => (
                  <article key={`${item.question}-${index}`}>
                    <strong>{item.question}</strong>
                    <p>{item.result.answer}</p>
                    {item.result.next_actions.length > 0 && <span>Next: {item.result.next_actions.join(" ")}</span>}
                  </article>
                ))}
                <form onSubmit={askAdvisor}>
                  <input
                    aria-label="Question for AI growth advisor"
                    placeholder="Ask about pricing, customers, offers, retention..."
                    value={advisorQuestion}
                    onChange={(event) => setAdvisorQuestion(event.target.value)}
                    maxLength={600}
                  />
                  <button type="submit" title="Ask advisor" aria-label="Ask advisor" disabled={!advisorQuestion.trim() || questionStatus === "loading"}>
                    <Send size={18} aria-hidden="true" />
                  </button>
                </form>
              </section>
            </div>
          )}
        </section>
      </section>
    );
  }

  if (stage === "context") {
    return (
      <section className="comparison-workspace comparison-context-form">
        <header className="comparison-header">
          <div>
            <p className="eyebrow">Business context</p>
            <h2>Prepare the benchmark</h2>
          </div>
          <button type="button" onClick={() => setStage("select")}>
            <ArrowLeft size={17} aria-hidden="true" /> Back
          </button>
        </header>
        {error && <div className="error-box">{error}</div>}
        <div className="business-context-grid">
          <div>
            <label htmlFor="business-type">Business type</label>
            <input id="business-type" required placeholder="Boutique, restaurant, service..." value={businessContext.business_type} onChange={(event) => setBusinessContext({ ...businessContext, business_type: event.target.value })} />
          </div>
          <div>
            <label htmlFor="business-goal">Main goal</label>
            <select id="business-goal" required value={businessContext.goal} onChange={(event) => setBusinessContext({ ...businessContext, goal: event.target.value })}>
              <option value="">Choose a goal</option>
              {GOAL_OPTIONS.map((goal) => <option key={goal} value={goal}>{goal}</option>)}
            </select>
          </div>
          {businessContext.goal === "Other business goal" && (
            <div className="is-wide">
              <label htmlFor="custom-business-goal">Your goal</label>
              <input id="custom-business-goal" required placeholder="What should improve?" value={businessContext.custom_goal} onChange={(event) => setBusinessContext({ ...businessContext, custom_goal: event.target.value })} />
            </div>
          )}
          <div className="is-wide">
            <label htmlFor="business-location">Location <span>Optional</span></label>
            <input id="business-location" placeholder="City or service area" value={businessContext.location} onChange={(event) => setBusinessContext({ ...businessContext, location: event.target.value })} />
          </div>
        </div>
        <details className="business-more-details">
          <summary>More details <span>Optional, but improves the AI advice</span></summary>
          <div className="business-context-grid">
            <div><label htmlFor="business-name">Business name</label><input id="business-name" value={businessContext.business_name} onChange={(event) => setBusinessContext({ ...businessContext, business_name: event.target.value })} /></div>
            <div><label htmlFor="target-customer">Target customer</label><input id="target-customer" value={businessContext.target_customer} onChange={(event) => setBusinessContext({ ...businessContext, target_customer: event.target.value })} /></div>
            <div className="is-wide"><label htmlFor="business-offers">Products or offers</label><textarea id="business-offers" value={businessContext.offers} onChange={(event) => setBusinessContext({ ...businessContext, offers: event.target.value })} /></div>
            <div className="is-wide"><label htmlFor="business-challenge">Current challenge</label><textarea id="business-challenge" value={businessContext.current_challenge} onChange={(event) => setBusinessContext({ ...businessContext, current_challenge: event.target.value })} /></div>
          </div>
        </details>
        <div className="comparison-footer">
          <span>{loadedProfiles.reduce((sum, profile) => sum + profile.selectedKeys.length, 0)} posts selected</span>
          <button type="button" className="primary-button" onClick={buildReport}>Build benchmark</button>
        </div>
      </section>
    );
  }

  if (stage === "select" || stage === "collecting") {
    return (
      <section className="comparison-workspace">
        <header className="comparison-header">
          <div>
            <p className="eyebrow">Compare profiles</p>
            <h2>{stage === "collecting" ? "Collecting profile posts" : "Select benchmark posts"}</h2>
          </div>
          {stage !== "collecting" && <button type="button" onClick={resetComparison}><ArrowLeft size={17} aria-hidden="true" /> Profiles</button>}
        </header>
        {error && <div className="error-box">{error}</div>}
        <div className="compare-profile-grid" style={{ "--profile-count": profiles.length }}>
          {profiles.map((profile) => {
            const posts = pinSelectedPosts(profile.posts, profile.selectedKeys);
            return (
              <section className="compare-profile-column" key={profile.id}>
                <header>
                  <div>
                    <strong>@{profile.username || normalizeProfileInput(profile.value) || "profile"}</strong>
                    <span>{profile.role === "own" ? "My business" : "Competitor"}</span>
                  </div>
                  <span>{profile.selectedKeys.length}/{MAX_SELECTED_POSTS} selected</span>
                </header>
                {profile.status === "working" || profile.status === "queued" ? (
                  <div className="compare-profile-status"><div className="loader-ring" /><span>{profile.statusText}</span></div>
                ) : profile.status === "failed" ? (
                  <div className="compare-profile-status is-failed">
                    <span>{profile.error}</span>
                    <button type="button" onClick={() => retryProfile(profile)}><RefreshCw size={16} aria-hidden="true" /> Retry</button>
                  </div>
                ) : (
                  <div className="compare-post-list">
                    {posts.map((post) => {
                      const selected = profile.selectedKeys.includes(canonicalPostKey(post.post_url));
                      return <ProfilePost key={canonicalPostKey(post.post_url)} post={post} selected={selected} onToggle={() => togglePost(profile.id, post)} />;
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
        {stage !== "collecting" && (
          <div className="comparison-footer">
            <span>Select 1 to {MAX_SELECTED_POSTS} posts from every loaded profile</span>
            <button type="button" className="primary-button" disabled={!allProfilesSelected} onClick={() => setStage("context")}>Continue</button>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="comparison-workspace comparison-setup">
      <header className="comparison-header">
        <div>
          <p className="eyebrow">Compare profiles</p>
          <h2>Competitor benchmark</h2>
        </div>
        <button type="button" onClick={addProfile} disabled={profiles.length >= MAX_PROFILES}>
          <Plus size={17} aria-hidden="true" /> Add profile
        </button>
      </header>

      <div className="comparison-profile-inputs">
        {profiles.map((profile, index) => (
          <div className="comparison-profile-row" key={profile.id}>
            <span>{index + 1}</span>
            <div className="prefixed-input">
              <span className="input-prefix" aria-hidden="true">@</span>
              <input
                aria-label={`Instagram profile ${index + 1}`}
                placeholder="username or profile URL"
                value={profile.value}
                onChange={(event) => updateProfile(profile.id, { value: event.target.value })}
              />
            </div>
            <label className="own-profile-toggle">
              <input type="checkbox" checked={profile.role === "own"} onChange={(event) => setOwnProfile(profile.id, event.target.checked)} />
              <span>My profile</span>
            </label>
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove profile ${index + 1}`}
              title="Remove profile"
              disabled={profiles.length <= 2}
              onClick={() => removeProfile(profile.id)}
            >
              <Trash2 size={17} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>

      <div className="comparison-controls">
        <fieldset>
          <legend>Posts to compare</legend>
          <div className="comparison-segments">
            <button type="button" className={selectionMode === "recent" ? "is-selected" : ""} onClick={() => setSelectionMode("recent")}>Recent</button>
            <button type="button" className={selectionMode === "views" ? "is-selected" : ""} onClick={() => setSelectionMode("views")}>Most viewed</button>
          </div>
        </fieldset>
        <div>
          <label htmlFor="comparison-count">Posts per profile</label>
          <input id="comparison-count" type="number" min="3" max="20" value={postCount} onChange={(event) => setPostCount(Math.min(20, Math.max(3, Number(event.target.value) || 3)))} />
        </div>
        <button type="button" className="primary-button" onClick={collectProfiles}>Collect posts</button>
      </div>
      {error && <div className="error-box">{error}</div>}
    </section>
  );
}
