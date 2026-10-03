import { requireGlobalAdmin } from "@platform/server/access-control";
import ProjectManagement from "./ProjectManagement";
import "./project-management.css";

export const metadata = { title: "Project Management - AgenticThat" };
export const dynamic = "force-dynamic";

export default async function ProjectManagementPage() {
  const principal = await requireGlobalAdmin("/project-management");
  return <ProjectManagement principal={{ name: principal.name, email: principal.email }} />;
}
