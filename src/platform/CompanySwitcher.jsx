"use client";

import { Check, ChevronDown, ChevronsUpDown, Loader2, UserPlus, UsersRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import styles from "./product-shell.module.css";

// One list for every switcher on the page (the sidebar tile and the Home card).
let workspacesRequest = null;
function loadWorkspaces() {
  workspacesRequest ??= fetch("/api/workspaces")
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => (Array.isArray(data?.workspaces) ? data.workspaces : []))
    .catch(() => []);
  return workspacesRequest;
}

// Each company keeps the same colour everywhere.
const TILE_COLOURS = [
  ["#fde68a", "#7a4b00"], ["#bfdbfe", "#1e3a8a"], ["#bbf7d0", "#14532d"], ["#fecdd3", "#881337"],
  ["#ddd6fe", "#4c1d95"], ["#fed7aa", "#7c2d12"], ["#a5f3fc", "#164e63"], ["#e9d5ff", "#581c87"],
];
function tileColours(key) {
  let hash = 0;
  for (const char of String(key || "")) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return TILE_COLOURS[Math.abs(hash) % TILE_COLOURS.length];
}
function initials(name) {
  const words = String(name || "?").trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] || "?") + (words.length > 1 ? words[1][0] : "")).toUpperCase();
}

export function CompanyTile({ id, name, size = 38 }) {
  const [background, color] = tileColours(id || name);
  return (
    <span className={styles.companyTile} style={{ width: size, height: size, flexBasis: size, background, color, fontSize: Math.round(size * 0.36) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/**
 * The companies this account belongs to, and switching between them.
 * variant "rail": the company tile at the top of the sidebar.
 * variant "card": the company card on Home.
 */
export default function CompanySwitcher({ user, variant = "rail" }) {
  const [workspaces, setWorkspaces] = useState(null);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const wrapper = useRef(null);
  const listId = useId();

  useEffect(() => {
    let active = true;
    loadWorkspaces().then((list) => { if (active) setWorkspaces(list); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => { if (wrapper.current && !wrapper.current.contains(event.target)) setOpen(false); };
    const onKeyDown = (event) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    // Put the keyboard on the current company.
    wrapper.current?.querySelector('[aria-current="true"], [role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const current = workspaces?.find((workspace) => workspace.current)
    || { id: user?.workspaceId || user?.businessName || "", name: user?.businessName || "Your company", isOwner: false };
  const list = workspaces?.length ? workspaces : [current];
  const others = list.filter((workspace) => !workspace.current).length;
  const capabilities = Array.isArray(user?.capabilities) ? user.capabilities : [];
  const canInvite = capabilities.includes("workspace.team.manage");

  async function choose(workspace) {
    if (workspace.current || busyId) { setOpen(false); return; }
    setBusyId(workspace.id); setError("");
    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: workspace.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Couldn't switch company. Try again.");
      window.location.href = "/apps";
    } catch (switchError) {
      setError(switchError.message);
      setBusyId("");
    }
  }

  // Arrow keys move between companies in the menu.
  function onMenuKeyDown(event) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [...wrapper.current.querySelectorAll('[role="menuitem"]')];
    const at = items.indexOf(document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
    event.preventDefault();
  }

  const menu = open && (
    <div className={`${styles.companyMenu} ${variant === "card" ? styles.companyMenuBelow : ""}`} role="menu" id={listId} aria-label="Your companies" onKeyDown={onMenuKeyDown}>
      <p className={styles.companyMenuTitle}>Your companies{list.length > 1 ? ` · ${list.length}` : ""}</p>
      {list.map((workspace) => (
        <button
          type="button"
          role="menuitem"
          key={workspace.id}
          className={`${styles.companyOption} ${workspace.current ? styles.companyOptionCurrent : ""}`}
          aria-current={workspace.current ? "true" : undefined}
          disabled={Boolean(busyId) && busyId !== workspace.id}
          onClick={() => choose(workspace)}
        >
          <CompanyTile id={workspace.id} name={workspace.name} size={34} />
          <span className={styles.companyOptionCopy}>
            <strong>{workspace.name}</strong>
            <small>{busyId === workspace.id ? "Switching…" : workspace.current ? "You're here" : workspace.isOwner ? "Owner" : "Member"}</small>
          </span>
          {busyId === workspace.id ? <Loader2 size={16} className={styles.companySpin} /> : workspace.current ? <Check size={16} /> : null}
        </button>
      ))}
      {error && <p className={styles.companyError} role="alert">{error}</p>}
      <div className={styles.companyMenuFooter}>
        {canInvite && (
          <Link role="menuitem" href="/workspace-team" className={styles.companyAction} onClick={() => setOpen(false)}>
            <UserPlus size={16} /><span><strong>Invite people to {current.name}</strong></span>
          </Link>
        )}
        <p className={styles.companyHint}>
          <UsersRound size={15} aria-hidden="true" />
          <span>To join another company, ask its owner to invite <b>{user?.email || "your email"}</b>. It appears here once you accept.</span>
        </p>
      </div>
    </div>
  );

  if (variant === "card") {
    return (
      <div className={styles.companyCardWrap} ref={wrapper}>
        <button type="button" className={styles.companyCard} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen((value) => !value)}>
          <CompanyTile id={current.id} name={current.name} size={40} />
          <span className={styles.companyCardCopy}>
            <small>Company</small>
            <strong>{current.name}</strong>
            <em>{others ? `${others} other ${others === 1 ? "company" : "companies"} · switch` : current.isOwner ? "Owner" : "Member"}</em>
          </span>
          <ChevronDown size={18} className={open ? styles.companyChevronOpen : ""} />
        </button>
        {menu}
      </div>
    );
  }

  return (
    <div className={styles.companyRailWrap} ref={wrapper}>
      <button
        type="button"
        className={styles.companyRailButton}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        title={`${current.name}${others ? " · switch company" : ""}`}
        onClick={() => setOpen((value) => !value)}
      >
        <CompanyTile id={current.id} name={current.name} size={40} />
        {others > 0 && <span className={styles.companyCount} aria-label={`${others + 1} companies`}><ChevronsUpDown size={11} /></span>}
      </button>
      {menu}
    </div>
  );
}
