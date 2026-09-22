"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  BadgeCheck,
  Bot,
  Check,
  CircleAlert,
  Clock3,
  Copy,
  ExternalLink,
  LoaderCircle,
  Mail,
  MonitorSmartphone,
  Palette,
  RefreshCw,
  Rocket,
  Sparkles,
  WandSparkles,
} from "lucide-react";

const EMPTY_FORM = {
  clientName: "",
  clientEmail: "",
  businessName: "",
  businessType: "",
  description: "",
  services: "",
  audience: "",
  goal: "",
  location: "",
  phone: "",
  businessEmail: "",
  hours: "",
  bookingUrl: "",
  heroImage: "",
  galleryImages: "",
  brandColor: "#183f35",
  accentColor: "#e8b931",
  language: "English",
};

async function studioRequest(path, init) {
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "The operation failed.");
    error.code = data.code;
    throw error;
  }
  return data;
}

function Field({ label, hint, wide = false, children }) {
  return <label className={`waas-admin-field${wide ? " wide" : ""}`}><span>{label}{hint && <small>{hint}</small>}</span>{children}</label>;
}

function StatusBadge({ status }) {
  const label = String(status || "unknown").replaceAll("_", " ");
  return <span className={`waas-admin-status ${status || "unknown"}`}><i />{label}</span>;
}

function ProjectRow({ project }) {
  const passed = project.qaReport?.checks?.filter((item) => item.passed).length || 0;
  const total = project.qaReport?.checks?.length || 0;
  return <article className="waas-admin-project">
    <div className="waas-project-brand"><span>{project.businessName.charAt(0).toUpperCase()}</span><div><strong>{project.businessName}</strong><small>{project.businessType}</small></div></div>
    <div><small>Client</small><strong>{project.clientName}</strong><span>{project.clientEmail}</span></div>
    <div><small>Automation</small><StatusBadge status={project.status} /><span>{project.generationModel || "Waiting for Gemini"}</span></div>
    <div><small>Quality gate</small><strong>{total ? `${passed}/${total} passed` : "Not completed"}</strong><span>{project.generationAttempts ? `${project.generationAttempts} generation attempt${project.generationAttempts === 1 ? "" : "s"}` : "Queued"}</span></div>
    <div><small>Delivery</small><StatusBadge status={project.emailStatus} /><span>{project.selectedTheme ? `${project.selectedTheme} selected` : "Awaiting selection"}</span></div>
    <div className="waas-project-action">{project.publishedUrl ? <a href={project.publishedUrl} target="_blank" rel="noreferrer" aria-label={`Open ${project.businessName}`}><ExternalLink size={16} /></a> : <span><Clock3 size={15} /></span>}</div>
    {(project.failureMessage || project.emailError) && <p className="waas-project-warning"><CircleAlert size={14} />{project.failureMessage || `Website generated, but email failed: ${project.emailError}`}</p>}
  </article>;
}

