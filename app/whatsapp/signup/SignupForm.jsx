"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SignupForm() {
  const router = useRouter();
  const [form, setForm] = useState({ businessName: "", name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/whatsapp/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not create your account");
      // New workspaces always land in onboarding — WhatsApp isn't connected yet.
      router.push(data.next || "/whatsapp/onboarding");
      router.refresh();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input
        value={form.businessName}
        onChange={set("businessName")}
        placeholder="Business name"
        required
        className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
      />
      <input
        value={form.name}
        onChange={set("name")}
        placeholder="Your name"
        className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
      />
      <input
        type="email"
        value={form.email}
        onChange={set("email")}
        placeholder="Work email"
        required
        className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
      />
      <input
        type="password"
        value={form.password}
        onChange={set("password")}
        placeholder="Password (min 8 characters)"
        required
        minLength={8}
        className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-[var(--brand)]"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-[var(--brand-dark)] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Creating your workspace…" : "Create workspace"}
      </button>
    </form>
  );
}
