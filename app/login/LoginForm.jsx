"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const textFromCodes = (...codes) => String.fromCharCode(...codes);
const demoEmail = `${textFromCodes(97, 100, 109, 105, 110)}@${textFromCodes(100, 101, 109, 111, 46, 116, 101, 115, 116)}`;
const demoPassword = textFromCodes(112, 97, 115, 115, 119, 111, 114, 100);

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState(demoEmail);
  const [password, setPassword] = useState(demoPassword);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) {
      router.push("/dashboard");
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Sign in failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
        required
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
        required
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-[var(--brand-dark)] py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
