import { redirect } from "next/navigation";
import AppsExplorer from "@platform/AppsExplorer";
import { getCurrentPlatformUser } from "@platform/server/auth-store";

export const metadata = {
  title: "Apps — AgenticThat",
  description: "Choose, connect, and open AgenticThat messaging, publishing, scraping, and engagement services.",
};

export default async function AppsPage() {
  const user = await getCurrentPlatformUser();
  if (!user) redirect("/?auth=login&next=/apps");

  return (
    <AppsExplorer
      user={{
        id: user.id,
        name: user.name,
        email: user.email,
        businessName: user.businessName,
      }}
    />
  );
}
