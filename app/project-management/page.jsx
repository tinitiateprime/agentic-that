import { requireGlobalAdmin } from "@platform/server/access-control";
import ProductShell from "@platform/ProductShell";
import ProjectManagement from "./ProjectManagement";
import "./project-management.css";

export const metadata = { title: "Project Management - AgenticThat" };
export const dynamic = "force-dynamic";

export default async function ProjectManagementPage() {
  const principal = await requireGlobalAdmin("/project-management");
  return (
    <ProductShell user={principal} active="admin" companionBridge={false} embedded>
      <ProjectManagement principal={{ name: principal.name, email: principal.email }} />
    </ProductShell>
  );
}
