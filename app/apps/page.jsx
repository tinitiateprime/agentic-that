import { redirect } from "next/navigation";
import AppsExplorer from "@platform/AppsExplorer";
import { getCurrentPrincipal } from "@platform/server/access-control";

export const metadata = {
  title: "AgenticThat Store — messaging, publishing, scraping and SEO apps",
  description:
    "Browse AgenticThat apps: WhatsApp and Telegram messaging, publishing to Instagram, Facebook, X, LinkedIn and YouTube, Instagram and Facebook scraping, plus SEO and engagement tools.",
  alternates: { canonical: "/apps" },
};

// Public: anyone can browse the Store. Signing in is only needed to connect or open an app.
export default async function AppsPage() {
  const user = await getCurrentPrincipal();
  if (user && user.status !== "active") redirect("/pending-approval");

  return (
    <AppsExplorer
      user={user ? {
        id: user.userId,
        name: user.name,
        email: user.email,
        businessName: user.businessName,
        isGlobalAdmin: user.isGlobalAdmin,
        billingStatus: user.billingStatus,
        trialStartsAt: user.trialStartsAt,
        trialEndsAt: user.trialEndsAt,
        capabilities: user.capabilities,
      } : null}
      access={user?.access || {}}
    />
  );
}
