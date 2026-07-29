import { redirect } from "next/navigation";
import { requireUser } from "@whatsapp/lib/auth";
import { getBusiness } from "@whatsapp/lib/data";
import Nav from "@whatsapp/components/Nav";

export default async function AdminLayout({ children }) {
  const user = await requireUser();
  const business = await getBusiness(user.business_id);

  // A workspace that hasn't finished self-serve setup has no WhatsApp account
  // connected, so every page here would be empty or error — send them to the
  // wizard instead.
  if (business && !business.onboarded_at) redirect("/whatsapp/onboarding");

  return (
    <div className="min-h-screen">
      <Nav businessName={business?.name} />
      {/* sm:pl-60 clears the fixed left sidebar; pb-24 clears the mobile bottom nav.
          Full width (no max-w cap) — several components (stat cards, the chat
          view) already scale up via lg: breakpoints for wider screens. */}
      <main className="min-h-screen px-4 pb-24 pt-4 sm:pb-8 sm:pl-60">{children}</main>
    </div>
  );
}
