"use client";

import {
  Archive,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CopyPlus,
  Database,
  ExternalLink,
  FileText,
  History,
  Mail,
  MessageCircleMore,
  PackageOpen,
  Plus,
  RefreshCw,
  Search,
  Send,
  Share2,
  Sparkles,
  Store,
  Target,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const TEMPLATE_PRESETS = {
  platform: {
    invitationType: "platform",
    name: "",
    description: "",
    status: "draft",
    subject: "Meet AgenticThat | Practical automation in one place",
    preheader: "Discover AgenticThat services for messaging, publishing, and public-data workflows.",
    eyebrow: "One platform. Practical automation.",
    heading: "Put everyday digital work in one clear place",
    body: "Hi {{recipient_name}},\n\nAgenticThat brings useful business workflows together so your team can communicate, publish, and collect public data without juggling disconnected tools.\n\nExplore the platform and choose the services that fit your work today.",
    buttonLabel: "Explore AgenticThat",
    footer: "If you have questions, reply to this email and the {{company_name}} team will be happy to help.",
  },
  service: {
    invitationType: "service",
    name: "",
    description: "",
    status: "draft",
    subject: "A closer look at {{product_name}} | AgenticThat",
    preheader: "See how {{product_name}} can simplify your workflow.",
    eyebrow: "A service selected for you",
    heading: "Meet {{product_name}}",
    body: "Hi {{recipient_name}},\n\nWe thought {{product_name}} could be useful for your business. Here is what it does: {{product_description}}\n\nTake a look at the service page and see whether it fits your workflow.",
    buttonLabel: "Explore {{product_name}}",
    footer: "If you have questions, reply to this email and our team will be happy to help.",
  },
};

const SAMPLE_PLATFORM = {
  key: "platform:agenticthat",
  invitationType: "platform",
  name: "AgenticThat",
  description: "A practical automation platform for customer messaging, social publishing, and structured public-data workflows.",
  url: "https://agenticthat.com/apps",
  highlights: [
    { key: "messaging", name: "Messaging", description: "Manage conversations, outreach, templates, and follow-ups.", services: "WhatsApp · Telegram" },
    { key: "publishing", name: "Publishing", description: "Prepare, preview, publish, and track social content.", services: "Instagram · YouTube · Facebook · X · LinkedIn" },
    { key: "scraping", name: "Public data", description: "Collect structured public signals for research and review.", services: "Instagram · Facebook" },
  ],
};

const SAMPLE_SERVICE = {
  key: "publishing:instagram",
  invitationType: "service",
  name: "Instagram Publishing",
  description: "Prepare, preview, and publish Instagram content from one controlled workspace.",
  logo: "/instagram-logo.svg",
  url: "https://agenticthat.com/apps/publishing/instagram",
  highlights: [],
};

const HIGHLIGHT_ICONS = {
  messaging: MessageCircleMore,
  publishing: Share2,
  scraping: Database,
};

const blankTemplate = (invitationType = "platform") => ({ ...TEMPLATE_PRESETS[invitationType] });

async function request(path, init) {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The operation failed.");
  return data;
}

function sample(value, product = SAMPLE_PLATFORM, sender = null) {
  const values = {
    recipient_name: "Alex Morgan",
    recipient_email: "alex@example.com",
    product_name: product?.name || SAMPLE_PLATFORM.name,
    product_description: product?.description || SAMPLE_PLATFORM.description,
    product_url: product?.url || SAMPLE_PLATFORM.url,
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

function invitationTypeLabel(value) {
  return value === "platform" ? "AgenticThat overview" : "Single service";
}

function EmailPreview({ template, product = SAMPLE_PLATFORM, sender = null, compact = false }) {
  const body = sample(template.body, product, sender).split(/\n{2,}/).filter(Boolean);
  const isPlatform = product.invitationType === "platform";
  const highlights = isPlatform ? (product.highlights || SAMPLE_PLATFORM.highlights) : [];
  const ProductIcon = isPlatform ? Store : PackageOpen;

  return (
    <div className={`studio-preview-shell${compact ? " compact" : ""}`}>
      <div className="studio-preview-topbar">
        <span /><span /><span />
        <small>Live email preview</small>
      </div>
      <div className="studio-preview-subject">
        <small>Subject</small>
        <strong>{sample(template.subject, product, sender) || "Your subject appears here"}</strong>
      </div>
      <div className="studio-email-canvas">
        <div className="studio-email-brand">
          <span>AT</span>
          <strong>AgenticThat</strong>
          <small>{isPlatform ? "Platform introduction" : "Service introduction"}</small>
        </div>
        <div className="studio-email-content">
          <em>{sample(template.eyebrow, product, sender) || "A better way to work"}</em>
          <h3>{sample(template.heading, product, sender) || "Your invitation heading"}</h3>
          <div className="studio-email-copy">
            {body.length
              ? body.map((paragraph, index) => <p key={`${paragraph}-${index}`}>{paragraph}</p>)
              : <p>Your client message appears here.</p>}
          </div>
          {highlights.length > 0 && (
            <div className="studio-email-services">
              <span>What your team can use</span>
              {highlights.map((highlight) => {
                const HighlightIcon = HIGHLIGHT_ICONS[highlight.key] || Sparkles;
                return (
                  <div key={highlight.key}>
                    <i><HighlightIcon size={12} /></i>
                    <span><strong>{highlight.name}</strong><small>{highlight.description}</small></span>
                  </div>
                );
              })}
            </div>
          )}
          <div className={`studio-email-product${isPlatform ? " platform" : ""}`}>
            <span className="studio-email-product-icon">
              {!isPlatform && product?.logo ? <img src={product.logo} alt="" /> : <ProductIcon size={17} />}
            </span>
            <span className="studio-email-product-copy"><strong>{product?.name || SAMPLE_PLATFORM.name}</strong><small>{product?.description || SAMPLE_PLATFORM.description}</small></span>
          </div>
          <span className="studio-email-button">
            {sample(template.buttonLabel, product, sender) || "Explore AgenticThat"}<ArrowRight size={13} />
          </span>
        </div>
        <div className="studio-email-footer">
          <strong>A note from AgenticThat.</strong>
          <p>{sample(template.footer, product, sender) || "Your footer note appears here."}</p>
        </div>
      </div>
    </div>
  );
}

function TemplateList({ templates, selectedId, query, setQuery, onChoose, onNew }) {
  const visible = templates.filter((template) => `${template.name} ${template.description}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <aside className="studio-template-rail">
      <div className="studio-rail-heading">
        <span><small>Reusable content</small><strong>Message library</strong></span>
        <button type="button" onClick={onNew} aria-label="Create template"><Plus size={18} /></button>
      </div>
      <label className="studio-search">
        <Search size={17} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a template" />
      </label>
      <div className="studio-template-list">
        {visible.map((template) => (
          <button className={selectedId === template.id ? "selected" : ""} type="button" onClick={() => onChoose(template)} key={template.id}>
            <span className="studio-template-icon">{template.invitationType === "platform" ? <Store size={17} /> : <Target size={17} />}</span>
            <span>
              <strong>{template.name}</strong>
              <small>{invitationTypeLabel(template.invitationType)} · v{template.version}</small>
            </span>
            <ChevronRight size={16} />
          </button>
        ))}
        {!visible.length && <div className="studio-empty-compact"><FileText size={20} /><span>No matching templates</span></div>}
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
  const previewProduct = studio.products.find((product) => product.invitationType === draft.invitationType)
    || (draft.invitationType === "platform" ? SAMPLE_PLATFORM : SAMPLE_SERVICE);
  const previewSender = studio.sender.senders.find((sender) => sender.id === studio.sender.defaultSenderId)
    || studio.sender.senders[0]
    || null;

  const update = (key, value) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setError("");
    setNotice("");
  };
  const changeType = (invitationType) => {
    if (!selectedId && !dirty) {
      setDraft(blankTemplate(invitationType));
      return;
    }
    update("invitationType", invitationType);
  };
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
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      await request("/api/admin-center/email-templates/test", {
        method: "POST",
        body: JSON.stringify({
          email: testEmail,
          productKey: previewProduct.key,
          senderId: studio.sender.defaultSenderId,
          template: { ...draft, status: "draft" },
        }),
      });
      setNotice(`Test sent to ${testEmail}.`);
    } catch (testError) {
      setError(testError.message);
    } finally {
      setBusy(false);
    }
  };
  const insertVariable = (key) => {
    const token = `{{${key}}}`;
    const currentValue = String(draft[variableField] || "");
    update(variableField, `${currentValue}${currentValue.endsWith(" ") || !currentValue ? "" : " "}${token}`);
  };

  return (
    <div className="studio-template-workspace">
      <section className="studio-editor-card">
        <div className="studio-card-heading">
          <span><small>{selectedId ? `Template version ${draft.version || 1}` : "New reusable template"}</small><h2>{selectedId ? "Edit client introduction" : "Create client introduction"}</h2></span>
          <span className={`studio-status ${draft.status || "draft"}`}><i />{draft.status || "draft"}</span>
        </div>

        <div className="studio-template-type">
          <span><strong>What is this template for?</strong><small>Keep overview and service-specific messages organized.</small></span>
          <div>
            <button className={draft.invitationType === "platform" ? "selected" : ""} type="button" onClick={() => changeType("platform")}><Store size={17} /><span><strong>AgenticThat overview</strong><small>Introduce the complete platform</small></span><i>{draft.invitationType === "platform" && <Check size={12} />}</i></button>
            <button className={draft.invitationType === "service" ? "selected" : ""} type="button" onClick={() => changeType("service")}><Target size={17} /><span><strong>Single service</strong><small>Focus on one specific service</small></span><i>{draft.invitationType === "service" && <Check size={12} />}</i></button>
          </div>
        </div>

        <div className="studio-form-grid two">
          <label><span>Template name</span><input value={draft.name} onChange={(event) => update("name", event.target.value)} placeholder={draft.invitationType === "platform" ? "Example: AgenticThat introduction" : "Example: Focused service introduction"} maxLength={100} /></label>
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
        <div className="studio-variables">
          <span><Sparkles size={15} />Insert into {variableField.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
          <div>{studio.variables.map((variable) => <button type="button" onClick={() => insertVariable(variable.key)} title={variable.label} key={variable.key}>{`{{${variable.key}}}`}</button>)}</div>
        </div>
        <label className="studio-field"><span>Footer note</span><textarea value={draft.footer} onFocus={() => setVariableField("footer")} onChange={(event) => update("footer", event.target.value)} rows={3} maxLength={600} /></label>
        <div className="studio-protected-field">
          <ExternalLink size={18} />
          <span><strong>Destination stays accurate</strong><small>{draft.invitationType === "platform" ? "The button opens the AgenticThat Store." : "The button opens the selected service page."} Links are filled automatically when you send.</small></span>
        </div>
        {(error || notice) && <p className={error ? "studio-message error" : "studio-message success"}>{error || notice}</p>}
        <div className="studio-editor-actions">
          <div className="studio-test-send">
            <input type="email" value={testEmail} onChange={(event) => setTestEmail(event.target.value)} placeholder="test@company.com" />
            <button type="button" disabled={busy || !studio.sender.configured || !validEmail(testEmail) || !previewProduct.key} onClick={test}><Send size={16} />Send test</button>
          </div>
          <div>
            <button className="studio-button secondary" type="button" disabled={busy || !dirty} onClick={() => save("draft")}>Save draft</button>
            <button className="studio-button primary" type="button" disabled={busy} onClick={() => save("published")}><Check size={16} />{draft.status === "published" ? "Save & publish" : "Publish"}</button>
            {selectedId && draft.status !== "archived" && <button className="studio-icon-button danger" type="button" disabled={busy} onClick={onArchive} aria-label="Archive template"><Archive size={17} /></button>}
          </div>
        </div>
      </section>
      <aside className="studio-preview-column">
        <EmailPreview template={draft} product={previewProduct} sender={previewSender} />
        <div className="studio-preview-note"><CheckCircle2 size={18} /><span><strong>Ready for every client</strong><small>Responsive HTML and plain text are generated safely for every send.</small></span></div>
      </aside>
    </div>
  );
}

function ProductInvitationComposer({ studio, onSent }) {
  const allPublishedTemplates = useMemo(() => studio.templates.filter((template) => template.status === "published"), [studio.templates]);
  const platformProduct = studio.products.find((product) => product.invitationType === "platform") || SAMPLE_PLATFORM;
  const serviceProducts = useMemo(() => studio.products.filter((product) => product.invitationType === "service"), [studio.products]);
  const [form, setForm] = useState({ recipientName: "", email: "", invitationType: "platform", productKey: "", templateId: "", senderId: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const publishedTemplates = useMemo(
    () => allPublishedTemplates.filter((template) => template.invitationType === form.invitationType),
    [allPublishedTemplates, form.invitationType],
  );

  useEffect(() => {
    const productsForType = form.invitationType === "platform" ? [platformProduct] : serviceProducts;
    setForm((current) => ({
      ...current,
      templateId: publishedTemplates.some((template) => template.id === current.templateId) ? current.templateId : publishedTemplates[0]?.id || "",
      productKey: productsForType.some((product) => product.key === current.productKey) ? current.productKey : productsForType[0]?.key || "",
      senderId: studio.sender.senders.some((sender) => sender.id === current.senderId) ? current.senderId : "",
    }));
  }, [form.invitationType, platformProduct, publishedTemplates, serviceProducts, studio.sender.senders]);

  const selectedTemplate = publishedTemplates.find((template) => template.id === form.templateId)
    || publishedTemplates[0]
    || blankTemplate(form.invitationType);
  const selectedProduct = form.invitationType === "platform"
    ? platformProduct
    : serviceProducts.find((product) => product.key === form.productKey) || serviceProducts[0] || SAMPLE_SERVICE;
  const selectedSender = studio.sender.senders.find((sender) => sender.id === form.senderId) || null;

  const updateForm = (values) => {
    setForm((current) => ({ ...current, ...values }));
    setError("");
    setNotice("");
  };
  const chooseType = (invitationType) => updateForm({ invitationType, productKey: "", templateId: "" });
  const send = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      await request("/api/admin-center/product-invitations", { method: "POST", body: JSON.stringify(form) });
      setNotice(`${form.invitationType === "platform" ? "AgenticThat introduction" : "Service introduction"} sent to ${form.email}.`);
      setForm((current) => ({ ...current, recipientName: "", email: "", senderId: "" }));
      await onSent();
    } catch (sendError) {
      setError(sendError.message);
      await onSent();
    } finally {
      setBusy(false);
    }
  };
  const ready = studio.sender.configured && validEmail(form.email) && form.productKey && form.templateId && form.senderId;

  return (
    <div className="studio-send-layout">
      <section className="studio-send-card">
        <div className="studio-card-heading">
          <span><small>Client introduction</small><h2>Send a polished introduction</h2></span>
          <span className="studio-step-pill">Ready in 3 steps</span>
        </div>
        {!studio.sender.configured && <div className="studio-config-warning"><XCircle size={19} /><span><strong>No approved sender is ready</strong><small>Configure an Email Studio sender and Resend or the email webhook before sending.</small></span></div>}
        {!allPublishedTemplates.length && <div className="studio-config-warning"><FileText size={19} /><span><strong>A published template is required</strong><small>Review an introduction template and publish it before sending.</small></span></div>}

        <div className="studio-section-label">
          <span>1</span>
          <div><strong>Add the client</strong><small>Use their name for a more personal introduction.</small></div>
        </div>
        <div className="studio-form-grid two">
          <label><span>Client name <em>Optional</em></span><input value={form.recipientName} onChange={(event) => updateForm({ recipientName: event.target.value })} placeholder="Alex Morgan" maxLength={100} /></label>
          <label><span>Client email</span><input type="email" value={form.email} onChange={(event) => updateForm({ email: event.target.value })} placeholder="alex@company.com" /></label>
        </div>

        <div className="studio-section-label">
          <span>2</span>
          <div><strong>Choose what to introduce</strong><small>Share the complete AgenticThat platform or focus on one service.</small></div>
        </div>
        <div className="studio-invitation-type-grid">
          <button className={form.invitationType === "platform" ? "selected" : ""} type="button" onClick={() => chooseType("platform")}>
            <i><Store size={21} /></i>
            <span><strong>Introduce AgenticThat</strong><small>Explain the platform and its live service families.</small></span>
            <b>{form.invitationType === "platform" && <Check size={13} />}</b>
          </button>
          <button className={form.invitationType === "service" ? "selected" : ""} type="button" onClick={() => chooseType("service")}>
            <i><Target size={21} /></i>
            <span><strong>Share one service</strong><small>Send a focused introduction with its exact Store page.</small></span>
            <b>{form.invitationType === "service" && <Check size={13} />}</b>
          </button>
        </div>

        {form.invitationType === "platform" ? (
          <div className="studio-platform-overview">
            <div className="studio-platform-title"><span><Store size={20} /></span><div><small>Complete platform</small><strong>AgenticThat</strong><p>{platformProduct.description}</p></div><b>Store overview</b></div>
            <div className="studio-platform-services">
              {(platformProduct.highlights || []).map((highlight) => {
                const HighlightIcon = HIGHLIGHT_ICONS[highlight.key] || Sparkles;
                return <span key={highlight.key}><i><HighlightIcon size={15} /></i><span><strong>{highlight.name}</strong><small>{highlight.services}</small></span></span>;
              })}
            </div>
          </div>
        ) : (
          <div className="studio-service-picker">
            <span className="studio-picker-label">Select a service</span>
            <div className="studio-product-grid">
              {serviceProducts.map((product) => (
                <label className={form.productKey === product.key ? "selected" : ""} key={product.key}>
                  <input type="radio" name="product" checked={form.productKey === product.key} onChange={() => updateForm({ productKey: product.key })} />
                  <span className="studio-product-logo">{product.logo ? <img src={product.logo} alt="" /> : <PackageOpen size={19} />}</span>
                  <span><strong>{product.name}</strong><small>{product.description}</small></span>
                  <i>{form.productKey === product.key && <Check size={12} />}</i>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="studio-section-label">
          <span>3</span>
          <div><strong>Choose the message and sender</strong><small>Only matching published templates and approved sender addresses appear here.</small></div>
        </div>
        {!publishedTemplates.length && <div className="studio-inline-warning"><FileText size={17} />Publish an {form.invitationType === "platform" ? "AgenticThat overview" : "single-service"} template to continue.</div>}
        <div className="studio-form-grid two">
          <label><span>Email template</span><select value={form.templateId} onChange={(event) => updateForm({ templateId: event.target.value })}><option value="">Choose a published template</option>{publishedTemplates.map((template) => <option value={template.id} key={template.id}>{template.name} · v{template.version}</option>)}</select></label>
          <label><span>Send from</span><select value={form.senderId} onChange={(event) => updateForm({ senderId: event.target.value })}><option value="">Choose an approved sender</option>{studio.sender.senders.map((sender) => <option value={sender.id} key={sender.id}>{sender.from}</option>)}</select></label>
        </div>
        <p className="studio-sender-help"><CheckCircle2 size={15} />The sender is selected for this email only.</p>
        {(error || notice) && <p className={error ? "studio-message error" : "studio-message success"}>{error || notice}</p>}
        <button className="studio-send-button" type="button" disabled={busy || !ready} onClick={send}>
          {busy
            ? <><RefreshCw className="spin" size={18} />Sending introduction…</>
            : <><Send size={18} />{form.invitationType === "platform" ? "Send AgenticThat introduction" : "Send service introduction"}<ArrowRight size={18} /></>}
        </button>
      </section>
      <aside className="studio-send-preview">
        <div className="studio-preview-heading"><span><small>Client will receive</small><strong>{invitationTypeLabel(form.invitationType)}</strong></span><span><i />Live preview</span></div>
        <EmailPreview template={selectedTemplate} product={selectedProduct} sender={selectedSender} compact />
        <div className="studio-send-summary">
          <span><Mail size={16} /><small>From</small><strong>{selectedSender?.from || "Choose sender"}</strong></span>
          <span>{form.invitationType === "platform" ? <Store size={16} /> : <PackageOpen size={16} />}<small>Invitation</small><strong>{selectedProduct.name}</strong></span>
          <span><ExternalLink size={16} /><small>Destination</small><strong>{form.invitationType === "platform" ? "AgenticThat Store" : "Service page"}</strong></span>
        </div>
      </aside>
    </div>
  );
}

function ActivityView({ studio, onUpdated }) {
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const resend = async (delivery) => {
    setBusyId(delivery.id); setError("");
    try {
      await request(`/api/admin-center/product-invitations/${encodeURIComponent(delivery.id)}`, { method: "PATCH", body: JSON.stringify({ action: "resend" }) });
      await onUpdated();
    } catch (actionError) {
      setError(actionError.message);
      await onUpdated();
    } finally {
      setBusyId("");
    }
  };

  return (
    <section className="studio-activity-card">
      <div className="studio-card-heading">
        <span><small>Client email delivery</small><h2>Invitation activity</h2></span>
        <button className="studio-button secondary" type="button" onClick={onUpdated}><RefreshCw size={15} />Refresh</button>
      </div>
      {error && <p className="studio-message error">{error}</p>}
      <div className="studio-activity-head"><span>Client</span><span>Invitation</span><span>Template</span><span>Status</span><span>Sent</span><span /></div>
      <div className="studio-activity-list">
        {studio.deliveries.map((delivery) => (
          <article key={delivery.id}>
            <span className="studio-recipient"><i>{String(delivery.recipientName || delivery.recipientEmail).charAt(0).toUpperCase()}</i><span><strong>{delivery.recipientName || delivery.recipientEmail}</strong><small>{delivery.recipientEmail}</small></span></span>
            <span><strong>{delivery.productName}</strong><small>{invitationTypeLabel(delivery.invitationType)}</small></span>
            <span><strong>{delivery.templateName}</strong><small>Version {delivery.templateVersion} · {delivery.senderFrom}</small></span>
            <span><b className={`studio-delivery-status ${delivery.status}`}><i />{delivery.status}</b>{delivery.error && <small title={delivery.error}>{delivery.error}</small>}</span>
            <span><strong>{timeLabel(delivery.sentAt || delivery.queuedAt)}</strong><small>{delivery.attemptCount} {delivery.attemptCount === 1 ? "attempt" : "attempts"}</small></span>
            <span className="studio-row-actions">{delivery.status !== "queued" && <button type="button" disabled={busyId === delivery.id} onClick={() => resend(delivery)} title="Resend"><RefreshCw size={15} /></button>}</span>
          </article>
        ))}
        {!studio.deliveries.length && <div className="studio-empty-state"><span><History size={24} /></span><strong>No client introductions yet</strong><small>Your first AgenticThat or service introduction will appear here.</small></div>}
      </div>
    </section>
  );
}

export default function AdminEmailStudio() {
  const [studio, setStudio] = useState({ sender: { configured: false, from: "Loading…", provider: null, defaultSenderId: null, senders: [] }, variables: [], products: [], templates: [], deliveries: [] });
  const [view, setView] = useState("send");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState(blankTemplate("platform"));
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
        if (selected) {
          setSelectedId(selected.id);
          setDraft(selected);
          setDirty(false);
        }
      }
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const choose = (template) => {
    if (dirty && !window.confirm("Discard your unsaved template changes?")) return;
    setSelectedId(template.id);
    setDraft(template);
    setDirty(false);
  };
  const createNew = () => {
    if (dirty && !window.confirm("Discard your unsaved template changes?")) return;
    setSelectedId("");
    setDraft(blankTemplate("platform"));
    setDirty(false);
  };
  const archive = async () => {
    if (!selectedId || !window.confirm(`Archive "${draft.name}"? It will no longer be available for new client introductions.`)) return;
    try {
      await request(`/api/admin-center/email-templates/${encodeURIComponent(selectedId)}`, { method: "PATCH", body: JSON.stringify({ ...draft, status: "archived" }) });
      await load();
    } catch (error) {
      setLoadError(error.message);
    }
  };
  const publishedCount = useMemo(() => studio.templates.filter((template) => template.status === "published").length, [studio.templates]);

  if (loading) return <div className="studio-loading"><RefreshCw className="spin" size={20} />Preparing Email Studio…</div>;

  return (
    <div className="admin-email-studio">
      <div className="studio-hero">
        <div>
          <span className="studio-hero-icon"><Sparkles size={23} /></span>
          <span><p>Client introductions</p><h1>Email Studio</h1><small>Introduce the complete AgenticThat platform or share one service with a polished, reusable email.</small></span>
        </div>
        <div className={`studio-sender-card${studio.sender.configured ? " ready" : ""}`}>
          <span><i /><small>{studio.sender.configured ? "Approved senders ready" : "Setup required"}</small><strong>{studio.sender.configured ? `${studio.sender.senders.length} sender${studio.sender.senders.length === 1 ? "" : "s"} available` : "No Email Studio sender configured"}</strong></span>
          <b>{studio.sender.configured ? `Choose per email · ${studio.sender.provider}` : "Not ready"}</b>
        </div>
      </div>
      <nav className="studio-view-tabs" aria-label="Email Studio sections">
        <button className={view === "send" ? "active" : ""} type="button" onClick={() => setView("send")}><Send size={19} /><span>Send introduction<small>Platform or individual service</small></span></button>
        <button className={view === "templates" ? "active" : ""} type="button" onClick={() => setView("templates")}><CopyPlus size={19} /><span>Templates<small>{studio.templates.length} saved · {publishedCount} live</small></span></button>
        <button className={view === "activity" ? "active" : ""} type="button" onClick={() => setView("activity")}><History size={19} /><span>Activity<small>{studio.deliveries.length} recent client emails</small></span></button>
      </nav>
      {loadError && <p className="studio-message error">{loadError} <button type="button" onClick={() => load(selectedId, true)}>Try again</button></p>}
      {view === "send" && <ProductInvitationComposer studio={studio} onSent={() => load(selectedId, true)} />}
      {view === "templates" && <div className="studio-template-layout"><TemplateList templates={studio.templates} selectedId={selectedId} query={query} setQuery={setQuery} onChoose={choose} onNew={createNew} /><TemplateEditor studio={studio} selectedId={selectedId} draft={draft} setDraft={setDraft} dirty={dirty} setDirty={setDirty} onSaved={(id) => load(id)} onArchive={archive} /></div>}
      {view === "activity" && <ActivityView studio={studio} onUpdated={() => load(selectedId, true)} />}
    </div>
  );
}
