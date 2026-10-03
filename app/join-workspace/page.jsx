"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import "./join-workspace.css";

function JoinForm() {
  const token = useSearchParams().get("token") || "";
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    const response = await fetch("/api/workspace-team/accept", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, name, password }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setError(data.error || "Unable to accept this invitation."); setBusy(false); return; }
    window.location.href = "/apps";
  }
  return <main className="join-shell"><form onSubmit={submit}><a href="/" className="join-brand"><span>AT</span>AgenticThat</a><p>Workspace invitation</p><h1>Join your company workspace</h1><label>Full name<input value={name} onChange={(event) => setName(event.target.value)} minLength={2} required /></label><label>Create password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>{!token && <p className="join-error">The invitation token is missing.</p>}{error && <p className="join-error">{error}</p>}<button disabled={busy || !token}>{busy ? "Joining…" : "Accept invitation"}</button><small>Invited employees join the existing workspace and do not start another trial.</small></form></main>;
}

export default function JoinWorkspacePage() { return <Suspense><JoinForm /></Suspense>; }
