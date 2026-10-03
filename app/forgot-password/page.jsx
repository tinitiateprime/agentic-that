"use client";

import { useState } from "react";

const card = { maxWidth: 520, margin: "12vh auto", padding: 32, border: "1px solid #dbe2ea", borderRadius: 18, background: "white", fontFamily: "Arial, sans-serif" };
const input = { width: "100%", padding: 12, margin: "8px 0 16px", border: "1px solid #bcc7d5", borderRadius: 8 };
const button = { padding: "12px 18px", border: 0, borderRadius: 8, background: "#5b55df", color: "white", cursor: "pointer" };

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/platform-auth/password-reset/request", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to request a reset.");
      setMessage(data.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to request a reset.");
    } finally { setBusy(false); }
  }

  return <main style={card}><h1>Reset your password</h1><p>Enter your work email. We will send a secure, one-time link.</p><form onSubmit={submit}><label>Email<input style={input} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><button style={button} disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button></form>{message && <p role="status">{message}</p>}<p><a href="/?auth=login">Return to sign in</a></p></main>;
}
