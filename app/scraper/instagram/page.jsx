import InstagramScraperConsole from "@instagram/console/src/InstagramScraperConsole";
import ProductShell from "@platform/ProductShell";
import { createPublishingIdentityToken, getCurrentPlatformUser } from "@platform/server/auth-store";
import { redirect } from "next/navigation";

export const metadata = {
  title: "Instagram Scraper - AgenticThat",
};

export default async function InstagramScraperPage() {
  const user = await getCurrentPlatformUser();
  if (!user) {
    redirect("/?auth=login&next=/scraper/instagram");
  }
  return (
    <ProductShell
      user={{ id: user.id, name: user.name, email: user.email, businessName: user.businessName }}
      active="apps"
    >
      <InstagramScraperConsole publishingIdentityToken={await createPublishingIdentityToken(user)} />
    </ProductShell>
  );
}
