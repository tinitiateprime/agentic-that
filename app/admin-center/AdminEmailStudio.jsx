"use client";

import {
  Archive,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  CopyPlus,
  FileText,
  History,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  UsersRound,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const EMPTY_TEMPLATE = {
  name: "",
  description: "",
  status: "draft",
  subject: "{{inviter_name}} invited you to {{workspace_name}}",
  preheader: "Your secure invitation to join {{workspace_name}} is ready.",
  eyebrow: "Workspace invitation",
  heading: "You’re invited to {{workspace_name}}",
  body: "Hi {{recipient_name}},\n\n{{inviter_name}} invited you to join {{workspace_name}}. Your assigned access is: {{role_names}}.",
  buttonLabel: "Accept invitation",
  footer: "If you were not expecting this invitation, you can safely ignore this email. No account will be created unless you accept.",
};

const SAMPLE_VALUES = {
  recipient_name: "Alex Morgan",
  recipient_email: "alex@example.com",
  workspace_name: "Northstar Workspace",
  role_names: "Content Manager, Publishing Viewer",
  inviter_name: "AgenticThat Admin",
  invitation_url: "https://agenticthat.com/join-workspace",
  expires_in: "7 days",
};

async function request(path, init) {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The operation failed.");
  return data;
}

function sample(value) {
  return String(value || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => SAMPLE_VALUES[key.toLowerCase()] || match);
}

function timeLabel(value) {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function validEmail(value) {
  const email = String(value || "").trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function invitationRole(role) {
  return role.id === "role_workspace_owner"
    || role.id.startsWith("role_publishing_")
    || role.id.startsWith("role_scraping_")
    || role.id.startsWith("role_messaging_");
}

function EmailPreview({ template, compact = false }) {
  const body = sample(template.body).split(/\n{2,}/).filter(Boolean);
  return (
    <div className={`studio-preview-shell${compact ? " compact" : ""}`}>
      <div className="studio-preview-topbar"><span /><span /><span /><small>Live preview</small></div>
      <div className="studio-preview-subject"><small>Subject</small><strong>{sample(template.subject) || "Your subject appears here"}</strong></div>
      <div className="studio-email-canvas">
        <div className="studio-email-brand"><span>AT</span><strong>AgenticThat</strong><small>Secure account email</small></div>
        <div className="studio-email-content">
          <em>{sample(template.eyebrow) || "Workspace invitation"}</em>
          <h3>{sample(template.heading) || "Your invitation heading"}</h3>
          <div className="studio-email-copy">{body.length ? body.map((paragraph, index) => <p key={`${paragraph}-${index}`}>{paragraph}</p>) : <p>Your invitation message appears here.</p>}</div>
          <span className="studio-email-button">{sample(template.buttonLabel) || "Accept invitation"}<ArrowRight size={13} /></span>
          <div className="studio-email-security"><ShieldCheck size={15} /><span><strong>Protected invitation</strong><small>This secure invitation expires in 7 days and works once.</small></span></div>
        </div>
        <div className="studio-email-footer"><strong>Your account security matters.</strong><p>{sample(template.footer) || "Your security note appears here."}</p></div>
      </div>
    </div>
  );
}

function TemplateList({ templates, selectedId, query, setQuery, onChoose, onNew }) {
  const visible = templates.filter((template) => `${template.name} ${template.description}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <aside className="studio-template-rail">
      <div className="studio-rail-heading"><span><strong>Templates</strong><small>{templates.length} saved</small></span><button type="button" onClick={onNew} aria-label="Create template"><Plus size={15} /></button></div>
      <label className="studio-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a template" /></label>
      <div className="studio-template-list">
        {visible.map((template) => (
          <button className={selectedId === template.id ? "selected" : ""} type="button" onClick={() => onChoose(template)} key={template.id}>
            <span className="studio-template-icon"><Mail size={15} /></span>
            <span><strong>{template.name}</strong><small>Version {template.version} · {template.status}</small></span>
            <ChevronRight size={14} />
          </button>
        ))}
        {!visible.length && <div className="studio-empty-compact"><FileText size={17} /><span>No matching templates</span></div>}
      </div>
    </aside>
  );
}

function TemplateEditor({ studio, selectedId, draft, setDraft, dirty, setDirty, onSaved, onArchive }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [variableField, setVariableField] = useState("body");
  const update = (key, value) => { setDraft((current) => ({ ...current, [key]: value })); setDirty(true); setError(""); setNotice(""); };
  const save = async (status) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const payload = { ...draft, status };
      const result = selectedId
        ? await request(`/api/admin-center/email-templates/${encodeURIComponent(selectedId)}`, { method: "PATCH", body: JSON.stringify(payload) })
        : await request("/api/admin-center/email-templates", { method: "POST", body: JSON.stringify(payload) });
      setNotice(status === "published" ? "Template published and ready to send." : "Draft saved.");
      setDirty(false);
      await onSaved(result.template.id);
    } catch (saveError) { setError(saveError.message); } finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      await request("/api/admin-center/email-templates/test", { method: "POST", body: JSON.stringify({ email: testEmail, template: { ...draft, status: "draft" } }) });
      setNotice(`Test sent to ${testEmail}.`);
    } catch (testError) { setError(testError.message); } finally { setBusy(false); }
  };
  const insertVariable = (key) => {
    const token = `{{${key}}}`;
    const currentValue = String(draft[variableField] || "");
    update(variableField, `${currentValue}${currentValue.endsWith(" ") || !currentValue ? "" : " "}${token}`);
  };
  return (
    <div className="studio-template-workspace">
      <section className="studio-editor-card">
        <div className="studio-card-heading"><span><small>{selectedId ? `Version ${draft.version || 1}` : "New template"}</small><h2>{selectedId ? "Edit invitation email" : "Create invitation email"}</h2></span><span className={`studio-status ${draft.status || "draft"}`}><i />{draft.status || "draft"}</span></div>
        <div className="studio-form-grid two">
          <label><span>Template name</span><input value={draft.name} onChange={(event) => update("name", event.target.value)} placeholder="Example: Friendly team invitation" maxLength={100} /></label>
          <label><span>Internal description</span><input value={draft.description} onChange={(event) => update("description", event.target.value)} placeholder="Where this template should be used" maxLength={240} /></label>
        </div>
        <label className="studio-field"><span>Email subject</span><input value={draft.subject} onFocus={() => setVariableField("subject")} onChange={(event) => update("subject", event.target.value)} maxLength={180} /></label>
        <label className="studio-field"><span>Preview text</span><input value={draft.preheader} onFocus={() => setVariableField("preheader")} onChange={(event) => update("preheader", event.target.value)} maxLength={180} /></label>
        <div className="studio-form-grid two compact-fields">
          <label><span>Eyebrow</span><input value={draft.eyebrow} onFocus={() => setVariableField("eyebrow")} onChange={(event) => update("eyebrow", event.target.value)} maxLength={60} /></label>
          <label><span>Button label</span><input value={draft.buttonLabel} onFocus={() => setVariableField("buttonLabel")} onChange={(event) => update("buttonLabel", event.target.value)} maxLength={60} /></label>
        </div>
        <label className="studio-field"><span>Heading</span><input value={draft.heading} onFocus={() => setVariableField("heading")} onChange={(event) => update("heading", event.target.value)} maxLength={140} /></label>
        <label className="studio-field"><span>Message</span><textarea value={draft.body} onFocus={() => setVariableField("body")} onChange={(event) => update("body", event.target.value)} rows={6} maxLength={2400} /></label>
        <div className="studio-variables"><span><Sparkles size={13} />Insert into {variableField.replace(/([A-Z])/g, " $1").toLowerCase()}</span><div>{studio.variables.map((variable) => <button type="button" onClick={() => insertVariable(variable.key)} title={variable.label} key={variable.key}>{`{{${variable.key}}}`}</button>)}</div></div>
        <label className="studio-field"><span>Security footer</span><textarea value={draft.footer} onFocus={() => setVariableField("footer")} onChange={(event) => update("footer", event.target.value)} rows={3} maxLength={600} /></label>
        <div className="studio-protected-field"><ShieldCheck size={15} /><span><strong>Invitation link is protected</strong><small>The button always receives a new secure, one-use link. Editors cannot accidentally remove it.</small></span></div>
        {(error || notice) && <p className={error ? "studio-message error" : "studio-message success"}>{error || notice}</p>}
        <div className="studio-editor-actions">
          <div className="studio-test-send"><input type="email" value={testEmail} onChange={(event) => setTestEmail(event.target.value)} placeholder="test@company.com" /><button type="button" disabled={busy || !studio.sender.configured || !validEmail(testEmail)} onClick={test}><Send size={14} />Send test</button></div>
          <div><button className="studio-button secondary" type="button" disabled={busy || !dirty} onClick={() => save("draft")}>Save draft</button><button className="studio-button primary" type="button" disabled={busy} onClick={() => save("published")}><Check size={14} />{draft.status === "published" ? "Save & publish" : "Publish"}</button>{selectedId && draft.status !== "archived" && <button className="studio-icon-button danger" type="button" disabled={busy} onClick={onArchive} aria-label="Archive template"><Archive size={15} /></button>}</div>
        </div>
      </section>
      <aside className="studio-preview-column"><EmailPreview template={draft} /><div className="studio-preview-note"><CheckCircle2 size={15} /><span><strong>Responsive by default</strong><small>HTML and plain-text versions are generated safely for every send.</small></span></div></aside>
    </div>
  );
}

function InvitationComposer({ studio, workspaces, roles, onSent }) {
  const publishedTemplates = useMemo(() => studio.templates.filter((template) => template.status === "published"), [studio.templates]);
  const availableRoles = useMemo(() => roles.filter(invitationRole), [roles]);
  const [form, setForm] = useState({ recipientName: "", email: "", workspaceId: "", templateId: "", roleIds: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!publishedTemplates.some((template) => template.id === form.templateId) && publishedTemplates[0]) {
      setForm((current) => ({ ...current, templateId: publishedTemplates[0].id }));
    }
  }, [form.templateId, publishedTemplates]);
  const selectedTemplate = publishedTemplates.find((template) => template.id === form.templateId) || publishedTemplates[0] || EMPTY_TEMPLATE;
  const updateForm = (values) => {
    setForm((current) => ({ ...current, ...values }));
    setError("");
    setNotice("");
  };
  const setRole = (roleId, checked) => {
    setForm((current) => ({ ...current, roleIds: checked ? [...new Set([...current.roleIds, roleId])] : current.roleIds.filter((id) => id !== roleId) }));
    setError("");
    setNotice("");
  };
  const send = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      await request("/api/admin-center/invitations", { method: "POST", body: JSON.stringify(form) });
      setNotice(`Invitation sent to ${form.email}.`);
      setForm((current) => ({ ...current, recipientName: "", email: "", roleIds: [] }));
      await onSent();
    } catch (sendError) { setError(sendError.message); await onSent(); } finally { setBusy(false); }
  };
  const ready = studio.sender.configured && validEmail(form.email) && form.workspaceId && form.templateId && form.roleIds.length;
  return (
    <div className="studio-send-layout">
      <section className="studio-send-card">
        <div className="studio-card-heading"><span><small>Secure workspace access</small><h2>Send an invitation</h2></span><span className="studio-step-pill">One email · one-use link</span></div>
        {!studio.sender.configured && <div className="studio-config-warning"><XCircle size={16} /><span><strong>Email sender is not ready</strong><small>Configure AUTH_EMAIL_FROM and Resend or the email webhook before sending.</small></span></div>}
        {!publishedTemplates.length && <div className="studio-config-warning"><FileText size={16} /><span><strong>A published template is required</strong><small>Open Templates, create or review a message, then publish it before sending.</small></span></div>}
        <div className="studio-section-label"><span>1</span><div><strong>Who is joining?</strong><small>The recipient chooses their password after opening the secure link.</small></div></div>
        <div className="studio-form-grid two">
          <label><span>Recipient name <em>Optional</em></span><input value={form.recipientName} onChange={(event) => updateForm({ recipientName: event.target.value })} placeholder="Alex Morgan" maxLength={100} /></label>
          <label><span>Work email</span><input type="email" value={form.email} onChange={(event) => updateForm({ email: event.target.value })} placeholder="alex@company.com" /></label>
        </div>
        <div className="studio-section-label"><span>2</span><div><strong>Where will they work?</strong><small>Choose the workspace and responsibilities included in this invitation.</small></div></div>
        <label className="studio-field"><span>Workspace</span><select value={form.workspaceId} onChange={(event) => updateForm({ workspaceId: event.target.value })}><option value="">Choose a workspace</option>{workspaces.filter((workspace) => workspace.status === "active").map((workspace) => <option value={workspace.id} key={workspace.id}>{workspace.name}</option>)}</select></label>
        <div className="studio-role-grid">{availableRoles.map((role) => <label className={form.roleIds.includes(role.id) ? "selected" : ""} key={role.id}><input type="checkbox" checked={form.roleIds.includes(role.id)} onChange={(event) => setRole(role.id, event.target.checked)} /><i>{form.roleIds.includes(role.id) && <Check size={11} />}</i><span><strong>{role.name}</strong><small>{role.description}</small></span></label>)}</div>
        <div className="studio-section-label"><span>3</span><div><strong>Choose the message</strong><small>Only published templates can be used for real invitations.</small></div></div>
        <label className="studio-field"><span>Email template</span><select value={form.templateId} onChange={(event) => updateForm({ templateId: event.target.value })}><option value="">Choose a published template</option>{publishedTemplates.map((template) => <option value={template.id} key={template.id}>{template.name} · v{template.version}</option>)}</select></label>
        {(error || notice) && <p className={error ? "studio-message error" : "studio-message success"}>{error || notice}</p>}
        <button className="studio-send-button" type="button" disabled={busy || !ready} onClick={send}>{busy ? <><RefreshCw className="spin" size={15} />Sending invitation…</> : <><Send size={15} />Send secure invitation<ArrowRight size={15} /></>}</button>
      </section>
      <aside className="studio-send-preview"><EmailPreview template={selectedTemplate} compact /><div className="studio-send-summary"><span><Mail size={14} /><small>From</small><strong>{studio.sender.from}</strong></span><span><UsersRound size={14} /><small>Access</small><strong>{form.roleIds.length ? `${form.roleIds.length} role${form.roleIds.length === 1 ? "" : "s"}` : "Choose roles"}</strong></span><span><Clock3 size={14} /><small>Expires</small><strong>7 days</strong></span></div></aside>
    </div>
  );
}

function ActivityView({ studio, onUpdated }) {
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const act = async (delivery, action) => {
    if (action === "cancel" && !window.confirm(`Cancel the invitation for ${delivery.recipientEmail}?`)) return;
    setBusyId(delivery.id); setError("");
    try { await request(`/api/admin-center/invitations/${encodeURIComponent(delivery.id)}`, { method: "PATCH", body: JSON.stringify({ action }) }); await onUpdated(); }
    catch (actionError) { setError(actionError.message); await onUpdated(); } finally { setBusyId(""); }
  };
  return (
    <section className="studio-activity-card">
      <div className="studio-card-heading"><span><small>Provider and acceptance status</small><h2>Invitation activity</h2></span><button className="studio-button secondary" type="button" onClick={onUpdated}><RefreshCw size={13} />Refresh</button></div>
      {error && <p className="studio-message error">{error}</p>}
      <div className="studio-activity-head"><span>Recipient</span><span>Workspace</span><span>Template</span><span>Status</span><span>Sent</span><span /></div>
      <div className="studio-activity-list">
        {studio.deliveries.map((delivery) => {
          const finalStatus = delivery.invitationStatus === "accepted" ? "accepted" : delivery.invitationStatus === "canceled" ? "canceled" : delivery.invitationStatus === "expired" ? "expired" : delivery.status;
          const pending = delivery.invitationStatus === "pending";
          const resendable = pending || delivery.invitationStatus === "expired";
          return <article key={delivery.id}>
            <span className="studio-recipient"><i>{String(delivery.recipientName || delivery.recipientEmail).charAt(0).toUpperCase()}</i><span><strong>{delivery.recipientName || delivery.recipientEmail}</strong><small>{delivery.recipientEmail}</small></span></span>
            <span><strong>{delivery.workspaceName}</strong><small>{delivery.roleIds.length} assigned roles</small></span>
            <span><strong>{delivery.templateName}</strong><small>Version {delivery.templateVersion} · {delivery.provider || "Not sent"}</small></span>
            <span><b className={`studio-delivery-status ${finalStatus}`}><i />{finalStatus}</b>{delivery.error && <small title={delivery.error}>{delivery.error}</small>}</span>
            <span><strong>{timeLabel(delivery.sentAt || delivery.queuedAt)}</strong><small>{delivery.attemptCount} {delivery.attemptCount === 1 ? "attempt" : "attempts"}</small></span>
            <span className="studio-row-actions">{resendable && <button type="button" disabled={busyId === delivery.id} onClick={() => act(delivery, "resend")} title="Resend"><RefreshCw size={13} /></button>}{pending && <button className="danger" type="button" disabled={busyId === delivery.id} onClick={() => act(delivery, "cancel")} title="Cancel"><XCircle size={13} /></button>}</span>
          </article>;
        })}
        {!studio.deliveries.length && <div className="studio-empty-state"><span><History size={21} /></span><strong>No invitations sent yet</strong><small>Your first invitation and its live status will appear here.</small></div>}
      </div>
    </section>
  );
}

export default function AdminEmailStudio({ workspaces, roles }) {
  const [studio, setStudio] = useState({ sender: { configured: false, from: "Loading…", provider: null }, variables: [], templates: [], deliveries: [] });
  const [view, setView] = useState("templates");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState({ ...EMPTY_TEMPLATE });
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState("");
  const load = async (preferredId, preserveDraft = false) => {
    setLoadError("");
    try {
      const next = await request("/api/admin-center/communications");
      setStudio(next);
      if (!preserveDraft) {
        const selected = next.templates.find((template) => template.id === preferredId)
          || next.templates.find((template) => template.id === selectedId)
          || next.templates[0];
        if (selected) { setSelectedId(selected.id); setDraft(selected); setDirty(false); }
      }
    } catch (error) { setLoadError(error.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const choose = (template) => {
    if (dirty && !window.confirm("Discard your unsaved template changes?")) return;
    setSelectedId(template.id); setDraft(template); setDirty(false);
  };
  const createNew = () => {
    if (dirty && !window.confirm("Discard your unsaved template changes?")) return;
    setSelectedId(""); setDraft({ ...EMPTY_TEMPLATE }); setDirty(false);
  };
  const archive = async () => {
    if (!selectedId || !window.confirm(`Archive “${draft.name}”? It will no longer be available for new invitations.`)) return;
    try { await request(`/api/admin-center/email-templates/${encodeURIComponent(selectedId)}`, { method: "PATCH", body: JSON.stringify({ ...draft, status: "archived" }) }); await load(); }
    catch (error) { setLoadError(error.message); }
  };
  const publishedCount = useMemo(() => studio.templates.filter((template) => template.status === "published").length, [studio.templates]);
  if (loading) return <div className="studio-loading"><RefreshCw className="spin" size={18} />Preparing Email Studio…</div>;
  return (
    <div className="admin-email-studio">
      <div className="studio-hero">
        <div><span className="studio-hero-icon"><Sparkles size={19} /></span><span><p>Invitation communications</p><h1>Email Studio</h1><small>Create polished templates, send secure workspace invitations and follow every result.</small></span></div>
        <div className={`studio-sender-card${studio.sender.configured ? " ready" : ""}`}><span><i /><small>{studio.sender.configured ? "Sender ready" : "Setup required"}</small><strong>{studio.sender.from}</strong></span><b>{studio.sender.provider || "No provider"}</b></div>
      </div>
      <nav className="studio-view-tabs" aria-label="Email Studio sections">
        <button className={view === "templates" ? "active" : ""} type="button" onClick={() => setView("templates")}><CopyPlus size={15} /><span>Templates<small>{studio.templates.length} saved · {publishedCount} live</small></span></button>
        <button className={view === "send" ? "active" : ""} type="button" onClick={() => setView("send")}><Send size={15} /><span>Send invitation<small>Create secure workspace access</small></span></button>
        <button className={view === "activity" ? "active" : ""} type="button" onClick={() => setView("activity")}><History size={15} /><span>Activity<small>{studio.deliveries.length} recent deliveries</small></span></button>
      </nav>
      {loadError && <p className="studio-message error">{loadError} <button type="button" onClick={() => load(selectedId, true)}>Try again</button></p>}
      {view === "templates" && <div className="studio-template-layout"><TemplateList templates={studio.templates} selectedId={selectedId} query={query} setQuery={setQuery} onChoose={choose} onNew={createNew} /><TemplateEditor studio={studio} selectedId={selectedId} draft={draft} setDraft={setDraft} dirty={dirty} setDirty={setDirty} onSaved={(id) => load(id)} onArchive={archive} /></div>}
      {view === "send" && <InvitationComposer studio={studio} workspaces={workspaces} roles={roles} onSent={() => load(selectedId, true)} />}
      {view === "activity" && <ActivityView studio={studio} onUpdated={() => load(selectedId, true)} />}
    </div>
  );
}
