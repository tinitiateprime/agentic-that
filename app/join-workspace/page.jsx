"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import "./join-workspace.css";

const PENDING_INVITE_KEY = "agenticthat.pendingInvitation";

function JoinForm() {
  const token = useSearchParams().get("token") || "";
  const [invitation, setInvitation] = useState(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(token ? "" : "The invitation token is missing.");
  const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState({ state: "idle", message: "" });

  // Sends the password reset email for the invited address, from this page.
  // The invitation is remembered so the reset page can bring them back here.
  async function sendReset() {
    if (!invitation || reset.state === "sending") return;
    setReset({ state: "sending", message: "" });
    try { window.localStorage.setItem(PENDING_INVITE_KEY, window.location.href); } catch {}
    try {
      const response = await fetch("/api/platform-auth/password-reset/request", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: invitation.email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The reset email could not be sent.");
      setReset({ state: "sent", message: "" });
    } catch (resetError) {
      setReset({ state: "error", message: resetError.message });
    }
  }

  useEffect(() => {
    if (!token) return;
    fetch(`/api/workspace-team/accept?token=${encodeURIComponent(token)}`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "This invitation is invalid.");
        setInvitation(data);
      })
      .catch((loadError) => setError(loadError.message));
  }, [token]);

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    const response = await fetch("/api/workspace-team/accept", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, name, password }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setError(data.error || "Unable to accept this invitation."); setBusy(false); return; }
    window.location.href = "/apps";
  }

  const existing = Boolean(invitation?.existingAccount);
  const company = invitation?.workspaceName || "your company workspace";
  return (
    <main className="join-shell">
      <form onSubmit={submit}>
        <a href="/" className="join-brand"><span>AT</span>AgenticThat</a>
        <p>Workspace invitation</p>
        <h1>{existing ? `Sign in to join ${company}` : `Join ${company}`}</h1>
        {invitation && <small>Invitation for <strong>{invitation.email}</strong>{existing ? ". You already have an AgenticThat account, so this company will be added to it. Your other companies stay as they are." : "."}</small>}
        {!existing && <label>Full name<input value={name} onChange={(event) => setName(event.target.value)} minLength={2} required /></label>}
        <label className="join-password">
          <span className="join-label-row">
            {existing ? "Your current password" : "Create password"}
            {existing && <button type="button" className="join-forgot" onClick={sendReset} disabled={reset.state === "sending"}>Forgot password?</button>}
          </span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={existing ? 1 : 8} autoComplete={existing ? "current-password" : "new-password"} required />
        </label>
        {existing && reset.state === "sending" && <p className="join-reset" role="status">Sending a reset link to <strong>{invitation.email}</strong>…</p>}
        {existing && reset.state === "sent" && (
          <div className="join-reset sent" role="status">
            <strong>Check {invitation.email}</strong>
            <span>We sent a link to set a new password. Open it, choose a new password, then come back to this invitation and sign in. The email can take a minute and may land in Spam.</span>
            <button type="button" className="join-forgot" onClick={sendReset}>Send it again</button>
          </div>
        )}
        {existing && reset.state === "error" && <p className="join-error" role="alert">{reset.message}</p>}
        {error && <p className="join-error">{error}</p>}
        <button disabled={busy || !invitation}>{busy ? "Joining…" : existing ? "Sign in and join" : "Accept invitation"}</button>
        {existing
          ? <div className="join-help"><strong>Don't know the password?</strong><span>Use <button type="button" className="join-forgot inline" onClick={sendReset} disabled={reset.state === "sending"}>Forgot password?</button> to get a reset link at {invitation?.email || "this email"}.</span></div>
          : <small>Invited employees join the existing workspace and do not start another trial.</small>}
      </form>
    </main>
  );
}

export default function JoinWorkspacePage() { return <Suspense><JoinForm /></Suspense>; }
