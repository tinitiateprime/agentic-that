"use client";

import { useMemo, useState } from "react";
import { ACCESS_LEVELS, LIVE_ACCESS_CATALOG } from "@platform/access-catalog";

async function request(path, init) {
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The operation failed.");
  return data;
}

function GrantMatrix({ value, onChange, allowInherit = false }) {
  const map = new Map((value || []).map((grant) => [grant.resourceKey, grant.accessLevel]));
  const setLevel = (resourceKey, accessLevel) => {
    const next = new Map(map);
    if (allowInherit && accessLevel === "inherit") next.delete(resourceKey); else next.set(resourceKey, accessLevel);
    onChange([...next].map(([key, level]) => ({ resourceKey: key, accessLevel: level })));
  };
  return <div className="grant-matrix">{Object.entries(LIVE_ACCESS_CATALOG).map(([category, apps]) => <section key={category}>
    <div className="grant-row category-row"><strong>{category}</strong><select value={map.get(category) || (allowInherit ? "inherit" : "none")} onChange={(event) => setLevel(category, event.target.value)}>
      {allowInherit && <option value="inherit">Inherit roles</option>}{ACCESS_LEVELS.map((level) => <option value={level} key={level}>{level}</option>)}
    </select></div>
    {apps.map((app) => <div className="grant-row" key={app}><span>{app.split(".")[1]}</span><select value={map.get(app) || (allowInherit ? "inherit" : "none")} onChange={(event) => setLevel(app, event.target.value)}>
      {allowInherit && <option value="inherit">Inherit category</option>}{ACCESS_LEVELS.map((level) => <option value={level} key={level}>{level}</option>)}
    </select></div>)}
  </section>)}</div>;
}

