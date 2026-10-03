const GITHUB_API = "https://api.github.com";
const MARKDOWN_EXTENSION = /\.(md|markdown|mdx)$/i;
const IMAGE_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
};
const MAX_ASSET_BYTES = 10 * 1024 * 1024;

export class ProjectRepositoryError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function cleanSegmentPath(value) {
  return String(value || "")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== ".")
    .join("/");
}

/**
 * Accepts `owner/repo`, `https://github.com/owner/repo(.git)`, or a GitHub
 * folder URL such as `https://github.com/owner/repo/tree/main/docs`.
 * PROJECT_MANAGEMENT_BRANCH and PROJECT_MANAGEMENT_ROOT override the values
 * read from a folder URL, which matters for branch names containing slashes.
 */
export function projectRepositoryConfig(environment = process.env) {
  const raw = String(environment.PROJECT_MANAGEMENT_REPOSITORY || "").trim();
  if (!raw) return null;

  let location = raw.replace(/^git@github\.com:/i, "").replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "");
  location = location.replace(/[?#].*$/, "").replace(/\/+$/, "");
  const [owner, repoWithSuffix, marker, urlBranch, ...urlRoot] = location.split("/");
  const repo = String(repoWithSuffix || "").replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9_.-]+$/.test(owner || "") || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new ProjectRepositoryError(500, "INVALID_REPOSITORY", "PROJECT_MANAGEMENT_REPOSITORY must look like owner/repo or a github.com repository URL.");
  }
  const fromFolderUrl = marker === "tree" || marker === "blob";

  return {
    owner,
    repo,
    branch: String(environment.PROJECT_MANAGEMENT_BRANCH || "").trim() || (fromFolderUrl ? urlBranch || "" : ""),
    root: cleanSegmentPath(environment.PROJECT_MANAGEMENT_ROOT || (fromFolderUrl ? urlRoot.join("/") : "")),
    token: String(environment.PROJECT_MANAGEMENT_GITHUB_TOKEN || environment.GITHUB_TOKEN || "").trim(),
    cacheSeconds: Math.max(0, Number(environment.PROJECT_MANAGEMENT_CACHE_SECONDS ?? 60) || 0),
  };
}

