import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@whatsapp/lib/auth";
import {
  getGroup,
  listGroupMembers,
  listContactsNotInGroup,
  listNewGroupMembers,
  listTemplates,
} from "@whatsapp/lib/data";
import { metaListPhoneNumbers, metaTemplatesConfigured } from "@whatsapp/lib/wa/provider";
import GroupDetail from "./GroupDetail";
import { credsForBusiness } from "@whatsapp/lib/tenant";

export async function generateMetadata({ params }) {
  const { id } = await params;
  return { title: `Group #${id} — Tinitiate WA` };
}

export default async function GroupDetailPage({ params }) {
  const user = await requireUser();
  const creds = await credsForBusiness(user.business_id);
  const { id } = await params;

  const group = await getGroup(user.business_id, id);
  if (!group) notFound();

  const members = await listGroupMembers(group.id);
  // Members we've never messaged — the audience for the welcome template.
  const newMembers = await listNewGroupMembers(group.id);
  const available = await listContactsNotInGroup(user.business_id, group.id);
  const templates = await listTemplates(user.business_id);
  // Sender numbers on the WABA — lets the broadcast pick which business number
  // to send from when there's more than one.
  const phoneNumbers = metaTemplatesConfigured(creds) ? await metaListPhoneNumbers(creds).catch(() => []) : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/groups" className="text-sm text-slate-500">
          ← Groups
        </Link>
      </div>

      <GroupDetail
        group={group}
        members={members}
        newMemberCount={newMembers.length}
        available={available}
        templates={templates}
        phoneNumbers={phoneNumbers}
      />
    </div>
  );
}
