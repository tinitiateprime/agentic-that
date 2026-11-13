import ProductShell from "@platform/ProductShell";
import SocialSeoWorkspace from "@platform/social-seo/SocialSeoWorkspace";
import { requireOpenServicePrincipal } from "@platform/server/access-control";

export const metadata = {
  title: "Social SEO — AgenticThat",
  description: "Upload a post and get ready-to-post captions, hashtags and alt text for Instagram, Facebook, LinkedIn and YouTube, written by your own ChatGPT, Claude or Gemini.",
};

export const dynamic = "force-dynamic";

// Social SEO is open to every signed-in user; no role or plan is required.
export default async function SocialSeoPage() {
  const principal = await requireOpenServicePrincipal("/social-seo");

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
    <ProductShell user={user} active="social-seo" companionBridge={false}>
      <main>
        <SocialSeoWorkspace canGenerate workspaceName={principal.businessName || ""} />
      </main>
    </ProductShell>
  );
}
