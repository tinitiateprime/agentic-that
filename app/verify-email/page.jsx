"use client";

import { useEffect, useState } from "react";

const card = { maxWidth: 520, margin: "12vh auto", padding: 32, border: "1px solid #dbe2ea", borderRadius: 18, background: "white", fontFamily: "Arial, sans-serif" };

export default function VerifyEmailPage() {
  const [message, setMessage] = useState("Verifying your email…");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token") || "";
    if (!token) {
      setMessage("This verification link is invalid.");
      return;
    }
    fetch("/api/platform-auth/verify-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Email verification failed.");
      setMessage("Email verified. Opening your workspace…");
      window.location.replace(data.user?.mfaRequired ? "/admin-mfa?next=/admin-center" : "/apps");
    }).catch((error) => setMessage(error instanceof Error ? error.message : "Email verification failed."));
  }, []);

  return <main style={card}><h1>Verify email</h1><p>{message}</p><a href="/?auth=login">Return to sign in</a></main>;
}
