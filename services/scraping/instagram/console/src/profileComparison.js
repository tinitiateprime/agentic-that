const METRICS = ["views", "likes", "comments_count"];

const finiteMetric = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

const postMetric = (post, metric) => {
  if (metric === "likes" && post.likes_hidden) return null;
  if (metric === "comments_count" && post.comments_hidden) return null;
  return finiteMetric(post[metric]);
};

const average = (values) => {
  const visible = values.filter((value) => value !== null);
  if (!visible.length) return null;
  return Math.round(visible.reduce((sum, value) => sum + value, 0) / visible.length);
};

const metricSnapshot = (post, metric) => {
  const displayKey = metric === "comments_count" ? "comments_display" : `${metric}_display`;
  const exactKey = metric === "comments_count" ? "comments_exact" : `${metric}_exact`;
  const hiddenKey = metric === "comments_count" ? "comments_hidden" : `${metric}_hidden`;
  return {
    value: postMetric(post, metric),
    display: post[hiddenKey] ? "Hidden" : post[displayKey] || null,
    exact: Boolean(post[exactKey]),
    hidden: Boolean(post[hiddenKey])
  };
};

export function normalizeProfileInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^(?:https?:\/\/|www\.|instagram\.com\/)/i.test(raw)) {
    try {
      const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
      if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return "";
      const match = url.pathname.match(/^\/([A-Za-z0-9._]+)\/?$/);
      return match ? match[1].toLowerCase() : "";
    } catch {
      return "";
    }
  }
  const username = raw.replace(/^@+/, "").replace(/\/+$/, "").trim();
  return /^[A-Za-z0-9._]+$/.test(username) ? username.toLowerCase() : "";
}

export function canonicalPostKey(value) {
  try {
    const url = new URL(String(value || ""), "https://www.instagram.com");
    const match = url.pathname.match(/^\/(p|reel)\/([^/]+)/i);
    return match ? `${match[1].toLowerCase()}:${match[2]}` : url.pathname;
  } catch {
    return String(value || "");
  }
}

