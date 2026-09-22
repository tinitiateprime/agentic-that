"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Bot,
  Check,
  CircleAlert,
  Clock3,
  Copy,
  ExternalLink,
  Image,
  LoaderCircle,
  Mail,
  MonitorSmartphone,
  RefreshCw,
  Rocket,
  Sparkles,
  WandSparkles,
} from "lucide-react";

const EMPTY_FORM = {
  businessName: "",
  businessType: "",
  businessEmail: "",
  description: "",
  services: "",
  location: "",
  phone: "",
  heroImage: "",
  bookingUrl: "",
};

async function studioRequest(path, init) {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "The operation failed.");
    error.code = data.code;
    throw error;
  }
  return data;
}

function Field({ label, hint, required = false, wide = false, children }) {
  return (
    <label className={`waas-admin-field${wide ? " wide" : ""}`}>
      <span>
        {label}
        {required ? <em>Required</em> : hint ? <small>{hint}</small> : null}
      </span>
      {children}
    </label>
  );
}

function StatusBadge({ status }) {
  const label = String(status || "unknown").replaceAll("_", " ");
  return <span className={`waas-admin-status ${status || "unknown"}`}><i />{label}</span>;
}

function ProjectRow({ project, onRetry, retrying }) {
  const passed = project.qaReport?.checks?.filter((item) => item.passed).length || 0;
  const total = project.qaReport?.checks?.length || 0;
  const failed = project.status === "failed";
  const deliveryLabel = failed
    ? "Not sent"
    : project.selectedTheme
      ? `${project.selectedTheme} selected`
      : "Awaiting selection";

  return (
    <article className="waas-admin-project">
      <div className="waas-project-brand">
        <span>{project.businessName.charAt(0).toUpperCase()}</span>
        <div><strong>{project.businessName}</strong><small>{project.businessType}</small></div>
      </div>
      <div><small>Delivery email</small><strong>{project.clientEmail}</strong><span>{project.clientName}</span></div>
      <div><small>Automation</small><StatusBadge status={project.status} /><span>{project.generationModel || "AI generation"}</span></div>
      <div><small>Quality</small><strong>{total ? `${passed}/${total} checks passed` : "Not completed"}</strong><span>{project.generationAttempts ? `${project.generationAttempts} AI call${project.generationAttempts === 1 ? "" : "s"}` : "Queued"}</span></div>
      <div><small>Delivery</small>{failed ? <StatusBadge status="failed" /> : <StatusBadge status={project.emailStatus} />}<span>{deliveryLabel}</span></div>
      <div className="waas-project-action">
        {project.publishedUrl
          ? <a href={project.publishedUrl} target="_blank" rel="noreferrer" aria-label={`Open ${project.businessName}`}><ExternalLink size={18} /></a>
          : failed
            ? <button type="button" onClick={() => onRetry(project)} disabled={retrying} aria-label={`Retry ${project.businessName}`}>{retrying ? <LoaderCircle className="waas-spin" size={17} /> : <RefreshCw size={17} />}</button>
            : <span><Clock3 size={17} /></span>}
      </div>
      {(project.failureMessage || project.emailError) && (
        <p className="waas-project-warning">
          <CircleAlert size={16} />
          <span>{project.failureMessage || `Website generated, but email failed: ${project.emailError}`}</span>
          {failed && <button type="button" onClick={() => onRetry(project)} disabled={retrying}>{retrying ? "Retrying…" : "Retry now"}</button>}
        </p>
      )}
    </article>
  );
}

function projectPayload(form) {
  return {
    clientName: `${form.businessName.trim()} team`,
    clientEmail: form.businessEmail,
    businessProfile: {
      businessName: form.businessName,
      businessType: form.businessType,
      description: form.description,
      services: form.services.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      location: form.location,
      phone: form.phone,
      email: form.businessEmail,
      bookingUrl: form.bookingUrl,
      heroImage: form.heroImage,
      language: "English",
    },
  };
}

