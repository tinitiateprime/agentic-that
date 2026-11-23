"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import "./join-workspace.css";

function JoinForm() {
  const token = useSearchParams().get("token") || "";
  const [invitation, setInvitation] = useState(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(token ? "" : "The invitation token is missing.");
  const [busy, setBusy] = useState(false);

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
        <label>{existing ? "Your current password" : "Create password"}<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={existing ? 1 : 8} autoComplete={existing ? "current-password" : "new-password"} required /></label>
        {error && <p className="join-error">{error}</p>}
        <button disabled={busy || !invitation}>{busy ? "Joining…" : existing ? "Sign in and join" : "Accept invitation"}</button>
        {existing
          ? <small>Forgot your password? <a href="/forgot-password">Reset it</a>, then open this invitation again.</small>
          : <small>Invited employees join the existing workspace and do not start another trial.</small>}
      </form>
    </main>
  );
}

export default function JoinWorkspacePage() { return <Suspense><JoinForm /></Suspense>; }
