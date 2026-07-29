import { redirect } from "next/navigation";
import { getSql } from "@whatsapp/lib/db";
import { requireUser } from "@whatsapp/lib/auth";
import { getAccountForBusiness, listTenantNumbers } from "@whatsapp/lib/tenant";
import { hasEncryptionKey } from "@whatsapp/lib/crypto";
import OnboardingWizard from "./OnboardingWizard";

export const metadata = { title: "Set up your workspace — Tinitiate WA" };

export default async function OnboardingPage() {
  const user = await requireUser();
  const sql = await getSql();
  const [business] = await sql`SELECT * FROM businesses WHERE id = ${user.business_id}`;

  // Already set up — no reason to sit in the wizard.
  if (business?.onboarded_at) redirect("/dashboard");

  const account = await getAccountForBusiness(user.business_id);
  const numbers = account ? await listTenantNumbers(user.business_id) : [];

  return (
    <main className="min-h-screen bg-slate-50 p-4 py-10">
      <OnboardingWizard
        initial={{
          business,
          connected: Boolean(account),
          account: account
            ? { waba_id: account.waba_id, api_version: account.api_version, app_id: account.app_id }
            : null,
          numbers,
          encryptionReady: hasEncryptionKey(),
          metaAppId: process.env.META_APP_ID || "",
          metaConfigId: process.env.META_CONFIGURATION_ID || "",
        }}
      />
    </main>
  );
}