export default function AdminWebsiteStudio() {
  const [snapshot, setSnapshot] = useState({ configured: true, model: "gemini-3.6-flash", projects: [] });
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState("");
  const [view, setView] = useState("create");

  const refresh = async () => {
    setError("");
    try { setSnapshot(await studioRequest("/api/admin-center/website-studio")); }
    catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, []);

  const stats = useMemo(() => ({
    total: snapshot.projects.length,
    live: snapshot.projects.filter((project) => project.status === "published").length,
    waiting: snapshot.projects.filter((project) => project.status === "awaiting_selection").length,
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
        body: JSON.stringify({
          clientName: form.clientName,
          clientEmail: form.clientEmail,
          businessProfile: {
            businessName: form.businessName,
            businessType: form.businessType,
            description: form.description,
            services: form.services.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
            audience: form.audience,
            goal: form.goal,
            location: form.location,
            phone: form.phone,
            email: form.businessEmail,
            hours: form.hours,
            bookingUrl: form.bookingUrl,
            heroImage: form.heroImage,
            galleryImages: form.galleryImages.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
            brandColor: form.brandColor,
            accentColor: form.accentColor,
            language: form.language,
          },
        }),
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

  const copy = async (key, value) => {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(""), 1600);
  };

  return <div className="waas-admin-studio">
    <header className="waas-admin-hero">
      <div className="waas-admin-hero-copy"><span className="waas-admin-icon"><WandSparkles size={20} /></span><div><p>Autonomous delivery system</p><h1>AI Website Studio</h1><span>One brief becomes three business-specific websites. QA, private delivery and publishing happen automatically.</span></div></div>
      <div className="waas-admin-model"><i className={snapshot.configured ? "ready" : ""} /><span><small>Generation engine</small><strong>{snapshot.model}</strong></span><b>{snapshot.configured ? "Ready" : "Setup required"}</b></div>
    </header>

    <section className="waas-admin-overview">
      <article><span><MonitorSmartphone size={16} /></span><div><small>Websites created</small><strong>{stats.total}</strong></div></article>
      <article><span><Rocket size={16} /></span><div><small>Published automatically</small><strong>{stats.live}</strong></div></article>
      <article><span><Mail size={16} /></span><div><small>Awaiting client choice</small><strong>{stats.waiting}</strong></div></article>
      <article><span><BadgeCheck size={16} /></span><div><small>Human approval steps</small><strong>0</strong></div></article>
    </section>

    <div className="waas-admin-tabs"><button className={view === "create" ? "active" : ""} onClick={() => setView("create")}><Sparkles size={15} />Create & deliver</button><button className={view === "projects" ? "active" : ""} onClick={() => setView("projects")}><Rocket size={15} />Delivery pipeline <span>{snapshot.projects.length}</span></button></div>

    {!snapshot.configured && <div className="waas-admin-alert"><CircleAlert size={18} /><div><strong>Gemini is not configured</strong><span>Add GEMINI_API_KEY to the server environment before starting a generation.</span></div></div>}
    {error && <div className="waas-admin-alert error"><CircleAlert size={18} /><div><strong>Automation stopped safely</strong><span>{error}</span></div></div>}

    {view === "create" && <div className="waas-create-layout">
      <form className="waas-brief-card" onSubmit={generate}>
        <div className="waas-card-heading"><div><span>01</span><div><small>Verified source</small><h2>Client & business brief</h2></div></div><p>The generator is forbidden from inventing missing facts.</p></div>
        <div className="waas-form-section"><h3>Delivery contact</h3><div className="waas-form-grid"><Field label="Client name"><input value={form.clientName} onChange={set("clientName")} placeholder="Client's full name" required /></Field><Field label="Client email"><input type="email" value={form.clientEmail} onChange={set("clientEmail")} placeholder="client@business.com" required /></Field></div></div>
        <div className="waas-form-section"><h3>Business foundation</h3><div className="waas-form-grid"><Field label="Business name"><input value={form.businessName} onChange={set("businessName")} placeholder="Official business name" required /></Field><Field label="Business type"><input value={form.businessType} onChange={set("businessType")} placeholder="Describe the exact business category" required /></Field><Field label="Business description" hint="Be factual" wide><textarea rows={4} value={form.description} onChange={set("description")} placeholder="Explain what the business does, its approach and what makes the experience different…" minLength={40} required /></Field><Field label="Services" hint="One per line · every service is preserved" wide><textarea rows={5} value={form.services} onChange={set("services")} placeholder={"First real service or offering\nSecond real service or offering\nThird real service or offering"} required /></Field><Field label="Ideal customer"><input value={form.audience} onChange={set("audience")} placeholder="Describe the intended customers" /></Field><Field label="Primary website goal"><input value={form.goal} onChange={set("goal")} placeholder="Describe the desired customer action" /></Field></div></div>
        <div className="waas-form-section"><h3>Contact & conversion</h3><div className="waas-form-grid"><Field label="Location"><input value={form.location} onChange={set("location")} placeholder="Banjara Hills, Hyderabad" /></Field><Field label="Phone"><input value={form.phone} onChange={set("phone")} placeholder="+91 90000 00000" /></Field><Field label="Public email"><input type="email" value={form.businessEmail} onChange={set("businessEmail")} placeholder="hello@business.com" /></Field><Field label="Opening hours"><input value={form.hours} onChange={set("hours")} placeholder="Mon–Sat, 9 AM–7 PM" /></Field><Field label="Booking or enquiry URL" wide><input type="url" value={form.bookingUrl} onChange={set("bookingUrl")} placeholder="https://…" /></Field></div></div>
        <div className="waas-form-section"><h3>Visual direction</h3><div className="waas-form-grid"><Field label="Hero image URL" hint="Recommended" wide><input type="url" value={form.heroImage} onChange={set("heroImage")} placeholder="https://…/high-quality-business-photo.jpg" /></Field><Field label="Gallery image URLs" hint="Optional · one per line" wide><textarea rows={3} value={form.galleryImages} onChange={set("galleryImages")} placeholder={"https://…\nhttps://…"} /></Field><Field label="Primary brand colour"><span className="waas-color-control"><input type="color" value={form.brandColor} onChange={set("brandColor")} /><input value={form.brandColor} onChange={set("brandColor")} pattern="#[0-9a-fA-F]{6}" /></span></Field><Field label="Accent colour"><span className="waas-color-control"><input type="color" value={form.accentColor} onChange={set("accentColor")} /><input value={form.accentColor} onChange={set("accentColor")} pattern="#[0-9a-fA-F]{6}" /></span></Field><Field label="Website language"><select value={form.language} onChange={set("language")}><option>English</option><option>Hindi</option><option>Telugu</option></select></Field></div></div>
        <div className="waas-automation-submit"><div><Bot size={19} /><span><strong>Fully automatic after this click</strong><small>Generate → validate → repair if needed → create 3 previews → email client</small></span></div><button type="submit" disabled={busy || !snapshot.configured}>{busy ? <LoaderCircle className="waas-spin" size={17} /> : <WandSparkles size={17} />}{busy ? "Building three websites…" : "Generate, test & deliver"}<ArrowUpRight size={17} /></button></div>
      </form>

      <aside className="waas-automation-map"><div className="waas-card-heading"><div><span>02</span><div><small>No review queue</small><h2>Automatic pipeline</h2></div></div></div>{[
        [Bot, "Business intelligence", "Gemini turns only verified details into a structured, industry-aware content system."],
        [Palette, "Three premium directions", "Editorial, Momentum and Aura use independent layouts—not simple colour swaps."],
        [BadgeCheck, "Deterministic quality gate", "Structure, content depth, service grounding and placeholders are checked automatically."],
        [Mail, "Private delivery", "All three interactive preview links are sent to the client as soon as they pass."],
        [Rocket, "One-click publishing", "The client's selection instantly becomes the live website without admin approval."],
      ].map(([Icon, title, copy], index) => <article key={title}><span><Icon size={17} /></span><i>{String(index + 1).padStart(2, "0")}</i><div><strong>{title}</strong><p>{copy}</p></div></article>)}</aside>
    </div>}

    {result && view === "create" && <section className="waas-result-card"><div><span><Check size={18} /></span><div><small>Automation complete</small><h2>Three websites generated and {result.deliveryWarning ? "ready to share" : "delivered"}.</h2><p>{result.deliveryWarning || `${result.project.clientName} can now explore the concepts and publish a favourite automatically.`}</p></div></div><div className="waas-result-links">{Object.entries(result.previewLinks || {}).map(([theme, link]) => <article key={theme}><span>{theme}</span><a href={link} target="_blank" rel="noreferrer">Open preview <ExternalLink size={14} /></a><button type="button" onClick={() => copy(theme, link)}>{copied === theme ? <Check size={14} /> : <Copy size={14} />}</button></article>)}</div></section>}

    {view === "projects" && <section className="waas-projects-card"><div className="waas-card-heading"><div><span><Rocket size={16} /></span><div><small>Latest 100 projects</small><h2>Autonomous delivery pipeline</h2></div></div><button type="button" onClick={refresh} disabled={loading}><RefreshCw className={loading ? "waas-spin" : ""} size={15} />Refresh</button></div>{loading ? <div className="waas-admin-empty"><LoaderCircle className="waas-spin" /><span>Loading website projects…</span></div> : snapshot.projects.length ? <div className="waas-project-list">{snapshot.projects.map((project) => <ProjectRow project={project} key={project.id} />)}</div> : <div className="waas-admin-empty"><MonitorSmartphone /><strong>No websites generated yet</strong><span>Your first automated delivery will appear here.</span></div>}</section>}
  </div>;
}
