"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  X,
} from "lucide-react";
import styles from "./whatsapp-login-modal.module.css";

const EMPTY_FORM = {
  username: "",
  password: "",
  displayName: "",
  businessName: "",
};

async function responsePayload(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "The WhatsApp login could not be completed.");
    error.status = response.status;
    throw error;
  }
  return data;
}

async function whatsappAuthRequest(path, init = {}) {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`/api/whatsapp${path}`, {
    cache: "no-store",
    credentials: "include",
    ...init,
    headers,
  });
  return responsePayload(response);
}

export default function WhatsAppLoginModal({
  open,
  canRegister = false,
  initialMode = "signin",
  onClose,
  onAuthenticated,
}) {
  const firstInputRef = useRef(null);
  const closeRef = useRef(onClose);
  const authenticatedRef = useRef(onAuthenticated);
  const busyRef = useRef(false);
  const [mode, setMode] = useState(initialMode === "register" && canRegister ? "register" : "signin");
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    closeRef.current = onClose;
    authenticatedRef.current = onAuthenticated;
  }, [onAuthenticated, onClose]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    if (!open) return undefined;

    let active = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setMode(initialMode === "register" && canRegister ? "register" : "signin");
    setError("");
    setShowPassword(false);
    setLoading(true);

    void whatsappAuthRequest("/auth/session")
      .then((data) => {
        if (!active) return;
        if (data.authenticated) {
          authenticatedRef.current?.(data);
          return;
        }
        const hints = data.workspace || {};
        setForm({
          username: hints.username || "",
          password: "",
          displayName: hints.displayName || "",
          businessName: hints.businessName || "",
        });
        window.setTimeout(() => firstInputRef.current?.focus(), 40);
      })
      .catch((loadError) => {
        if (active) setError(loadError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !busyRef.current) closeRef.current?.();
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      active = false;
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [canRegister, initialMode, open]);

  if (!open) return null;

  const registering = mode === "register";
  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  const changeMode = (nextMode) => {
    if (busy || (nextMode === "register" && !canRegister)) return;
    setMode(nextMode);
    setError("");
    setForm((current) => ({ ...current, password: "" }));
  };

  const requestClose = () => {
    if (!busy) onClose?.();
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await whatsappAuthRequest(registering ? "/auth/register" : "/auth/session", {
        method: "POST",
        body: JSON.stringify(registering
          ? {
              username: form.username.trim(),
              password: form.password,
              displayName: form.displayName.trim(),
              businessName: form.businessName.trim(),
            }
          : { username: form.username.trim(), password: form.password }),
      });
      setForm((current) => ({ ...current, password: "" }));
      authenticatedRef.current?.(data);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={styles.overlay}
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && requestClose()}
    >
      <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="whatsapp-login-title">
        <button className={styles.close} type="button" aria-label="Close WhatsApp login" onClick={requestClose} disabled={busy}>
          <X size={19} />
        </button>

        <aside className={styles.story}>
          <span className={styles.logo}><img src="/whatsapp-logo.svg" alt="" /></span>
          <div>
            <p>WhatsApp workspace</p>
            <h2>Sign in once. Return from the Store anytime.</h2>
            <span>Your saved session opens the same WhatsApp workspace for conversations, contacts, templates, and campaigns.</span>
          </div>
          <ul>
            <li><CheckCircle2 size={16} />30-day secure session</li>
            <li><ShieldCheck size={16} />Passwords are hashed, never stored as plain text</li>
            <li><LockKeyhole size={16} />Workspace access stays tied to AgenticThat</li>
          </ul>
        </aside>

        <div className={styles.panel}>
          <div className={styles.modeSwitch} role="tablist" aria-label="WhatsApp workspace access">
            <button type="button" role="tab" aria-selected={!registering} className={!registering ? styles.active : ""} onClick={() => changeMode("signin")} disabled={busy}>Sign in</button>
            {canRegister && <button type="button" role="tab" aria-selected={registering} className={registering ? styles.active : ""} onClick={() => changeMode("register")} disabled={busy}>Create login</button>}
          </div>

          <header>
            <span>{registering ? "First-time setup" : "Welcome back"}</span>
            <h2 id="whatsapp-login-title">{registering ? "Save a WhatsApp workspace login" : "Open your WhatsApp workspace"}</h2>
            <p>{registering
              ? "Create the shared workspace credentials your approved team members can use."
              : "Use the WhatsApp workspace credentials saved during setup."}</p>
          </header>

          {loading ? (
            <div className={styles.loading} role="status"><Loader2 size={21} />Checking your saved login…</div>
          ) : (
            <form onSubmit={submit}>
              {registering && (
                <div className={styles.twoColumns}>
                  <label>
                    <span>Business name</span>
                    <input ref={firstInputRef} value={form.businessName} onChange={update("businessName")} autoComplete="organization" placeholder="Your business" />
                  </label>
                  <label>
                    <span>Your name</span>
                    <input value={form.displayName} onChange={update("displayName")} autoComplete="name" placeholder="Workspace owner" />
                  </label>
                </div>
              )}

              <label>
                <span>Workspace username</span>
                <input ref={registering ? undefined : firstInputRef} type="email" value={form.username} onChange={update("username")} autoComplete="username" placeholder="you@example.com" required />
              </label>

              <label>
                <span>Password</span>
                <div className={styles.passwordField}>
                  <input type={showPassword ? "text" : "password"} value={form.password} onChange={update("password")} autoComplete={registering ? "new-password" : "current-password"} minLength={registering ? 8 : undefined} required />
                  <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"}>
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </label>

              <div className={`${styles.error}${error ? ` ${styles.visible}` : ""}`} role="alert">{error || " "}</div>

              <button className={styles.submit} type="submit" disabled={busy}>
                {busy ? <Loader2 className={styles.spin} size={17} /> : <ArrowRight size={17} />}
                {busy ? "Saving secure session…" : registering ? "Save login and continue" : "Sign in and continue"}
              </button>
            </form>
          )}

          {!canRegister && <p className={styles.permissionNote}>Only a workspace administrator can create or replace the saved WhatsApp login.</p>}
        </div>
      </section>
    </div>
  );
}
