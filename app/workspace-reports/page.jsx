import { redirect } from "next/navigation";
import ProductShell from "@platform/ProductShell";
import { requireOpenServicePrincipal } from "@platform/server/access-control";
import { workspaceActivityReport } from "@platform/server/workspace-reports-store";
import WorkspaceReports from "./WorkspaceReports";
import "./workspace-reports.css";

export const metadata = { title: "Reports - AgenticThat" };

export default async function WorkspaceReportsPage() {
  const principal = await requireOpenServicePrincipal("/workspace-reports");
  if (!principal.workspaceId) redirect("/apps");
  return (
    <ProductShell user={principal} active="reports">
      <WorkspaceReports initialReport={await workspaceActivityReport(principal, { days: 30 })} currentUserId={principal.userId} />
    </ProductShell>
  );
}
