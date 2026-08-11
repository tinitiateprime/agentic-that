import FacebookScraperConsole from "@facebook/console/src/FacebookScraperConsole";
import ProductShell from "@platform/ProductShell";
import { createPublishingIdentityToken, getCurrentPlatformUser } from "@platform/server/auth-store";
import { redirect } from "next/navigation";

export const metadata = { title: "Facebook Scraper - AgenticThat" };

export default async function FacebookScraperPage() {
  const user = await getCurrentPlatformUser();
  if (!user) redirect("/?auth=login&next=/scraper/facebook");
  return <ProductShell
    user={{ id: user.id, name: user.name, email: user.email, businessName: user.businessName }}
    active="apps"
  >
    <FacebookScraperConsole publishingIdentityToken={await createPublishingIdentityToken(user)} />
  </ProductShell>;
}
