"use client";

import { Building2, Check } from "lucide-react";
import { useEffect, useState } from "react";
import styles from "./product-shell.module.css";

// Lists the companies this account belongs to and switches between them.
// Hidden for accounts that belong to a single company.
export default function WorkspaceSwitcher() {
  const [workspaces, setWorkspaces] = useState([]);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/workspaces")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (active && data?.workspaces) setWorkspaces(data.workspaces); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  if (workspaces.length < 2) return null;

  async function choose(workspace) {
    if (workspace.current || busyId) return;
    setBusyId(workspace.id); setError("");
    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: workspace.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to switch workspace.");
      window.location.href = "/apps";
    } catch (switchError) {
      setError(switchError.message);
      setBusyId("");
    }
  }

  return (
    <section className={styles.workspaceSwitcher} aria-label="Switch company">
      <h3>Your companies</h3>
      {workspaces.map((workspace) => (
        <button
          type="button"
          key={workspace.id}
          className={`${styles.workspaceOption} ${workspace.current ? styles.workspaceCurrent : ""}`}
          aria-current={workspace.current ? "true" : undefined}
          disabled={Boolean(busyId)}
          onClick={() => choose(workspace)}
        >
          <Building2 size={16} />
          <span>
            <strong>{workspace.name}</strong>
            <small>{busyId === workspace.id ? "Switching…" : workspace.isOwner ? "Owner" : "Member"}</small>
          </span>
          {workspace.current && <Check size={16} />}
        </button>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
