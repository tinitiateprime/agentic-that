import FacebookScraperConsole from "@facebook/console/src/FacebookScraperConsole";
import ProductShell from "@platform/ProductShell";
import { createServiceIdentityToken } from "@platform/server/auth-store";
import { requireAccess, requireCapability } from "@platform/server/access-control";

export const metadata = { title: "Facebook Scraper - AgenticThat" };

export default async function FacebookScraperPage() {
  await requireAccess("scraping.facebook", "view", "/scraper/facebook");
  const user = await requireCapability("scraping.view", "/scraper/facebook");
  return <ProductShell
    user={{ id: user.userId, name: user.name, email: user.email, businessName: user.businessName, isGlobalAdmin: user.isGlobalAdmin, billingStatus: user.billingStatus, trialStartsAt: user.trialStartsAt, trialEndsAt: user.trialEndsAt, capabilities: user.capabilities }}
    active="apps"
  >
    <FacebookScraperConsole publishingIdentityToken={await createServiceIdentityToken(user, "scraping")} capabilities={user.capabilities} />
  </ProductShell>;
}
