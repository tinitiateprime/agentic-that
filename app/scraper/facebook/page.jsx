import FacebookScraperConsole from "@facebook/console/src/FacebookScraperConsole";
import ProductShell from "@platform/ProductShell";
import { createServiceIdentityToken } from "@platform/server/auth-store";
import { requireAccess } from "@platform/server/access-control";

export const metadata = { title: "Facebook Scraper - AgenticThat" };

export default async function FacebookScraperPage() {
  const user = await requireAccess("scraping.facebook", "view", "/scraper/facebook");
  return <ProductShell
    user={{ id: user.userId, name: user.name, email: user.email, businessName: user.businessName, isGlobalAdmin: user.isGlobalAdmin, billingStatus: user.billingStatus, trialEndsAt: user.trialEndsAt }}
    active="apps"
  >
    <FacebookScraperConsole publishingIdentityToken={await createServiceIdentityToken(user, "scraping")} />
  </ProductShell>;
}
