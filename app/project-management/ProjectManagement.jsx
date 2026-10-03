"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, ExternalLink, FileText, Folder, FolderOpen, Menu, Pencil, RefreshCw, Search, X } from "lucide-react";

async function request(path, signal) {
  const response = await fetch(path, { signal, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) window.location.assign(`/?auth=login&next=${encodeURIComponent("/project-management")}`);
    if (data.code === "MFA_REQUIRED") window.location.assign(`/admin-mfa?next=${encodeURIComponent("/project-management")}`);
    throw new Error(data.error || "The request failed.");
  }
  return data;
}

function readLocation() {
  const url = new URL(window.location.href);
  return { path: url.searchParams.get("doc") || "", hash: decodeURIComponent(url.hash.slice(1)) };
}

function ancestorsOf(path) {
  const segments = path.split("/").slice(0, -1);
  return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
}

function displayName(name) {
  return name.replace(/\.(md|markdown|mdx)$/i, "");
}

/** Keeps files whose path matches the query, plus the folders that lead to them. */
function filterTree(nodes, query) {
  if (!query) return nodes;
  return nodes.flatMap((node) => {
    if (node.type === "file") return node.path.toLowerCase().includes(query) ? [node] : [];
    const children = filterTree(node.children, query);
    return children.length ? [{ ...node, children }] : [];
  });
}

function TreeNodes({ nodes, depth, expanded, filtering, selectedPath, onToggle, onSelect }) {
  return <ul className="pm-tree-list" role={depth === 0 ? "tree" : "group"}>
    {nodes.map((node) => {
      const indent = { paddingLeft: `${10 + depth * 14}px` };
      if (node.type === "file") {
        const active = node.path === selectedPath;
        return <li key={node.path} role="treeitem" aria-selected={active}>
          <a
            className={`pm-tree-item pm-tree-file${active ? " active" : ""}`}
            style={indent}
            href={`/project-management?doc=${encodeURIComponent(node.path)}`}
            title={node.path}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              onSelect(node.path);
            }}
          ><FileText size={15} aria-hidden="true" /><span>{displayName(node.name)}</span></a>
        </li>;
      }
      const open = filtering || expanded.has(node.path);
      return <li key={node.path} role="treeitem" aria-expanded={open}>
        <button type="button" className="pm-tree-item pm-tree-folder" style={indent} onClick={() => onToggle(node.path)} title={node.path}>
          <ChevronRight size={14} className={`pm-chevron${open ? " open" : ""}`} aria-hidden="true" />
          {open ? <FolderOpen size={15} aria-hidden="true" /> : <Folder size={15} aria-hidden="true" />}
          <span>{node.name}</span>
        </button>
        {open && <TreeNodes nodes={node.children} depth={depth + 1} expanded={expanded} filtering={filtering} selectedPath={selectedPath} onToggle={onToggle} onSelect={onSelect} />}
      </li>;
    })}
  </ul>;
}

function SetupNotice() {
  return <section className="pm-notice">
    <h2>Connect a GitHub repository</h2>
    <p>Project Management reads its folders and Markdown files directly from GitHub. Add these server environment variables, then reload this page.</p>
    <pre>{`PROJECT_MANAGEMENT_REPOSITORY=https://github.com/owner/repo
# Optional
PROJECT_MANAGEMENT_BRANCH=main
PROJECT_MANAGEMENT_ROOT=docs
PROJECT_MANAGEMENT_GITHUB_TOKEN=   # required for private repositories`}</pre>
  </section>;
}

