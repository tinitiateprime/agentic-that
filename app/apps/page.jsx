import { redirect } from "next/navigation";
import AppsExplorer from "@platform/AppsExplorer";
import { getCurrentPrincipal } from "@platform/server/access-control";

export const metadata = {
  title: "Apps — AgenticThat",
  description: "Choose, connect, and open AgenticThat messaging, publishing, scraping, SEO, and engagement services.",
};

export default async function AppsPage() {
  const user = await getCurrentPrincipal();
  if (!user) redirect("/?auth=login&next=/apps");
  if (user.status === "pending") redirect("/pending-approval");
  if (user.status !== "active") redirect("/pending-approval");

  return (
    <AppsExplorer
      user={{
        id: user.userId,
        name: user.name,
        email: user.email,
        businessName: user.businessName,
        isGlobalAdmin: user.isGlobalAdmin,
        billingStatus: user.billingStatus,
        trialEndsAt: user.trialEndsAt,
      }}
      access={user.access}
    />
  );
}
