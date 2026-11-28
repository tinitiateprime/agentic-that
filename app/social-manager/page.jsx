import { redirect } from "next/navigation";
import ProductShell from "@platform/ProductShell";
import { requireOpenServicePrincipal } from "@platform/server/access-control";
import { socialAnalyticsReport } from "@platform/server/social-analytics-store";
import { autoSyncState } from "@platform/server/social-analytics-sync";
import SocialManager from "./SocialManager";
import "./social-manager.css";

export const metadata = { title: "Social Manager - AgenticThat" };
export const dynamic = "force-dynamic";

// Social Manager: post performance analytics (and, next, the unified inbox).
// Every member of the company can open it.
// Finished automatic updates are added first, so the numbers include them.
async function reportWithAutoSync(principal) {
  const autoSync = await autoSyncState(principal.workspaceId);
  return { ...(await socialAnalyticsReport(principal, { days: 30 })), autoSync };
}

export default async function SocialManagerPage() {
  const principal = await requireOpenServicePrincipal("/social-manager");
  if (!principal.workspaceId) redirect("/apps");
  return (
    <ProductShell user={principal} active="social-manager">
      <SocialManager workspaceName={principal.businessName || ""} workspaceId={principal.workspaceId} initialReport={await reportWithAutoSync(principal)} />
    </ProductShell>
  );
}