export default function ProjectManagement({ principal }) {
  const [tree, setTree] = useState(null);
  const [treeError, setTreeError] = useState("");
  const [treeLoading, setTreeLoading] = useState(true);
  const [selected, setSelected] = useState({ path: "", hash: "" });
  const [expanded, setExpanded] = useState(() => new Set());
  const [documentState, setDocumentState] = useState({ status: "idle", document: null, error: "" });
  const [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const documentCache = useRef(new Map());
  const articleRef = useRef(null);

  const revealPath = useCallback((path) => {
    setExpanded((current) => {
      const next = new Set(current);
      ancestorsOf(path).forEach((folder) => next.add(folder));
      return next;
    });
  }, []);

  const navigate = useCallback((path, hash = "", { replace = false } = {}) => {
    const url = `/project-management?doc=${encodeURIComponent(path)}${hash ? `#${encodeURIComponent(hash)}` : ""}`;
    window.history[replace ? "replaceState" : "pushState"]({ path, hash }, "", url);
    setSelected({ path, hash });
    revealPath(path);
    setSidebarOpen(false);
  }, [revealPath]);

  const loadTree = useCallback(async (refresh = false) => {
    setTreeLoading(true);
    setTreeError("");
    try {
      const data = await request(`/api/project-management/tree${refresh ? "?refresh=1" : ""}`);
      setTree(data);
      if (data.configured) {
        const current = readLocation();
        if (current.path) { setSelected(current); revealPath(current.path); }
        else if (data.defaultPath) navigate(data.defaultPath, "", { replace: true });
      }
    } catch (error) {
      setTreeError(error.message);
    } finally {
      setTreeLoading(false);
    }
  }, [navigate, revealPath]);

  useEffect(() => { loadTree(); }, [loadTree]);

  useEffect(() => {
    const onPopState = () => {
      const current = readLocation();
      setSelected(current);
      if (current.path) revealPath(current.path);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [revealPath]);

  useEffect(() => {
    if (!tree?.configured || !selected.path) return undefined;
    const cached = documentCache.current.get(selected.path);
    if (cached) {
      setDocumentState({ status: "ready", document: cached, error: "" });
      return undefined;
    }
    const controller = new AbortController();
    setDocumentState((current) => ({ status: "loading", document: current.document, error: "" }));
    request(`/api/project-management/document?path=${encodeURIComponent(selected.path)}${refreshToken ? "&refresh=1" : ""}`, controller.signal)
      .then(({ document }) => {
        documentCache.current.set(document.path, document);
        setDocumentState({ status: "ready", document, error: "" });
      })
      .catch((error) => {
        if (error.name !== "AbortError") setDocumentState({ status: "error", document: null, error: error.message });
      });
    return () => controller.abort();
  }, [tree, selected.path, refreshToken]);

  useEffect(() => {
    const { document } = documentState;
    if (!document || document.path !== selected.path) return;
    window.document.title = `${displayName(document.name)} - Project Management`;
    const target = selected.hash && window.document.getElementById(`user-content-${selected.hash}`);
    if (target) target.scrollIntoView({ block: "start" });
    else articleRef.current?.closest(".pm-content")?.scrollTo({ top: 0 });
  }, [documentState, selected]);

  const refresh = () => {
    documentCache.current.clear();
    setRefreshToken((value) => value + 1);
    loadTree(true);
  };

  const toggleFolder = useCallback((path) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  const onArticleClick = (event) => {
    const link = event.target.closest("a");
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    if (link.dataset.docPath) {
      event.preventDefault();
      navigate(link.dataset.docPath, link.dataset.docHash || "");
      return;
    }
    const href = link.getAttribute("href") || "";
    if (href.startsWith("#") && href.length > 1) {
      event.preventDefault();
      const hash = decodeURIComponent(href.slice(1));
      window.document.getElementById(`user-content-${hash}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
      window.history.replaceState(window.history.state, "", `#${encodeURIComponent(hash)}`);
    }
  };

  const normalizedQuery = query.trim().toLowerCase();
  const visibleTree = useMemo(() => filterTree(tree?.tree || [], normalizedQuery), [tree, normalizedQuery]);
  const repository = tree?.repository;
  const { document, status: documentStatus, error: documentError } = documentState;
  const crumbs = selected.path
    ? selected.path.slice(repository?.root ? repository.root.length + 1 : 0).split("/")
    : [];

  return <main className={`pm-shell${sidebarOpen ? " sidebar-open" : ""}`}>
    <aside className="pm-sidebar" aria-label="Project documents">
      <div className="pm-sidebar-head">
        <a href="/admin-center" className="admin-brand"><span>AT</span>AgenticThat</a>
        <button type="button" className="pm-icon-button pm-close" onClick={() => setSidebarOpen(false)} aria-label="Close documents"><X size={18} /></button>
      </div>
      <nav className="pm-admin-nav">
        <a href="/admin-center">Admin Center</a>
        <a href="/project-management" className="active" aria-current="page">Project Management</a>
      </nav>
      {repository && <div className="pm-repo">
        <a href={repository.htmlUrl} target="_blank" rel="noopener noreferrer">{repository.owner}/{repository.repo}<ExternalLink size={12} aria-hidden="true" /></a>
        <small>{repository.branch}{repository.root ? ` · /${repository.root}` : ""} · {tree.documentCount} documents</small>
      </div>}
      {tree?.configured && <label className="pm-search">
        <Search size={14} aria-hidden="true" />
        <input type="search" placeholder="Filter documents" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Filter documents" />
      </label>}
      <div className="pm-tree">
        {treeLoading && !tree && <p className="pm-muted">Loading repository…</p>}
        {tree?.configured && visibleTree.length > 0 && <TreeNodes nodes={visibleTree} depth={0} expanded={expanded} filtering={Boolean(normalizedQuery)} selectedPath={selected.path} onToggle={toggleFolder} onSelect={(path) => navigate(path)} />}
        {tree?.configured && !visibleTree.length && <p className="pm-muted">{normalizedQuery ? "No documents match this filter." : "This repository has no Markdown files."}</p>}
        {tree?.truncated && <p className="pm-muted">GitHub truncated this repository listing; some folders may be missing.</p>}
      </div>
      <div className="admin-identity"><strong>{principal.name}</strong><small>{principal.email}</small></div>
    </aside>
    <div className="pm-scrim" onClick={() => setSidebarOpen(false)} aria-hidden="true" />

    <section className="pm-content">
      <header className="pm-toolbar">
        <button type="button" className="pm-icon-button pm-menu" onClick={() => setSidebarOpen(true)} aria-label="Open documents"><Menu size={18} /></button>
        <nav className="pm-breadcrumbs" aria-label="Document path">
          <span>{repository?.repo || "Project Management"}</span>
          {crumbs.map((crumb, index) => <span key={`${crumb}-${index}`}><ChevronRight size={13} aria-hidden="true" />{index === crumbs.length - 1 ? <strong>{crumb}</strong> : crumb}</span>)}
        </nav>
        <div className="pm-toolbar-actions">
          {document && <a className="pm-button" href={document.editUrl} target="_blank" rel="noopener noreferrer"><Pencil size={14} aria-hidden="true" />Edit</a>}
          {document && <a className="pm-button" href={document.htmlUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true" />GitHub</a>}
          {tree?.configured && <button type="button" className="pm-button" onClick={refresh} disabled={treeLoading}><RefreshCw size={14} className={treeLoading ? "pm-spin" : ""} aria-hidden="true" />Refresh</button>}
        </div>
      </header>

      <div className="pm-page">
        {treeError && <div className="pm-notice pm-error"><h2>Unable to load the repository</h2><p>{treeError}</p><button type="button" className="pm-button" onClick={() => loadTree(true)}>Try again</button></div>}
        {tree && !tree.configured && <SetupNotice />}
        {tree?.configured && !tree.documentCount && !treeError && <div className="pm-notice"><h2>No documents yet</h2><p>Add Markdown files to the repository and select Refresh.</p></div>}
        {documentStatus === "error" && <div className="pm-notice pm-error"><h2>Unable to open this document</h2><p>{documentError}</p></div>}
        {documentStatus === "loading" && !document && <div className="pm-skeleton" aria-label="Loading document"><span /><span /><span /><span /></div>}
        {document && documentStatus !== "error" && <article
          ref={articleRef}
          className={`pm-markdown${documentStatus === "loading" ? " is-loading" : ""}`}
          onClick={onArticleClick}
          dangerouslySetInnerHTML={{ __html: document.html }}
        />}
      </div>
    </section>
  </main>;
}
