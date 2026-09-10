"use client";

import {
  Archive,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CopyPlus,
  ExternalLink,
  FileText,
  History,
  Mail,
  PackageOpen,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const EMPTY_TEMPLATE = {
  name: "",
  description: "",
  status: "draft",
  subject: "A closer look at {{product_name}} | AgenticThat",
  preheader: "See how {{product_name}} can simplify your workflow.",
  eyebrow: "A product selected for you",
  heading: "Meet {{product_name}}",
  body: "Hi {{recipient_name}},\n\nWe thought {{product_name}} could be useful for your business. Here is what it does: {{product_description}}\n\nTake a look at the product page and see whether it fits your workflow.",
  buttonLabel: "Explore {{product_name}}",
  footer: "If you have questions, reply to this email and our team will be happy to help.",
};

const SAMPLE_PRODUCT = {
  key: "publishing:instagram",
  name: "Instagram Publishing",
  description: "Prepare, preview and publish Instagram content from one controlled workspace.",
  url: "https://agenticthat.com/apps/publishing/instagram",
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

function sample(value, product = SAMPLE_PRODUCT, sender = null) {
  const values = {
    recipient_name: "Alex Morgan",
    recipient_email: "alex@example.com",
    product_name: product?.name || SAMPLE_PRODUCT.name,
    product_description: product?.description || SAMPLE_PRODUCT.description,
    product_url: product?.url || SAMPLE_PRODUCT.url,
    sender_name: sender?.name || "AgenticThat Team",
    company_name: "AgenticThat",
  };
  return String(value || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => values[key.toLowerCase()] || match);
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

function EmailPreview({ template, product = SAMPLE_PRODUCT, sender = null, compact = false }) {
  const body = sample(template.body, product, sender).split(/\n{2,}/).filter(Boolean);
  return (
    <div className={`studio-preview-shell${compact ? " compact" : ""}`}>
      <div className="studio-preview-topbar"><span /><span /><span /><small>Live preview</small></div>
      <div className="studio-preview-subject"><small>Subject</small><strong>{sample(template.subject, product, sender) || "Your subject appears here"}</strong></div>
      <div className="studio-email-canvas">
        <div className="studio-email-brand"><span>AT</span><strong>AgenticThat</strong><small>Product introduction</small></div>
        <div className="studio-email-content">
          <em>{sample(template.eyebrow, product, sender) || "A product selected for you"}</em>
          <h3>{sample(template.heading, product, sender) || "Your product heading"}</h3>
          <div className="studio-email-copy">{body.length ? body.map((paragraph, index) => <p key={`${paragraph}-${index}`}>{paragraph}</p>) : <p>Your client message appears here.</p>}</div>
          <div className="studio-email-security"><PackageOpen size={15} /><span><strong>{product?.name || SAMPLE_PRODUCT.name}</strong><small>{product?.description || SAMPLE_PRODUCT.description}</small></span></div>
          <span className="studio-email-button">{sample(template.buttonLabel, product, sender) || "Explore product"}<ArrowRight size={13} /></span>
        </div>
        <div className="studio-email-footer"><strong>A note from AgenticThat.</strong><p>{sample(template.footer, product, sender) || "Your footer note appears here."}</p></div>
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
  const previewProduct = studio.products[0] || SAMPLE_PRODUCT;
  const previewSender = studio.sender.senders.find((sender) => sender.id === studio.sender.defaultSenderId) || studio.sender.senders[0] || null;
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
      await request("/api/admin-center/email-templates/test", {
        method: "POST",
        body: JSON.stringify({ email: testEmail, productKey: previewProduct.key, senderId: studio.sender.defaultSenderId, template: { ...draft, status: "draft" } }),
      });
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
        <div className="studio-card-heading"><span><small>{selectedId ? `Version ${draft.version || 1}` : "New template"}</small><h2>{selectedId ? "Edit client introduction" : "Create client introduction"}</h2></span><span className={`studio-status ${draft.status || "draft"}`}><i />{draft.status || "draft"}</span></div>
        <div className="studio-form-grid two">
          <label><span>Template name</span><input value={draft.name} onChange={(event) => update("name", event.target.value)} placeholder="Example: Friendly product introduction" maxLength={100} /></label>
          <label><span>Internal description</span><input value={draft.description} onChange={(event) => update("description", event.target.value)} placeholder="When your team should use it" maxLength={240} /></label>
        </div>
        <label className="studio-field"><span>Email subject</span><input value={draft.subject} onFocus={() => setVariableField("subject")} onChange={(event) => update("subject", event.target.value)} maxLength={180} /></label>
        <label className="studio-field"><span>Preview text</span><input value={draft.preheader} onFocus={() => setVariableField("preheader")} onChange={(event) => update("preheader", event.target.value)} maxLength={180} /></label>
        <div className="studio-form-grid two compact-fields">
          <label><span>Eyebrow</span><input value={draft.eyebrow} onFocus={() => setVariableField("eyebrow")} onChange={(event) => update("eyebrow", event.target.value)} maxLength={60} /></label>
          <label><span>Button label</span><input value={draft.buttonLabel} onFocus={() => setVariableField("buttonLabel")} onChange={(event) => update("buttonLabel", event.target.value)} maxLength={80} /></label>
        </div>
        <label className="studio-field"><span>Heading</span><input value={draft.heading} onFocus={() => setVariableField("heading")} onChange={(event) => update("heading", event.target.value)} maxLength={140} /></label>
        <label className="studio-field"><span>Client message</span><textarea value={draft.body} onFocus={() => setVariableField("body")} onChange={(event) => update("body", event.target.value)} rows={7} maxLength={2400} /></label>
        <div className="studio-variables"><span><Sparkles size={13} />Insert into {variableField.replace(/([A-Z])/g, " $1").toLowerCase()}</span><div>{studio.variables.map((variable) => <button type="button" onClick={() => insertVariable(variable.key)} title={variable.label} key={variable.key}>{`{{${variable.key}}}`}</button>)}</div></div>
        <label className="studio-field"><span>Footer note</span><textarea value={draft.footer} onFocus={() => setVariableField("footer")} onChange={(event) => update("footer", event.target.value)} rows={3} maxLength={600} /></label>
        <div className="studio-protected-field"><ExternalLink size={15} /><span><strong>Product link is automatic</strong><small>The button always opens the selected product’s official AgenticThat Store page.</small></span></div>
        {(error || notice) && <p className={error ? "studio-message error" : "studio-message success"}>{error || notice}</p>}
        <div className="studio-editor-actions">
          <div className="studio-test-send"><input type="email" value={testEmail} onChange={(event) => setTestEmail(event.target.value)} placeholder="test@company.com" /><button type="button" disabled={busy || !studio.sender.configured || !validEmail(testEmail) || !previewProduct.key} onClick={test}><Send size={14} />Send test</button></div>
          <div><button className="studio-button secondary" type="button" disabled={busy || !dirty} onClick={() => save("draft")}>Save draft</button><button className="studio-button primary" type="button" disabled={busy} onClick={() => save("published")}><Check size={14} />{draft.status === "published" ? "Save & publish" : "Publish"}</button>{selectedId && draft.status !== "archived" && <button className="studio-icon-button danger" type="button" disabled={busy} onClick={onArchive} aria-label="Archive template"><Archive size={15} /></button>}</div>
        </div>
      </section>
      <aside className="studio-preview-column"><EmailPreview template={draft} product={previewProduct} sender={previewSender} /><div className="studio-preview-note"><CheckCircle2 size={15} /><span><strong>Ready for every client</strong><small>Product details and the Store link are filled in automatically at send time.</small></span></div></aside>
    </div>
  );
}

function ProductInvitationComposer({ studio, onSent }) {
  const publishedTemplates = useMemo(() => studio.templates.filter((template) => template.status === "published"), [studio.templates]);
  const [form, setForm] = useState({ recipientName: "", email: "", productKey: "", templateId: "", senderId: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    setForm((current) => ({
      ...current,
      templateId: publishedTemplates.some((template) => template.id === current.templateId) ? current.templateId : publishedTemplates[0]?.id || "",
      productKey: studio.products.some((product) => product.key === current.productKey) ? current.productKey : studio.products[0]?.key || "",
      senderId: studio.sender.senders.some((sender) => sender.id === current.senderId) ? current.senderId : "",
    }));
  }, [publishedTemplates, studio.products, studio.sender.senders]);
  const selectedTemplate = publishedTemplates.find((template) => template.id === form.templateId) || publishedTemplates[0] || EMPTY_TEMPLATE;
  const selectedProduct = studio.products.find((product) => product.key === form.productKey) || studio.products[0] || SAMPLE_PRODUCT;
  const selectedSender = studio.sender.senders.find((sender) => sender.id === form.senderId) || null;
  const updateForm = (values) => { setForm((current) => ({ ...current, ...values })); setError(""); setNotice(""); };
  const send = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      await request("/api/admin-center/product-invitations", { method: "POST", body: JSON.stringify(form) });
      setNotice(`Product invitation sent to ${form.email}.`);
      setForm((current) => ({ ...current, recipientName: "", email: "", senderId: "" }));
      await onSent();
    } catch (sendError) { setError(sendError.message); await onSent(); } finally { setBusy(false); }
  };
  const ready = studio.sender.configured && validEmail(form.email) && form.productKey && form.templateId && form.senderId;
  return (
    <div className="studio-send-layout">
      <section className="studio-send-card">
        <div className="studio-card-heading"><span><small>Client product introduction</small><h2>Share a product with a client</h2></span><span className="studio-step-pill">Personal · reusable</span></div>
        {!studio.sender.configured && <div className="studio-config-warning"><XCircle size={16} /><span><strong>No approved sender is ready</strong><small>Configure an Email Studio sender and Resend or the email webhook before sending.</small></span></div>}
        {!publishedTemplates.length && <div className="studio-config-warning"><FileText size={16} /><span><strong>A published template is required</strong><small>Create or review a client introduction, then publish it before sending.</small></span></div>}
        <div className="studio-section-label"><span>1</span><div><strong>Who should receive it?</strong><small>Add the client’s details to personalize the introduction.</small></div></div>
        <div className="studio-form-grid two">
          <label><span>Client name <em>Optional</em></span><input value={form.recipientName} onChange={(event) => updateForm({ recipientName: event.target.value })} placeholder="Alex Morgan" maxLength={100} /></label>
          <label><span>Client email</span><input type="email" value={form.email} onChange={(event) => updateForm({ email: event.target.value })} placeholder="alex@company.com" /></label>
        </div>
        <div className="studio-section-label"><span>2</span><div><strong>Which product should they see?</strong><small>The correct AgenticThat Store link and product details are added automatically.</small></div></div>
        <div className="studio-product-grid">{studio.products.map((product) => <label className={form.productKey === product.key ? "selected" : ""} key={product.key}><input type="radio" name="product" checked={form.productKey === product.key} onChange={() => updateForm({ productKey: product.key })} /><span className="studio-product-logo">{product.logo ? <img src={product.logo} alt="" /> : <PackageOpen size={16} />}</span><span><strong>{product.name}</strong><small>{product.description}</small></span><i>{form.productKey === product.key && <Check size={11} />}</i></label>)}</div>
        <div className="studio-section-label"><span>3</span><div><strong>Choose the message and sender</strong><small>Only approved sender addresses and published templates are available.</small></div></div>
        <div className="studio-form-grid two">
          <label><span>Email template</span><select value={form.templateId} onChange={(event) => updateForm({ templateId: event.target.value })}><option value="">Choose a published template</option>{publishedTemplates.map((template) => <option value={template.id} key={template.id}>{template.name} · v{template.version}</option>)}</select></label>
          <label><span>Send from</span><select value={form.senderId} onChange={(event) => updateForm({ senderId: event.target.value })}><option value="">Choose an approved sender</option>{studio.sender.senders.map((sender) => <option value={sender.id} key={sender.id}>{sender.from}</option>)}</select></label>
        </div>
        <p className="studio-sender-help"><CheckCircle2 size={13} />Sender addresses are restricted to your approved email configuration.</p>
        {(error || notice) && <p className={error ? "studio-message error" : "studio-message success"}>{error || notice}</p>}
        <button className="studio-send-button" type="button" disabled={busy || !ready} onClick={send}>{busy ? <><RefreshCw className="spin" size={15} />Sending introduction…</> : <><Send size={15} />Send product invitation<ArrowRight size={15} /></>}</button>
      </section>
      <aside className="studio-send-preview"><EmailPreview template={selectedTemplate} product={selectedProduct} sender={selectedSender} compact /><div className="studio-send-summary"><span><Mail size={14} /><small>From</small><strong>{selectedSender?.from || "Choose sender"}</strong></span><span><PackageOpen size={14} /><small>Product</small><strong>{selectedProduct.name}</strong></span><span><ExternalLink size={14} /><small>Destination</small><strong>Store product page</strong></span></div></aside>
    </div>
  );
}

function ActivityView({ studio, onUpdated }) {
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const resend = async (delivery) => {
    setBusyId(delivery.id); setError("");
    try { await request(`/api/admin-center/product-invitations/${encodeURIComponent(delivery.id)}`, { method: "PATCH", body: JSON.stringify({ action: "resend" }) }); await onUpdated(); }
    catch (actionError) { setError(actionError.message); await onUpdated(); } finally { setBusyId(""); }
  };
  return (
    <section className="studio-activity-card">
      <div className="studio-card-heading"><span><small>Product introduction delivery</small><h2>Client email activity</h2></span><button className="studio-button secondary" type="button" onClick={onUpdated}><RefreshCw size={13} />Refresh</button></div>
      {error && <p className="studio-message error">{error}</p>}
      <div className="studio-activity-head"><span>Client</span><span>Product</span><span>Template</span><span>Status</span><span>Sent</span><span /></div>
      <div className="studio-activity-list">
        {studio.deliveries.map((delivery) => <article key={delivery.id}>
          <span className="studio-recipient"><i>{String(delivery.recipientName || delivery.recipientEmail).charAt(0).toUpperCase()}</i><span><strong>{delivery.recipientName || delivery.recipientEmail}</strong><small>{delivery.recipientEmail}</small></span></span>
          <span><strong>{delivery.productName}</strong><small>Official Store link</small></span>
          <span><strong>{delivery.templateName}</strong><small>Version {delivery.templateVersion} · {delivery.senderFrom}</small></span>
          <span><b className={`studio-delivery-status ${delivery.status}`}><i />{delivery.status}</b>{delivery.error && <small title={delivery.error}>{delivery.error}</small>}</span>
          <span><strong>{timeLabel(delivery.sentAt || delivery.queuedAt)}</strong><small>{delivery.attemptCount} {delivery.attemptCount === 1 ? "attempt" : "attempts"}</small></span>
          <span className="studio-row-actions">{delivery.status !== "queued" && <button type="button" disabled={busyId === delivery.id} onClick={() => resend(delivery)} title="Resend"><RefreshCw size={13} /></button>}</span>
        </article>)}
        {!studio.deliveries.length && <div className="studio-empty-state"><span><History size={21} /></span><strong>No client invitations sent yet</strong><small>Your first product introduction and its delivery status will appear here.</small></div>}
      </div>
    </section>
  );
}

export default function AdminEmailStudio() {
  const [studio, setStudio] = useState({ sender: { configured: false, from: "Loading…", provider: null, defaultSenderId: null, senders: [] }, variables: [], products: [], templates: [], deliveries: [] });
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
    if (!selectedId || !window.confirm(`Archive "${draft.name}"? It will no longer be available for new client introductions.`)) return;
    try { await request(`/api/admin-center/email-templates/${encodeURIComponent(selectedId)}`, { method: "PATCH", body: JSON.stringify({ ...draft, status: "archived" }) }); await load(); }
    catch (error) { setLoadError(error.message); }
  };
  const publishedCount = useMemo(() => studio.templates.filter((template) => template.status === "published").length, [studio.templates]);
  if (loading) return <div className="studio-loading"><RefreshCw className="spin" size={18} />Preparing Email Studio…</div>;
  return (
    <div className="admin-email-studio">
      <div className="studio-hero">
        <div><span className="studio-hero-icon"><Sparkles size={19} /></span><span><p>Client product invitations</p><h1>Email Studio</h1><small>Create reusable introductions, share the right product page and follow every client email.</small></span></div>
        <div className={`studio-sender-card${studio.sender.configured ? " ready" : ""}`}><span><i /><small>{studio.sender.configured ? "Approved senders ready" : "Setup required"}</small><strong>{studio.sender.configured ? `${studio.sender.senders.length} sender${studio.sender.senders.length === 1 ? "" : "s"} available` : "No Email Studio sender configured"}</strong></span><b>{studio.sender.configured ? `Choose per email · ${studio.sender.provider}` : "Not ready"}</b></div>
      </div>
      <nav className="studio-view-tabs" aria-label="Email Studio sections">
        <button className={view === "templates" ? "active" : ""} type="button" onClick={() => setView("templates")}><CopyPlus size={15} /><span>Templates<small>{studio.templates.length} saved · {publishedCount} live</small></span></button>
        <button className={view === "send" ? "active" : ""} type="button" onClick={() => setView("send")}><Send size={15} /><span>Send to client<small>Introduce an AgenticThat product</small></span></button>
        <button className={view === "activity" ? "active" : ""} type="button" onClick={() => setView("activity")}><History size={15} /><span>Activity<small>{studio.deliveries.length} recent client emails</small></span></button>
      </nav>
      {loadError && <p className="studio-message error">{loadError} <button type="button" onClick={() => load(selectedId, true)}>Try again</button></p>}
      {view === "templates" && <div className="studio-template-layout"><TemplateList templates={studio.templates} selectedId={selectedId} query={query} setQuery={setQuery} onChoose={choose} onNew={createNew} /><TemplateEditor studio={studio} selectedId={selectedId} draft={draft} setDraft={setDraft} dirty={dirty} setDirty={setDirty} onSaved={(id) => load(id)} onArchive={archive} /></div>}
      {view === "send" && <ProductInvitationComposer studio={studio} onSent={() => load(selectedId, true)} />}
      {view === "activity" && <ActivityView studio={studio} onUpdated={() => load(selectedId, true)} />}
    </div>
  );
}
