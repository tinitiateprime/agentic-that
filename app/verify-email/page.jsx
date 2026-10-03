"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./verify-email.module.css";

const statusContent = {
  verifying: {
    eyebrow: "Secure verification",
    title: "Confirming your email",
    description: "Please keep this page open for a moment while we securely activate your account.",
  },
  success: {
    eyebrow: "Verification complete",
    title: "Your email is verified",
    description: "You're signed in. We're opening your AgenticThat workspace now.",
  },
  error: {
    eyebrow: "Link needs attention",
    title: "We couldn't verify this link",
    description: "Verification links work once and expire after 24 hours. Sign in to request a fresh link.",
  },
};

function StatusIcon({ status }) {
  if (status === "verifying") return <span className={styles.spinner} aria-hidden="true" />;
  if (status === "success") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7" /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5m0 3.5v.1M12 3.5 21 20H3L12 3.5Z" /></svg>;
}

export default function VerifyEmailPage() {
  const started = useRef(false);
  const [status, setStatus] = useState("verifying");
  const [errorMessage, setErrorMessage] = useState("");
  const [destination, setDestination] = useState("/apps");
  const content = statusContent[status];

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const token = new URLSearchParams(window.location.search).get("token") || "";
    window.history.replaceState(null, "", window.location.pathname);

    if (!token) {
      setStatus("error");
      setErrorMessage("This verification link is missing or invalid.");
      return;
    }

    fetch("/api/platform-auth/verify-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Email verification failed. Please request a fresh link.");

      const next = data.user?.mfaRequired ? "/admin-mfa?next=/admin-center" : "/apps";
      setDestination(next);
      setStatus("success");
      window.setTimeout(() => window.location.replace(next), 1100);
    }).catch((error) => {
      setErrorMessage(error instanceof Error ? error.message : "Email verification failed. Please request a fresh link.");
      setStatus("error");
    });
  }, []);

  return (
    <main className={styles.page}>
      <div className={styles.glow} aria-hidden="true" />
      <a className={styles.brand} href="/" aria-label="AgenticThat home">
        <span>AT</span>
        <strong>AgenticThat</strong>
      </a>

      <section className={styles.card} aria-live="polite" aria-busy={status === "verifying"}>
        <div className={`${styles.statusIcon} ${styles[status]}`}>
          <StatusIcon status={status} />
        </div>
        <p className={styles.eyebrow}>{content.eyebrow}</p>
        <h1>{content.title}</h1>
        <p className={styles.description}>{content.description}</p>

        {status === "verifying" && (
          <div className={styles.progress} aria-label="Verification in progress">
            <i /><i /><i />
          </div>
        )}

        {status === "success" && (
          <a className={styles.primaryAction} href={destination}>Open workspace now <span aria-hidden="true">&#8594;</span></a>
        )}

        {status === "error" && (
          <div className={styles.errorPanel}>
            <p role="alert">{errorMessage}</p>
            <a className={styles.primaryAction} href="/?auth=login">Return to sign in <span aria-hidden="true">&#8594;</span></a>
          </div>
        )}

        <footer>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.8 2.8 8.3 7 10 4.2-1.7 7-5.2 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
          <span><strong>Secure account verification</strong>Your link is encrypted, time-limited, and works only once.</span>
        </footer>
      </section>

      <p className={styles.help}>Need help? Return to sign in to request a new verification email.</p>
    </main>
  );
}
