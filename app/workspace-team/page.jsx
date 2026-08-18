import ProductShell from "@platform/ProductShell";
import { requireCapability } from "@platform/server/access-control";
import { workspaceTeamSnapshot } from "@platform/server/workspace-team-store";
import WorkspaceTeam from "./WorkspaceTeam";
import "./workspace-team.css";

export const metadata = { title: "Workspace Team - AgenticThat" };

export default async function WorkspaceTeamPage() {
  const principal = await requireCapability("workspace.team.manage", "/workspace-team");
  return (
    <ProductShell user={principal} active="team">
      <WorkspaceTeam initialData={await workspaceTeamSnapshot(principal)} currentUserId={principal.userId} />
    </ProductShell>
  );
}
