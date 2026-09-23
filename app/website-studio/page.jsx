import ProductShell from "@platform/ProductShell";
import WebsiteStudioWorkspace from "@platform/WebsiteStudioWorkspace";
import {
  principalHasAccess,
  principalHasCapability,
  requireAccess,
  requirePrincipalCapability,
} from "@platform/server/access-control";
import "./website-studio.css";

export const metadata = {
  title: "AI Website Studio — AgenticThat",
  description: "Generate, validate, deliver and publish complete business websites automatically.",
};

export const dynamic = "force-dynamic";

export default async function WebsiteStudioPage() {
  let principal = await requireAccess("website.ai-website-studio", "view", "/website-studio");
  principal = await requirePrincipalCapability(principal, "website.view", "/website-studio");
  const canGenerate = principalHasAccess(principal, "website.ai-website-studio", "operate")
    && principalHasCapability(principal, "website.generate");

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
      <main className="website-studio-shell">
        <WebsiteStudioWorkspace canGenerate={canGenerate} />
      </main>
    </ProductShell>
  );
}
