import { requireGlobalAdmin } from "@platform/server/access-control";
import AdminCenter from "./AdminCenter";
import "./admin-center.css";
import "./email-studio.css";

export const metadata = { title: "Admin Center - AgenticThat" };
export const dynamic = "force-dynamic";

export default async function AdminCenterPage() {
  const principal = await requireGlobalAdmin();
  return <AdminCenter initialData={null} principal={principal} />;
}
