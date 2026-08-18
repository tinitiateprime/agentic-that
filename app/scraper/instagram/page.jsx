import InstagramScraperConsole from "@instagram/console/src/InstagramScraperConsole";
import ProductShell from "@platform/ProductShell";
import { createServiceIdentityToken } from "@platform/server/auth-store";
import { requireAccess, requireCapability } from "@platform/server/access-control";

export const metadata = {
  title: "Instagram Scraper - AgenticThat",
};

export default async function InstagramScraperPage() {
  await requireAccess("scraping.instagram", "view", "/scraper/instagram");
  const user = await requireCapability("scraping.view", "/scraper/instagram");
  return (
    <ProductShell
      user={{ id: user.userId, name: user.name, email: user.email, businessName: user.businessName, isGlobalAdmin: user.isGlobalAdmin, billingStatus: user.billingStatus, trialStartsAt: user.trialStartsAt, trialEndsAt: user.trialEndsAt, capabilities: user.capabilities }}
      active="apps"
    >
      <InstagramScraperConsole publishingIdentityToken={await createServiceIdentityToken(user, "scraping")} capabilities={user.capabilities} />
    </ProductShell>
  );
}
