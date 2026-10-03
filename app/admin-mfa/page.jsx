"use client";

import { useEffect, useState } from "react";

const card = { maxWidth: 620, margin: "8vh auto", padding: 32, border: "1px solid #dbe2ea", borderRadius: 18, background: "white", fontFamily: "Arial, sans-serif" };
const input = { width: "100%", padding: 12, margin: "8px 0 16px", border: "1px solid #bcc7d5", borderRadius: 8, fontSize: 18, letterSpacing: 2 };
const button = { padding: "12px 18px", border: 0, borderRadius: 8, background: "#5b55df", color: "white", cursor: "pointer" };

export default function AdminMfaPage() {
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const next = typeof window === "undefined" ? "/admin-center" : (() => {
    const candidate = new URLSearchParams(window.location.search).get("next") || "/admin-center";
    return candidate.startsWith("/") && !candidate.startsWith("//") ? candidate : "/admin-center";
  })();

  useEffect(() => {
    fetch("/api/platform-auth/mfa/setup", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "begin" }),
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "MFA setup is unavailable.");
      setSetup(data);
    }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "MFA setup is unavailable."));
  }, []);

  async function submit(event) {
    event.preventDefault(); setError("");
    const endpoint = setup?.enabled ? "/api/platform-auth/mfa/verify" : "/api/platform-auth/mfa/setup";
    const body = setup?.enabled ? { code } : { action: "confirm", code };
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setError(data.error || "The authentication code is invalid."); return; }
    if (Array.isArray(data.recoveryCodes)) { setRecoveryCodes(data.recoveryCodes); return; }
    window.location.replace(next);
  }

  return <main style={card}><h1>Administrator security</h1>{error && <p role="alert">{error}</p>}{!setup && !error && <p>Loading secure MFA setup…</p>}{setup && !recoveryCodes.length && <><p>{setup.enabled ? "Enter the six-digit code from your authenticator app or one unused recovery code." : "In your authenticator app, choose Enter setup key. Use AgenticThat as the account name and choose Time-based."}</p>{!setup.enabled && <><p><strong>Setup key</strong></p><code style={{ overflowWrap: "anywhere" }}>{setup.secret}</code><p><small>If a code is rejected, enable automatic date and time on your phone before trying again.</small></p></>}<form onSubmit={submit}><label>Authentication code<input style={input} value={code} onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code" minLength={6} maxLength={20} required /></label><button style={button}>Verify and continue</button></form></>}{recoveryCodes.length > 0 && <><h2>Save your recovery codes</h2><p>Each code works once. Store them outside this device.</p><pre style={{ padding: 16, background: "#f3f5f8", borderRadius: 8 }}>{recoveryCodes.join("\n")}</pre><button style={button} onClick={() => window.location.replace(next)}>I saved these codes</button></>}</main>;
}
