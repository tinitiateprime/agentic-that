import { requireUser } from "@whatsapp/lib/auth";
import { listTemplates } from "@whatsapp/lib/data";
import { metaGetTemplates, metaTemplatesConfigured } from "@whatsapp/lib/wa/provider";
import { credsForBusiness } from "@whatsapp/lib/tenant";
import MetaTemplatesManager from "@whatsapp/components/MetaTemplatesManager";
import TemplatesCard from "@whatsapp/components/TemplatesCard";

export const metadata = { title: "Templates — Tinitiate WA" };

export default async function TemplatesPage() {
  const user = await requireUser();
  const creds = await credsForBusiness(user.business_id);
  const templates = await listTemplates(user.business_id);
  const configured = metaTemplatesConfigured(creds);
  let metaTemplates = [];
  let error = "";
  if (configured) {
    try {
      metaTemplates = await metaGetTemplates({ approvedOnly: false, creds });
    } catch (err) {
      error = err.message;
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Templates</h1>
        <p className="text-sm text-slate-500">
          Canned quick replies for chat &amp; broadcasts, and WhatsApp templates approved by Meta
          for messaging outside the 24h session window.
        </p>
      </div>

      <TemplatesCard templates={templates} />

      <MetaTemplatesManager
        initialTemplates={metaTemplates}
        configured={configured}
        initialError={error}
      />
    </div>
  );
}
