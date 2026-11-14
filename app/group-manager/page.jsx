import ProductShell from "@platform/ProductShell";
import GroupManagerWorkspace from "@platform/group-manager/GroupManagerWorkspace";
import { requireOpenServicePrincipal } from "@platform/server/access-control";

export const metadata = {
  title: "Group Manager — AgenticThat",
  description: "Create groups once and they're made in your real WhatsApp, Telegram and Discord. Keep every contact's numbers and IDs in Contact Master, add people and message everyone in one go.",
};

export const dynamic = "force-dynamic";

// Group Manager is open to every signed-in user; it works through their own
// Companion and their own WhatsApp, Telegram and Discord.
export default async function GroupManagerPage() {
  const principal = await requireOpenServicePrincipal("/group-manager");

  const user = {
    id: principal.userId,
    name: principal.name,
    email: principal.email,
    businessName: principal.businessName,
    isGlobalAdmin: principal.isGlobalAdmin,
    billingStatus: principal.billingStatus,
    trialStartsAt: principal.trialStartsAt,
    trialEndsAt: principal.trialEndsAt,
    capabilities: principal.capabilities,
  };

  return (
    <ProductShell user={user} active="groups" companionBridge={false}>
      <main>
        <GroupManagerWorkspace workspaceName={principal.businessName || ""} />
      </main>
    </ProductShell>
  );
}
