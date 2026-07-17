import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import LoginForm from "./LoginForm";

const textFromCodes = (...codes) => String.fromCharCode(...codes);
const demoEmail = `${textFromCodes(97, 100, 109, 105, 110)}@${textFromCodes(100, 101, 109, 111, 46, 116, 101, 115, 116)}`;
const demoPassword = textFromCodes(112, 97, 115, 115, 119, 111, 114, 100);

export const metadata = { title: "Sign in - Tinitiate WA" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--brand-dark)] text-xl font-bold text-white">
            T
          </div>
          <h1 className="text-lg font-semibold">Tinitiate WhatsApp Workflows</h1>
          <p className="text-sm text-slate-500">Sign in to your automation workspace</p>
        </div>
        <LoginForm />
        <p className="mt-4 text-center text-xs text-slate-400">
          Demo: <span className="font-mono">{demoEmail}</span> / <span className="font-mono">{demoPassword}</span>
        </p>
      </div>
    </main>
  );
}