async function githubRequest(config, path, accept = "application/vnd.github+json") {
  let response;
  try {
    response = await fetch(`${GITHUB_API}${path}`, {
      headers: {
        Accept: accept,
        "User-Agent": "AgenticThat-Project-Management",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new ProjectRepositoryError(502, "GITHUB_UNREACHABLE", "GitHub could not be reached. Try again shortly.");
  }
  if (response.ok) return response;

  if (response.status === 404) {
    throw new ProjectRepositoryError(404, "NOT_FOUND", config.token
      ? "The repository, branch, or file was not found. Check the configured repository and that the token can read it."
      : "The repository, branch, or file was not found. Private repositories need PROJECT_MANAGEMENT_GITHUB_TOKEN.");
  }
  if (response.status === 401) {
    throw new ProjectRepositoryError(502, "GITHUB_UNAUTHORIZED", "GitHub rejected PROJECT_MANAGEMENT_GITHUB_TOKEN. Replace it with a valid read-only token.");
  }
  if (response.status === 403 || response.status === 429) {
    const limited = response.headers.get("x-ratelimit-remaining") === "0" || response.status === 429;
    throw new ProjectRepositoryError(503, limited ? "GITHUB_RATE_LIMITED" : "GITHUB_FORBIDDEN", limited
      ? "The GitHub API rate limit was reached. Set PROJECT_MANAGEMENT_GITHUB_TOKEN to raise the limit."
      : "GitHub denied access to this repository.");
  }
  throw new ProjectRepositoryError(502, "GITHUB_ERROR", `GitHub returned an unexpected ${response.status} response.`);
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function compareNodes(left, right) {
  if (left.type !== right.type) return left.type === "folder" ? -1 : 1;
  const leftReadme = /^readme\./i.test(left.name);
  const rightReadme = /^readme\./i.test(right.name);
  if (leftReadme !== rightReadme) return leftReadme ? -1 : 1;
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
}

/** Builds a nested folder tree containing only folders that lead to Markdown files. */
function buildMarkdownTree(markdownPaths, root) {
  const top = { children: new Map() };
  for (const path of markdownPaths) {
    const relative = root ? path.slice(root.length + 1) : path;
    const segments = relative.split("/");
    let parent = top;
    segments.forEach((name, index) => {
      const isFile = index === segments.length - 1;
      const nodePath = [root, ...segments.slice(0, index + 1)].filter(Boolean).join("/");
      if (isFile) {
        parent.children.set(`file:${name}`, { type: "file", name, path: nodePath });
        return;
      }
      if (!parent.children.has(`folder:${name}`)) {
        parent.children.set(`folder:${name}`, { type: "folder", name, path: nodePath, children: new Map() });
      }
      parent = parent.children.get(`folder:${name}`);
    });
  }
  const finalize = (node) => [...node.children.values()]
    .map((child) => (child.type === "folder" ? { ...child, children: finalize(child) } : child))
    .sort(compareNodes);
  return finalize(top);
}

const snapshotCache = new Map();

async function loadSnapshot(config, { refresh = false } = {}) {
  const key = `${config.owner}/${config.repo}#${config.branch}:${config.root}:${config.token ? "auth" : "anon"}`;
  const cached = snapshotCache.get(key);
  if (!refresh && cached && cached.expiresAt > Date.now()) return cached.snapshot;

  let branch = config.branch;
  if (!branch) {
    const repository = await (await githubRequest(config, `/repos/${config.owner}/${config.repo}`)).json();
    branch = String(repository.default_branch || "main");
  }
  const tree = await (await githubRequest(
    config,
    `/repos/${config.owner}/${config.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  )).json();

  const blobs = new Map();
  const folders = new Set();
  for (const entry of Array.isArray(tree.tree) ? tree.tree : []) {
    if (entry.type === "blob") blobs.set(entry.path, { size: Number(entry.size) || 0 });
    if (entry.type === "tree") folders.add(entry.path);
  }
  if (config.root && !folders.has(config.root)) {
    throw new ProjectRepositoryError(404, "ROOT_NOT_FOUND", `The folder "${config.root}" does not exist on branch ${branch}.`);
  }
  const markdownPaths = [...blobs.keys()]
    .filter((path) => MARKDOWN_EXTENSION.test(path))
    .filter((path) => !config.root || path.startsWith(`${config.root}/`));
  const nodes = buildMarkdownTree(markdownPaths, config.root);
  const rootReadme = markdownPaths.find((path) => /^readme\.(md|markdown|mdx)$/i.test(config.root ? path.slice(config.root.length + 1) : path));

  const snapshot = {
    repository: {
      owner: config.owner,
      repo: config.repo,
      branch,
      root: config.root,
      htmlUrl: `https://github.com/${config.owner}/${config.repo}/tree/${encodePath(branch)}${config.root ? `/${encodePath(config.root)}` : ""}`,
    },
    tree: nodes,
    documentCount: markdownPaths.length,
    truncated: Boolean(tree.truncated),
    defaultPath: rootReadme || markdownPaths.sort()[0] || null,
    markdown: new Set(markdownPaths),
    blobs,
    folders,
    loadedAt: new Date().toISOString(),
  };
  snapshotCache.set(key, { snapshot, expiresAt: Date.now() + config.cacheSeconds * 1000 });
  return snapshot;
}

function requireConfig() {
  const config = projectRepositoryConfig();
  if (!config) {
    throw new ProjectRepositoryError(503, "NOT_CONFIGURED", "No project repository is configured. Set PROJECT_MANAGEMENT_REPOSITORY.");
  }
  return config;
}

export async function getProjectTree({ refresh = false } = {}) {
  const config = projectRepositoryConfig();
  if (!config) return { configured: false };
  const snapshot = await loadSnapshot(config, { refresh });
  return {
    configured: true,
    repository: snapshot.repository,
    tree: snapshot.tree,
    documentCount: snapshot.documentCount,
    truncated: snapshot.truncated,
    defaultPath: snapshot.defaultPath,
    loadedAt: snapshot.loadedAt,
  };
}

/** Resolves a Markdown-relative reference against the document's folder. */
function resolveRepositoryPath(fromDocument, reference) {
  const base = reference.startsWith("/") ? [] : fromDocument.split("/").slice(0, -1);
  for (const segment of reference.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") base.pop();
    else base.push(segment);
  }
  return base.join("/");
}

function escapeAttribute(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function decodeAttribute(value) {
  return value.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
}

function isRelativeReference(value) {
  return value && !value.startsWith("#") && !/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith("//");
}

function splitReference(value) {
  const match = value.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
  let path = match?.[1] || "";
  try { path = decodeURIComponent(path); } catch { /* keep the literal path */ }
  return { path, hash: match?.[3] || "" };
}

/**
 * GitHub's rendered HTML is sanitized but keeps repository-relative links as
 * written. Markdown links become in-app navigation, images are proxied so
 * private repositories render, and every other relative link opens on GitHub.
 */
function rewriteRenderedHtml(html, documentPath, snapshot) {
  const { owner, repo, branch } = snapshot.repository;
  const githubBlob = (path) => `https://github.com/${owner}/${repo}/${snapshot.folders.has(path) ? "tree" : "blob"}/${encodePath(branch)}/${encodePath(path)}`;

  return html
    .replace(/<a\s[^>]*>/gi, (tag) => {
      const hrefMatch = tag.match(/\shref="([^"]*)"/i);
      if (!hrefMatch) return tag;
      const href = decodeAttribute(hrefMatch[1]);
      if (href.startsWith("#")) return tag;
      if (!isRelativeReference(href)) {
        return tag.replace(/>$/, ' target="_blank" rel="noopener noreferrer">');
      }
      const { path: reference, hash } = splitReference(href);
      const target = reference ? resolveRepositoryPath(documentPath, reference) : documentPath;
      if (snapshot.markdown.has(target)) {
        const internal = `/project-management?doc=${encodeURIComponent(target)}${hash}`;
        return tag.replace(hrefMatch[0], ` href="${escapeAttribute(internal)}" data-doc-path="${escapeAttribute(target)}" data-doc-hash="${escapeAttribute(hash.slice(1))}"`);
      }
      return tag.replace(hrefMatch[0], ` href="${escapeAttribute(githubBlob(target))}" target="_blank" rel="noopener noreferrer"`);
    })
    .replace(/<img\s[^>]*>/gi, (tag) => {
      const srcMatch = tag.match(/\ssrc="([^"]*)"/i);
      if (!srcMatch) return tag;
      const src = decodeAttribute(srcMatch[1]);
      if (!isRelativeReference(src)) return tag;
      const target = resolveRepositoryPath(documentPath, splitReference(src).path);
      const proxied = `/api/project-management/asset?path=${encodeURIComponent(target)}`;
      return tag.replace(srcMatch[0], ` src="${escapeAttribute(proxied)}" loading="lazy"`);
    });
}

function requireMarkdownPath(snapshot, path) {
  const normalized = cleanSegmentPath(path);
  if (!normalized || !snapshot.markdown.has(normalized)) {
    throw new ProjectRepositoryError(404, "DOCUMENT_NOT_FOUND", "That document is not part of the project repository.");
  }
  return normalized;
}

export async function getProjectDocument(path, { refresh = false } = {}) {
  const config = requireConfig();
  const snapshot = await loadSnapshot(config, { refresh });
  const documentPath = requireMarkdownPath(snapshot, path);
  const { owner, repo, branch } = snapshot.repository;
  const response = await githubRequest(
    config,
    `/repos/${owner}/${repo}/contents/${encodePath(documentPath)}?ref=${encodeURIComponent(branch)}`,
    "application/vnd.github.html+json",
  );
  const html = await response.text();
  return {
    path: documentPath,
    name: documentPath.split("/").pop(),
    html: rewriteRenderedHtml(html, documentPath, snapshot),
    htmlUrl: `https://github.com/${owner}/${repo}/blob/${encodePath(branch)}/${encodePath(documentPath)}`,
    editUrl: `https://github.com/${owner}/${repo}/edit/${encodePath(branch)}/${encodePath(documentPath)}`,
  };
}

/** Streams an image referenced by a document. Only files present in the repository tree are served. */
export async function getProjectAsset(path) {
  const config = requireConfig();
  const snapshot = await loadSnapshot(config);
  const assetPath = cleanSegmentPath(path);
  const blob = snapshot.blobs.get(assetPath);
  const contentType = IMAGE_TYPES[assetPath.split(".").pop()?.toLowerCase() || ""];
  if (!blob || !contentType) {
    throw new ProjectRepositoryError(404, "ASSET_NOT_FOUND", "That image is not part of the project repository.");
  }
  if (blob.size > MAX_ASSET_BYTES) {
    throw new ProjectRepositoryError(413, "ASSET_TOO_LARGE", "That image is too large to preview.");
  }
  const { owner, repo, branch } = snapshot.repository;
  const response = await githubRequest(
    config,
    `/repos/${owner}/${repo}/contents/${encodePath(assetPath)}?ref=${encodeURIComponent(branch)}`,
    "application/vnd.github.raw+json",
  );
  return { body: await response.arrayBuffer(), contentType };
}

export function projectRepositoryErrorResponse(error, fallbackMessage) {
  if (error instanceof ProjectRepositoryError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error(fallbackMessage, error);
  return Response.json({ error: fallbackMessage }, { status: 500 });
}
