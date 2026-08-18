import { requireGlobalAdmin } from "@platform/server/access-control";
import { adminCenterSnapshot } from "@platform/server/admin-center-store";
import AdminCenter from "./AdminCenter";
import "./admin-center.css";

export const metadata = { title: "Admin Center - AgenticThat" };
export const dynamic = "force-dynamic";

export default async function AdminCenterPage() {
  const principal = await requireGlobalAdmin();
  return <AdminCenter initialData={await adminCenterSnapshot()} principal={principal} />;
}
