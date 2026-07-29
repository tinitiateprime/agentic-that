import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@whatsapp/lib/auth";
import SignupForm from "./SignupForm";

export const metadata = { title: "Create your workspace — Tinitiate WA" };

export default async function SignupPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--brand-dark)] text-xl font-bold text-white">
            T
          </div>
          <h1 className="text-lg font-semibold">Create your workspace</h1>
          <p className="text-sm text-slate-500">
            Start automating WhatsApp for your business — connect your own WhatsApp Business Account next.
          </p>
        </div>
        <SignupForm />
        <p className="mt-4 text-center text-xs text-slate-500">
          Already have an account?{" "}
          <Link href="/whatsapp/login" className="text-[var(--brand-dark)] underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
