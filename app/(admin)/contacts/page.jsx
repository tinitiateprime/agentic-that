import { requireUser } from "@/lib/auth";
import { listContactThreads } from "@/lib/data";
import { metaListPhoneNumbers, metaTemplatesConfigured } from "@/lib/wa/provider";
import NotificationCenter from "./NotificationCenter";

export const metadata = { title: "Notification Center — Tinitiate WA" };

export default async function ContactsPage() {
  const user = await requireUser();
  const contacts = await listContactThreads(user.business_id);
  const provider = (process.env.WA_PROVIDER || "mock").toLowerCase();
  // Sender numbers on the WABA — lets a new quick-chat pick which business
  // number to send from when there's more than one.
  const phoneNumbers = metaTemplatesConfigured() ? await metaListPhoneNumbers().catch(() => []) : [];

  return <NotificationCenter contacts={contacts} provider={provider} phoneNumbers={phoneNumbers} />;
}