export function postsFromComparisonJob(data, selectionMode, limit) {
  const analysis = data?.analysis || data?.run?.analysis || null;
  const source = selectionMode === "views"
    ? (analysis ? analysis.top_watched || [] : (data?.results || []).filter((post) => postMetric(post, "views") !== null))
    : data?.results || [];
  const seen = new Set();
  const posts = source.filter((post) => {
    const key = canonicalPostKey(post.post_url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  posts.sort((a, b) => selectionMode === "views"
    ? (postMetric(b, "views") ?? -1) - (postMetric(a, "views") ?? -1)
    : new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
  return posts.slice(0, Math.max(1, Number(limit) || 10));
}

export function pinSelectedPosts(posts, selectedKeys) {
  const order = new Map(selectedKeys.map((key, index) => [key, index]));
  return posts.slice().sort((a, b) => {
    const aOrder = order.get(canonicalPostKey(a.post_url));
    const bOrder = order.get(canonicalPostKey(b.post_url));
    if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder;
    if (aOrder !== undefined) return -1;
    if (bOrder !== undefined) return 1;
    return 0;
  });
}

export function extractHashtags(caption) {
  const unique = new Set();
  for (const match of String(caption || "").matchAll(/#([\p{L}\p{N}_]+)/gu)) {
    unique.add(`#${match[1].toLowerCase()}`);
  }
  return [...unique];
}

const selectedPostSnapshot = (post) => ({
  key: canonicalPostKey(post.post_url),
  post_url: post.post_url,
  profile_url: post.profile_url || null,
  username: post.username || null,
  format: /\/reel\//i.test(post.post_url || "") ? "Reel" : "Post",
  thumbnail_url: post.thumbnail_url || null,
  timestamp: post.timestamp || null,
  caption: post.caption || null,
  hashtags: extractHashtags(post.caption),
  views: metricSnapshot(post, "views"),
  likes: metricSnapshot(post, "likes"),
  comments: metricSnapshot(post, "comments_count"),
  top_comments: (post.top_comments || []).slice(0, 3).map((comment) => ({
    username: comment.username || null,
    text: comment.text || ""
  }))
});

const metricLeader = (profiles, metric) => profiles
  .filter((profile) => profile.averages[metric] !== null)
  .sort((a, b) => b.averages[metric] - a.averages[metric])[0] || null;

export function buildComparisonReport({ profiles, excludedProfiles = [], businessContext, selectionMode, capturedAt }) {
  const reportProfiles = profiles.map((profile) => {
    const selectedSet = new Set(profile.selectedKeys || []);
    const selectedPosts = pinSelectedPosts(profile.posts || [], profile.selectedKeys || [])
      .filter((post) => selectedSet.has(canonicalPostKey(post.post_url)))
      .map(selectedPostSnapshot);
    const analysis = profile.analysis || null;
    const firstPost = profile.posts?.[0] || null;
    const followerCount = finiteMetric(analysis?.follower_count ?? firstPost?.follower_count);
    const followerDisplay = analysis?.follower_count_display || firstPost?.follower_count_display || null;
    const averages = {
      views: average(selectedPosts.map((post) => post.views.value)),
      likes: average(selectedPosts.map((post) => post.likes.value)),
      comments_count: average(selectedPosts.map((post) => post.comments.value))
    };
    const engagementValues = selectedPosts
      .filter((post) => followerCount && post.likes.value !== null && post.comments.value !== null)
      .map((post) => ((post.likes.value + post.comments.value) / followerCount) * 100);
    return {
      id: profile.id,
      role: profile.role === "own" ? "own" : "competitor",
      username: analysis?.username || firstPost?.username || profile.username,
      display_name: analysis?.display_name || firstPost?.display_name || null,
      profile_url: analysis?.profile_url || firstPost?.profile_url || `https://www.instagram.com/${profile.username}/`,
      followers: { value: followerCount, display: followerDisplay },
      selected_posts: selectedPosts,
      averages,
      engagement_rate: engagementValues.length
        ? Math.round((engagementValues.reduce((sum, value) => sum + value, 0) / engagementValues.length) * 100) / 100
        : null
    };
  });

  const hashtagProfiles = new Map();
  for (const profile of reportProfiles) {
    const profileTags = new Set(profile.selected_posts.flatMap((post) => post.hashtags));
    for (const hashtag of profileTags) {
      hashtagProfiles.set(hashtag, (hashtagProfiles.get(hashtag) || 0) + 1);
    }
  }
  const sharedHashtags = [...hashtagProfiles.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([label, profile_count]) => ({ label, profile_count }));

  const leaders = {};
  for (const metric of METRICS) {
    const leader = metricLeader(reportProfiles, metric);
    leaders[metric] = leader ? {
      profile_id: leader.id,
      username: leader.username,
      average: leader.averages[metric]
    } : null;
  }

  const formatCounts = reportProfiles
    .flatMap((profile) => profile.selected_posts)
    .reduce((counts, post) => ({ ...counts, [post.format]: (counts[post.format] || 0) + 1 }), {});

  const context = {
    business_name: String(businessContext?.business_name || "").trim() || null,
    business_type: String(businessContext?.business_type || "").trim() || null,
    location: String(businessContext?.location || "").trim() || null,
    target_customer: String(businessContext?.target_customer || "").trim() || null,
    offers: String(businessContext?.offers || "").trim() || null,
    current_challenge: String(businessContext?.current_challenge || "").trim() || null,
    goal: String(businessContext?.goal || "").trim() || null
  };

  return {
    version: 1,
    title: "Competitor Benchmark",
    captured_at: capturedAt || new Date().toISOString(),
    selection_mode: selectionMode === "views" ? "most_viewed" : "recent",
    business_context: context,
    profiles: reportProfiles,
    excluded_profiles: excludedProfiles.map((profile) => ({
      username: normalizeProfileInput(profile.username || profile.value) || null,
      reason: String(profile.error || "Profile data was unavailable")
    })),
    benchmark: {
      profiles_compared: reportProfiles.length,
      posts_selected: reportProfiles.reduce((sum, profile) => sum + profile.selected_posts.length, 0),
      leaders,
      shared_hashtags: sharedHashtags,
      format_counts: formatCounts
    },
    evidence: reportProfiles.flatMap((profile) => profile.selected_posts.map((post) => post.post_url)),
    advisor_context_ready: Boolean(context.business_type && context.goal)
  };
}
