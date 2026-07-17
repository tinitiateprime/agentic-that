import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import {
  getGroup,
  listGroupMembers,
  listContactsNotInGroup,
  listTemplates,
} from "@/lib/data";
import { metaListPhoneNumbers, metaTemplatesConfigured } from "@/lib/wa/provider";
import GroupDetail from "./GroupDetail";

export async function generateMetadata({ params }) {
  const { id } = await params;
  return { title: `Group #${id} — Tinitiate WA` };
}

export default async function GroupDetailPage({ params }) {
  const user = await requireUser();
  const { id } = await params;

  const group = await getGroup(user.business_id, id);
  if (!group) notFound();

  const members = await listGroupMembers(group.id);
  const available = await listContactsNotInGroup(user.business_id, group.id);
  const templates = await listTemplates(user.business_id);
  // Sender numbers on the WABA — lets the broadcast pick which business number
  // to send from when there's more than one.
  const phoneNumbers = metaTemplatesConfigured() ? await metaListPhoneNumbers().catch(() => []) : [];

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
        available={available}
        templates={templates}
        phoneNumbers={phoneNumbers}
      />
    </div>
  );
}
