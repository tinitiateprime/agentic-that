"use client";

import { useMemo, useState } from "react";

async function request(path, init) {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The team operation failed.");
  return data;
}

function RoleChecks({ roles, selected, onChange, disabled = false }) {
  const groups = useMemo(() => ({
    Workspace: roles.filter((role) => role.id === "role_workspace_owner"),
    Publishing: roles.filter((role) => role.id.startsWith("role_publishing_")),
    Scraping: roles.filter((role) => role.id.startsWith("role_scraping_")),
    Messaging: roles.filter((role) => role.id.startsWith("role_messaging_")),
  }), [roles]);
  const setRole = (roleId, checked) => onChange(checked ? [...new Set([...selected, roleId])] : selected.filter((id) => id !== roleId));
  return <div className="team-role-groups">{Object.entries(groups).map(([group, options]) => options.length ? <fieldset key={group}><legend>{group}</legend>{options.map((role) => <label key={role.id}><input type="checkbox" checked={selected.includes(role.id)} disabled={disabled} onChange={(event) => setRole(role.id, event.target.checked)} /><span><strong>{role.name}</strong><small>{role.description}</small></span></label>)}</fieldset> : null)}</div>;
}

function MemberCard({ member, roles, currentUserId, onSaved }) {
  const [roleIds, setRoleIds] = useState(member.roleIds);
  const [status, setStatus] = useState(member.status);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true); setError("");
    try {
      await request(`/api/workspace-team/members/${encodeURIComponent(member.id)}`, { method: "PATCH", body: JSON.stringify({ roleIds, status }) });
      await onSaved(); setOpen(false);
    } catch (saveError) { setError(saveError.message); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(`Remove ${member.name} from this workspace?`)) return;
    setBusy(true); setError("");
    try { await request(`/api/workspace-team/members/${encodeURIComponent(member.id)}`, { method: "DELETE" }); await onSaved(); }
    catch (removeError) { setError(removeError.message); } finally { setBusy(false); }
  };
  return <article className="team-card"><button className="team-card-summary" type="button" onClick={() => setOpen(!open)}><span className="team-avatar">{String(member.name || member.email).charAt(0).toUpperCase()}</span><span><strong>{member.name}</strong><small>{member.email}</small></span><span className={`team-status ${member.status}`}>{member.status}</span></button>{open && <div className="team-card-editor"><RoleChecks roles={roles} selected={roleIds} onChange={setRoleIds} /><label className="team-status-control">Member status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">Active</option><option value="suspended">Suspended</option></select></label>{error && <p className="team-error">{error}</p>}<div className="team-actions"><button disabled={busy || roleIds.length === 0} onClick={save}>{busy ? "Saving…" : "Save roles"}</button>{member.id !== currentUserId && <button className="danger" disabled={busy} onClick={remove}>Remove member</button>}</div></div>}</article>;
}

export default function WorkspaceTeam({ initialData, currentUserId }) {
  const [data, setData] = useState(initialData);
  const [email, setEmail] = useState("");
  const [roleIds, setRoleIds] = useState([]);
  const [inviteLink, setInviteLink] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = async () => setData(await request("/api/workspace-team"));
  const invite = async () => {
    setBusy(true); setError(""); setInviteLink("");
    try {
      const result = await request("/api/workspace-team", { method: "POST", body: JSON.stringify({ email, roleIds }) });
      setInviteLink(result.invitation.acceptUrl); setEmail(""); setRoleIds([]); await refresh();
    } catch (inviteError) { setError(inviteError.message); } finally { setBusy(false); }
  };
  const invitationAction = async (id, action) => {
    setError(""); setInviteLink("");
    try {
      const result = await request(`/api/workspace-team/invitations/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ action }) });
      if (result.invitation?.acceptUrl) setInviteLink(result.invitation.acceptUrl);
      await refresh();
    } catch (actionError) { setError(actionError.message); }
  };
  return <main className="team-shell"><header><p>Workspace administration</p><h1>Team and roles</h1><span>Invite employees into this workspace and assign only the access they need.</span></header><section className="team-layout"><div><section className="team-panel"><h2>Invite employee</h2><label>Work email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="employee@company.com" /></label><RoleChecks roles={data.roles} selected={roleIds} onChange={setRoleIds} />{error && <p className="team-error">{error}</p>}<button disabled={busy || !email.trim() || roleIds.length === 0} onClick={invite}>{busy ? "Creating invitation…" : "Create invitation"}</button>{inviteLink && <div className="invite-link"><strong>Secure invitation link</strong><input readOnly value={inviteLink} onFocus={(event) => event.target.select()} /><button onClick={() => navigator.clipboard.writeText(inviteLink)}>Copy link</button></div>}</section><section className="team-panel"><h2>Pending invitations</h2>{data.invitations.length ? data.invitations.map((invitation) => <article className="invite-row" key={invitation.id}><span><strong>{invitation.email}</strong><small>{invitation.status} · expires {new Date(invitation.expiresAt).toLocaleString()}</small></span>{invitation.status === "pending" && <span className="team-actions"><button onClick={() => invitationAction(invitation.id, "resend")}>Resend</button><button className="danger" onClick={() => invitationAction(invitation.id, "cancel")}>Cancel</button></span>}</article>) : <p>No invitations yet.</p>}</section></div><section><h2>Workspace members</h2><div className="team-members">{data.members.map((member) => <MemberCard member={member} roles={data.roles} currentUserId={currentUserId} onSaved={refresh} key={member.id} />)}</div></section></section></main>;
}
