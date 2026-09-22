"use client";

import { useState } from "react";
import { ArrowRight, Check, LoaderCircle } from "lucide-react";

export default function WebsiteSelectionBar({ token, theme, businessName, publishedTheme, publishedUrl }) {
  const [state, setState] = useState(publishedTheme === theme ? "published" : "ready");
  const [error, setError] = useState("");

  const choose = async () => {
    setState("publishing");
    setError("");
    try {
      const response = await fetch(`/api/site-previews/${encodeURIComponent(token)}/select`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ theme }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to publish this website.");
      setState("published");
      window.location.assign(data.publishedUrl);
    } catch (publishError) {
      setState("ready");
      setError(publishError instanceof Error ? publishError.message : "Unable to publish this website.");
    }
  };

  const differentThemePublished = publishedTheme && publishedTheme !== theme;
  return <aside className="waas-selection-bar" aria-label="Website concept selection">
    <div className="waas-selection-copy">
      <span>{differentThemePublished ? "Website already published" : state === "published" ? "Selected concept" : "Private client preview"}</span>
      <strong>{businessName} · {theme}</strong>
      {error && <small role="alert">{error}</small>}
    </div>
    {differentThemePublished || state === "published" ? <a href={publishedUrl || "#"}><Check size={16} /> Open published website <ArrowRight size={16} /></a> : <button type="button" onClick={choose} disabled={state === "publishing"}>
      {state === "publishing" ? <LoaderCircle className="waas-spin" size={17} /> : <Check size={17} />}
      {state === "publishing" ? "Publishing automatically…" : "Choose this concept & publish"}
      {state !== "publishing" && <ArrowRight size={17} />}
    </button>}
  </aside>;
}
