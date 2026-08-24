"use client";

import { ArrowRight, Check, ChevronDown, CircleHelp, Copy, Link2, ListChecks, Mail, ShieldCheck, UserRoundPlus, UsersRound, X } from "lucide-react";
import { useMemo, useState } from "react";

async function request(path, init) {
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers || {}) } });
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

  return (
    <div className="team-role-picker">
      <div className="team-role-picker-heading"><span><strong>Choose responsibilities</strong><small>Roles can be combined and changed later.</small></span><em>{selected.length} selected</em></div>
      <div className="team-role-groups">
        {Object.entries(groups).map(([group, options]) => options.length ? (
          <fieldset key={group}>
            <legend>{group}</legend>
            {options.map((role) => (
              <label className={selected.includes(role.id) ? "selected" : ""} key={role.id}>
                <input type="checkbox" checked={selected.includes(role.id)} disabled={disabled} onChange={(event) => setRole(role.id, event.target.checked)} />
                <i>{selected.includes(role.id) && <Check size={12} />}</i>
                <span><strong>{role.name}</strong><small>{role.description}</small></span>
              </label>
            ))}
          </fieldset>
        ) : null)}
      </div>
    </div>
  );
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

  return (
    <article className={`team-card ${open ? "open" : ""}`}>
      <button className="team-card-summary" type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="team-avatar">{String(member.name || member.email).charAt(0).toUpperCase()}</span>
        <span><strong>{member.name}</strong><small>{member.email} · {member.roleIds.length} {member.roleIds.length === 1 ? "role" : "roles"}</small></span>
        <span className={`team-status ${member.status}`}>{member.status}</span><ChevronDown size={16} />
      </button>
      {open && <div className="team-card-editor"><RoleChecks roles={roles} selected={roleIds} onChange={setRoleIds} /><label className="team-status-control"><span>Member status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">Active</option><option value="suspended">Suspended</option></select></label>{error && <p className="team-error">{error}</p>}<div className="team-actions"><button disabled={busy || roleIds.length === 0} onClick={save}>{busy ? "Saving…" : "Save roles"}</button>{member.id !== currentUserId && <button className="danger" disabled={busy} onClick={remove}>Remove member</button>}</div></div>}
    </article>
  );
}

export default function WorkspaceTeam({ initialData, currentUserId }) {
  const [data, setData] = useState(initialData);
  const [email, setEmail] = useState("");
  const [roleIds, setRoleIds] = useState([]);
  const [inviteLink, setInviteLink] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [guideOpen, setGuideOpen] = useState(initialData.members.length <= 1 && initialData.invitations.length === 0);
  const refresh = async () => setData(await request("/api/workspace-team"));

  const invite = async () => {
    setBusy(true); setError(""); setInviteLink(""); setCopied(false);
    try {
      const result = await request("/api/workspace-team", { method: "POST", body: JSON.stringify({ email, roleIds }) });
      setInviteLink(result.invitation.acceptUrl); setEmail(""); setRoleIds([]); setGuideOpen(false); await refresh();
    } catch (inviteError) { setError(inviteError.message); } finally { setBusy(false); }
  };

  const invitationAction = async (id, action) => {
    setError(""); setInviteLink(""); setCopied(false);
    try {
      const result = await request(`/api/workspace-team/invitations/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ action }) });
      if (result.invitation?.acceptUrl) setInviteLink(result.invitation.acceptUrl);
      await refresh();
    } catch (actionError) { setError(actionError.message); }
  };

  const copyInvitation = async () => { await navigator.clipboard.writeText(inviteLink); setCopied(true); };

  return (
    <main className="team-shell">
      <header className="team-header"><div><p>Workspace administration</p><h1>Team and roles</h1><span>Invite teammates and give each person only the access they need.</span></div>{!guideOpen && <button className="team-guide-toggle" type="button" onClick={() => setGuideOpen(true)}><CircleHelp size={16} />How roles work</button>}</header>

      {guideOpen && (
        <section className="team-guide" aria-labelledby="team-guide-title">
          <div className="team-guide-heading">
            <span><ShieldCheck size={21} /></span>
            <div><p>Quick guide</p><h2 id="team-guide-title">Add people by responsibility</h2></div>
            <button type="button" onClick={() => setGuideOpen(false)} aria-label="Close guide"><X size={18} /></button>
          </div>
          <ol>
            <li><span><Mail size={21} strokeWidth={1.9} /></span><div><strong>Enter their work email</strong><small>We create a private invitation for this workspace.</small></div></li>
            <li><span><ListChecks size={21} strokeWidth={1.9} /></span><div><strong>Choose what they do</strong><small>Combine roles when one person has more than one responsibility.</small></div></li>
            <li><span><Link2 size={21} strokeWidth={1.9} /></span><div><strong>Share the secure link</strong><small>They create their password and join your existing workspace.</small></div></li>
          </ol>
          <footer><Check size={15} />You can change roles or suspend access at any time.</footer>
        </section>
      )}

      <section className="team-layout">
        <div>
          <section className="team-panel team-invite-panel">
            <div className="team-panel-heading"><span><UserRoundPlus size={18} /></span><div><p>New teammate</p><h2>Invite employee</h2></div></div>
            <label className="team-field"><span>Work email</span><div><Mail size={16} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="employee@company.com" /></div></label>
            <RoleChecks roles={data.roles} selected={roleIds} onChange={setRoleIds} />
            {error && <p className="team-error">{error}</p>}
            <button className="team-primary" disabled={busy || !email.trim() || roleIds.length === 0} onClick={invite}>{busy ? "Creating invitation…" : <>Create invitation<ArrowRight size={15} /></>}</button>
            {inviteLink && <div className="invite-link"><span><strong>Invitation ready</strong><small>Copy and send this secure link to the employee.</small></span><div><input readOnly value={inviteLink} onFocus={(event) => event.target.select()} /><button onClick={copyInvitation}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy link"}</button></div></div>}
          </section>
          <section className="team-panel team-invitations-panel"><div className="team-panel-heading compact"><span><Mail size={17} /></span><div><h2>Pending invitations</h2><p>{data.invitations.length} total</p></div></div>{data.invitations.length ? data.invitations.map((invitation) => <article className="invite-row" key={invitation.id}><span><strong>{invitation.email}</strong><small>{invitation.status} · expires {new Date(invitation.expiresAt).toLocaleString()}</small></span>{invitation.status === "pending" && <span className="team-actions"><button onClick={() => invitationAction(invitation.id, "resend")}>Resend</button><button className="danger" onClick={() => invitationAction(invitation.id, "cancel")}>Cancel</button></span>}</article>) : <div className="team-empty"><Mail size={19} /><span><strong>No pending invitations</strong><small>New invitation links will appear here.</small></span></div>}</section>
        </div>
        <section className="team-members-section"><div className="team-section-heading"><span><UsersRound size={18} /></span><div><h2>Workspace members</h2><p>{data.members.length} {data.members.length === 1 ? "person" : "people"} in this workspace</p></div></div><div className="team-members">{data.members.map((member) => <MemberCard member={member} roles={data.roles} currentUserId={currentUserId} onSaved={refresh} key={member.id} />)}</div></section>
      </section>
    </main>
  );
}
