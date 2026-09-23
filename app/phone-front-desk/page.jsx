import ProductShell from "@platform/ProductShell";
import PhoneFrontDeskWorkspace from "@platform/PhoneFrontDeskWorkspace";
import {
  principalHasAccess,
  principalHasCapability,
  requireAccess,
  requirePrincipalCapability,
} from "@platform/server/access-control";
import "./phone-front-desk.css";

export const metadata = {
  title: "AI Phone Front Desk — AgenticThat",
  description: "Run a natural AI receptionist demo, capture leads and review instant call summaries.",
};

export const dynamic = "force-dynamic";

export default async function PhoneFrontDeskPage() {
  let principal = await requireAccess("messaging.ai-phone-front-desk", "view", "/phone-front-desk");
  principal = await requirePrincipalCapability(principal, "messaging.view", "/phone-front-desk");
  const canOperate = principalHasAccess(principal, "messaging.ai-phone-front-desk", "operate")
    && principalHasCapability(principal, "messaging.operate");
  const canConfigure = principalHasAccess(principal, "messaging.ai-phone-front-desk", "configure")
    && principalHasCapability(principal, "messaging.configure");

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
    <ProductShell user={user} active="apps" companionBridge={false}>
      <main className="phone-front-desk-shell">
        <PhoneFrontDeskWorkspace canOperate={canOperate} canConfigure={canConfigure} />
      </main>
    </ProductShell>
  );
}