function RoleEditor({ role, onSaved }) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState({
    name: role.name,
    description: role.description,
    isSelfSelectable: role.isSelfSelectable,
    grants: role.grants || []
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true); setError("");
    try {
      await request(`/api/admin-center/roles/${encodeURIComponent(role.id)}`, {
        method: "PATCH",
        body: JSON.stringify(draft)
      });
      await onSaved();
    } catch (saveError) { setError(saveError.message); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete the role “${role.name}”? Assigned users will lose this role.`)) return;
    setBusy(true); setError("");
    try {
      await request(`/api/admin-center/roles/${encodeURIComponent(role.id)}`, { method: "DELETE" });
      await onSaved();
    } catch (deleteError) { setError(deleteError.message); } finally { setBusy(false); }
  };
  return <article className="role-card">
    <button className="admin-user-summary" type="button" onClick={() => setExpanded(!expanded)}>
      <span><strong>{role.name}</strong><small>{role.description}</small></span>
      <small>{role.grants.length} configured grants{role.isSystem ? " · System role" : ""}</small>
    </button>
    {expanded && <div className="admin-user-editor">
      {role.isSystem ? <p>System roles are read-only.</p> : <>
        <label>Role name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Description<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
        <GrantMatrix value={draft.grants} onChange={(grants) => setDraft({ ...draft, grants })} />
        {error && <p className="admin-error">{error}</p>}
        <div className="admin-actions"><button disabled={busy} onClick={save}>Save role</button><button className="danger" disabled={busy} onClick={remove}>Delete role</button></div>
      </>}
    </div>}
  </article>;
}

function UserEditor({ user, roles, workspaces, onSaved }) {
  const [status, setStatus] = useState(user.status);
  const [workspaceId, setWorkspaceId] = useState(user.workspaceId || "");
  const [workspaceName, setWorkspaceName] = useState(user.workspaceId ? "" : user.requestedBusinessName || "");
  const [expanded, setExpanded] = useState(user.status === "pending");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (nextStatus = status, revokeSessions = false) => {
    setBusy(true); setError("");
    try {
      await request(`/api/admin-center/users/${encodeURIComponent(user.id)}`, { method: "PATCH", body: JSON.stringify({ status: nextStatus, workspaceId, workspaceName, revokeSessions }) });
      await onSaved();
    } catch (saveError) { setError(saveError.message); } finally { setBusy(false); }
  };
  return <article className={`admin-user-card status-${user.status}`}>
    <button className="admin-user-summary" type="button" onClick={() => setExpanded(!expanded)}><span className="admin-avatar">{String(user.name || user.email).charAt(0).toUpperCase()}</span><span><strong>{user.name}</strong><small>{user.email}</small></span><span className="status-pill">{user.status}</span><span className="workspace-label">{user.workspaceName || "Unassigned"}</span></button>
    {expanded && <div className="admin-user-editor"><div className="admin-field-grid">
      <label>Status<select value={status} disabled={user.isGlobalAdmin} onChange={(event) => setStatus(event.target.value)}>{["pending", "active", "suspended", "rejected"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Existing workspace<select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}><option value="">Create from name</option>{workspaces.map((workspace) => <option value={workspace.id} key={workspace.id}>{workspace.name}</option>)}</select></label>
      {!workspaceId && <label>New workspace<input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} /></label>}
    </div><h4>Plan-controlled role entitlements</h4><p><span className="status-pill">{user.billingStatus}</span>{user.trialStartsAt ? user.trialEndsAt && ` · Trial ends ${new Date(user.trialEndsAt).toLocaleString()}` : user.billingStatus === "trialing" ? " · Starts on first service use" : ""}</p><div className="role-checks">{(user.entitlements || []).map((entitlement) => <span key={`${entitlement.roleId}:${entitlement.source}`}><strong>{roles.find((role) => role.id === entitlement.roleId)?.name || entitlement.roleId}</strong> · {entitlement.source} · {entitlement.status}{entitlement.expiresAt ? ` · expires ${new Date(entitlement.expiresAt).toLocaleString()}` : ""}</span>)}</div><small>The Trial plan includes every service. Access and limits are shared by the workspace.</small>{error && <p className="admin-error">{error}</p>}<div className="admin-actions"><button disabled={busy} onClick={() => save(status)}>{busy ? "Saving…" : user.status === "pending" ? "Activate account" : "Save account"}</button>{user.status !== "pending" && <button disabled={busy} onClick={() => save(status, true)}>Revoke sessions</button>}{user.status === "pending" && <button className="danger" disabled={busy} onClick={() => save("rejected")}>Reject</button>}</div></div>}
  </article>;
}

export default function AdminCenter({ initialData, principal }) {
  const [data, setData] = useState(initialData);
  const [tab, setTab] = useState("users");
  const [roleDraft, setRoleDraft] = useState({ name: "", description: "", isSelfSelectable: false, grants: [] });
  const [roleError, setRoleError] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useMemo(() => data.users.filter((user) => user.status === "pending").length, [data.users]);
  const refresh = async () => setData(await request("/api/admin-center"));
  const createRole = async () => { setBusy(true); setRoleError(""); try { await request("/api/admin-center/roles", { method: "POST", body: JSON.stringify(roleDraft) }); setRoleDraft({ name: "", description: "", isSelfSelectable: false, grants: [] }); await refresh(); } catch (error) { setRoleError(error.message); } finally { setBusy(false); } };
  const createWorkspace = async () => { setBusy(true); setWorkspaceError(""); try { await request("/api/admin-center/workspaces", { method: "POST", body: JSON.stringify({ name: workspaceName }) }); setWorkspaceName(""); await refresh(); } catch (error) { setWorkspaceError(error.message); } finally { setBusy(false); } };
  const updateReview = async (id, status) => { await request(`/api/admin-center/identity-reviews/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status }) }); await refresh(); };
  const reviewCount = (data.identityReviews || []).filter((item) => item.status === "pending").length;
  return <main className="admin-center-shell"><aside className="admin-sidebar"><a href="/apps" className="admin-brand"><span>AT</span>AgenticThat</a><p>Global Admin Center</p>{[["users", `Users${pending ? ` (${pending})` : ""}`], ["roles", "Roles & permissions"], ["workspaces", "Workspaces"], ["reviews", `Identity reviews${reviewCount ? ` (${reviewCount})` : ""}`], ["audit", "Audit history"]].map(([id, label]) => <button className={tab === id ? "active" : ""} onClick={() => setTab(id)} key={id}>{label}</button>)}<div className="admin-identity"><strong>{principal.name}</strong><small>{principal.email}</small></div></aside>
    <section className="admin-main"><header><p>Centralized access control</p><h1>{tab === "roles" ? "Roles and permissions" : tab.charAt(0).toUpperCase() + tab.slice(1)}</h1></header>
      {tab === "users" && <div className="admin-list">{data.users.map((user) => <UserEditor user={user} roles={data.roles} workspaces={data.workspaces} onSaved={refresh} key={user.id} />)}</div>}
      {tab === "roles" && <div className="admin-role-layout"><section className="admin-panel"><h2>Create internal role</h2><label>Role name<input value={roleDraft.name} onChange={(event) => setRoleDraft({ ...roleDraft, name: event.target.value })} /></label><label>Description<textarea value={roleDraft.description} onChange={(event) => setRoleDraft({ ...roleDraft, description: event.target.value })} /></label><GrantMatrix value={roleDraft.grants} onChange={(grants) => setRoleDraft({ ...roleDraft, grants })} />{roleError && <p className="admin-error">{roleError}</p>}<button disabled={busy} onClick={createRole}>Create role</button></section><section className="admin-panel"><h2>Available roles</h2>{data.roles.map((role) => <RoleEditor role={role} onSaved={refresh} key={role.id} />)}</section></div>}
      {tab === "workspaces" && <><section className="admin-panel"><h2>Create workspace</h2><label>Workspace name<input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} /></label>{workspaceError && <p className="admin-error">{workspaceError}</p>}<button disabled={busy || !workspaceName.trim()} onClick={createWorkspace}>Create workspace</button></section><div className="workspace-grid">{data.workspaces.map((workspace) => <article className="admin-panel" key={workspace.id}><h2>{workspace.name}</h2><p>{workspace.id}</p><span className="status-pill">{workspace.status}</span></article>)}</div></>}
      {tab === "reviews" && <div className="admin-list">{(data.identityReviews || []).map((item) => <article className="admin-panel" key={item.id}><p>{item.product}</p><h2>{item.localActorId}</h2><span className="status-pill">{item.status}</span><p>{item.reason.replaceAll("_", " ")}</p>{item.localEmail && <small>{item.localEmail}</small>}<pre>{JSON.stringify(item.details, null, 2)}</pre>{item.status === "pending" && <div className="admin-actions"><button onClick={() => updateReview(item.id, "resolved")}>Mark resolved</button><button className="danger" onClick={() => updateReview(item.id, "dismissed")}>Dismiss</button></div>}</article>)}</div>}
      {tab === "audit" && <div className="admin-panel audit-table">{data.auditEvents.map((event) => <article key={event.id}><span>{new Date(event.createdAt).toLocaleString()}</span><strong>{event.action}</strong><span>{event.actorName}</span><code>{event.targetType}:{event.targetId || "-"}</code></article>)}</div>}
    </section></main>;
}
