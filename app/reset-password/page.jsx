"use client";

import { useState } from "react";

const card = { maxWidth: 520, margin: "12vh auto", padding: 32, border: "1px solid #dbe2ea", borderRadius: 18, background: "white", fontFamily: "Arial, sans-serif" };
const input = { width: "100%", padding: 12, margin: "8px 0 16px", border: "1px solid #bcc7d5", borderRadius: 8 };
const button = { padding: "12px 18px", border: 0, borderRadius: 8, background: "#5b55df", color: "white", cursor: "pointer" };

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [complete, setComplete] = useState(false);
  async function submit(event) {
    event.preventDefault(); setMessage("");
    if (password !== confirmation) { setMessage("Passwords do not match."); return; }
    const token = new URLSearchParams(window.location.search).get("token") || "";
    const response = await fetch("/api/platform-auth/password-reset/complete", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(data.error || "Password reset failed."); return; }
    setComplete(true); setMessage("Your password has been changed. You can sign in now.");
  }
  return <main style={card}><h1>Choose a new password</h1>{!complete && <form onSubmit={submit}><label>New password<input style={input} type="password" autoComplete="new-password" minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required /></label><label>Confirm password<input style={input} type="password" autoComplete="new-password" minLength={8} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></label><button style={button}>Change password</button></form>}{message && <p role="status">{message}</p>}{complete && <a href="/?auth=login">Sign in</a>}</main>;
}