export default function AdminWebsiteStudio() {
  const [snapshot, setSnapshot] = useState({
    configured: true,
    model: "gemini-3.8-flash",
    fallbackModels: [],
    projects: [],
  });
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [retryingId, setRetryingId] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState("");
  const [view, setView] = useState("create");

  const refresh = async () => {
    try {
      setSnapshot(await studioRequest("/api/admin-center/website-studio"));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const stats = useMemo(() => ({
    total: snapshot.projects.length,
    live: snapshot.projects.filter((project) => project.status === "published").length,
    waiting: snapshot.projects.filter((project) => project.status === "awaiting_selection").length,
    failed: snapshot.projects.filter((project) => project.status === "failed").length,
  }), [snapshot.projects]);

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const generate = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const data = await studioRequest("/api/admin-center/website-studio", {
        method: "POST",
        body: JSON.stringify(projectPayload(form)),
      });
      setResult(data);
      setForm(EMPTY_FORM);
      await refresh();
    } catch (generationError) {
      setError(generationError.message);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const retry = async (project) => {
    setRetryingId(project.id);
    setError("");
    setResult(null);
    try {
      const data = await studioRequest("/api/admin-center/website-studio", {
        method: "POST",
        body: JSON.stringify({
          clientName: project.clientName,
          clientEmail: project.clientEmail,
          businessProfile: project.businessProfile,
        }),
      });
      setResult(data);
      setView("create");
      await refresh();
    } catch (retryError) {
      setError(retryError.message);
      await refresh();
    } finally {
      setRetryingId("");
    }
  };

  const copy = async (key, value) => {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(""), 1600);
  };

  return (
    <div className="waas-admin-studio">
      <header className="waas-admin-hero">
        <div className="waas-admin-hero-copy">
          <span className="waas-admin-icon"><WandSparkles size={24} /></span>
          <div>
            <p>Global Admin · Website automation</p>
            <h1>AI Website Studio</h1>
            <span>Five details in. Three polished websites delivered automatically.</span>
          </div>
        </div>
        <div className="waas-admin-model">
          <i className={snapshot.configured ? "ready" : ""} />
          <span>
            <small>Automatic AI routing</small>
            <strong>{snapshot.model}</strong>
            <em>{snapshot.fallbackModels?.length || 0} fallback models</em>
          </span>
          <b>{snapshot.configured ? "Ready" : "Setup required"}</b>
        </div>
      </header>

      <section className="waas-admin-overview">
        <article><span><MonitorSmartphone size={19} /></span><div><small>Projects</small><strong>{stats.total}</strong></div></article>
        <article><span><Rocket size={19} /></span><div><small>Published</small><strong>{stats.live}</strong></div></article>
        <article><span><Mail size={19} /></span><div><small>Awaiting choice</small><strong>{stats.waiting}</strong></div></article>
        <article className={stats.failed ? "has-failures" : ""}><span><BadgeCheck size={19} /></span><div><small>Needs retry</small><strong>{stats.failed}</strong></div></article>
      </section>

      <div className="waas-admin-tabs">
        <button type="button" className={view === "create" ? "active" : ""} onClick={() => setView("create")}><Sparkles size={17} />Create website</button>
        <button type="button" className={view === "projects" ? "active" : ""} onClick={() => setView("projects")}><Rocket size={17} />Delivery pipeline <span>{snapshot.projects.length}</span></button>
      </div>

      {!snapshot.configured && (
        <div className="waas-admin-alert">
          <CircleAlert size={20} />
          <div><strong>AI is not configured</strong><span>Add GEMINI_API_KEY to the server environment.</span></div>
        </div>
      )}
      {error && (
        <div className="waas-admin-alert error">
          <CircleAlert size={20} />
          <div><strong>Generation did not finish</strong><span>{error}</span></div>
        </div>
      )}

      {view === "create" && (
        <div className="waas-create-layout">
          <form className="waas-brief-card" onSubmit={generate}>
            <div className="waas-card-heading">
              <div><span>01</span><div><small>Quick business brief</small><h2>Only the essentials</h2></div></div>
              <p><strong>5 required fields</strong><span>AI handles the writing, structure and visual direction.</span></p>
            </div>

            <div className="waas-form-section">
              <h3>Business basics</h3>
              <div className="waas-form-grid">
                <Field label="Business name" required>
                  <input value={form.businessName} onChange={set("businessName")} placeholder="Example: Northstar Plumbing" required />
                </Field>
                <Field label="Business type" required>
                  <input value={form.businessType} onChange={set("businessType")} placeholder="Example: Residential plumbing company" required />
                </Field>
                <Field label="Business email" hint="Receives previews and appears on the website" required wide>
                  <input type="email" value={form.businessEmail} onChange={set("businessEmail")} placeholder="hello@business.com" required />
                </Field>
                <Field label="What makes this business useful?" required wide>
                  <textarea rows={4} value={form.description} onChange={set("description")} placeholder="Briefly explain what the business does, who it helps and what makes the experience different." minLength={40} required />
                </Field>
                <Field label="Services" hint="One service per line · every service is preserved" required wide>
                  <textarea rows={6} value={form.services} onChange={set("services")} placeholder={"Emergency plumbing\nLeak detection\nBathroom installations"} required />
                </Field>
              </div>
            </div>

            <div className="waas-form-section compact">
              <h3>Helpful contact details <span>Optional</span></h3>
              <div className="waas-form-grid">
                <Field label="Location" hint="City or service area">
                  <input value={form.location} onChange={set("location")} placeholder="Hyderabad, Telangana" />
                </Field>
                <Field label="Public phone">
                  <input value={form.phone} onChange={set("phone")} placeholder="+91 90000 00000" />
                </Field>
              </div>
            </div>

            <details className="waas-optional-details">
              <summary><span><Image size={18} />Add a photo or booking link</span><small>Optional finishing details</small></summary>
              <div className="waas-form-grid">
                <Field label="Hero image URL" hint="A high-quality business photo" wide>
                  <input type="url" value={form.heroImage} onChange={set("heroImage")} placeholder="https://example.com/business-photo.jpg" />
                </Field>
                <Field label="Booking or enquiry URL" wide>
                  <input type="url" value={form.bookingUrl} onChange={set("bookingUrl")} placeholder="https://example.com/book" />
                </Field>
              </div>
            </details>

            <div className="waas-automation-submit">
              <div>
                <Bot size={22} />
                <span><strong>Everything after this is automatic</strong><small>Generate → validate → create 3 previews → email the business</small></span>
              </div>
              <button type="submit" disabled={busy || !snapshot.configured}>
                {busy ? <LoaderCircle className="waas-spin" size={19} /> : <WandSparkles size={19} />}
                {busy ? "Creating websites…" : "Create & deliver"}
                {!busy && <ArrowUpRight size={18} />}
              </button>
            </div>
          </form>

          <aside className="waas-automation-map">
            <div className="waas-card-heading">
              <div><span>02</span><div><small>Automatic delivery</small><h2>What happens next</h2></div></div>
            </div>
            {[
              [Bot, "AI writes the complete website", "The latest Gemini model starts first. Busy models are retried and replaced automatically."],
              [BadgeCheck, "Quality checks run", "Every service, section and claim is validated before anything reaches the client."],
              [MonitorSmartphone, "Three designs are created", "Editorial, Momentum and Aura are complete responsive experiences—not colour swaps."],
              [Mail, "The client receives all previews", "One click selects and publishes the preferred website. No admin approval step."],
            ].map(([Icon, title, copy], index) => (
              <article key={title}>
                <span><Icon size={19} /></span>
                <i>{String(index + 1).padStart(2, "0")}</i>
                <div><strong>{title}</strong><p>{copy}</p></div>
              </article>
            ))}
          </aside>
        </div>
      )}

      {result && view === "create" && (
        <section className="waas-result-card">
          <div>
            <span><Check size={20} /></span>
            <div><small>Automation complete</small><h2>Three websites are ready.</h2><p>{result.deliveryWarning || "The preview email was delivered and the client can publish a favourite immediately."}</p></div>
          </div>
          <div className="waas-result-links">
            {Object.entries(result.previewLinks || {}).map(([theme, link]) => (
              <article key={theme}>
                <span>{theme}</span>
                <a href={link} target="_blank" rel="noreferrer">Open preview <ExternalLink size={15} /></a>
                <button type="button" onClick={() => copy(theme, link)} aria-label={`Copy ${theme} preview`}>{copied === theme ? <Check size={15} /> : <Copy size={15} />}</button>
              </article>
            ))}
          </div>
        </section>
      )}

      {view === "projects" && (
        <section className="waas-projects-card">
          <div className="waas-card-heading">
            <div><span><Rocket size={18} /></span><div><small>Latest 100 projects</small><h2>Delivery pipeline</h2></div></div>
            <button type="button" onClick={refresh} disabled={loading}><RefreshCw className={loading ? "waas-spin" : ""} size={16} />Refresh</button>
          </div>
          {loading
            ? <div className="waas-admin-empty"><LoaderCircle className="waas-spin" /><span>Loading website projects…</span></div>
            : snapshot.projects.length
              ? <div className="waas-project-list">{snapshot.projects.map((project) => <ProjectRow project={project} onRetry={retry} retrying={retryingId === project.id} key={project.id} />)}</div>
              : <div className="waas-admin-empty"><MonitorSmartphone /><strong>No websites generated yet</strong><span>Your first automatic delivery will appear here.</span></div>}
        </section>
      )}

      <p className="waas-studio-footnote"><BadgeCheck size={15} />Accessible only to Global Admins <ArrowRight size={14} /> AI generation and delivery are server-side.</p>
    </div>
  );
}
